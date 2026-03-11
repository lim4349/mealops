// Domain Types
export interface Restaurant {
  id: number;
  name: string;
  alias?: string;
  category: RestaurantCategory;
  distance: number;
  price: number;
  is_active: boolean;
  is_delivery?: boolean;
}

export type RestaurantCategory = '한식' | '일식' | '중식' | '양식' | '분식' | '기타';

export interface User {
  id: string;
  name: string;
  aad_object_id?: string;
}

export interface Vote {
  user_id: string;
  restaurant_id: number | null;
  vote_date: string; // YYYY-MM-DD
  is_solo: boolean;
  is_any?: boolean;
}

export interface Blacklist {
  user_id: string;
  restaurant_id: number;
}

export interface Review {
  id: number;
  user_id: string;
  restaurant_id: number;
  rating: number; // 1-5
  visit_date: string;
  comment?: string;
  created_at: string;
}

export interface SelectedHistory {
  id: number;
  restaurant_id: number;
  selected_date: string;
  vote_count: number;
  weather_temp?: number;
  weather_condition?: string;
}

export interface Holiday {
  date: string;
  name: string;
}

export interface Setting {
  key: string;
  value: string;
}

// DTO Types
export interface CreateRestaurantDto {
  name: string;
  alias?: string;
  category: RestaurantCategory;
  distance: number;
  price: number;
  is_delivery?: boolean;
}

export interface VoterEntry {
  user_id: string;
  user_name: string;
}

export interface VoteResult {
  restaurant_id: number;
  restaurant_name: string;
  count: number;
}

export interface RecommendationResult {
  name: string;
  reason: string;
  category?: string;
  distance?: number;
  price?: number;
}

export interface UserFavoriteStats {
  user_name: string;
  most_visited: { name: string; count: number }[];
  highest_rated: { name: string; rating: number }[];
  recent_visits: { name: string; date: string }[];
}

// Command Types
export type Command = 'help';

export interface ParsedCommand {
  command: Command;
  args: string[];
  mentionedUser?: string;
}

// Service Response Types
export type CardType =
  | 'main_menu'
  | 'vote'
  | 'recommend'
  | 'list'
  | 'blacklist'
  | 'settings'
  | 'dashboard'
  | 'response'
  | 'add_form';

export interface ServiceResponse<T = unknown> {
  success: boolean;
  data?: T;
  message: string;
  cardType?: CardType;
}

// Weather Types
export interface WeatherInfo {
  temp: number;
  condition: string;
  description: string;
}

// DI Container Types
export interface Dependencies {
  db: Database;
  restaurantRepo: RestaurantRepository;
  voteRepo: VoteRepository;
  blacklistRepo: BlacklistRepository;
  reviewRepo: ReviewRepository;
  historyRepo: SelectedHistoryRepository;
  userRepo: UserRepository;
  settingRepo: SettingRepository;
  ollamaService: OllamaService;
  weatherService: WeatherService;
  recommendationService: RecommendationService;
  voteService: VoteService;
  favoriteService: FavoriteService;
  scheduler: Scheduler;
}

// Repository Interfaces
export interface Database {
  init(): void;
  close(): void;
  get<T>(query: string, params: unknown[]): T | undefined;
  all<T>(query: string, params: unknown[]): T[];
  run(query: string, params: unknown[]): void;
}

export interface RestaurantRepository {
  create(dto: CreateRestaurantDto): Restaurant;
  findById(id: number): Restaurant | undefined;
  findByName(name: string): Restaurant | undefined;
  findAll(activeOnly?: boolean): Restaurant[];
  findByCategory(category: RestaurantCategory): Restaurant[];
  delete(id: number): boolean;
  updateActive(id: number, isActive: boolean): boolean;
  update(id: number, dto: Partial<CreateRestaurantDto>): void;
}

