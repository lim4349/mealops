import type {
  ParsedCommand,
  Command,
  ServiceResponse,
  RestaurantRepository,
  VoteService,
  RecommendationService,
  FavoriteService,
  BlacklistRepository,
  UserRepository,
  ReviewRepository,
  SettingRepository,
  SelectedHistoryRepository,
  CreateRestaurantDto,
  RestaurantCategory,
} from '../core/types.js';

export class CommandHandler {
  constructor(
    private restaurantRepo: RestaurantRepository,
    private voteService: VoteService,
    private recommendationService: RecommendationService,
    private favoriteService: FavoriteService,
    private blacklistRepo: BlacklistRepository,
    private userRepo: UserRepository,
    private reviewRepo: ReviewRepository,
    private settingRepo: SettingRepository,
    private historyRepo: SelectedHistoryRepository
  ) {}

  parseCommand(text: string): ParsedCommand {
    const trimmed = text.trim();

    // Extract mentioned user if any
    const mentionedMatch = trimmed.match(/@(\S+)/);
    const mentionedUser = mentionedMatch ? mentionedMatch[1] : undefined;

    // Parse command
    const parts = trimmed.split(/\s+/);
    const commandStr = parts[0]?.toLowerCase().replace('/', '') || '';
    const args = parts.slice(1);

    return {
      command: this.mapCommand(commandStr),
      args,
      mentionedUser,
    };
  }

  private mapCommand(cmd: string): Command {
    const commandMap: Record<string, Command> = {
      '도움': 'help',
      'help': 'help',
      '추가': 'add',
      'add': 'add',
      '삭제': 'delete',
      'delete': 'delete',
      '목록': 'list',
      'list': 'list',
      '리스트': 'list',
      '블랙': 'blacklist',
      'blacklist': 'blacklist',
      '투표': 'vote',
      'vote': 'vote',
      '추천': 'recommend',
      'recommend': 'recommend',
      '상관없음': 'recommend',
      'refresh': 'refresh',
      '새로고침': 'refresh',
      '최애': 'favorite',
      'favorite': 'favorite',
      '내취향': 'favorite',
      '대시보드': 'dashboard',
      'dashboard': 'dashboard',
      '리뷰': 'review',
      'review': 'review',
      '설정': 'settings',
      'settings': 'settings',
      '공휴일': 'holiday',
      'holiday': 'holiday',
      '배달': 'delivery',
      'delivery': 'delivery',
    };

    return commandMap[cmd] ?? 'help';
  }

  async handle(
    command: ParsedCommand,
    userId: string,
    userName: string
  ): Promise<ServiceResponse> {
    switch (command.command) {
      case 'help':
        return this.handleHelp();

      case 'add':
        return this.handleAdd(command.args);

      case 'delete':
        return this.handleDelete(command.args);

      case 'list':
        return this.handleList(command.args);

      case 'blacklist':
        return this.handleBlacklist(userId, command.args);

      case 'vote':
        return this.handleVote(userId, userName, command.args);

      case 'recommend':
        return this.handleRecommend(userId);

      case 'refresh':
        return this.handleRefresh(userId);

      case 'favorite':
        return this.handleFavorite(userId, command.mentionedUser);

      case 'dashboard':
        return this.handleDashboard();

      case 'review':
        return this.handleReview(userId, userName, command.args);

      case 'settings':
        return this.handleSettings(command.args);

      case 'holiday':
        return this.handleHoliday(command.args);

      case 'delivery':
        return this.handleDelivery();

      default:
        return { success: false, message: '알 수 없는 명령어입니다. `/도움`을 입력해보세요.' };
    }
  }

  private handleHelp(): ServiceResponse {
    return {
      success: true,
      message: `**🍽️ MeaLOps 명령어**

**식당 관리**
• /추가 [이름] [카테고리] [거리m] [가격] - 식당 추가
• /삭제 [이름] - 식당 삭제
• /목록 [카테고리] - 식당 목록

**투표 & 추천**
• /투표 [식당이름] - 투표하기
• /추천 또는 /상관없음 - AI 추천
• /추천 새로고침 - 새로운 추천
• /블랙 [식당이름] - 블랙리스트

**내 정보**
• /최애 - 내 최애 식당
• /최애 @이름 - 다른 사람 최애 보기

**기능**
• /대시보드 - 최근 히스토리
• /리뷰 [식당] [1-5점] [코멘트] - 별점
• /설정 식대 [금액] - 1인 식대 변경
• /설정 강제결정 on/off - 11:30 강제결정`,
    };
  }

