import 'dotenv/config';
import express from 'express';
import { CloudAdapter, ConfigurationBotFrameworkAuthentication, MessageFactory } from 'botbuilder';
import { CommandHandler } from './handlers/command.js';
import { getDatabase } from './db/index.js';
import {
  RestaurantRepositoryImpl,
  VoteRepositoryImpl,
  BlacklistRepositoryImpl,
  ReviewRepositoryImpl,
  SelectedHistoryRepositoryImpl,
  UserRepositoryImpl,
  SettingRepositoryImpl,
} from './repositories/index.js';
import { OllamaServiceImpl } from './services/ollama.js';
import { WeatherServiceImpl, MockWeatherService } from './services/weather.js';
import { VoteServiceImpl } from './services/vote.js';
import { RecommendationServiceImpl } from './services/recommendation.js';
import { FavoriteServiceImpl } from './services/favorite.js';
import { SchedulerImpl } from './scheduler/index.js';
import { MeaLOpsBot, conversationReferences } from './bot/index.js';
import type { Dependencies } from './core/types.js';

// Initialize database
const db = getDatabase(process.env.DB_PATH);
db.init();

// Initialize repositories
const restaurantRepo = new RestaurantRepositoryImpl(db);
const voteRepo = new VoteRepositoryImpl(db);
const blacklistRepo = new BlacklistRepositoryImpl(db);
const reviewRepo = new ReviewRepositoryImpl(db);
const historyRepo = new SelectedHistoryRepositoryImpl(db);
const userRepo = new UserRepositoryImpl(db);
const settingRepo = new SettingRepositoryImpl(db);

// Initialize services
const ollamaService = new OllamaServiceImpl(
  process.env.OLLAMA_URL ?? 'http://localhost:11434',
  process.env.OLLAMA_MODEL ?? 'gemma3:12b'
);

const weatherService = process.env.WEATHER_API_KEY
  ? new WeatherServiceImpl(process.env.WEATHER_API_KEY, process.env.WEATHER_CITY ?? 'Seoul')
  : new MockWeatherService();

const voteService = new VoteServiceImpl(
  voteRepo,
  userRepo,
  restaurantRepo,
  blacklistRepo,
  historyRepo,
  reviewRepo
);

const recommendationService = new RecommendationServiceImpl(
  ollamaService,
  weatherService,
  restaurantRepo,
  blacklistRepo,
  reviewRepo,
  historyRepo,
  settingRepo
);

const favoriteService = new FavoriteServiceImpl(
  userRepo,
  voteRepo,
  reviewRepo,
  historyRepo,
  restaurantRepo
);

// CloudAdapter authentication
const auth = new ConfigurationBotFrameworkAuthentication({
  MicrosoftAppId: process.env.MICROSOFT_APP_ID ?? '',
  MicrosoftAppPassword: process.env.MICROSOFT_APP_PASSWORD ?? '',
});

const adapter = new CloudAdapter(auth);

// Error handler
adapter.onTurnError = async (context, error) => {
  const errorMsg = error instanceof Error ? error.message : String(error);
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.error('❌ Bot Error:', errorMsg);
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  try {
    if (context && context.activity) {
      await context.sendActivity('일시적인 오류입니다. 잠시 후 다시 시도해주세요.');
    }
  } catch (sendErr) {
    console.error('Failed to send error message:', sendErr instanceof Error ? sendErr.message : sendErr);
  }
};

