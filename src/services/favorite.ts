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
    // 가장 많이 투표한 식당 (solo/any 제외, 일반 투표만)
    const voteCounts = this.voteRepo.countAllVotesByUser(user.id);
    const mostVoted = voteCounts
      .slice(0, 5)
      .flatMap(v => {
        const restaurant = this.restaurantRepo.findById(v.restaurantId);
        return restaurant ? [{ name: restaurant.name, count: v.count }] : [];
      });

    // 개인 평점 높은 식당 (rating=0 안먹음 제외)
    const reviews = this.reviewRepo.findByUser(user.id).filter(r => r.rating > 0);
    const ratingAccum = new Map<number, { total: number; count: number }>();
    for (const review of reviews) {
      const ex = ratingAccum.get(review.restaurant_id);
      if (ex) {
        ex.total += review.rating;
        ex.count++;
      } else {
        ratingAccum.set(review.restaurant_id, { total: review.rating, count: 1 });
      }
    }
    const highestRated = Array.from(ratingAccum.entries())
      .flatMap(([restaurantId, { total, count }]) => {
        const restaurant = this.restaurantRepo.findById(restaurantId);
        const avg = Math.round(total / count * 10) / 10;
        return restaurant ? [{ name: restaurant.name, rating: avg }] : [];
      })
      .filter(v => v.rating >= 4)
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 5);

    return {
      user_name: user.name,
      most_visited: mostVoted,
      highest_rated: highestRated,
      recent_visits: [],
    };
  }
}
