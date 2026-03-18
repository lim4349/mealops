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
  VoterEntry,
} from '../core/types.js';
import type { SqliteDatabase } from '../db/index.js';

export class RestaurantRepositoryImpl implements RestaurantRepository {
  constructor(private db: SqliteDatabase) {}

  create(dto: CreateRestaurantDto): Restaurant {
    this.db.run(
      'INSERT INTO restaurants (name, alias, category, distance, price, is_delivery, tags) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [dto.name, dto.alias ?? null, dto.category, dto.distance, dto.price, dto.is_delivery ? 1 : 0, dto.tags ?? '']
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

  update(id: number, dto: Partial<CreateRestaurantDto>): void {
    const fields: string[] = [];
    const params: unknown[] = [];
    if (dto.name !== undefined) { fields.push('name = ?'); params.push(dto.name); }
    if (dto.alias !== undefined) { fields.push('alias = ?'); params.push(dto.alias || null); }
    if (dto.category !== undefined) { fields.push('category = ?'); params.push(dto.category); }
    if (dto.distance !== undefined) { fields.push('distance = ?'); params.push(Number(dto.distance)); }
    if (dto.price !== undefined) { fields.push('price = ?'); params.push(Number(dto.price)); }
    if (dto.is_delivery !== undefined) { fields.push('is_delivery = ?'); params.push(dto.is_delivery ? 1 : 0); }
    if (dto.tags !== undefined) { fields.push('tags = ?'); params.push(dto.tags); }
    if (fields.length === 0) return;
    params.push(id);
    this.db.run(`UPDATE restaurants SET ${fields.join(', ')} WHERE id = ?`, params);
  }
}

export class VoteRepositoryImpl implements VoteRepository {
  constructor(private db: SqliteDatabase) {}

  vote(userId: string, restaurantId: number | null, date: string, isSolo = false, isAny = false): void {
    if (isSolo || isAny) {
      // Solo or Any vote - single vote per user per date
      this.db.run(
        'INSERT OR REPLACE INTO votes (user_id, restaurant_id, vote_date, is_solo, is_any) VALUES (?, NULL, ?, ?, ?)',
        [userId, date, isSolo ? 1 : 0, isAny ? 1 : 0]
      );
    } else {
      // Restaurant vote - allow multiple votes
      this.db.run(
        'INSERT OR IGNORE INTO votes (user_id, restaurant_id, vote_date, is_solo, is_any) VALUES (?, ?, ?, 0, 0)',
        [userId, restaurantId, date]
      );
    }
  }

  findTodayVotes(date: string): Vote[] {
    const rows = this.db.all<any>(
      'SELECT * FROM votes WHERE vote_date = ?',
      [date]
    );
    return rows.map(v => ({
      user_id: v.user_id,
      restaurant_id: v.restaurant_id,
      vote_date: v.vote_date,
      is_solo: !!v.is_solo,
      is_any: !!v.is_any,
    }));
  }

  findUserVote(userId: string, date: string): Vote | undefined {
    const result = this.db.get<any>(
      'SELECT * FROM votes WHERE user_id = ? AND vote_date = ? AND (is_solo = 1 OR is_any = 1)',
      [userId, date]
    );
    return result
      ? {
          user_id: result.user_id,
          restaurant_id: result.restaurant_id,
          vote_date: result.vote_date,
          is_solo: !!result.is_solo,
          is_any: !!result.is_any,
        }
      : undefined;
  }

  findUserVotes(userId: string, date: string): Vote[] {
    const rows = this.db.all<any>(
      'SELECT * FROM votes WHERE user_id = ? AND vote_date = ?',
      [userId, date]
    );
    return rows.map(v => ({
      user_id: v.user_id,
      restaurant_id: v.restaurant_id,
      vote_date: v.vote_date,
      is_solo: !!v.is_solo,
      is_any: !!v.is_any,
    }));
  }

  countByRestaurant(restaurantId: number, date: string): number {
    const result = this.db.get<{ count: number }>(
      'SELECT COUNT(*) as count FROM votes WHERE restaurant_id = ? AND vote_date = ? AND is_solo = 0 AND is_any = 0',
      [restaurantId, date]
    );
    return result?.count ?? 0;
  }

  countUniqueVoters(date: string): number {
    const result = this.db.get<{ count: number }>(
      'SELECT COUNT(DISTINCT user_id) as count FROM votes WHERE vote_date = ?',
      [date]
    );
    return result?.count ?? 0;
  }

  getSoloCount(date: string): number {
    const result = this.db.get<{ count: number }>(
      'SELECT COUNT(*) as count FROM votes WHERE vote_date = ? AND is_solo = 1',
      [date]
    );
    return result?.count ?? 0;
  }

  getAnyCount(date: string): number {
    const result = this.db.get<{ count: number }>(
      'SELECT COUNT(*) as count FROM votes WHERE vote_date = ? AND is_any = 1',
      [date]
    );
    return result?.count ?? 0;
  }

  getResults(date: string): VoteResult[] {
    return this.db.all<VoteResult>(`
      SELECT r.id as restaurant_id, r.name as restaurant_name, COUNT(DISTINCT v.user_id) as count
      FROM votes v
      JOIN restaurants r ON v.restaurant_id = r.id
      WHERE v.vote_date = ? AND v.is_solo = 0 AND v.is_any = 0
      GROUP BY r.id, r.name
      ORDER BY count DESC
    `, [date]);
  }

  cancelVote(userId: string, restaurantId: number, date: string): boolean {
    this.db.run(
      'DELETE FROM votes WHERE user_id = ? AND restaurant_id = ? AND vote_date = ?',
      [userId, restaurantId, date]
    );
    return true;
  }

  findVotersByRestaurant(date: string): Map<number, VoterEntry[]> {
    const rows = this.db.all<any>(`
      SELECT DISTINCT v.restaurant_id, u.id, u.name
      FROM votes v
      JOIN users u ON v.user_id = u.id
      WHERE v.vote_date = ? AND v.is_solo = 0 AND v.is_any = 0
      ORDER BY v.restaurant_id, u.name
    `, [date]);

    const map = new Map<number, import('../core/types.js').VoterEntry[]>();
    for (const row of rows) {
      if (!map.has(row.restaurant_id)) {
        map.set(row.restaurant_id, []);
      }
      map.get(row.restaurant_id)!.push({ user_id: row.id, user_name: row.name });
    }
    return map;
  }

  findSoloVoters(date: string): VoterEntry[] {
    return this.db.all<any>(`
      SELECT DISTINCT u.id, u.name
      FROM votes v
      JOIN users u ON v.user_id = u.id
      WHERE v.vote_date = ? AND v.is_solo = 1
      ORDER BY u.name
    `, [date]).map(row => ({ user_id: row.id, user_name: row.name }));
  }

  cancelSoloVote(userId: string, date: string): boolean {
    this.db.run(
      'DELETE FROM votes WHERE user_id = ? AND vote_date = ? AND is_solo = 1',
      [userId, date]
    );
    return true;
  }

  cancelAllVotes(userId: string, date: string): boolean {
    this.db.run(
      'DELETE FROM votes WHERE user_id = ? AND vote_date = ? AND is_solo = 0 AND is_any = 0',
      [userId, date]
    );
    return true;
  }

  findUserAnyVote(userId: string, date: string): Vote | undefined {
    const result = this.db.get<any>(
      'SELECT * FROM votes WHERE user_id = ? AND vote_date = ? AND is_any = 1',
      [userId, date]
    );
    return result
      ? {
          user_id: result.user_id,
          restaurant_id: result.restaurant_id,
          vote_date: result.vote_date,
          is_solo: !!result.is_solo,
          is_any: !!result.is_any,
        }
      : undefined;
  }

  cancelAnyVote(userId: string, date: string): boolean {
    this.db.run(
      'DELETE FROM votes WHERE user_id = ? AND vote_date = ? AND is_any = 1',
      [userId, date]
    );
    return true;
  }

  findAnyVoters(date: string): VoterEntry[] {
    return this.db.all<any>(`
      SELECT DISTINCT u.id, u.name
      FROM votes v
      JOIN users u ON v.user_id = u.id
      WHERE v.vote_date = ? AND v.is_any = 1
      ORDER BY u.name
    `, [date]).map(row => ({ user_id: row.id, user_name: row.name }));
  }

  countAllVotesByUser(userId: string): { restaurantId: number; count: number }[] {
    return this.db.all<{ restaurantId: number; count: number }>(
      `SELECT restaurant_id as restaurantId, COUNT(*) as count
       FROM votes
       WHERE user_id = ? AND restaurant_id IS NOT NULL AND is_solo = 0 AND is_any = 0
       GROUP BY restaurant_id
       ORDER BY count DESC`,
      [userId]
    );
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
    const result = this.db.get<{ found: number }>(
      'SELECT 1 as found FROM blacklist WHERE user_id = ? AND restaurant_id = ?',
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

  findByUserAndRestaurantAndDate(userId: string, restaurantId: number, visitDate: string): Review | undefined {
    return this.db.get<Review>(
      'SELECT * FROM reviews WHERE user_id = ? AND restaurant_id = ? AND visit_date = ?',
      [userId, restaurantId, visitDate]
    );
  }

  updateRating(userId: string, restaurantId: number, visitDate: string, rating: number): void {
    this.db.run(
      'UPDATE reviews SET rating = ? WHERE user_id = ? AND restaurant_id = ? AND visit_date = ?',
      [rating, userId, restaurantId, visitDate]
    );
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
      'SELECT AVG(rating) as avg FROM reviews WHERE restaurant_id = ? AND rating > 0',
      [restaurantId]
    );
    return result?.avg ? Math.round(result.avg * 10) / 10 : 0;
  }
}

export class SelectedHistoryRepositoryImpl implements SelectedHistoryRepository {
  constructor(private db: SqliteDatabase) {}

  add(restaurantId: number, date: string, voteCount: number, weatherTemp?: number, weatherCondition?: string): void {
    this.db.run(
      'INSERT INTO selected_history (restaurant_id, selected_date, vote_count, weather_temp, weather_condition) VALUES (?, ?, ?, ?, ?)',
      [restaurantId, date, voteCount, weatherTemp ?? null, weatherCondition ?? null]
    );
  }

  findAll(): SelectedHistory[] {
    return this.db.all<SelectedHistory>(
      'SELECT * FROM selected_history ORDER BY selected_date DESC',
      []
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

  findByWeather(condition: string, tempMin?: number, tempMax?: number): SelectedHistory[] {
    if (tempMin !== undefined && tempMax !== undefined) {
      return this.db.all<SelectedHistory>(
        'SELECT * FROM selected_history WHERE weather_condition = ? AND weather_temp >= ? AND weather_temp <= ? ORDER BY selected_date DESC',
        [condition, tempMin, tempMax]
      );
    }
    return this.db.all<SelectedHistory>(
      'SELECT * FROM selected_history WHERE weather_condition = ? ORDER BY selected_date DESC',
      [condition]
    );
  }
}

export class UserRepositoryImpl implements UserRepository {
  constructor(private db: SqliteDatabase) {}

  findOrCreate(userId: string, name: string): User {
    const existing = this.findById(userId);
    if (existing) {
      // Upsert: update name if a real name is provided and differs
      if (name && name !== '익명' && existing.name !== name) {
        this.db.run('UPDATE users SET name = ? WHERE id = ?', [name, userId]);
        return { ...existing, name };
      }
      return existing;
    }
    this.db.run('INSERT INTO users (id, name) VALUES (?, ?)', [userId, name]);
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

  getVoteTriggeredDate(): string {
    return this.get('vote_triggered_date') ?? '';
  }

  setVoteTriggeredDate(date: string): void {
    this.set('vote_triggered_date', date);
  }

  getDeliveryModeActive(): boolean {
    return this.get('delivery_mode_active') === 'true';
  }

  setDeliveryModeActive(active: boolean): void {
    this.set('delivery_mode_active', active ? 'true' : 'false');
  }
}
