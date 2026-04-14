import type {
  RecommendationService,
  OllamaService,
  WeatherService,
  RestaurantRepository,
  BlacklistRepository,
  ReviewRepository,
  SelectedHistoryRepository,
  SettingRepository,
  Restaurant,
  RecommendationResult,
  WeatherInfo,
  RestaurantCategory,
} from '../core/types.js';

interface QueryPreference {
  hasQuery: boolean;
  near: boolean;
  far: boolean;
  spicy: boolean;
  soup: boolean;
  noodle: boolean;
  rice: boolean;
  meat: boolean;
  coolFood: boolean;
  warmFood: boolean;
  categories: Set<RestaurantCategory>;
}

interface RankedCandidate {
  restaurant: Restaurant;
  score: number;
  reason: string;
}

export class RecommendationServiceImpl implements RecommendationService {
  constructor(
    private ollamaService: OllamaService,
    private weatherService: WeatherService,
    private restaurantRepo: RestaurantRepository,
    private blacklistRepo: BlacklistRepository,
    private reviewRepo: ReviewRepository,
    private historyRepo: SelectedHistoryRepository,
    private settingRepo: SettingRepository
  ) {}

  async getRecommendations(
    userId: string,
    previousNames: string[] = [],
    userRequest?: string
  ): Promise<RecommendationResult[]> {
    const weather = await this.weatherService.getCurrent();
    const query = (userRequest ?? '').trim();
    const preference = this.parsePreference(query);
    const previousSet = new Set(previousNames);

    let restaurants = this.restaurantRepo.findAll();
    if (this.settingRepo.getDeliveryModeActive()) {
      restaurants = restaurants.filter(r => r.is_delivery);
    }

    const blacklisted = new Set(this.blacklistRepo.getUserBlacklist(userId).map(r => r.name));
    const recent3 = new Set(
      this.historyRepo
        .findRecent(3)
        .map(h => this.restaurantRepo.findById(h.restaurant_id)?.name)
        .filter(Boolean) as string[]
    );

    const visits90 = this.buildVisitCountMap(90);
    const budget = this.settingRepo.getBudget();

    const available = restaurants.filter(r => !blacklisted.has(r.name));
    if (available.length === 0) return [];

    const ranked = available.map(restaurant => {
      const score = this.scoreRestaurant({
        restaurant,
        weather,
        preference,
        recent3,
        visits90,
        previousSet,
        budget,
      });
      const reason = this.buildReason(restaurant, weather, preference, recent3, visits90);
      return { restaurant, score, reason };
    });

    ranked.sort((a, b) => b.score - a.score);
    const selected = this.pickTopFive(ranked, preference);
    const rotated = this.rotateIfSameFirst(selected, previousNames);

    return rotated.map(item => ({
      name: item.restaurant.name,
      reason: item.reason,
      category: item.restaurant.category,
      distance: item.restaurant.distance,
      price: item.restaurant.price,
    }));
  }

  private buildVisitCountMap(days: number): Map<number, number> {
    const map = new Map<number, number>();
    for (const h of this.historyRepo.findRecent(days)) {
      map.set(h.restaurant_id, (map.get(h.restaurant_id) ?? 0) + 1);
    }
    return map;
  }

  private parsePreference(query: string): QueryPreference {
    const q = query.toLowerCase();
    const has = query.length > 0;

    const categories = new Set<RestaurantCategory>();
    if (/한식/.test(q)) categories.add('한식');
    if (/일식|초밥|스시|라멘|우동/.test(q)) categories.add('일식');
    if (/중식|중국|짜장|짬뽕|마라|훠궈/.test(q)) categories.add('중식');
    if (/양식|파스타|피자|돈까스/.test(q)) categories.add('양식');
    if (/분식|김밥|떡볶이/.test(q)) categories.add('분식');
    if (/기타|베트남|태국|쌀국수/.test(q)) categories.add('기타');

    return {
      hasQuery: has,
      near: /가깝|근처|도보|빨리|가까운/.test(q),
      far: /멀|먼|드라이브|가볼/.test(q),
      spicy: /매운|얼큰|맵/.test(q),
      soup: /국물|탕|찌개|해장/.test(q),
      noodle: /면|라멘|국수|우동|냉면|쌀국수/.test(q),
      rice: /밥|덮밥|비빔밥|볶음밥|국밥/.test(q),
      meat: /고기|육|돈까스|갈비|삼겹/.test(q),
      coolFood: /시원|냉|차가운/.test(q),
      warmFood: /뜨끈|따뜻|온기|해장/.test(q),
      categories,
    };
  }

