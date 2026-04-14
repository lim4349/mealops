import type {
  RecommendationService,
  OllamaService,
  WeatherService,
  RestaurantRepository,
  BlacklistRepository,
  ReviewRepository,
  SelectedHistoryRepository,
  SettingRepository,
} from '../core/types.js';

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

  async getRecommendations(userId: string, previousNames: string[] = [], userRequest?: string): Promise<import('../core/types.js').RecommendationResult[]> {
    // Get current weather
    const weather = await this.weatherService.getCurrent();
    const previousNameSet = new Set(previousNames);

    // Get all active restaurants
    let allRestaurants = this.restaurantRepo.findAll();

    // Filter by delivery mode if active
    const deliveryModeActive = this.settingRepo.getDeliveryModeActive();
    if (deliveryModeActive) {
      allRestaurants = allRestaurants.filter(r => r.is_delivery);
    }

    // Get user's blacklist
    const blacklisted = this.blacklistRepo.getUserBlacklist(userId);
    const blacklistedNames = blacklisted.map(r => r.name);

    // Get recently visited (last 3 days)
    const recentHistory = this.historyRepo.findRecent(3);
    const recentVisits = recentHistory
      .map(h => this.restaurantRepo.findById(h.restaurant_id)?.name)
      .filter(Boolean) as string[];

    // Get top rated restaurants for logging/analysis (not for Ollama weighting)
    const allReviews = allRestaurants.map(r => ({
      name: r.name,
      rating: this.reviewRepo.getAverageRating(r.id),
    }))
      .filter(r => r.rating > 0)
      .sort((a, b) => b.rating - a.rating);

    // Don't pass topRated to Ollama - let it decide independently
    const topRated: string[] = [];

    const budget = this.settingRepo.getBudget();

    // 저평점 식당 필터링 (리뷰가 있는데 3.0 미만이면 제외)
    const lowRatedIds = new Set(
      allRestaurants
        .map(r => ({ id: r.id, rating: this.reviewRepo.getAverageRating(r.id) }))
        .filter(r => r.rating > 0 && r.rating < 3.0)
        .map(r => r.id)
    );

    // Build available list (excluding blacklisted, recent, low-rated)
    const availableRestaurants = allRestaurants.filter(r =>
      !blacklistedNames.includes(r.name) &&
      !recentVisits.includes(r.name) &&
      !lowRatedIds.has(r.id) &&
      !previousNameSet.has(r.name)
    );
    const availableNames = new Set(availableRestaurants.map(r => r.name));

    // 거리 정렬 방향 결정
    const isRainy = weather.condition === 'rain' || weather.condition === 'snow';
    const wantFar = /멀|먼\s*곳|먼\s*데|멀리/.test(userRequest ?? '');
    const wantNear = /가깝|가까운|가까이|근처/.test(userRequest ?? '');

    let sortedForOllama = availableRestaurants;
    if (wantFar) {
      sortedForOllama = [...availableRestaurants].sort((a, b) => b.distance - a.distance);
    } else if (wantNear || isRainy) {
      sortedForOllama = [...availableRestaurants].sort((a, b) => a.distance - b.distance);
    }

    const sortLabel = wantFar ? '먼거리순' : (wantNear || isRainy) ? '가까운순' : '기본';
    console.log(`[Recommend] available=${availableRestaurants.length}개, blacklisted=${blacklistedNames.length}개, recent=${recentVisits.join(',')}, lowRated=${lowRatedIds.size}개, 정렬=${sortLabel}${userRequest ? `, 요청="${userRequest}"` : ''}`);

    try {
      const recommendations = await this.ollamaService.recommend({
        weather,
        recentVisits,
        topRated,
        blacklisted: blacklistedNames,
        budget,
        availableRestaurants: sortedForOllama.map(r => ({
          name: r.name,
          category: r.category,
          price: r.price,
          distance: r.distance,
          tags: r.tags,
        })),
        previousRecommendations: previousNames,
        userRequest,
      });

      // DB에 존재하는 식당만 필터링
      const validRecommendations = recommendations.filter(r => availableNames.has(r.name));
      console.log(`[Recommend] Ollama 결과=${recommendations.length}개, 유효=${validRecommendations.length}개, Ollama반환:${recommendations.map(r=>r.name).join(',')}`);

      // If no valid recommendations, return fallback
      if (validRecommendations.length === 0) {
        console.log('[Recommend] → fallback 사용');
        return this.getFallbackRecommendations(weather, availableRestaurants);
      }

      // 후처리: 한국어 체크 + 카테고리/거리 보정 + 5개 보충
      return this.postProcess(validRecommendations, availableRestaurants, weather);
    } catch (error) {
      console.error('Recommendation error:', error);
      return this.getFallbackRecommendations(weather, availableRestaurants);
    }
  }

  private postProcess(
    recs: import('../core/types.js').RecommendationResult[],
    available: import('../core/types.js').Restaurant[],
    weather: import('../core/types.js').WeatherInfo
  ): import('../core/types.js').RecommendationResult[] {
    const restaurantMap = new Map(available.map(r => [r.name, r]));
    const isRainy = weather.condition === 'rain' || weather.condition === 'snow';
    const uniqueByName = new Set<string>();

    // 1. LLM reason 정리 + 이름 중복 제거
    const normalized = recs.flatMap(rec => {
      const r = restaurantMap.get(rec.name);
      if (!r || uniqueByName.has(rec.name)) return [];
      uniqueByName.add(rec.name);

      const hasKorean = /[가-힣]/.test(rec.reason);
      const rawReason = hasKorean ? rec.reason.split('·')[0].trim() : this.buildWeatherKeyword(weather);
      const keyword = rawReason || this.buildWeatherKeyword(weather);
      // 항상 DB의 카테고리·거리 append
      const reason = `${keyword} · ${r.category} · ${r.distance}m`;

      return [{
        ...rec,
        reason,
        category: r.category,
        distance: r.distance,
        price: r.price,
      }];
    });

    return this.expandToFive(normalized, available, weather, isRainy);
  }

  private getFallbackRecommendations(
    weather: import('../core/types.js').WeatherInfo,
    restaurants: import('../core/types.js').Restaurant[]
  ): import('../core/types.js').RecommendationResult[] {
    if (restaurants.length === 0) return [];

    // Build category preference based on weather
    const isRainy = weather.condition === 'rain' || weather.condition === 'snow';
    let categoryPreferences: string[] = [];
    if (isRainy) {
      categoryPreferences = ['분식', '한식', '일식'];
    } else if (weather.temp < 10) {
      categoryPreferences = ['한식', '국물', '분식'];
    } else if (weather.temp > 25) {
      categoryPreferences = ['일식', '냉면', '분식'];
    } else {
      categoryPreferences = ['일식', '한식', '중식'];
    }

    // 비/눈 오는 날은 가까운 순, 그 외에는 랜덤
    const ordered = isRainy
      ? [...restaurants].sort((a, b) => a.distance - b.distance)
      : [...restaurants].sort(() => Math.random() - 0.5);

    const preferred = categoryPreferences.flatMap(category => {
      const picked = ordered.find(r => r.category === category);
      if (!picked) return [];
      return [{
        name: picked.name,
        reason: this.buildFallbackReason(weather, picked, category),
        category: picked.category,
        distance: picked.distance,
        price: picked.price,
      }];
    });

    return this.expandToFive(preferred, ordered, weather, isRainy);
  }

  private expandToFive(
    seeds: import('../core/types.js').RecommendationResult[],
    available: import('../core/types.js').Restaurant[],
    weather: import('../core/types.js').WeatherInfo,
    isRainy: boolean
  ): import('../core/types.js').RecommendationResult[] {
    const restaurantMap = new Map(available.map(r => [r.name, r]));
    const selected: import('../core/types.js').RecommendationResult[] = [];
    const usedNames = new Set<string>();
    const usedCategories = new Set<string>();
    const overflow: import('../core/types.js').RecommendationResult[] = [];

    for (const rec of seeds) {
      const restaurant = restaurantMap.get(rec.name);
      if (!restaurant || usedNames.has(rec.name)) continue;

      const normalized = {
        ...rec,
        category: restaurant.category,
        distance: restaurant.distance,
        price: restaurant.price,
        reason: rec.reason || this.buildFallbackReason(weather, restaurant, restaurant.category),
      };

      if (!usedCategories.has(restaurant.category)) {
        selected.push(normalized);
        usedNames.add(rec.name);
        usedCategories.add(restaurant.category);
      } else {
        overflow.push(normalized);
      }
    }

    for (const rec of overflow) {
      if (selected.length >= 5) break;
      if (usedNames.has(rec.name)) continue;
      selected.push(rec);
      usedNames.add(rec.name);
    }

    const remaining = isRainy
      ? [...available].sort((a, b) => a.distance - b.distance)
      : [...available].sort(() => Math.random() - 0.5);

    for (const preferUnusedCategory of [true, false]) {
      for (const restaurant of remaining) {
        if (selected.length >= 5) break;
        if (usedNames.has(restaurant.name)) continue;
        if (preferUnusedCategory && usedCategories.has(restaurant.category)) continue;

        selected.push({
          name: restaurant.name,
          reason: this.buildFallbackReason(weather, restaurant, restaurant.category),
          category: restaurant.category,
          distance: restaurant.distance,
          price: restaurant.price,
        });
        usedNames.add(restaurant.name);
        usedCategories.add(restaurant.category);
      }
    }

    return selected.slice(0, 5);
  }

  private buildWeatherKeyword(weather: import('../core/types.js').WeatherInfo): string {
    if (weather.condition === 'rain') return '비오는날';
    if (weather.condition === 'snow') return '눈오는날';
    if (weather.temp < 10) return '추운날';
    if (weather.temp > 25) return '더운날';
    return '오늘추천';
  }

  private buildFallbackReason(
    weather: import('../core/types.js').WeatherInfo,
    restaurant: import('../core/types.js').Restaurant,
    _category: string
  ): string {
    const weatherReason = (() => {
      if (weather.condition === 'rain') return `비가 오니 가까운 거리 추천`;
      if (weather.condition === 'snow') return `눈이 오니 가까운 거리 추천`;
      if (weather.temp < 10) return '추운 날 따뜻한 메뉴';
      if (weather.temp > 25) return '더운 날 시원한 메뉴';
      return '오늘 날씨에 어울리는';
    })();

    return `${weatherReason} · ${restaurant.category} · ${restaurant.distance}m`;
  }
}
