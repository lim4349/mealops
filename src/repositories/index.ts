import type {
  Restaurant,
  RestaurantRepository,
  Vote,
  VoteRepository,
  BlacklistRepository,
  Review,
  ReviewRepository,
  SelectedHistory,
  SelectedHistoryRepository,
  User,
  UserRepository,
  Setting,
  SettingRepository,
  CreateRestaurantDto,
  RestaurantCategory,
  VoteResult,
} from '../core/types.js';
import type { SqliteDatabase } from '../db/index.js';

export class RestaurantRepositoryImpl implements RestaurantRepository {
  constructor(private db: SqliteDatabase) {}

  create(dto: CreateRestaurantDto): Restaurant {
    this.db.run(
      'INSERT INTO restaurants (name, category, distance, price) VALUES (?, ?, ?, ?)',
      [dto.name, dto.category, dto.distance, dto.price]
    );
    const created = this.findByName(dto.name);
    if (!created) throw new Error('Failed to create restaurant');
    return created;
  }

  findById(id: number): Restaurant | undefined {
    return this.db.get<Restaurant>(
      'SELECT * FROM restaurants WHERE id = ?',
      [id]
    );
  }

  findByName(name: string): Restaurant | undefined {
    return this.db.get<Restaurant>(
      'SELECT * FROM restaurants WHERE name = ?',
      [name]
    );
  }

  findAll(activeOnly: boolean = true): Restaurant[] {
    if (activeOnly) {
      return this.db.all<Restaurant>(
        'SELECT * FROM restaurants WHERE is_active = 1 ORDER BY category, distance'
      );
    }
    return this.db.all<Restaurant>(
      'SELECT * FROM restaurants ORDER BY category, distance'
    );
  }

  findByCategory(category: RestaurantCategory): Restaurant[] {
    return this.db.all<Restaurant>(
      'SELECT * FROM restaurants WHERE category = ? AND is_active = 1 ORDER BY distance',
      [category]
    );
  }

  delete(id: number): boolean {
    this.db.run('UPDATE restaurants SET is_active = 0 WHERE id = ?', [id]);
    return true;
  }

  updateActive(id: number, isActive: boolean): boolean {
    this.db.run('UPDATE restaurants SET is_active = ? WHERE id = ?', [isActive ? 1 : 0, id]);
    return true;
  }
}

export class VoteRepositoryImpl implements VoteRepository {
  constructor(private db: SqliteDatabase) {}

  vote(userId: string, restaurantId: number, date: string): void {
    this.db.run(
      'INSERT OR REPLACE INTO votes (user_id, restaurant_id, vote_date) VALUES (?, ?, ?)',
      [userId, restaurantId, date]
    );
  }

  findTodayVotes(date: string): Vote[] {
    return this.db.all<Vote>(
      'SELECT * FROM votes WHERE vote_date = ?',
      [date]
    );
  }

  findUserVote(userId: string, date: string): Vote | undefined {
    return this.db.get<Vote>(
      'SELECT * FROM votes WHERE user_id = ? AND vote_date = ?',
      [userId, date]
    );
  }

  countByRestaurant(restaurantId: number, date: string): number {
    const result = this.db.get<{ count: number }>(
      'SELECT COUNT(*) as count FROM votes WHERE restaurant_id = ? AND vote_date = ?',
      [restaurantId, date]
    );
    return result?.count ?? 0;
  }

  getResults(date: string): VoteResult[] {
    return this.db.all<VoteResult>(`
      SELECT r.id as restaurant_id, r.name as restaurant_name, COUNT(v.user_id) as count
      FROM votes v
      JOIN restaurants r ON v.restaurant_id = r.id
      WHERE v.vote_date = ?
      GROUP BY r.id, r.name
      ORDER BY count DESC
    `, [date]);
  }
}

export class BlacklistRepositoryImpl implements BlacklistRepository {
  constructor(private db: SqliteDatabase) {}

  add(userId: string, restaurantId: number): void {
    this.db.run(
      'INSERT OR IGNORE INTO blacklist (user_id, restaurant_id) VALUES (?, ?)',
      [userId, restaurantId]
    );
  }

  remove(userId: string, restaurantId: number): void {
    this.db.run(
      'DELETE FROM blacklist WHERE user_id = ? AND restaurant_id = ?',
      [userId, restaurantId]
    );
  }

  getUserBlacklist(userId: string): Restaurant[] {
    return this.db.all<Restaurant>(`
      SELECT r.* FROM restaurants r
      JOIN blacklist b ON r.id = b.restaurant_id
      WHERE b.user_id = ? AND r.is_active = 1
    `, [userId]);
  }