export interface VoteRepository {
  vote(userId: string, restaurantId: number | null, date: string, isSolo?: boolean, isAny?: boolean): void;
  findTodayVotes(date: string): Vote[];
  findUserVote(userId: string, date: string): Vote | undefined;
  findUserVotes(userId: string, date: string): Vote[]; // plural - multiple votes
  countByRestaurant(restaurantId: number, date: string): number;
  countUniqueVoters(date: string): number;
  getResults(date: string): VoteResult[];
  getSoloCount(date: string): number;
  cancelVote(userId: string, restaurantId: number, date: string): boolean;
  findVotersByRestaurant(date: string): Map<number, VoterEntry[]>;
  findSoloVoters(date: string): VoterEntry[];
  cancelSoloVote(userId: string, date: string): boolean;
  cancelAllVotes(userId: string, date: string): boolean;
  getAnyCount(date: string): number;
  findUserAnyVote(userId: string, date: string): Vote | undefined;
  cancelAnyVote(userId: string, date: string): boolean;
  findAnyVoters(date: string): VoterEntry[];
}

export interface BlacklistRepository {
  add(userId: string, restaurantId: number): void;
  remove(userId: string, restaurantId: number): void;
  getUserBlacklist(userId: string): Restaurant[];
  isBlacklisted(userId: string, restaurantId: number): boolean;
  getBlacklistedRestaurantIds(): number[];
}

export interface ReviewRepository {
  create(review: Omit<Review, 'id' | 'created_at'>): Review;
  findByRestaurant(restaurantId: number): Review[];
  findByUser(userId: string): Review[];
  findByUserAndRestaurantAndDate(userId: string, restaurantId: number, visitDate: string): Review | undefined;
  updateRating(userId: string, restaurantId: number, visitDate: string, rating: number): void;
  getAverageRating(restaurantId: number): number;
}

export interface SelectedHistoryRepository {
  add(restaurantId: number, date: string, voteCount: number, weatherTemp?: number, weatherCondition?: string): void;
  findRecent(days: number): SelectedHistory[];
  findByDate(date: string): SelectedHistory | undefined;
  getRecentVisitDates(restaurantId: number, days: number): string[];
  findByWeather(condition: string, tempMin?: number, tempMax?: number): SelectedHistory[];
}

export interface UserRepository {
  findOrCreate(userId: string, name: string): User;
  findById(userId: string): User | undefined;
  findAll(): User[];
}

export interface SettingRepository {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  getBudget(): number;
  setBudget(amount: number): void;
  getForceDecisionEnabled(): boolean;
  setForceDecisionEnabled(enabled: boolean): void;
  getVoteTriggeredDate(): string;
  setVoteTriggeredDate(date: string): void;
  getDeliveryModeActive(): boolean;
  setDeliveryModeActive(active: boolean): void;
}

// Service Interfaces
export interface OllamaService {
  recommend(context: RecommendationContext): Promise<RecommendationResult[]>;
}

export interface RecommendationContext {
  weather: WeatherInfo;
  recentVisits: string[];
  topRated: string[];
  blacklisted: string[];
  budget: number;
  availableRestaurants: { name: string; category: string; price: number; distance: number }[];
  previousRecommendations?: string[];
}

export interface WeatherService {
  getCurrent(): Promise<WeatherInfo>;
}

export interface RecommendationService {
  getRecommendations(userId: string, previousNames?: string[]): Promise<RecommendationResult[]>;
}

export interface VoteService {
  vote(userId: string, userName: string, restaurantName: string, date: string): Promise<ServiceResponse>;
  voteSolo(userId: string, userName: string, date: string): Promise<ServiceResponse>;
  voteAny(userId: string, userName: string, date: string): Promise<ServiceResponse>;
  getResults(date: string): VoteResult[];
  getSoloCount(date: string): number;
  getAnyCount(date: string): number;
  decideWinner(date: string): ServiceResponse<{ restaurant: string; reason: string }>;
}

export interface FavoriteService {
  getUserFavorites(userId: string, userName?: string): UserFavoriteStats;
  getUserFavoritesByName(userName: string): UserFavoriteStats | undefined;
}

export interface Scheduler {
  start(): void;
  stop(): void;
  isHoliday(date: Date): boolean;
}

// Adaptive Card Response
export interface AdaptiveCardInvokeResponse {
  statusCode: number;
  type?: string;
  value?: any;
}
