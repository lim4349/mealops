import 'dotenv/config';
import express from 'express';
import { MeaLOpsBot } from './bot/index.js';
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

// Notification function (to be connected to Teams)
async function sendNotification(message: string): Promise<void> {
  // TODO: Send to Teams channel
  console.log('Notification:', message);
}

// Initialize scheduler
const scheduler = new SchedulerImpl(
  voteService,
  userRepo,
  blacklistRepo,
  historyRepo,
  settingRepo,
  restaurantRepo,
  sendNotification
);

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
  // Bot Framework adapter will handle this
  res.send(200);
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
