import {
  ActivityHandler,
  TurnContext,
  MessageFactory,
  CardFactory,
} from 'botbuilder';
import type { CommandHandler } from '../handlers/command.js';
import type { Dependencies, AdaptiveCardInvokeResponse } from '../core/types.js';
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
} from '../cards/index.js';

export const conversationReferences = new Map<string, any>();

export class MeaLOpsBot extends ActivityHandler {
  private commandHandler: CommandHandler;
  private deps: Dependencies;

  constructor(dependencies: Dependencies) {
    super();

    this.deps = dependencies;

    // Initialize command handler with all dependencies
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

      const text = context.activity.text?.trim();

      if (!text) {
        // Empty message - show main menu
        await context.sendActivity(MessageFactory.attachment(buildMainMenuCard()));
        return await next();
      }

      // Parse command
      const parsed = this.commandHandler.parseCommand(text);

      // Get user info
      const userId = context.activity.from?.id ?? 'unknown';
      const userName = context.activity.from?.name ?? '익명';

      // Handle command
      const response = await this.commandHandler.handle(parsed, userId, userName);

      // Send response
      await context.sendActivity(response.message);

      await next();
    });


    // Handle conversation update events to welcome new members
    this.onEvent(async (context: TurnContext, next: () => Promise<void>) => {
      if (context.activity.type === 'conversationUpdateActivity' && context.activity.membersAdded) {
        const welcomeText = '**🍽️ MeaLOps에 오신 것을 환영합니다!**\n\n점심 메뉴 고르기가 이제 즐거워집니다!';

        for (const member of context.activity.membersAdded) {
          if (member.id !== context.activity.recipient?.id) {
            await context.sendActivity(welcomeText);
            await context.sendActivity(MessageFactory.attachment(buildMainMenuCard()));
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

    try {
      switch (verb) {
        case 'main_menu':
          return this.cardResponse(buildMainMenuCard());

        case 'show_vote':
          return this.cardResponse(this.buildVoteCardForToday(userId));

        case 'vote': {
          const { restaurantId, restaurantName } = data;
          await this.deps.voteService.vote(userId, userName, restaurantName, today);
          return this.cardResponse(this.buildVoteCardForToday(userId));
        }

        case 'vote_solo': {
          await this.deps.voteService.voteSolo(userId, userName, today);
          return this.cardResponse(this.buildVoteCardForToday(userId));
        }

        case 'recommend': {
          const recommendations = await this.deps.recommendationService.getRecommendations(userId);
          if (recommendations.length === 0) {
            return this.cardResponse(buildResponseCard('추천할 식당이 없습니다.', true));
          }
          return this.cardResponse(buildRecommendCard(recommendations));
        }

        case 'show_list': {
          const restaurants = this.deps.restaurantRepo.findAll();
          return this.cardResponse(buildListCard(restaurants));
        }

        case 'my_favorites': {
          const stats = this.deps.favoriteService.getUserFavorites(userId);
          const message = this.buildFavoritesMessage(stats);
          return this.cardResponse(buildResponseCard(message, true));
        }

        case 'my_blacklist': {
          const blacklisted = this.deps.blacklistRepo.getUserBlacklist(userId);
          return this.cardResponse(buildBlacklistCard(blacklisted));
        }

        case 'blacklist_remove': {
          const { restaurantId, restaurantName } = data;
          this.deps.blacklistRepo.remove(userId, restaurantId);
          const blacklisted = this.deps.blacklistRepo.getUserBlacklist(userId);
          return this.cardResponse(buildBlacklistCard(blacklisted));
        }

        case 'blacklist_add': {
          const { restaurantName } = data;
          const restaurant = this.deps.restaurantRepo.findByName(restaurantName);
          if (restaurant) {
            this.deps.blacklistRepo.add(userId, restaurant.id);
          }
          return this.cardResponse(buildResponseCard(`'${restaurantName}'이(가) 블랙리스트에 추가되었습니다.`, true));
        }

        case 'show_settings': {
          const budget = this.deps.settingRepo.getBudget();
          const forceEnabled = this.deps.settingRepo.getForceDecisionEnabled();
          return this.cardResponse(buildSettingsCard(budget, forceEnabled));
        }

        case 'set_force_on': {
          this.deps.settingRepo.setForceDecisionEnabled(true);
          const budget = this.deps.settingRepo.getBudget();
          return this.cardResponse(buildSettingsCard(budget, true));
        }

        case 'set_force_off': {
          this.deps.settingRepo.setForceDecisionEnabled(false);
          const budget = this.deps.settingRepo.getBudget();
          return this.cardResponse(buildSettingsCard(budget, false));
        }

        case 'dashboard': {
          const history = this.deps.historyRepo.findRecent(7);
          return this.cardResponse(buildDashboardCard(history, this.deps.restaurantRepo));
        }

        case 'review': {
          const { restaurantName, rating } = data;
          const restaurant = this.deps.restaurantRepo.findByName(restaurantName);
          if (restaurant) {
            this.deps.reviewRepo.create({
              user_id: userId,
              restaurant_id: restaurant.id,
              rating,
              visit_date: today,
              comment: undefined,
            });
          }
          return this.cardResponse(buildResponseCard(`⭐ '${restaurantName}'에 ${rating}점 리뷰가 등록되었습니다!`, true));
        }

        case 'delivery': {
          // Delivery mode - save triggered date and show vote card
          this.deps.settingRepo.setVoteTriggeredDate(today);
          return this.cardResponse(this.buildVoteCardForToday(userId));
        }

        default:
          return this.cardResponse(buildMainMenuCard());
      }
    } catch (error) {
      console.error('Card action error:', error);
      return this.cardResponse(buildResponseCard('오류가 발생했습니다. 다시 시도해주세요.', true));
    }
  }

  private buildVoteCardForToday(userId: string): any {
    const today = new Date().toISOString().split('T')[0];
    const restaurants = this.deps.restaurantRepo.findAll();
    const voteResults = this.deps.voteService.getResults(today);
    const soloCount = this.deps.voteService.getSoloCount(today);

    // Get current user's vote
    const userVote = this.deps.voteRepo.findUserVote(userId, today);

    return buildVoteCard(restaurants, voteResults, soloCount, userVote?.restaurant_id, userVote?.is_solo);
  }

  private buildFavoritesMessage(stats: any): string {
    let message = `**🏆 ${stats.user_name}님의 최애 식당**\n\n`;

    if (stats.most_visited.length > 0) {
      message += `**📊 자주 가는 식당**\n`;
      stats.most_visited.forEach((v: any) => {
        message += `• ${v.name} (${v.count}회)\n`;
      });
      message += '\n';
    }

    if (stats.highest_rated.length > 0) {
      message += `**⭐ 높은 평점**\n`;
      stats.highest_rated.forEach((v: any) => {
        message += `• ${v.name} (${v.rating}점)\n`;
      });
      message += '\n';
    }

    if (stats.recent_visits.length > 0) {
      message += `**🕐 최근 방문**\n`;
      stats.recent_visits.forEach((v: any) => {
        message += `• ${v.name} (${v.date})\n`;
      });
    }

    if (stats.most_visited.length === 0 && stats.highest_rated.length === 0 && stats.recent_visits.length === 0) {
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