  isBlacklisted(userId: string, restaurantId: number): boolean {
    const result = this.db.get<{ exists: number }>(
      'SELECT 1 as exists FROM blacklist WHERE user_id = ? AND restaurant_id = ?',
      [userId, restaurantId]
    );
    return !!result;
  }

  getBlacklistedRestaurantIds(): number[] {
    const results = this.db.all<{ restaurant_id: number }>(
      'SELECT DISTINCT restaurant_id FROM blacklist'
    );
    return results.map(r => r.restaurant_id);
  }
}

export class ReviewRepositoryImpl implements ReviewRepository {
  constructor(private db: SqliteDatabase) {}

  create(review: Omit<Review, 'id' | 'created_at'>): Review {
    this.db.run(
      'INSERT INTO reviews (user_id, restaurant_id, rating, visit_date, comment) VALUES (?, ?, ?, ?, ?)',
      [review.user_id, review.restaurant_id, review.rating, review.visit_date, review.comment ?? null]
    );
    const created = this.db.all<Review>('SELECT * FROM reviews WHERE user_id = ? AND visit_date = ?', [
      review.user_id, review.visit_date
    ]);
    return created[created.length - 1];
  }

  findByRestaurant(restaurantId: number): Review[] {
    return this.db.all<Review>(
      'SELECT * FROM reviews WHERE restaurant_id = ? ORDER BY created_at DESC',
      [restaurantId]
    );
  }

  findByUser(userId: string): Review[] {
    return this.db.all<Review>(
      'SELECT * FROM reviews WHERE user_id = ? ORDER BY created_at DESC',
      [userId]
    );
  }

  getAverageRating(restaurantId: number): number {
    const result = this.db.get<{ avg: number }>(
      'SELECT AVG(rating) as avg FROM reviews WHERE restaurant_id = ?',
      [restaurantId]
    );
    return result?.avg ? Math.round(result.avg * 10) / 10 : 0;
  }
}

export class SelectedHistoryRepositoryImpl implements SelectedHistoryRepository {
  constructor(private db: SqliteDatabase) {}

  add(restaurantId: number, date: string, voteCount: number): void {
    this.db.run(
      'INSERT INTO selected_history (restaurant_id, selected_date, vote_count) VALUES (?, ?, ?)',
      [restaurantId, date, voteCount]
    );
  }

  findRecent(days: number): SelectedHistory[] {
    return this.db.all<SelectedHistory>(`
      SELECT sh.* FROM selected_history sh
      WHERE sh.selected_date >= date('now', '-${days} days')
      ORDER BY sh.selected_date DESC
    `);
  }

  findByDate(date: string): SelectedHistory | undefined {
    return this.db.get<SelectedHistory>(
      'SELECT * FROM selected_history WHERE selected_date = ?',
      [date]
    );
  }

  getRecentVisitDates(restaurantId: number, days: number): string[] {
    const results = this.db.all<{ selected_date: string }>(`
      SELECT selected_date FROM selected_history
      WHERE restaurant_id = ? AND selected_date >= date('now', '-${days} days')
      ORDER BY selected_date DESC
    `, [restaurantId]);
    return results.map(r => r.selected_date);
  }
}

export class UserRepositoryImpl implements UserRepository {
  constructor(private db: SqliteDatabase) {}

  findOrCreate(userId: string, name: string): User {
    const existing = this.findById(userId);
    if (existing) return existing;

    this.db.run(
      'INSERT INTO users (id, name) VALUES (?, ?)',
      [userId, name]
    );
    return { id: userId, name };
  }

  findById(userId: string): User | undefined {
    return this.db.get<User>(
      'SELECT * FROM users WHERE id = ?',
      [userId]
    );
  }

  findAll(): User[] {
    return this.db.all<User>('SELECT * FROM users');
  }
}

export class SettingRepositoryImpl implements SettingRepository {
  constructor(private db: SqliteDatabase) {}

  get(key: string): string | undefined {
    const result = this.db.get<Setting>(
      'SELECT * FROM settings WHERE key = ?',
      [key]
    );
    return result?.value;
  }

  set(key: string, value: string): void {
    this.db.run(
      'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
      [key, value]
    );
  }

  getBudget(): number {
    return parseInt(this.get('budget') ?? '15000', 10);
  }

  setBudget(amount: number): void {
    this.set('budget', amount.toString());
  }

  getForceDecisionEnabled(): boolean {
    return this.get('force_decision_enabled') === 'true';
  }

  setForceDecisionEnabled(enabled: boolean): void {
    this.set('force_decision_enabled', enabled ? 'true' : 'false');
  }
}
