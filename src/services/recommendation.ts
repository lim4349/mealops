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
      !lowRatedIds.has(r.id)
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
        return this.getFallbackRecommendations(weather, allRestaurants, blacklistedNames, recentVisits);
      }

      // 후처리: 한국어 체크 + 카테고리/거리 보정 + 5개 보충
      return this.postProcess(validRecommendations, availableRestaurants, weather, blacklistedNames, recentVisits);
    } catch (error) {
      console.error('Recommendation error:', error);
      return this.getFallbackRecommendations(weather, allRestaurants, blacklistedNames, recentVisits);
    }
  }

  private postProcess(
    recs: import('../core/types.js').RecommendationResult[],
    available: import('../core/types.js').Restaurant[],
    weather: import('../core/types.js').WeatherInfo,
    blacklisted: string[],
    recentVisits: string[]
  ): import('../core/types.js').RecommendationResult[] {
    const restaurantMap = new Map(available.map(r => [r.name, r]));
    const isRainy = weather.condition === 'rain' || weather.condition === 'snow';

    // 1. LLM reason에서 핵심 키워드만 추출 + 카테고리·거리 항상 강제 append
    const processed = recs.map(rec => {
      const r = restaurantMap.get(rec.name);
      if (!r) return rec;

      const hasKorean = /[가-힣]/.test(rec.reason);
      // LLM reason에서 · 이전 부분만 사용 (LLM이 붙인 카테고리/거리 제거)
      const rawReason = hasKorean ? rec.reason.split('·')[0].trim() : this.buildWeatherKeyword(weather);
      // 항상 DB의 카테고리·거리 append
      const reason = `${rawReason} · ${r.category} · ${r.distance}m`;

      return { ...rec, reason };
    });

    // 2. 5개 미만이면 나머지 채우기
    if (processed.length < 5) {
      const usedNames = new Set(processed.map(r => r.name));
      const remaining = available
        .filter(r => !usedNames.has(r.name) && !blacklisted.includes(r.name) && !recentVisits.includes(r.name));

      const sorted = isRainy
        ? remaining.sort((a, b) => a.distance - b.distance)
        : remaining.sort(() => Math.random() - 0.5);

      for (const r of sorted) {
        if (processed.length >= 5) break;
        processed.push({
          name: r.name,
          reason: this.buildFallbackReason(weather, r, r.category),
        });
      }
    }

    return processed.slice(0, 5);
  }

  private getFallbackRecommendations(
    weather: import('../core/types.js').WeatherInfo,
    restaurants: import('../core/types.js').Restaurant[],
    blacklisted: string[],
    recentVisits: string[]
  ): import('../core/types.js').RecommendationResult[] {
    const available = restaurants.filter(r =>
      !blacklisted.includes(r.name) && !recentVisits.includes(r.name)
    );

    if (available.length === 0) return [];

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
    const shuffled = isRainy
      ? [...available].sort((a, b) => a.distance - b.distance)
      : [...available].sort(() => Math.random() - 0.5);

    // Group by category and pick one from each preferred category
    const selectedByCategory = new Map<string, import('../core/types.js').Restaurant>();
    const results: import('../core/types.js').RecommendationResult[] = [];

    // 1. First, pick one from each preferred category
    for (const category of categoryPreferences) {
      const candidates = shuffled.filter(
        r => r.category === category && !selectedByCategory.has(r.name)
      );
      if (candidates.length > 0) {
        const picked = candidates[0];
        selectedByCategory.set(picked.name, picked);
        results.push({
          name: picked.name,
          reason: this.buildFallbackReason(weather, picked, category),
          category: picked.category,
          distance: picked.distance,
        });
      }
    }

    // 2. Fill remaining slots with random other categories
    const remaining = shuffled.filter(r => !selectedByCategory.has(r.name));
    for (const r of remaining) {
      if (results.length >= 5) break;
      results.push({
        name: r.name,
        reason: this.buildFallbackReason(weather, r, 'other'),
        category: r.category,
        distance: r.distance,
      });
    }

    return results.slice(0, 5);
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
