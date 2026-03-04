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

  getUserFavorites(userId: string): UserFavoriteStats {
    const user = this.userRepo.findById(userId);
    if (!user) {
      throw new Error('사용자를 찾을 수 없습니다.');
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

    // Get restaurants from reviews for visit tracking
    const restaurantVisits = new Map<number, { name: string; count: number; rating: number }>();

    for (const review of reviews) {
      const restaurant = this.restaurantRepo.findById(review.restaurant_id);
      if (restaurant) {
        const existing = restaurantVisits.get(restaurant.id);
        if (existing) {
          existing.count++;
          existing.rating = Math.max(existing.rating, review.rating);
        } else {
          restaurantVisits.set(restaurant.id, { name: restaurant.name, count: 1, rating: review.rating });
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

    // Recent visits (from selected history)
    const recentHistory = this.historyRepo.findRecent(10);
    const recentVisits = recentHistory
      .filter(h => {
        const votes = this.voteRepo.findTodayVotes(h.selected_date);
        return votes.some(v => v.user_id === user.id);
      })
      .map(h => {
        const restaurant = this.restaurantRepo.findById(h.restaurant_id);
        return { name: restaurant?.name ?? '알 수 없음', date: h.selected_date };
      })
      .slice(0, 5);

    return {
      user_name: user.name,
      most_visited: mostVisited.length > 0 ? mostVisited : [{ name: '데이터 없음', count: 0 }],
      highest_rated: highestRated.length > 0 ? highestRated : [{ name: '데이터 없음', rating: 0 }],
      recent_visits: recentVisits.length > 0 ? recentVisits : [{ name: '데이터 없음', date: '-' }],
    };
  }
}
