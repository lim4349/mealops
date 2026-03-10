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

  async getRecommendations(userId: string, previousNames: string[] = []): Promise<import('../core/types.js').RecommendationResult[]> {
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

    // Get top rated restaurants
    const allReviews = allRestaurants.map(r => ({
      name: r.name,
      rating: this.reviewRepo.getAverageRating(r.id),
    }))
      .filter(r => r.rating > 0)
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 10);

    const topRated = allReviews.map(r => r.name);

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

    console.log(`[Recommend] available=${availableRestaurants.length}개, blacklisted=${blacklistedNames.length}개, recent=${recentVisits.join(',')}, lowRated=${lowRatedIds.size}개`);

    try {
      const recommendations = await this.ollamaService.recommend({
        weather,
        recentVisits,
        topRated,
        blacklisted: blacklistedNames,
        budget,
        availableRestaurants: availableRestaurants.map(r => ({
          name: r.name,
          category: r.category,
          price: r.price,
          distance: r.distance,
        })),
        previousRecommendations: previousNames,
      });

      // DB에 존재하는 식당만 필터링
      const validRecommendations = recommendations.filter(r => availableNames.has(r.name));
      console.log(`[Recommend] Ollama 결과=${recommendations.length}개, 유효=${validRecommendations.length}개, Ollama반환:${recommendations.map(r=>r.name).join(',')}`);

      // If no valid recommendations, return fallback
      if (validRecommendations.length === 0) {
        console.log('[Recommend] → fallback 사용');
        return this.getFallbackRecommendations(weather, allRestaurants, blacklistedNames, recentVisits);
      }

      return validRecommendations.slice(0, 5);
    } catch (error) {
      console.error('Recommendation error:', error);
      return this.getFallbackRecommendations(weather, allRestaurants, blacklistedNames, recentVisits);
    }
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

    // Get historical data for similar weather
    const similarWeatherHistories = this.historyRepo.findByWeather(
      weather.condition.toLowerCase(),
      Math.max(0, weather.temp - 5),
      weather.temp + 5
    );
    const frequentRestaurantIds = new Set<number>();
    for (const history of similarWeatherHistories) {
      frequentRestaurantIds.add(history.restaurant_id);
    }

    // Build category preference based on weather
    let categoryPreferences: string[] = [];
    if (weather.condition.toLowerCase().includes('rain') || weather.condition.toLowerCase().includes('snow')) {
      // Rain/Snow: prefer near restaurants
      categoryPreferences = ['분식', '한식', '일식'];
    } else if (weather.temp < 10) {
      // Cold: prefer warm food
      categoryPreferences = ['한식', '국물', '분식'];
    } else if (weather.temp > 25) {
      // Hot: prefer cool food
      categoryPreferences = ['일식', '냉면', '분식'];
    } else {
      // Mild: balanced preference
      categoryPreferences = ['일식', '한식', '중식'];
    }

    // Sort candidates:
    // 1. Similar weather history → frequent restaurants
    // 2. Category preference
    // 3. Distance (closer first)
    // 4. Rating
    const sorted = available.sort((a, b) => {
      // 1. Similar weather history score
      const aInHistory = frequentRestaurantIds.has(a.id) ? 1 : 0;
      const bInHistory = frequentRestaurantIds.has(b.id) ? 1 : 0;
      if (aInHistory !== bInHistory) return bInHistory - aInHistory;

      // 2. Category preference score
      const aCategoryIdx = categoryPreferences.indexOf(a.category);
      const bCategoryIdx = categoryPreferences.indexOf(b.category);
      const aScore = aCategoryIdx >= 0 ? aCategoryIdx : 999;
      const bScore = bCategoryIdx >= 0 ? bCategoryIdx : 999;
      if (aScore !== bScore) return aScore - bScore;

      // 3. Distance (closer first for rain)
      if (weather.condition.toLowerCase().includes('rain') || weather.condition.toLowerCase().includes('snow')) {
        return a.distance - b.distance;
      }

      // 4. Random for variety
      return Math.random() - 0.5;
    });

    const reasonByCondition = (() => {
      if (weather.condition === 'rain' || weather.condition === 'snow') return '비/눈 오는 날 가까운 식당';
      if (weather.temp < 10) return '추운 날 따뜻한 메뉴';
      if (weather.temp > 25) return '더운 날 시원한 메뉴';
      return '오늘 날씨에 어울리는 메뉴';
    })();

    return sorted.slice(0, 5).map(r => ({
      name: r.name,
      reason: `${reasonByCondition} · ${r.category} · ${r.distance}m`,
      category: r.category,
      distance: r.distance,
    }));
  }
}
