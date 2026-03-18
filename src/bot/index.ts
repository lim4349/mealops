import {
  ActivityHandler,
  TurnContext,
  MessageFactory,
} from 'botbuilder';
import type { CommandHandler } from '../handlers/command.js';
import type { Dependencies, AdaptiveCardInvokeResponse, RecommendationResult } from '../core/types.js';
import {
  buildMainMenuCard,
  buildVoteCard,
  buildRecommendCard,
  buildListCard,
  buildBlacklistCard,
  buildSettingsCard,
  buildDashboardCard,
  buildResponseCard,
  buildReviewCard,
  buildEditRestaurantCard,
  buildAddRestaurantCard,
  type SortKey,
} from '../cards/index.js';

export const conversationReferences = new Map<string, any>();

export class MeaLOpsBot extends ActivityHandler {
  private commandHandler: CommandHandler;
  private deps: Dependencies;

  // AI 추천 캐시 (키: YYYY-MM-DD, 오늘 날짜 기준)
  private recommendCache = new Map<string, { data: RecommendationResult[]; timestamp: number }>();
  private readonly RECOMMEND_CACHE_TTL = 60 * 60 * 1000; // 1시간

  constructor(dependencies: Dependencies) {
    super();
    this.deps = dependencies;

    const { CommandHandler } = require('../handlers/command.js');
    this.commandHandler = new CommandHandler(
      dependencies.restaurantRepo,
      dependencies.voteService,
      dependencies.recommendationService,
      dependencies.favoriteService,
      dependencies.blacklistRepo,
      dependencies.userRepo,
      dependencies.reviewRepo,
      dependencies.settingRepo,
      dependencies.historyRepo
    );

    this.onMessage(async (context: TurnContext, next: () => Promise<void>) => {
      await this.saveConversationReference(context);

      // MS Teams 멘션 태그 (<at>봇이름</at>) 제거 후 명령 파싱
      const rawText = context.activity.text?.trim() ?? '';
      const text = rawText.replace(/<at>[^<]*<\/at>/gi, '').trim();
      console.log(`[onMessage] rawText="${rawText}" → text="${text}"`);

      // 모든 텍스트 메시지 → 날씨 포함 메인메뉴 카드
      let card: any;
      try {
        const weather = await this.deps.weatherService.getCurrent();
        card = buildMainMenuCard(weather);
      } catch {
        card = buildMainMenuCard();
      }

      try {
        await context.sendActivity(MessageFactory.attachment(card));
      } catch (err: any) {
        console.error('[onMessage] sendActivity FAILED:', err?.message);
      }
      await next();
    });

    this.onEvent(async (context: TurnContext, next: () => Promise<void>) => {
      // 봇이 채널/대화에 추가될 때 conversation reference 저장
      await this.saveConversationReference(context);

      if (context.activity.type === 'conversationUpdateActivity' && context.activity.membersAdded) {
        for (const member of context.activity.membersAdded) {
          if (member.id !== context.activity.recipient?.id) {
            await context.sendActivity('**🍽️ MeaLOps에 오신 것을 환영합니다!**\n\n점심 메뉴 고르기가 이제 즐거워집니다!');
            try {
              const weather = await this.deps.weatherService.getCurrent();
              await context.sendActivity(MessageFactory.attachment(buildMainMenuCard(weather)));
            } catch {
              await context.sendActivity(MessageFactory.attachment(buildMainMenuCard()));
            }
          }
        }
      }
      await next();
    });
  }

  private async saveConversationReference(context: TurnContext): Promise<void> {
    const conversationRef = TurnContext.getConversationReference(context.activity);
    const userId = context.activity.from?.id ?? 'unknown';
    conversationReferences.set(userId, conversationRef);
  }

