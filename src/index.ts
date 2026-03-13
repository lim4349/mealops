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
  blacklistRepo
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

// CloudAdapter with SingleTenant authentication (한국 리전 Single-Tenant 봇)
const auth = new ConfigurationBotFrameworkAuthentication({
  MicrosoftAppId: process.env.MICROSOFT_APP_ID ?? '',
  MicrosoftAppPassword: process.env.MICROSOFT_APP_PASSWORD ?? '',
  MicrosoftAppType: 'SingleTenant',
  MicrosoftAppTenantId: process.env.MICROSOFT_APP_TENANT_ID ?? '',
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

// Notification function - send to channel or conversation references
async function sendNotification(message: string, card?: any): Promise<void> {
  const channelId = process.env.TEAMS_CHANNEL_ID;
  const appId = process.env.MICROSOFT_APP_ID ?? '';
  const tenantId = process.env.MICROSOFT_APP_TENANT_ID ?? '';

  // If channel ID is set, send to channel directly
  if (channelId) {
    try {
      await (adapter as any).createConversationAsync(
        appId,
        'msteams',
        'https://smba.trafficmanager.net/teams/',
        'https://api.botframework.com',
        {
          isGroup: true,
          channelData: {
            channel: { id: channelId },
          },
          activity: card ? MessageFactory.attachment(card) : MessageFactory.text(message),
          bot: { id: appId, name: 'MeaLOps' },
          tenantId: tenantId,
        } as any,
        async (turnContext: any) => {
          console.log('✅ Notification sent to channel');
        }
      );
    } catch (error) {
      console.error('Error sending to channel:', error);
    }
  }

  // Also send to all stored conversation references (DMs, previous chats)
  for (const [, reference] of conversationReferences) {
    try {
      await (adapter as any).continueConversation(reference, async (context: any) => {
        await context.sendActivity(card ? MessageFactory.attachment(card) : message);
      });
    } catch (error) {
      console.error('Error sending to DM:', error);
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

  // Check Ollama connection
  ollamaService.checkConnection().then(connected => {
    if (connected) {
      console.log('✅ Ollama connected');
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
