import Database from 'better-sqlite3';
import { promises as fs } from 'fs';
import path from 'path';

export class SqliteDatabase {
  private db: Database.Database | null = null;
  private readonly dbPath: string;

  constructor(dbPath: string = './data/lunch.db') {
    this.dbPath = dbPath;
  }

  init(): void {
    // Ensure data directory exists
    const dir = path.dirname(this.dbPath);
    fs.mkdir(dir, { recursive: true }).catch(() => {});

    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.createTables();
  }

  private createTables(): void {
    if (!this.db) throw new Error('Database not initialized');

    this.db.exec(`
      -- Restaurants
      CREATE TABLE IF NOT EXISTS restaurants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        category TEXT NOT NULL,
        distance INTEGER,
        price INTEGER,
        is_active BOOLEAN DEFAULT 1
      );

      -- Users
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        aad_object_id TEXT
      );

      -- Votes
      CREATE TABLE IF NOT EXISTS votes (
        user_id TEXT NOT NULL,
        restaurant_id INTEGER,
        vote_date TEXT NOT NULL,
        is_solo INTEGER DEFAULT 0,
        PRIMARY KEY (user_id, vote_date),
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (restaurant_id) REFERENCES restaurants(id)
      );

      -- Blacklist
      CREATE TABLE IF NOT EXISTS blacklist (
        user_id TEXT NOT NULL,
        restaurant_id INTEGER NOT NULL,
        PRIMARY KEY (user_id, restaurant_id),
        FOREIGN KEY (restaurant_id) REFERENCES restaurants(id)
      );

      -- Reviews
      CREATE TABLE IF NOT EXISTS reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        restaurant_id INTEGER NOT NULL,
        rating INTEGER CHECK(rating BETWEEN 1 AND 5),
        visit_date TEXT NOT NULL,
        comment TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (restaurant_id) REFERENCES restaurants(id)
      );

      -- Selected History
      CREATE TABLE IF NOT EXISTS selected_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        restaurant_id INTEGER NOT NULL,
        selected_date TEXT NOT NULL UNIQUE,
        vote_count INTEGER,
        FOREIGN KEY (restaurant_id) REFERENCES restaurants(id)
      );

      -- Holidays
      CREATE TABLE IF NOT EXISTS holidays (
        date TEXT PRIMARY KEY,
        name TEXT
      );

      -- Settings
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      -- Insert default settings
      INSERT OR IGNORE INTO settings (key, value) VALUES ('budget', '15000');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('force_decision_enabled', 'true');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('force_decision_minute', '30');
    `);

    // Migration: Add is_solo column to votes table if it doesn't exist
    try {
      this.db.exec('ALTER TABLE votes ADD COLUMN is_solo INTEGER DEFAULT 0');
    } catch {
      // Column already exists, ignore error
    }
  }

  get<T>(query: string, params: unknown[] = []): T | undefined {
    if (!this.db) throw new Error('Database not initialized');
    const stmt = this.db.prepare(query);
    return stmt.get(...params) as T | undefined;
  }

  all<T>(query: string, params: unknown[] = []): T[] {
    if (!this.db) throw new Error('Database not initialized');
    const stmt = this.db.prepare(query);
    return stmt.all(...params) as T[];
  }

  run(query: string, params: unknown[] = []): void {
    if (!this.db) throw new Error('Database not initialized');
    const stmt = this.db.prepare(query);
    stmt.run(...params);
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

// Singleton instance
let dbInstance: SqliteDatabase | null = null;

export function getDatabase(dbPath?: string): SqliteDatabase {
  if (!dbInstance) {
    dbInstance = new SqliteDatabase(dbPath);
  }
  return dbInstance;
}