  async handleCardAction(
    context: TurnContext,
    invokeValue: any
  ): Promise<AdaptiveCardInvokeResponse> {
    const { verb, data } = invokeValue.action;
    const userId = context.activity.from?.id ?? 'unknown';
    const userName = context.activity.from?.name ?? '익명';
    const today = new Date().toISOString().split('T')[0];

    // 오늘 날짜가 아닌 오래된 캐시 정리
    for (const [key] of this.recommendCache) {
      if (key !== today) this.recommendCache.delete(key);
    }

    try {
      switch (verb) {
        case 'main_menu': {
          try {
            const weather = await this.deps.weatherService.getCurrent();
            return this.cardResponse(buildMainMenuCard(weather));
          } catch {
            return this.cardResponse(buildMainMenuCard());
          }
        }

        case 'show_vote':
          return this.cardResponse(this.buildVoteCardForToday(userId));

        case 'vote': {
          const { restaurantName } = data;
          await this.deps.voteService.vote(userId, userName, restaurantName, today);
          return this.cardResponse(this.buildVoteCardForToday(userId));
        }

        case 'vote_solo': {
          await this.deps.voteService.voteSolo(userId, userName, today);
          return this.cardResponse(this.buildVoteCardForToday(userId));
        }

        case 'vote_any': {
          await this.deps.voteService.voteAny(userId, userName, today);
          return this.cardResponse(this.buildVoteCardForToday(userId));
        }

        case 'recommend': {
          const userRequest = data.userRequest ? String(data.userRequest).trim().slice(0, 30) : undefined;
          const cached = this.recommendCache.get(today);
          let recommendations: RecommendationResult[];
          // userRequest가 있으면 캐시 무시하고 새로 추천
          if (!userRequest && cached && Date.now() - cached.timestamp < this.RECOMMEND_CACHE_TTL) {
            recommendations = cached.data;
          } else {
            recommendations = await this.deps.recommendationService.getRecommendations(userId, [], userRequest);
            if (recommendations.length > 0 && !userRequest) {
              this.recommendCache.set(today, { data: recommendations, timestamp: Date.now() });
            }
          }
          if (recommendations.length === 0) {
            return this.cardResponse(buildResponseCard('추천할 식당이 없습니다.', true));
          }
          return this.cardResponse(buildRecommendCard(recommendations, userRequest));
        }

        case 'refresh_recommend': {
          const userRequest = data.userRequest ? String(data.userRequest).trim().slice(0, 30) : undefined;
          const previousNames = (this.recommendCache.get(today)?.data ?? []).map(r => r.name);
          this.recommendCache.delete(today);
          const recommendations = await this.deps.recommendationService.getRecommendations(userId, previousNames, userRequest);
          if (recommendations.length > 0 && !userRequest) {
            this.recommendCache.set(today, { data: recommendations, timestamp: Date.now() });
          }
          if (recommendations.length === 0) {
            return this.cardResponse(buildResponseCard('추천할 식당이 없습니다.', true));
          }
          return this.cardResponse(buildRecommendCard(recommendations, userRequest));
        }

        case 'show_list': {
          return this.cardResponse(this.buildListCardForUser(userId));
        }

        case 'sort_list': {
          // 구 형식(sortBy/sortOrder) 및 신 형식(sortKeys/groupByCategory) 모두 지원
          const sortKeys = Array.isArray(data.sortKeys)
            ? data.sortKeys
            : (data.sortBy && data.sortBy !== 'default' && data.sortBy !== 'category'
                ? [{ field: data.sortBy, order: data.sortOrder ?? 'asc' }]
                : []);
          const groupByCategory = data.groupByCategory ?? (data.sortBy === 'category');
          return this.cardResponse(this.buildListCardForUser(userId, sortKeys, groupByCategory));
        }

        case 'add_restaurant_form':
          return this.cardResponse(buildAddRestaurantCard());

        case 'create_restaurant': {
          const { name, alias, category, distance, price, is_delivery } = data;
          if (!name || !category) {
            return this.cardResponse(buildResponseCard('식당 이름과 카테고리는 필수입니다.', true));
          }
          const restaurant = this.deps.restaurantRepo.create({
            name: String(name).trim(),
            alias: alias ? String(alias).trim() : undefined,
            category,
            distance: Number(distance) || 0,
            price: Number(price) || 0,
            is_delivery: is_delivery === 'true',
          });
          // 태그 자동 생성 (비동기, 완료 후 업데이트)
          this.deps.ollamaService.generateTags(restaurant.name, restaurant.category).then(tags => {
            if (tags) this.deps.restaurantRepo.update(restaurant.id, { tags });
          }).catch(() => {});
          return this.cardResponse(this.buildListCardForUser(userId));
        }

        case 'edit_restaurant': {
          const restaurant = this.deps.restaurantRepo.findById(data.restaurantId);
          if (!restaurant) {
            return this.cardResponse(buildResponseCard('식당을 찾을 수 없습니다.', true));
          }
          return this.cardResponse(buildEditRestaurantCard(restaurant));
        }

        case 'save_restaurant': {
          const { restaurantId, name, alias, category, distance, price, is_delivery, tags } = data;
          this.deps.restaurantRepo.update(restaurantId, {
            name: name ? String(name).trim() : undefined,
            alias: alias !== undefined ? (String(alias).trim() || undefined) : undefined,
            category: category || undefined,
            distance: distance !== undefined ? Number(distance) : undefined,
            price: price !== undefined ? Number(price) : undefined,
            is_delivery: is_delivery !== undefined ? is_delivery === 'true' : undefined,
            tags: tags !== undefined ? String(tags).trim() : undefined,
          });
          return this.cardResponse(this.buildListCardForUser(userId));
        }

        case 'cancel_edit':
          return this.cardResponse(this.buildListCardForUser(userId));

        case 'delete_restaurant': {
          this.deps.restaurantRepo.delete(data.restaurantId);
          return this.cardResponse(this.buildListCardForUser(userId));
        }

        case 'blacklist_toggle': {
          const { restaurantId } = data;
          const isBlacklisted = this.deps.blacklistRepo.isBlacklisted(userId, restaurantId);
          if (isBlacklisted) {
            this.deps.blacklistRepo.remove(userId, restaurantId);
          } else {
            this.deps.blacklistRepo.add(userId, restaurantId);
          }
          return this.cardResponse(this.buildListCardForUser(userId));
        }

        case 'my_favorites': {
          const stats = this.deps.favoriteService.getUserFavorites(userId, userName);
          return this.cardResponse(buildResponseCard(this.buildFavoritesMessage(stats), true));
        }

        case 'my_blacklist': {
          const blacklisted = this.deps.blacklistRepo.getUserBlacklist(userId);
          return this.cardResponse(buildBlacklistCard(blacklisted));
        }

        case 'blacklist_remove': {
          this.deps.blacklistRepo.remove(userId, data.restaurantId);
          const blacklisted = this.deps.blacklistRepo.getUserBlacklist(userId);
          return this.cardResponse(buildBlacklistCard(blacklisted));
        }

        case 'blacklist_add': {
          const restaurant = this.deps.restaurantRepo.findByName(data.restaurantName);
          if (restaurant) {
            this.deps.blacklistRepo.add(userId, restaurant.id);
          }
          return this.cardResponse(buildResponseCard(`'${data.restaurantName}'이(가) 블랙리스트에 추가되었습니다.`, true));
        }

        case 'show_settings': {
          const budget = this.deps.settingRepo.getBudget();
          const forceEnabled = this.deps.settingRepo.getForceDecisionEnabled();
          const deliveryModeActive = this.deps.settingRepo.getDeliveryModeActive();
          return this.cardResponse(buildSettingsCard(budget, forceEnabled, deliveryModeActive));
        }

        case 'set_budget': {
          const budgetValue = parseInt(String(data.budget ?? '0'), 10);
          if (budgetValue > 0) {
            this.deps.settingRepo.setBudget(budgetValue);
          }
          const budget = this.deps.settingRepo.getBudget();
          const forceEnabled = this.deps.settingRepo.getForceDecisionEnabled();
          const deliveryModeActive = this.deps.settingRepo.getDeliveryModeActive();
          return this.cardResponse(buildSettingsCard(budget, forceEnabled, deliveryModeActive));
        }

        case 'toggle_force_decision': {
          const current = this.deps.settingRepo.getForceDecisionEnabled();
          this.deps.settingRepo.setForceDecisionEnabled(!current);
          const budget = this.deps.settingRepo.getBudget();
          const deliveryModeActive = this.deps.settingRepo.getDeliveryModeActive();
          return this.cardResponse(buildSettingsCard(budget, !current, deliveryModeActive));
        }

        // 하위 호환 (기존 verb들)
        case 'set_force_on': {
          this.deps.settingRepo.setForceDecisionEnabled(true);
          const budget = this.deps.settingRepo.getBudget();
          const deliveryModeActive = this.deps.settingRepo.getDeliveryModeActive();
          return this.cardResponse(buildSettingsCard(budget, true, deliveryModeActive));
        }

        case 'set_force_off': {
          this.deps.settingRepo.setForceDecisionEnabled(false);
          const budget = this.deps.settingRepo.getBudget();
          const deliveryModeActive = this.deps.settingRepo.getDeliveryModeActive();
          return this.cardResponse(buildSettingsCard(budget, false, deliveryModeActive));
        }

        case 'toggle_delivery_setting': {
          const current = this.deps.settingRepo.getDeliveryModeActive();
          this.deps.settingRepo.setDeliveryModeActive(!current);
          const budget = this.deps.settingRepo.getBudget();
          const forceEnabled = this.deps.settingRepo.getForceDecisionEnabled();
          return this.cardResponse(buildSettingsCard(budget, forceEnabled, !current));
        }

        case 'delivery': {
          // 레거시 verb
          const current = this.deps.settingRepo.getDeliveryModeActive();
          this.deps.settingRepo.setDeliveryModeActive(!current);
          return this.cardResponse(this.buildVoteCardForToday(userId));
        }

        case 'decide_now': {
          // 이미 오늘 결정된 경우 체크
          const existingHistory = this.deps.historyRepo.findByDate(today);
          if (existingHistory) {
            const existingRestaurant = this.deps.restaurantRepo.findById(existingHistory.restaurant_id);
            return this.cardResponse(buildResponseCard(`✅ 오늘은 이미 **${existingRestaurant?.name ?? '알 수 없음'}**으로 결정되었습니다!`, true));
          }
          const result = this.deps.voteService.decideWinner(today);
          if (result.success && result.data) {
            const restaurant = this.deps.restaurantRepo.findByName(result.data.restaurant);
            if (restaurant) {
              const voteResults = this.deps.voteService.getResults(today);
              const winnerVotes = voteResults.find(r => r.restaurant_id === restaurant.id)?.count ?? 0;
              try {
                const weather = await this.deps.weatherService.getCurrent();
                this.deps.historyRepo.add(restaurant.id, today, winnerVotes, weather.temp, weather.condition);
              } catch {
                this.deps.historyRepo.add(restaurant.id, today, winnerVotes);
              }
            }
            return this.cardResponse(buildResponseCard(`🍽️ ${result.message}\n\n13:30에 리뷰 알림이 발송됩니다.`, true));
          }
          return this.cardResponse(buildResponseCard(result.message, true));
        }

        case 'dashboard': {
          const history = this.deps.historyRepo.findRecent(90);
          const allTimeHistory = this.deps.historyRepo.findAll();
          const userReviews = this.deps.reviewRepo.findByUser(userId);
          const reviewMap = new Map(userReviews.map(r => [`${r.restaurant_id}_${r.visit_date}`, r.rating] as [string, number]));
          return this.cardResponse(buildDashboardCard(history, this.deps.restaurantRepo, 'week', reviewMap, allTimeHistory));
        }

        case 'dashboard_view': {
          const view: 'week' | 'month' | 'regulars' =
            data.view === 'month' ? 'month' : data.view === 'regulars' ? 'regulars' : 'week';
          const history = this.deps.historyRepo.findRecent(90);
          const allTimeHistory = this.deps.historyRepo.findAll();
          const userReviews = this.deps.reviewRepo.findByUser(userId);
          const reviewMap = new Map(userReviews.map(r => [`${r.restaurant_id}_${r.visit_date}`, r.rating] as [string, number]));
          return this.cardResponse(buildDashboardCard(history, this.deps.restaurantRepo, view, reviewMap, allTimeHistory));
        }

        case 'show_review': {
          const { restaurantName, visitDate: rvDate } = data;
          return this.cardResponse(buildReviewCard(restaurantName, rvDate));
        }

        case 'review': {
          const { restaurantName, rating, visitDate: rvDate } = data;
          const visitDate = rvDate ?? today;
          const restaurant = this.deps.restaurantRepo.findByName(restaurantName);
          if (restaurant) {
            const existing = this.deps.reviewRepo.findByUserAndRestaurantAndDate(userId, restaurant.id, visitDate);
            if (existing) {
              this.deps.reviewRepo.updateRating(userId, restaurant.id, visitDate, rating);
            } else {
              this.deps.reviewRepo.create({
                user_id: userId,
                restaurant_id: restaurant.id,
                rating,
                visit_date: visitDate,
                comment: undefined,
              });
            }
          }
          // 히스토리에서 리뷰한 경우 바로 대시보드로 복귀
          if (rvDate) {
            const history = this.deps.historyRepo.findRecent(90);
            const allTimeHistory = this.deps.historyRepo.findAll();
            const userReviews = this.deps.reviewRepo.findByUser(userId);
            const reviewMap = new Map(userReviews.map(r => [`${r.restaurant_id}_${r.visit_date}`, r.rating] as [string, number]));
            return this.cardResponse(buildDashboardCard(history, this.deps.restaurantRepo, 'week', reviewMap, allTimeHistory));
          }
          const msg = rating === 0
            ? `🚫 '${restaurantName}' 안먹음으로 표시했습니다.`
            : `⭐ '${restaurantName}'에 ${rating}점 리뷰가 등록되었습니다!`;
          return this.cardResponse(buildResponseCard(msg, true));
        }

        default: {
          try {
            const weather = await this.deps.weatherService.getCurrent();
            return this.cardResponse(buildMainMenuCard(weather));
          } catch {
            return this.cardResponse(buildMainMenuCard());
          }
        }
      }
    } catch (error) {
      console.error('Card action error:', error);
      return this.cardResponse(buildResponseCard('오류가 발생했습니다. 다시 시도해주세요.', true));
    }
  }