  private scoreRestaurant(params: {
    restaurant: Restaurant;
    weather: WeatherInfo;
    preference: QueryPreference;
    recent3: Set<string>;
    visits90: Map<number, number>;
    previousSet: Set<string>;
    budget: number;
  }): number {
    const { restaurant, weather, preference, recent3, visits90, previousSet, budget } = params;
    const tags = (restaurant.tags ?? '').toLowerCase();
    const rating = this.reviewRepo.getAverageRating(restaurant.id);
    const visits = visits90.get(restaurant.id) ?? 0;
    const distance = restaurant.distance ?? 0;

    let score = 0;

    // Random baseline so refresh without input changes naturally.
    score += Math.random() * 1.2;

    // Weather + distance
    const isRainy = weather.condition === 'rain' || weather.condition === 'snow';
    if (isRainy) score += Math.max(0, 2.8 - distance / 120);
    if (weather.temp < 10) score += this.hasAny(tags, ['국물', '탕', '찌개', '라멘', '국밥']) ? 1.7 : 0;
    if (weather.temp > 25) score += this.hasAny(tags, ['냉', '면', '쌀국수', '시원']) ? 1.5 : 0;

    // Quality / history
    score += rating * 0.65;
    score -= visits * 0.3;
    if (recent3.has(restaurant.name)) score -= 1.8;
    if (previousSet.has(restaurant.name)) score -= 1.1;
    if (restaurant.price > budget) score -= 0.8;

    // Distance preference
    if (preference.near) score += Math.max(0, 2.4 - distance / 130);
    if (preference.far) score += Math.min(2.2, distance / 220);

    // Category preference
    if (preference.categories.size > 0 && preference.categories.has(restaurant.category)) {
      score += 3.0;
    }

    // Query semantic preference from tags
    if (preference.spicy && this.hasAny(tags, ['매운', '마라', '얼큰'])) score += 1.8;
    if (preference.soup && this.hasAny(tags, ['국물', '탕', '찌개', '국밥'])) score += 1.8;
    if (preference.noodle && this.hasAny(tags, ['면', '라멘', '국수', '냉면', '쌀국수'])) score += 1.6;
    if (preference.rice && this.hasAny(tags, ['밥', '덮밥', '비빔밥', '볶음밥', '국밥'])) score += 1.4;
    if (preference.meat && this.hasAny(tags, ['고기', '갈비', '불고기', '삼겹', '돈까스'])) score += 1.4;
    if (preference.coolFood && this.hasAny(tags, ['냉', '시원', '냉면'])) score += 1.4;
    if (preference.warmFood && this.hasAny(tags, ['국물', '탕', '찌개', '해장'])) score += 1.4;

    return score;
  }

  private pickTopFive(ranked: RankedCandidate[], preference: QueryPreference): RankedCandidate[] {
    const selected: RankedCandidate[] = [];
    const usedNames = new Set<string>();
    const usedCategories = new Set<string>();
    const preferCategoryDiversity = !preference.hasQuery || preference.categories.size === 0;

    // 1st pass: diversity-first
    if (preferCategoryDiversity) {
      for (const item of ranked) {
        if (selected.length >= 5) break;
        if (usedNames.has(item.restaurant.name)) continue;
        if (usedCategories.has(item.restaurant.category)) continue;
        selected.push(item);
        usedNames.add(item.restaurant.name);
        usedCategories.add(item.restaurant.category);
      }
    }

    // 2nd pass: fill remaining by score order
    for (const item of ranked) {
      if (selected.length >= 5) break;
      if (usedNames.has(item.restaurant.name)) continue;
      selected.push(item);
      usedNames.add(item.restaurant.name);
    }

    return selected.slice(0, 5);
  }

  private rotateIfSameFirst(items: RankedCandidate[], previousNames: string[]): RankedCandidate[] {
    if (items.length < 2 || previousNames.length === 0) return items;
    if (items[0].restaurant.name !== previousNames[0]) return items;

    const nextIndex = items.findIndex((item, idx) => idx > 0 && item.restaurant.name !== items[0].restaurant.name);
    if (nextIndex > 0) {
      const swapped = [...items];
      [swapped[0], swapped[nextIndex]] = [swapped[nextIndex], swapped[0]];
      return swapped;
    }
    return items;
  }

  private buildReason(
    restaurant: Restaurant,
    weather: WeatherInfo,
    preference: QueryPreference,
    recent3: Set<string>,
    visits90: Map<number, number>
  ): string {
    const tags = (restaurant.tags ?? '').toLowerCase();
    const distance = restaurant.distance ?? 0;
    const visits = visits90.get(restaurant.id) ?? 0;
    const isRainy = weather.condition === 'rain' || weather.condition === 'snow';

    if (preference.categories.has(restaurant.category)) return '요청 조건 반영';
    if (preference.near && distance <= 150) return '가까운 곳';
    if (preference.far && distance >= 200) return '조금 먼 곳';
    if (preference.spicy && this.hasAny(tags, ['매운', '마라', '얼큰'])) return '매운 메뉴';
    if (preference.soup && this.hasAny(tags, ['국물', '탕', '찌개', '국밥'])) return '국물 메뉴';
    if (preference.noodle && this.hasAny(tags, ['면', '라멘', '국수', '냉면'])) return '면 요리';
    if (preference.rice && this.hasAny(tags, ['밥', '덮밥', '비빔밥', '볶음밥'])) return '밥 메뉴';
    if (preference.meat && this.hasAny(tags, ['고기', '갈비', '불고기', '삼겹'])) return '고기 메뉴';
    if (isRainy && distance <= 120) return '비/눈 대비';
    if (weather.temp > 25 && this.hasAny(tags, ['냉', '시원', '면'])) return '더운 날씨';
    if (weather.temp < 10 && this.hasAny(tags, ['국물', '탕', '찌개'])) return '추운 날씨';
    if (recent3.has(restaurant.name)) return '최근 방문';
    if (visits <= 1) return '최근 덜 간 곳';
    return '오늘 추천';
  }

  private hasAny(tags: string, needles: string[]): boolean {
    return needles.some(n => tags.includes(n));
  }
}