  private handleAdd(args: string[]): ServiceResponse {
    if (args.length < 4) {
      return { success: false, message: '사용법: /추가 [이름] [카테고리] [거리m] [가격]\n예: /추가 국수나무 한식 300 10000' };
    }

    const [name, category, distanceStr, priceStr] = args;
    const categories: RestaurantCategory[] = ['한식', '일식', '중식', '양식', '분식', '기타'];

    if (/\s/.test(name)) {
      return { success: false, message: '식당 이름은 띄어쓰기 없이 입력해주세요. 예: /추가 국수나무 한식 300 10000' };
    }

    if (!categories.includes(category as RestaurantCategory)) {
      return { success: false, message: `카테고리: ${categories.join(', ')}` };
    }

    const distance = parseInt(distanceStr, 10);
    const price = parseInt(priceStr, 10);

    if (isNaN(distance) || distance < 0) {
      return { success: false, message: '거리는 0 이상의 숫자여야 합니다.' };
    }

    if (isNaN(price) || price < 0) {
      return { success: false, message: '가격은 0 이상의 숫자여야 합니다.' };
    }

    const dto: CreateRestaurantDto = {
      name,
      category: category as RestaurantCategory,
      distance,
      price,
    };

    try {
      const created = this.restaurantRepo.create(dto);
      return { success: true, message: `'${created.name}' 식당이 추가되었습니다! ✅` };
    } catch (error) {
      return { success: false, message: `추가 실패: ${(error as Error).message}` };
    }
  }

  private handleDelete(args: string[]): ServiceResponse {
    if (args.length === 0) {
      return { success: false, message: '사용법: /삭제 [식당이름]' };
    }

    const name = args.join(' ');
    const restaurant = this.restaurantRepo.findByName(name);

    if (!restaurant) {
      return { success: false, message: `'${name}' 식당을 찾을 수 없습니다.` };
    }

    this.restaurantRepo.delete(restaurant.id);
    return { success: true, message: `'${name}' 식당이 비활성화되었습니다.` };
  }

  private handleList(args: string[]): ServiceResponse {
    const category = args[0] as RestaurantCategory | undefined;
    const categories: RestaurantCategory[] = ['한식', '일식', '중식', '양식', '분식', '기타'];

    let restaurants;
    if (category && categories.includes(category)) {
      restaurants = this.restaurantRepo.findByCategory(category);
    } else {
      restaurants = this.restaurantRepo.findAll();
    }

    if (restaurants.length === 0) {
      return { success: true, message: '등록된 식당이 없습니다.' };
    }

    const grouped = restaurants.reduce((acc, r) => {
      if (!acc[r.category]) acc[r.category] = [];
      acc[r.category].push(r);
      return acc;
    }, {} as Record<string, typeof restaurants>);

    let message = `**🍽️ 식당 목록** (총 ${restaurants.length}개)\n\n`;

    for (const [cat, rests] of Object.entries(grouped)) {
      message += `**${cat}**\n`;
      for (const r of rests) {
        message += `• ${r.name} (${r.distance}m, ₩${r.price})\n`;
      }
      message += '\n';
    }

    return { success: true, message };
  }

  private handleBlacklist(userId: string, args: string[]): ServiceResponse {
    if (args.length === 0) {
      const blacklisted = this.blacklistRepo.getUserBlacklist(userId);
      if (blacklisted.length === 0) {
        return { success: true, message: '블랙리스트가 비어있습니다.' };
      }
      return {
        success: true,
        message: `**내 블랙리스트**\n${blacklisted.map(r => `• ${r.name}`).join('\n')}`,
      };
    }

    const name = args.join(' ');
    const restaurant = this.restaurantRepo.findByName(name);

    if (!restaurant) {
      return { success: false, message: `'${name}' 식당을 찾을 수 없습니다.` };
    }

    this.blacklistRepo.add(userId, restaurant.id);
    return { success: true, message: `'${name}'이(가) 블랙리스트에 추가되었습니다. 🚫` };
  }

  private async handleVote(userId: string, userName: string, args: string[]): Promise<ServiceResponse> {
    if (args.length === 0) {
      return { success: false, message: '사용법: /투표 [식당이름]' };
    }

    const restaurantName = args.join(' ');
    const today = new Date().toISOString().split('T')[0];

    return this.voteService.vote(userId, userName, restaurantName, today);
  }

  private async handleRecommend(userId: string): Promise<ServiceResponse> {
    const recommendations = await this.recommendationService.getRecommendations(userId);

    if (recommendations.length === 0) {
      return { success: false, message: '추천할 식당이 없습니다.' };
    }

    let message = '**🤖 AI 추천 메뉴**\n\n';
    recommendations.forEach((r, i) => {
      message += `${i + 1}. **${r.name}**\n   └ ${r.reason}\n`;
    });

    return { success: true, message };
  }

  private async handleRefresh(userId: string): Promise<ServiceResponse> {
    // Same as recommend but can have different randomization
    return this.handleRecommend(userId);
  }