  // 식당 목록 카드 헬퍼 (userId 기반으로 블랙리스트 포함)
  private buildListCardForUser(userId: string, sortKeys: SortKey[] = [], groupByCategory: boolean = false): any {
    const restaurants = this.deps.restaurantRepo.findAll();
    const globalBlacklistedIds = this.deps.blacklistRepo.getBlacklistedRestaurantIds();
    const userBlacklistedIds = this.deps.blacklistRepo.getUserBlacklist(userId).map(r => r.id);
    const avgRatings = new Map<number, number>(
      restaurants.map(r => [r.id, this.deps.reviewRepo.getAverageRating(r.id)])
    );
    return buildListCard(restaurants, globalBlacklistedIds, sortKeys, groupByCategory, userBlacklistedIds, avgRatings);
  }

  private buildVoteCardForToday(userId: string): any {
    const today = new Date().toISOString().split('T')[0];

    const deliveryModeActive = this.deps.settingRepo.getDeliveryModeActive();
    let restaurants = this.deps.restaurantRepo.findAll();
    if (deliveryModeActive) {
      restaurants = restaurants.filter(r => r.is_delivery);
    }

    const globalBlacklistedIds = this.deps.blacklistRepo.getBlacklistedRestaurantIds();
    const voteResults = this.deps.voteService.getResults(today);
    const soloCount = this.deps.voteService.getSoloCount(today);
    const anyCount = this.deps.voteService.getAnyCount(today);
    const uniqueVoterCount = this.deps.voteRepo.countUniqueVoters(today);

    const userVotes = this.deps.voteRepo.findUserVotes(userId, today);
    const userVoteRestaurantIds = userVotes
      .filter(v => !v.is_solo && !v.is_any)
      .map(v => v.restaurant_id!)
      .filter(id => restaurants.some(r => r.id === id));
    const userIsSolo = userVotes.some(v => v.is_solo);
    const userIsAny = userVotes.some(v => v.is_any);

    const votersByRestaurant = this.deps.voteRepo.findVotersByRestaurant(today);
    const soloVoters = this.deps.voteRepo.findSoloVoters(today);
    const anyVoters = this.deps.voteRepo.findAnyVoters(today);

    return buildVoteCard(
      restaurants, voteResults, soloCount,
      userVoteRestaurantIds, userIsSolo, userIsAny,
      votersByRestaurant, soloVoters, anyVoters,
      anyCount, uniqueVoterCount, deliveryModeActive, globalBlacklistedIds
    );
  }

  private buildFavoritesMessage(stats: any): string {
    let message = `**🏆 ${stats.user_name}님의 최애 식당**\n\n`;
    if (stats.most_visited.length > 0) {
      message += `**📊 자주 투표한 식당**\n`;
      stats.most_visited.forEach((v: any) => { message += `• ${v.name} (${v.count}회)\n`; });
      message += '\n';
    }
    if (stats.highest_rated.length > 0) {
      message += `**⭐ 높은 평점**\n`;
      stats.highest_rated.forEach((v: any) => { message += `• ${v.name} (${v.rating}점)\n`; });
      message += '\n';
    }
    if (!stats.most_visited.length && !stats.highest_rated.length) {
      message += '아직 데이터가 없습니다. 투표하고 리뷰를 남겨보세요!';
    }
    return message;
  }

  private cardResponse(card: any): AdaptiveCardInvokeResponse {
    const content = card && typeof card === 'object' && 'content' in card ? card.content : card;
    return {
      statusCode: 200,
      type: 'application/vnd.microsoft.card.adaptive',
      value: content,
    };
  }
}
