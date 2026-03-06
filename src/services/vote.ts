import type {
  VoteService,
  ServiceResponse,
  VoteRepository,
  UserRepository,
  RestaurantRepository,
  Restaurant,
  BlacklistRepository,
} from '../core/types.js';

export class VoteServiceImpl implements VoteService {
  constructor(
    private voteRepo: VoteRepository,
    private userRepo: UserRepository,
    private restaurantRepo: RestaurantRepository,
    private blacklistRepo: BlacklistRepository
  ) {}

  async vote(
    userId: string,
    userName: string,
    restaurantName: string,
    date: string
  ): Promise<ServiceResponse> {
    // Find or create user
    this.userRepo.findOrCreate(userId, userName);

    // Find restaurant
    const restaurant = this.restaurantRepo.findByName(restaurantName);
    if (!restaurant) {
      return { success: false, message: `'${restaurantName}' 식당을 찾을 수 없습니다. '/목록'으로 확인해주세요.` };
    }

    if (!restaurant.is_active) {
      return { success: false, message: `'${restaurantName}'은(는) 현재 비활성화된 식당입니다.` };
    }

    // Check if blacklisted
    if (this.blacklistRepo.isBlacklisted(userId, restaurant.id)) {
      return { success: false, message: `'${restaurantName}'은(는) 블랙리스트에 있습니다.` };
    }

    // Cast vote (기존 투표가 있으면 변경)
    const existingVote = this.voteRepo.findUserVote(userId, date);
    this.voteRepo.vote(userId, restaurant.id, date, false);

    if (existingVote && existingVote.restaurant_id !== restaurant.id) {
      const prev = this.restaurantRepo.findById(existingVote.restaurant_id!);
      return {
        success: true,
        message: `${userName}님의 투표가 '${prev?.name ?? '이전 식당'}'에서 '${restaurantName}'(으)로 변경되었습니다! 🔄`,
        data: { restaurant: restaurant.name, category: restaurant.category },
      };
    }

    return {
      success: true,
      message: `${userName}님이 '${restaurantName}'에 투표했습니다! 🗳️`,
      data: { restaurant: restaurant.name, category: restaurant.category },
    };
  }

  async voteSolo(userId: string, userName: string, date: string): Promise<ServiceResponse> {
    // Find or create user
    this.userRepo.findOrCreate(userId, userName);

    // Register as solo (혼밥)
    this.voteRepo.vote(userId, null, date, true);

    return {
      success: true,
      message: `${userName}님이 오늘 혼밥으로 등록되었습니다! 🍱`,
    };
  }

  getResults(date: string): import('../core/types.js').VoteResult[] {
    return this.voteRepo.getResults(date);
  }

  getSoloCount(date: string): number {
    return this.voteRepo.getSoloCount(date);
  }

  decideWinner(date: string): ServiceResponse<{ restaurant: string; reason: string }> {
    const results = this.voteRepo.getResults(date);

    if (results.length === 0) {
      // No votes, pick random from active restaurants
      const allRestaurants = this.restaurantRepo.findAll();
      if (allRestaurants.length === 0) {
        return { success: false, message: '등록된 식당이 없습니다.' };
      }
      const random = allRestaurants[Math.floor(Math.random() * allRestaurants.length)];
      return {
        success: true,
        message: `오늘은 ${random.name}(으)로 결정했습니다! 🍽️`,
        data: { restaurant: random.name, reason: '무투표 임의 지정' },
      };
    }

    // Find max votes
    const maxVotes = Math.max(...results.map(r => r.count));
    const winners = results.filter(r => r.count === maxVotes);

    if (winners.length === 1) {
      return {
        success: true,
        message: `오늘은 ${winners[0].restaurant_name}(으)로 결정했습니다! ${winners[0].count}표 🍽️`,
        data: { restaurant: winners[0].restaurant_name, reason: `${winners[0].count}표 득표` },
      };
    }

    // Tie-breaker: random
    const winner = winners[Math.floor(Math.random() * winners.length)];
    return {
      success: true,
      message: `동표 발생! 무작위로 ${winner.restaurant_name}(으)로 결정했습니다! 🎲`,
      data: { restaurant: winner.restaurant_name, reason: '동표 무작위 선정' },
    };
  }
}
