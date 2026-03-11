import type {
  FavoriteService,
  UserFavoriteStats,
  UserRepository,
  VoteRepository,
  ReviewRepository,
  SelectedHistoryRepository,
  RestaurantRepository,
} from '../core/types.js';

export class FavoriteServiceImpl implements FavoriteService {
  constructor(
    private userRepo: UserRepository,
    private voteRepo: VoteRepository,
    private reviewRepo: ReviewRepository,
    private historyRepo: SelectedHistoryRepository,
    private restaurantRepo: RestaurantRepository
  ) {}

  getUserFavorites(userId: string, userName?: string): UserFavoriteStats {
    let user = this.userRepo.findById(userId);
    if (!user) {
      user = this.userRepo.findOrCreate(userId, userName ?? '사용자');
    }

    return this.calculateFavorites(user);
  }

  getUserFavoritesByName(userName: string): UserFavoriteStats | undefined {
    const users = this.userRepo.findAll();
    const user = users.find(u => u.name === userName);

    if (!user) {
      return undefined;
    }

    return this.calculateFavorites(user);
  }

  private calculateFavorites(user: import('../core/types.js').User): UserFavoriteStats {
    // Get user's reviews
    const reviews = this.reviewRepo.findByUser(user.id);

    // Group reviews by visit_date and restaurant to avoid counting multiple reviews from same day
    const visitsByRestaurantDate = new Map<string, Map<number, number>>();
    const restaurantRatings = new Map<number, number>();

    for (const review of reviews) {
      const key = `${review.restaurant_id}|${review.visit_date}`;
      if (!visitsByRestaurantDate.has(key)) {
        visitsByRestaurantDate.set(key, new Map());
      }
      // Store the latest review for this restaurant on this date
      restaurantRatings.set(review.restaurant_id, Math.max(restaurantRatings.get(review.restaurant_id) ?? 0, review.rating));
    }

    // Get restaurants from reviews for visit tracking
    const restaurantVisits = new Map<number, { name: string; count: number; rating: number }>();

    for (const [key] of visitsByRestaurantDate) {
      const [restaurantIdStr, visitDate] = key.split('|');
      const restaurantId = Number(restaurantIdStr);
      const restaurant = this.restaurantRepo.findById(restaurantId);
      if (restaurant) {
        const existing = restaurantVisits.get(restaurantId);
        const rating = restaurantRatings.get(restaurantId) ?? 0;
        if (existing) {
          existing.count++;
          existing.rating = Math.max(existing.rating, rating);
        } else {
          restaurantVisits.set(restaurantId, { name: restaurant.name, count: 1, rating });
        }
      }
    }

    // Most visited
    const mostVisited = Array.from(restaurantVisits.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map(v => ({ name: v.name, count: v.count }));

    // Highest rated
    const highestRated = Array.from(restaurantVisits.values())
      .filter(v => v.rating >= 4)
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 5)
      .map(v => ({ name: v.name, rating: v.rating }));

    return {
      user_name: user.name,
      most_visited: mostVisited,
      highest_rated: highestRated,
      recent_visits: [],
    };
  }
}
