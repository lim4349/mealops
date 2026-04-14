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
  label: string;
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

    const ranked = available
      .map(restaurant => this.rankRestaurant(restaurant, weather, preference, recent3, visits90, previousSet, budget))
      .sort((a, b) => b.score - a.score);

    const selected = this.selectRecommendations(ranked, preference, previousSet);

    return selected.map(item => ({
      name: item.restaurant.name,
      reason: item.label,
      category: item.restaurant.category,
      distance: item.restaurant.distance,
      price: item.restaurant.price,
    }));
  }

  private rankRestaurant(
    restaurant: Restaurant,
    weather: WeatherInfo,
    preference: QueryPreference,
    recent3: Set<string>,
    visits90: Map<number, number>,
    previousSet: Set<string>,
    budget: number
  ): RankedCandidate {
    const tags = this.parseTags(restaurant.tags);
    const rating = this.reviewRepo.getAverageRating(restaurant.id);
    const visitCount = visits90.get(restaurant.id) ?? 0;
    const distance = restaurant.distance ?? 0;
    const rainy = weather.condition === 'rain' || weather.condition === 'snow';

    let score = 0;

    score += Math.random() * (preference.hasQuery ? 0.9 : 1.8);
    score += Math.max(0.6, 2.6 - distance / 140);
    score += Math.max(0, rating) * 0.65;
    score -= visitCount * 0.38;
    if (recent3.has(restaurant.name)) score -= 2.2;
    if (previousSet.has(restaurant.name)) score -= preference.hasQuery ? 1.4 : 2.0;
    if (restaurant.price > budget) score -= 0.9;

    if (rainy) score += Math.max(0, 2.4 - distance / 110);
    if (weather.temp <= 10 && this.matchesAnyTag(tags, ['국밥', '탕', '찌개', '국물', '라멘', '우동'])) score += 1.9;
    if (weather.temp >= 25 && this.matchesAnyTag(tags, ['냉면', '쌀국수', '면', '시원'])) score += 1.8;

    if (preference.near) score += Math.max(0, 3.0 - distance / 90);
    if (preference.far) score += Math.min(2.2, distance / 180);

    if (preference.categories.size > 0 && preference.categories.has(restaurant.category)) {
      score += 4.4;
    }

    if (preference.spicy && this.matchesAnyTag(tags, ['매운', '마라', '얼큰'])) score += 2.6;
    if (preference.soup && this.matchesAnyTag(tags, ['국물', '탕', '찌개', '국밥'])) score += 2.4;
    if (preference.noodle && this.matchesAnyTag(tags, ['냉면', '라멘', '우동', '국수', '쌀국수', '면'])) score += 2.2;
    if (preference.rice && this.matchesAnyTag(tags, ['덮밥', '비빔밥', '볶음밥', '국밥', '밥'])) score += 2.0;
    if (preference.meat && this.matchesAnyTag(tags, ['고기', '갈비', '불고기', '삼겹', '돈까스'])) score += 2.0;
    if (preference.coolFood && this.matchesAnyTag(tags, ['냉면', '시원', '냉', '쌀국수'])) score += 2.1;
    if (preference.warmFood && this.matchesAnyTag(tags, ['국물', '탕', '찌개', '해장', '국밥'])) score += 2.1;

    const label = this.buildDisplayLabel(restaurant, tags, weather, preference, recent3, visitCount);
    return { restaurant, score, label };
  }

  private selectRecommendations(
    ranked: RankedCandidate[],
    preference: QueryPreference,
    previousSet: Set<string>
  ): RankedCandidate[] {
    const selected: RankedCandidate[] = [];
    const usedNames = new Set<string>();
    const usedCategories = new Set<string>();
    const poolSize = Math.min(ranked.length, preference.hasQuery ? 12 : 16);
    const pool = ranked.slice(0, poolSize);

    while (selected.length < 5) {
      const remaining = pool.filter(item => !usedNames.has(item.restaurant.name));
      if (remaining.length === 0) break;

      const minScore = Math.min(...remaining.map(item => item.score));
      const weighted = remaining.map(item => {
        let weight = Math.max(0.2, item.score - minScore + 1.25);
        if (previousSet.has(item.restaurant.name)) weight *= preference.hasQuery ? 0.55 : 0.35;
        if ((!preference.hasQuery || preference.categories.size === 0) && !usedCategories.has(item.restaurant.category)) {
          weight *= 1.25;
        } else if (!preference.hasQuery && usedCategories.has(item.restaurant.category)) {
          weight *= 0.85;
        }
        return { item, weight };
      });

      const picked = this.pickWeighted(weighted);
      if (!picked) break;

      selected.push(picked);
      usedNames.add(picked.restaurant.name);
      usedCategories.add(picked.restaurant.category);
    }

    for (const item of ranked) {
      if (selected.length >= 5) break;
      if (usedNames.has(item.restaurant.name)) continue;
      selected.push(item);
      usedNames.add(item.restaurant.name);
    }

    return selected.slice(0, 5);
  }

  private pickWeighted(items: Array<{ item: RankedCandidate; weight: number }>): RankedCandidate | undefined {
    const total = items.reduce((sum, item) => sum + item.weight, 0);
    if (total <= 0) return items[0]?.item;

    let cursor = Math.random() * total;
    for (const entry of items) {
      cursor -= entry.weight;
      if (cursor <= 0) return entry.item;
    }
    return items[items.length - 1]?.item;
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

    const categories = new Set<RestaurantCategory>();
    if (/한식/.test(q)) categories.add('한식');
    if (/일식|초밥|스시|라멘|우동/.test(q)) categories.add('일식');
    if (/중식|중국|짜장|짬뽕|마라|훠궈/.test(q)) categories.add('중식');
    if (/양식|파스타|피자|돈까스/.test(q)) categories.add('양식');
    if (/분식|김밥|떡볶이/.test(q)) categories.add('분식');
    if (/기타|베트남|태국|쌀국수/.test(q)) categories.add('기타');

    return {
      hasQuery: query.length > 0,
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

  private buildDisplayLabel(
    restaurant: Restaurant,
    tags: string[],
    weather: WeatherInfo,
    preference: QueryPreference,
    recent3: Set<string>,
    visitCount: number
  ): string {
    const menuHint = this.pickMenuHint(tags, preference, weather);
    if (menuHint) return menuHint;

    const distance = restaurant.distance ?? 0;
    const rainy = weather.condition === 'rain' || weather.condition === 'snow';

    if (preference.categories.has(restaurant.category)) return '요청 반영';
    if (preference.near && distance <= 150) return '가까운 곳';
    if (preference.far && distance >= 200) return '멀리 가볼 만한 곳';
    if (rainy && distance <= 120) return '비 오는 날 가까운 곳';
    if (weather.temp <= 10) return '따뜻하게 먹기 좋은 곳';
    if (weather.temp >= 25) return '가볍게 먹기 좋은 곳';
    if (recent3.has(restaurant.name)) return '오랜만에 다시 추천';
    if (visitCount <= 1) return '최근 덜 간 곳';
    return '오늘 추천';
  }

  private pickMenuHint(tags: string[], preference: QueryPreference, weather: WeatherInfo): string | undefined {
    const explicitMenu =
      (preference.noodle && this.findFirstTag(tags, ['냉면', '라멘', '우동', '국수', '쌀국수', '면'])) ||
      (preference.rice && this.findFirstTag(tags, ['덮밥', '비빔밥', '볶음밥', '국밥', '밥'])) ||
      (preference.soup && this.findFirstTag(tags, ['탕', '찌개', '국밥', '국물'])) ||
      (preference.spicy && this.findFirstTag(tags, ['마라', '얼큰', '매운'])) ||
      (preference.meat && this.findFirstTag(tags, ['갈비', '불고기', '삼겹', '돈까스', '고기'])) ||
      (preference.coolFood && this.findFirstTag(tags, ['냉면', '쌀국수', '냉', '시원'])) ||
      (preference.warmFood && this.findFirstTag(tags, ['국밥', '탕', '찌개', '해장', '국물']));

    if (explicitMenu) return explicitMenu;

    if (weather.temp <= 10) {
      const warmTag = this.findFirstTag(tags, ['국밥', '탕', '찌개', '라멘', '우동', '국물']);
      if (warmTag) return warmTag;
    }

    if (weather.temp >= 25) {
      const coolTag = this.findFirstTag(tags, ['냉면', '쌀국수', '시원', '냉']);
      if (coolTag) return coolTag;
    }

    return this.findFirstTag(tags, [
      '냉면', '라멘', '우동', '국수', '쌀국수',
      '덮밥', '비빔밥', '볶음밥', '국밥', '찌개',
      '탕', '마라', '돈까스', '초밥', '피자', '파스타',
      '김밥', '떡볶이', '불고기', '갈비', '삼겹'
    ]);
  }

  private parseTags(rawTags?: string): string[] {
    return (rawTags ?? '')
      .split(',')
      .map(tag => tag.trim())
      .filter(Boolean);
  }

  private matchesAnyTag(tags: string[], needles: string[]): boolean {
    return needles.some(needle => tags.some(tag => tag.includes(needle)));
  }

  private findFirstTag(tags: string[], needles: string[]): string | undefined {
    for (const needle of needles) {
      const match = tags.find(tag => tag.includes(needle));
      if (match) return match;
    }
    return undefined;
  }
}