  private handleFavorite(userId: string, mentionedUserName?: string): ServiceResponse {
    try {
      const stats = mentionedUserName
        ? this.favoriteService.getUserFavoritesByName(mentionedUserName)
        : this.favoriteService.getUserFavorites(userId);

      if (!stats) {
        return { success: false, message: `사용자 '${mentionedUserName}'을(를) 찾을 수 없습니다.` };
      }

      let message = `**🏆 ${stats.user_name}님의 최애 식당**\n\n`;

      if (stats.most_visited.length > 0) {
        message += `**📊 자주 가는 식당**\n`;
        stats.most_visited.forEach(v => {
          message += `• ${v.name} (${v.count}회)\n`;
        });
        message += '\n';
      }

      if (stats.highest_rated.length > 0) {
        message += `**⭐ 높은 평점**\n`;
        stats.highest_rated.forEach(v => {
          message += `• ${v.name} (${v.rating}점)\n`;
        });
        message += '\n';
      }

      if (stats.recent_visits.length > 0) {
        message += `**🕐 최근 방문**\n`;
        stats.recent_visits.forEach(v => {
          message += `• ${v.name} (${v.date})\n`;
        });
      }

      if (stats.most_visited.length === 0 && stats.highest_rated.length === 0 && stats.recent_visits.length === 0) {
        message += '아직 데이터가 없습니다. 투표하고 리뷰를 남겨보세요!';
      }

      return { success: true, message };
    } catch (error) {
      return { success: false, message: (error as Error).message };
    }
  }

  private handleDashboard(): ServiceResponse {
    const recent = this.historyRepo.findRecent(7);

    if (recent.length === 0) {
      return { success: true, message: '아직 히스토리가 없습니다.' };
    }

    let message = '**📊 최근 7일 점심 히스토리**\n\n';

    recent.forEach(h => {
      const restaurant = this.restaurantRepo.findById(h.restaurant_id);
      message += `• ${h.selected_date}: ${restaurant?.name ?? '알 수 없음'} (${h.vote_count}표)\n`;
    });

    return { success: true, message };
  }

  private handleReview(userId: string, userName: string, args: string[]): ServiceResponse {
    if (args.length < 2) {
      return { success: false, message: '사용법: /리뷰 [식당이름] [1-5점] [코멘트]\n예: /리뷰 본죽 5 따뜻해서 좋았어요' };
    }

    // 첫 번째 순수 숫자 arg의 위치로 이름/점수 구분
    const ratingIndex = args.findIndex((a, i) => i >= 1 && /^\d+$/.test(a));
    if (ratingIndex === -1) {
      return { success: false, message: '사용법: /리뷰 [식당이름] [1-5점] [코멘트]\n예: /리뷰 본죽 강남점 5 따뜻해서 좋았어요' };
    }

    const restaurantName = args.slice(0, ratingIndex).join(' ');
    const rating = parseInt(args[ratingIndex], 10);
    const comment = args.slice(ratingIndex + 1).join(' ');

    if (isNaN(rating) || rating < 1 || rating > 5) {
      return { success: false, message: '평점은 1~5 사이 숫자여야 합니다.' };
    }

    const restaurant = this.restaurantRepo.findByName(restaurantName);
    if (!restaurant) {
      return { success: false, message: `'${restaurantName}' 식당을 찾을 수 없습니다.` };
    }

    // Find or create user
    this.userRepo.findOrCreate(userId, userName);

    const today = new Date().toISOString().split('T')[0];
    this.reviewRepo.create({
      user_id: userId,
      restaurant_id: restaurant.id,
      rating,
      visit_date: today,
      comment: comment || undefined,
    });

    return { success: true, message: `⭐ '${restaurantName}'에 ${rating}점 리뷰가 등록되었습니다!` };
  }

  private handleSettings(args: string[]): ServiceResponse {
    if (args.length === 0) {
      const budget = this.settingRepo.getBudget();
      const forceEnabled = this.settingRepo.getForceDecisionEnabled();
      return {
        success: true,
        message: `**⚙️ 현재 설정**

• 1인 식대: ₩${budget}
• 강제 결정: ${forceEnabled ? 'ON' : 'OFF'}

사용법:
• /설정 식대 [금액]
• /설정 강제결정 on/off`,
      };
    }

    const setting = args[0];
    const value = args[1];

    if (setting === '식대' && value) {
      const amount = parseInt(value, 10);
      if (isNaN(amount) || amount < 0) {
        return { success: false, message: '유효한 금액을 입력하세요.' };
      }
      this.settingRepo.setBudget(amount);
      return { success: true, message: `1인 식대가 ₩${amount}으로 변경되었습니다.` };
    }

    if (setting === '강제결정' && (value === 'on' || value === 'off')) {
      this.settingRepo.setForceDecisionEnabled(value === 'on');
      return { success: true, message: `강제 결정이 ${value === 'on' ? '활성화' : '비활성화'}되었습니다.` };
    }

    return { success: false, message: '알 수 없는 설정입니다.' };
  }

  private handleHoliday(args: string[]): ServiceResponse {
    // Placeholder for holiday management
    return { success: false, message: '공휴일 관리는 아직 구현 중입니다.' };
  }

  private handleDelivery(): ServiceResponse {
    // Delivery mode trigger - actual card display handled by bot
    return { success: true, message: '배달 투표를 시작합니다!' };
  }
}
