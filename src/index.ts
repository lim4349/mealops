import 'dotenv/config';
import express from 'express';
import { BotFrameworkAdapter, MessageFactory } from 'botbuilder';
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

// Bot Framework adapter
const adapter = new BotFrameworkAdapter({
  appId: process.env.MICROSOFT_APP_ID ?? '',
  appPassword: process.env.MICROSOFT_APP_PASSWORD ?? '',
});

// Error handler
adapter.onTurnError = async (context, error) => {
  const errorMsg = error instanceof Error ? error.message : String(error);

  // Log detailed error info
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.error('❌ Bot Framework Error:');
  console.error(`   Type: ${error?.constructor?.name || 'Unknown'}`);
  console.error(`   Message: ${errorMsg}`);
  if (errorMsg.includes('Authorization') || errorMsg.includes('401')) {
    console.error('   Status: Azure Bot Service 인증 실패');
    console.error('   Action: MICROSOFT_APP_ID/PASSWORD 확인 필요');
  }
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  try {
    // Only try to send activity if there's a valid context
    if (context && context.activity) {
      await context.sendActivity('일시적인 오류입니다. 잠시 후 다시 시도해주세요.');
    }
  } catch (sendErr) {
    // If send fails, just log it - don't crash
    console.error('Failed to send error message:', sendErr instanceof Error ? sendErr.message : sendErr);
  }
};

// Notification function - send to all conversation references
async function sendNotification(message: string, card?: any): Promise<void> {
  for (const [, reference] of conversationReferences) {
    try {
      await adapter.continueConversation(reference, async (context) => {
        await context.sendActivity(card ? MessageFactory.attachment(card) : message);
      });
    } catch (error) {
      console.error('Error sending notification:', error);
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
app.post('/api/messages', (req, res) => {
  adapter.processActivity(req, res, async (context) => {
    // Handle Adaptive Card actions
    if (context.activity.type === 'invoke' && context.activity.name === 'adaptiveCard/action') {
      const response = await (bot as any).handleCardAction(context, context.activity.value);
      res.json(response);
      return;
    }
    await bot.run(context);
  }).catch((err: Error) => {
    console.error('processActivity error (non-fatal):', err.message);
    if (!res.headersSent) {
      res.status(500).send();
    }
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
