import type {
  VoteService,
  ServiceResponse,
  VoteRepository,
  UserRepository,
  RestaurantRepository,
  Restaurant,
  BlacklistRepository,
  SelectedHistoryRepository,
  ReviewRepository,
} from '../core/types.js';

export class VoteServiceImpl implements VoteService {
  constructor(
    private voteRepo: VoteRepository,
    private userRepo: UserRepository,
    private restaurantRepo: RestaurantRepository,
    private blacklistRepo: BlacklistRepository,
    private historyRepo: SelectedHistoryRepository,
    private reviewRepo: ReviewRepository
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

    // Cancel solo vote if exists
    this.voteRepo.cancelSoloVote(userId, date);

    // Cancel any vote if exists
    this.voteRepo.cancelAnyVote(userId, date);

    // Check if already voted for this restaurant (toggle)
    const userVotes = this.voteRepo.findUserVotes(userId, date);
    const existingRestaurantVote = userVotes.find(v => v.restaurant_id === restaurant.id);

    if (existingRestaurantVote) {
      // Toggle: cancel the vote
      this.voteRepo.cancelVote(userId, restaurant.id, date);
      return {
        success: true,
        message: `${userName}님의 '${restaurantName}' 투표가 취소되었습니다! 🗳️`,
        data: { restaurant: restaurant.name, category: restaurant.category },
      };
    }

    // Cast new vote
    this.voteRepo.vote(userId, restaurant.id, date, false);

    return {
      success: true,
      message: `${userName}님이 '${restaurantName}'에 투표했습니다! 🗳️`,
      data: { restaurant: restaurant.name, category: restaurant.category },
    };
  }

  async voteSolo(userId: string, userName: string, date: string): Promise<ServiceResponse> {
    // Find or create user
    this.userRepo.findOrCreate(userId, userName);

    // Cancel all restaurant votes
    this.voteRepo.cancelAllVotes(userId, date);

    // Cancel any vote if exists
    this.voteRepo.cancelAnyVote(userId, date);

    // Check if already solo voted (toggle)
    const existingSoloVote = this.voteRepo.findUserVote(userId, date);
    if (existingSoloVote?.is_solo) {
      // Toggle: cancel the solo vote
      this.voteRepo.cancelSoloVote(userId, date);
      return {
        success: true,
        message: `${userName}님의 혼밥 신청이 취소되었습니다! 🍱`,
      };
    }

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

  getAnyCount(date: string): number {
    return this.voteRepo.getAnyCount(date);
  }

  async voteAny(userId: string, userName: string, date: string): Promise<ServiceResponse> {
    // Find or create user
    this.userRepo.findOrCreate(userId, userName);

    // Cancel all restaurant votes
    this.voteRepo.cancelAllVotes(userId, date);

    // Cancel solo vote if exists
    this.voteRepo.cancelSoloVote(userId, date);

    // Check if already any voted (toggle)
    const existingAnyVote = this.voteRepo.findUserAnyVote(userId, date);
    if (existingAnyVote) {
      // Toggle: cancel the any vote
      this.voteRepo.cancelAnyVote(userId, date);
      return {
        success: true,
        message: `${userName}님의 '아무거나' 투표가 취소되었습니다! 🎲`,
      };
    }

    // Register as any (아무거나)
    this.voteRepo.vote(userId, null, date, false, true);

    return {
      success: true,
      message: `${userName}님이 '아무거나'에 투표했습니다! 🎲`,
    };
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
    let candidates = results.filter(r => r.count === maxVotes);

    if (candidates.length === 1) {
      return {
        success: true,
        message: `오늘은 ${candidates[0].restaurant_name}(으)로 결정했습니다! ${candidates[0].count}표 🍽️`,
        data: { restaurant: candidates[0].restaurant_name, reason: `${candidates[0].count}표 득표` },
      };
    }

    // Tie-breaker 1: 최근 30일 방문 안 한 곳 우선 (가장 오래 전에 방문한 순)
    const visitMap = new Map<number, string>(); // restaurantId → lastVisitDate (or '' if never)
    for (const c of candidates) {
      const restaurant = this.restaurantRepo.findByName(c.restaurant_name);
      if (!restaurant) continue;
      const dates = this.historyRepo.getRecentVisitDates(restaurant.id, 30);
      visitMap.set(restaurant.id, dates[0] ?? ''); // 가장 최근 방문일 (없으면 '')
    }
    const minVisit = candidates.reduce((min, c) => {
      const restaurant = this.restaurantRepo.findByName(c.restaurant_name);
      const v = restaurant ? (visitMap.get(restaurant.id) ?? '') : '';
      return v < min ? v : min;
    }, '\uFFFF');
    candidates = candidates.filter(c => {
      const restaurant = this.restaurantRepo.findByName(c.restaurant_name);
      return restaurant ? (visitMap.get(restaurant.id) ?? '') === minVisit : false;
    });

    if (candidates.length === 1) {
      return {
        success: true,
        message: `동표! 최근 방문 적은 ${candidates[0].restaurant_name}(으)로 결정했습니다! 🍽️`,
        data: { restaurant: candidates[0].restaurant_name, reason: '동표 - 최근 방문 적은 곳 선정' },
      };
    }

    // Tie-breaker 2: 평점 높은 곳 우선
    const ratingMap = new Map<number, number>();
    for (const c of candidates) {
      const restaurant = this.restaurantRepo.findByName(c.restaurant_name);
      if (!restaurant) continue;
      ratingMap.set(restaurant.id, this.reviewRepo.getAverageRating(restaurant.id));
    }
    const maxRating = Math.max(...candidates.map(c => {
      const restaurant = this.restaurantRepo.findByName(c.restaurant_name);
      return restaurant ? (ratingMap.get(restaurant.id) ?? 0) : 0;
    }));
    candidates = candidates.filter(c => {
      const restaurant = this.restaurantRepo.findByName(c.restaurant_name);
      return restaurant ? (ratingMap.get(restaurant.id) ?? 0) === maxRating : false;
    });

    if (candidates.length === 1) {
      return {
        success: true,
        message: `동표! 평점 높은 ${candidates[0].restaurant_name}(으)로 결정했습니다! ⭐`,
        data: { restaurant: candidates[0].restaurant_name, reason: '동표 - 평점 높은 곳 선정' },
      };
    }

    // Tie-breaker 3: 랜덤
    const winner = candidates[Math.floor(Math.random() * candidates.length)];
    return {
      success: true,
      message: `동표! 무작위로 ${winner.restaurant_name}(으)로 결정했습니다! 🎲`,
      data: { restaurant: winner.restaurant_name, reason: '동표 무작위 선정' },
    };
  }
}