// Notification function - send to group chat or conversation references
async function sendNotification(message: string, card?: any): Promise<void> {
  const groupChatId = process.env.TEAMS_CHANNEL_ID;
  const appId = process.env.MICROSOFT_APP_ID ?? '';
  const tenantId = process.env.MICROSOFT_APP_TENANT_ID ?? '';

  // If group chat ID is set, send to group chat directly
  if (groupChatId) {
    try {
      const groupChatRef = {
        channelId: 'msteams',
        serviceUrl: 'https://smba.trafficmanager.net/teams/',
        conversation: {
          id: groupChatId,
          isGroup: true,
          conversationType: 'groupChat',
          tenantId: tenantId,
          name: '',
        },
        bot: {
          id: appId,
          name: 'MeaLOps',
        },
      };

      await (adapter as any).continueConversationAsync(
        appId,
        groupChatRef,
        async (context: any) => {
          // 메시지 먼저 전송
          await context.sendActivity(MessageFactory.text(message));
          // 카드가 있으면 카드도 전송
          if (card) {
            await context.sendActivity(MessageFactory.attachment(card));
          }
        }
      );
      console.log('✅ Notification sent to group chat');
    } catch (error) {
      console.error('Error sending to group chat:', error);
    }
  }

  // Also send to all stored conversation references (other chats)
  for (const [, reference] of conversationReferences) {
    // Skip if already sent to this group chat via groupChatId
    if (groupChatId && reference.conversation?.id === groupChatId) continue;
    try {
      await (adapter as any).continueConversation(reference, async (context: any) => {
        await context.sendActivity(card ? MessageFactory.attachment(card) : message);
      });
    } catch (error) {
      console.error('Error sending to other chat:', error);
    }
  }
}

// Initialize scheduler
const scheduler = new SchedulerImpl(
  voteService,
  voteRepo,
  userRepo,
  blacklistRepo,
  historyRepo,
  settingRepo,
  restaurantRepo,
  weatherService,
  sendNotification
);

const commandHandler = new CommandHandler();

// Create dependencies container
const dependencies: Dependencies = {
  db,
  restaurantRepo,
  voteRepo,
  blacklistRepo,
  reviewRepo,
  historyRepo,
  userRepo,
  settingRepo,
  ollamaService,
  weatherService,
  recommendationService,
  voteService,
  favoriteService,
  scheduler,
};

// Create bot instance
const bot = new MeaLOpsBot(dependencies);

// Express server for Bot Framework
const app = express();
app.use(express.json());

const port = process.env.PORT ?? 3978;

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'MeaLOps' });
});

// Bot Framework endpoint
app.post('/api/messages', async (req, res) => {
  await adapter.process(req, res, async (context) => {
    const act = context.activity;
    console.log(`[Activity] type=${act.type} name=${act.name ?? '-'} text="${act.text ?? ''}" from=${act.from?.name ?? act.from?.id ?? '-'}`);

    // Handle Adaptive Card actions - CloudAdapter는 invokeResponse로 응답
    if (act.type === 'invoke' && act.name === 'adaptiveCard/action') {
      const response = await (bot as any).handleCardAction(context, act.value);
      await context.sendActivity({
        type: 'invokeResponse',
        value: {
          status: response.statusCode ?? 200,
          body: response,
        },
      });
      return;
    }
    await bot.run(context);
  });
});

// Prevent unhandled promise rejections from crashing the server
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection (non-fatal):', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception (non-fatal):', err.message);
});

// Test endpoint
app.post('/test', async (req, res) => {
  const { text, userId = 'test-user', userName = '테스트유저' } = req.body;
  if (!text) {
    res.status(400).json({ error: 'text 필드가 필요합니다' });
    return;
  }
  const result = await commandHandler.handle();
  res.json(result);
});

// Start server
app.listen(port, () => {
  console.log(`🍽️ MeaLOps server running on port ${port}`);

  // Start scheduler
  scheduler.start();

  // Check Ollama connection + warmup + 태그 자동 생성
  ollamaService.checkConnection().then(async connected => {
    if (connected) {
      console.log('✅ Ollama connected');
      await ollamaService.warmup();
      console.log('✅ Ollama warmup complete');

      // 태그 없는 기존 식당 자동 태그 생성 (백그라운드)
      const untagged = restaurantRepo.findAll(false).filter(r => !r.tags);
      if (untagged.length > 0) {
        console.log(`[Tags] 태그 없는 식당 ${untagged.length}개 자동 생성 시작`);
        (async () => {
          for (const r of untagged) {
            const tags = await ollamaService.generateTags(r.name, r.category);
            if (tags) restaurantRepo.update(r.id, { tags });
          }
          console.log(`[Tags] 자동 태그 생성 완료`);
        })();
      }
    } else {
      console.log('⚠️ Ollama not available, using fallback recommendations');
    }
  });
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  scheduler.stop();
  db.close();
  process.exit(0);
});

export { dependencies };
