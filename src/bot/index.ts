import {
  ActivityHandler,
  TurnContext,
} from 'botbuilder';
import type { CommandHandler } from '../handlers/command.js';
import type { Dependencies } from '../core/types.js';

export class MeaLOpsBot extends ActivityHandler {
  private commandHandler: CommandHandler;

  constructor(dependencies: Dependencies) {
    super();

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
      const text = context.activity.text?.trim();
      if (!text) return await next();

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
        const welcomeText = '**🍽️ MeaLOps에 오신 것을 환영합니다!**\n\n점심 메뉴 고르기가 이제 즐거워집니다!\n`/도움`을 입력하면 모든 명령어를 볼 수 있습니다.';

        for (const member of context.activity.membersAdded) {
          if (member.id !== context.activity.recipient?.id) {
            await context.sendActivity(welcomeText);
          }
        }
      }

      await next();
    });
  }
}
