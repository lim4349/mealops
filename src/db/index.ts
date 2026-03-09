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

      -- Votes (v2 schema with multi-vote support)
      CREATE TABLE IF NOT EXISTS votes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        restaurant_id INTEGER,
        vote_date TEXT NOT NULL,
        is_solo INTEGER DEFAULT 0,
        is_any INTEGER DEFAULT 0,
        UNIQUE(user_id, restaurant_id, vote_date),
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
        weather_temp REAL,
        weather_condition TEXT,
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
      INSERT OR IGNORE INTO settings (key, value) VALUES ('delivery_mode_active', 'false');
    `);

    // Migrations
    this.runMigrations();
  }

  private runMigrations(): void {
    if (!this.db) throw new Error('Database not initialized');

    // Migration 1: Add is_delivery to restaurants
    try {
      this.db.exec('ALTER TABLE restaurants ADD COLUMN is_delivery INTEGER DEFAULT 0');
    } catch {
      // Column already exists
    }

    // Migration 2: Handle votes table schema - check if old schema exists
    try {
      const columns = this.db.pragma('table_info(votes)') as any[];
      const hasId = columns.some(col => col.name === 'id');
      const hasIsAny = columns.some(col => col.name === 'is_any');

      if (!hasId) {
        // Old schema exists, migrate to new schema
        this.db.exec(`
          -- Rename old votes table
          ALTER TABLE votes RENAME TO votes_old;

          -- Create new votes table with id column
          CREATE TABLE votes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            restaurant_id INTEGER,
            vote_date TEXT NOT NULL,
            is_solo INTEGER DEFAULT 0,
            is_any INTEGER DEFAULT 0,
            UNIQUE(user_id, restaurant_id, vote_date),
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (restaurant_id) REFERENCES restaurants(id)
          );

          -- Copy data from old table
          INSERT INTO votes (user_id, restaurant_id, vote_date, is_solo, is_any)
          SELECT user_id, restaurant_id, vote_date, is_solo, 0 FROM votes_old;

          -- Drop old table
          DROP TABLE votes_old;
        `);
      } else if (!hasIsAny) {
        // Has id but missing is_any column
        this.db.exec('ALTER TABLE votes ADD COLUMN is_any INTEGER DEFAULT 0');
      }
    } catch (err) {
      console.error('Error during votes table migration:', err);
    }

    // Migration 3: Add weather columns to selected_history
    try {
      const columns = this.db.pragma('table_info(selected_history)') as any[];
      if (!columns.some(col => col.name === 'weather_temp')) {
        this.db.exec('ALTER TABLE selected_history ADD COLUMN weather_temp REAL');
      }
      if (!columns.some(col => col.name === 'weather_condition')) {
        this.db.exec('ALTER TABLE selected_history ADD COLUMN weather_condition TEXT');
      }
    } catch {
      // Columns already exist
    }

    // Migration 4: Add alias to restaurants
    try {
      const columns = this.db.pragma('table_info(restaurants)') as any[];
      if (!columns.some(col => col.name === 'alias')) {
        this.db.exec('ALTER TABLE restaurants ADD COLUMN alias TEXT');
      }
    } catch {
      // Column already exists
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
