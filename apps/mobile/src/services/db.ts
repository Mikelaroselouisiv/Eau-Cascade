import * as SQLite from 'expo-sqlite';

let db: SQLite.SQLiteDatabase | null = null;
let initPromise: Promise<void> | null = null;

export async function initDb(): Promise<void> {
  if (db) return;
  initPromise ??= (async () => {
    db = await SQLite.openDatabaseAsync('pos-local.db');
    try {
      await db.execAsync('PRAGMA journal_mode = WAL;');
    } catch {
      await db.execAsync('PRAGMA journal_mode = DELETE;');
    }
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS outbox_sales (
        id TEXT PRIMARY KEY NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS app_cache (
        key TEXT PRIMARY KEY NOT NULL,
        value_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS printer_settings (
        id INTEGER PRIMARY KEY NOT NULL,
        device_address TEXT,
        device_name TEXT,
        paper_width INTEGER NOT NULL DEFAULT 58,
        transport TEXT NOT NULL DEFAULT 'classic'
      );
    `);
    await migratePrinterSettings(db);
  })();
  await initPromise;
}

async function migratePrinterSettings(database: SQLite.SQLiteDatabase): Promise<void> {
  const cols = await database.getAllAsync<{ name: string }>('PRAGMA table_info(printer_settings)');
  if (!cols.some((col) => col.name === 'transport')) {
    await database.execAsync(
      "ALTER TABLE printer_settings ADD COLUMN transport TEXT NOT NULL DEFAULT 'classic'",
    );
  }
}

export function getDb(): SQLite.SQLiteDatabase {
  if (!db) throw new Error('DB not initialized — call initDb() first');
  return db;
}
