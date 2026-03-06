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

  async getRecommendations(userId: string): Promise<import('../core/types.js').RecommendationResult[]> {
    // Get current weather
    const weather = await this.weatherService.getCurrent();

    // Get all active restaurants
    const allRestaurants = this.restaurantRepo.findAll();

    // Get user's blacklist
    const blacklisted = this.blacklistRepo.getUserBlacklist(userId);
    const blacklistedNames = blacklisted.map(r => r.name);

    // Get recently visited (last 3 days)
    const recentHistory = this.historyRepo.findRecent(3);
    const recentVisits = recentHistory
      .map(h => this.restaurantRepo.findById(h.restaurant_id)?.name)
      .filter(Boolean) as string[];

    // Get top rated restaurants
    const allReviews = this.restaurantRepo.findAll().map(r => ({
      name: r.name,
      rating: this.reviewRepo.getAverageRating(r.id),
    }))
      .filter(r => r.rating > 0)
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 10);

    const topRated = allReviews.map(r => r.name);

    const budget = this.settingRepo.getBudget();

    // Build available list (excluding blacklisted and recent)
    const availableRestaurants = allRestaurants.filter(r =>
      !blacklistedNames.includes(r.name) && !recentVisits.includes(r.name)
    );
    const availableNames = new Set(availableRestaurants.map(r => r.name));

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
        })),
      });

      // DB에 존재하는 식당만 필터링
      const validRecommendations = recommendations.filter(r => availableNames.has(r.name));

      // If no valid recommendations, return fallback
      if (validRecommendations.length === 0) {
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

    // Filter by weather preference
    let candidates = available;
    if (weather.temp < 10) {
      // Prefer warm food (한식)
      candidates = available.filter(r => r.category === '한식');
    } else if (weather.temp > 25) {
      // Prefer cool food (일식/국수)
      candidates = available.filter(r => ['일식', '분식'].includes(r.category));
    }

    // Fallback to all available
    if (candidates.length === 0) {
      candidates = available;
    }

    // Sort by rating (randomize a bit for variety)
    const shuffled = candidates.sort(() => Math.random() - 0.5);

    return shuffled.slice(0, 5).map(r => ({
      name: r.name,
      reason: `${r.category}, ${r.distance}m, ₩${r.price}`,
      category: r.category,
      distance: r.distance,
      price: r.price,
    }));
  }
}
