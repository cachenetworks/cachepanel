// Unified driver layer for the DB management section. Each driver gets the
// resolved profile (with the password decrypted) and exposes the same shape:
//   listDatabases, listTables, describeTable, runQuery
//
// All mutating SQL is allowed by default — gate with profile.readOnly to lock
// to SELECT/SHOW/EXPLAIN.

import type { DbConnection } from '@prisma/client';
import { decryptSecret } from './secrets';

export type Driver = 'mysql' | 'mariadb' | 'postgres' | 'sqlite';

export const DRIVERS: Driver[] = ['mysql', 'mariadb', 'postgres', 'sqlite'];

export interface ResolvedConnection {
  id: string;
  name: string;
  driver: Driver;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  ssl: boolean;
  readOnly: boolean;
}

export function resolveConnection(c: DbConnection): ResolvedConnection {
  const driver = c.driver as Driver;
  return {
    id: c.id,
    name: c.name,
    driver,
    host: c.host ?? '',
    port: c.port ?? defaultPort(driver),
    username: c.username ?? '',
    password: decryptSecret(c.password),
    database: c.database ?? '',
    ssl: !!c.ssl,
    readOnly: !!c.readOnly,
  };
}

export function defaultPort(driver: Driver): number {
  switch (driver) {
    case 'mysql':
    case 'mariadb':
      return 3306;
    case 'postgres':
      return 5432;
    default:
      return 0;
  }
}

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
  /** Field metadata if available. */
  fields?: Array<{ name: string; type?: string }>;
  /** Echoed back for INSERT/UPDATE/DELETE-style queries on engines that
   * don't return result sets. */
  affected?: number;
  durationMs: number;
}

export interface TableInfo {
  name: string;
  schema?: string | null;
  rowEstimate?: number | null;
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  defaultValue?: string | null;
}

const READ_ONLY_PREFIXES = ['select', 'show', 'explain', 'pragma', 'with', 'desc', 'describe'];

export function isReadOnlySql(sql: string): boolean {
  const trimmed = sql.replace(/^\s*(\/\*[\s\S]*?\*\/|--[^\n]*\n)*\s*/, '').toLowerCase();
  return READ_ONLY_PREFIXES.some((p) => trimmed.startsWith(p + ' ') || trimmed === p);
}

const ROW_CAP = 5000;
const QUERY_TIMEOUT_MS = 30_000;

// ---------- MySQL / MariaDB ----------

async function withMysql<T>(c: ResolvedConnection, fn: (conn: import('mysql2/promise').Connection) => Promise<T>): Promise<T> {
  const mysql = await import('mysql2/promise');
  const conn = await mysql.createConnection({
    host: c.host,
    port: c.port,
    user: c.username,
    password: c.password,
    database: c.database || undefined,
    ssl: c.ssl ? {} : undefined,
    connectTimeout: 8000,
    multipleStatements: false,
    rowsAsArray: true,
  });
  try {
    return await fn(conn);
  } finally {
    await conn.end().catch(() => undefined);
  }
}

async function mysqlListDatabases(c: ResolvedConnection): Promise<string[]> {
  return withMysql(c, async (conn) => {
    const [rows] = await conn.query('SHOW DATABASES');
    return ((rows as unknown as string[][]) ?? [])
      .map((r) => r[0])
      .filter((n) => !['information_schema', 'mysql', 'performance_schema', 'sys'].includes(n));
  });
}

async function mysqlListTables(c: ResolvedConnection, database?: string): Promise<TableInfo[]> {
  return withMysql(c, async (conn) => {
    if (database) await conn.query(`USE \`${database.replace(/`/g, '')}\``);
    const [rows] = await conn.query(
      `SELECT TABLE_NAME, TABLE_ROWS FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME`,
    );
    return ((rows as unknown as Array<[string, number]>) ?? []).map((r) => ({
      name: r[0],
      rowEstimate: r[1] ?? null,
    }));
  });
}

async function mysqlDescribe(c: ResolvedConnection, table: string, database?: string): Promise<ColumnInfo[]> {
  return withMysql(c, async (conn) => {
    if (database) await conn.query(`USE \`${database.replace(/`/g, '')}\``);
    const [rows] = await conn.query(
      `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION`,
      [table],
    );
    return ((rows as unknown as Array<[string, string, string, string, string | null]>) ?? []).map((r) => ({
      name: r[0],
      type: r[1],
      nullable: r[2] === 'YES',
      primaryKey: r[3] === 'PRI',
      defaultValue: r[4],
    }));
  });
}

async function mysqlQuery(c: ResolvedConnection, sql: string, database?: string): Promise<QueryResult> {
  return withMysql(c, async (conn) => {
    if (database) await conn.query(`USE \`${database.replace(/`/g, '')}\``);
    const start = Date.now();
    // mysql2 supports a query timeout via the second arg; we apply a hard
    // promise race to be safe.
    const job = conn.query({ sql, timeout: QUERY_TIMEOUT_MS, rowsAsArray: true });
    const result = await Promise.race([
      job,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Query exceeded ${QUERY_TIMEOUT_MS / 1000}s`)), QUERY_TIMEOUT_MS + 500),
      ),
    ]);
    const [rows, fields] = result as [unknown, Array<{ name: string; type?: number }>];
    const dur = Date.now() - start;
    if (Array.isArray(fields) && Array.isArray(rows)) {
      const arr = rows as unknown[][];
      const truncated = arr.length > ROW_CAP;
      return {
        columns: fields.map((f) => f.name),
        rows: arr.slice(0, ROW_CAP),
        rowCount: arr.length,
        truncated,
        durationMs: dur,
      };
    }
    // INSERT/UPDATE/DELETE — mysql2 returns OkPacket
    const ok = rows as { affectedRows?: number };
    return {
      columns: [],
      rows: [],
      rowCount: 0,
      truncated: false,
      affected: ok.affectedRows ?? 0,
      durationMs: dur,
    };
  });
}

// ---------- Postgres ----------

async function withPg<T>(c: ResolvedConnection, fn: (client: import('pg').Client) => Promise<T>): Promise<T> {
  const { Client } = await import('pg');
  const client = new Client({
    host: c.host,
    port: c.port,
    user: c.username,
    password: c.password,
    database: c.database || 'postgres',
    ssl: c.ssl ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 8000,
    statement_timeout: QUERY_TIMEOUT_MS,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function pgListDatabases(c: ResolvedConnection): Promise<string[]> {
  return withPg(c, async (client) => {
    const r = await client.query(
      `SELECT datname FROM pg_database WHERE datistemplate = false AND datname NOT IN ('postgres') ORDER BY datname`,
    );
    return r.rows.map((row: { datname: string }) => row.datname);
  });
}

async function pgListTables(c: ResolvedConnection): Promise<TableInfo[]> {
  return withPg(c, async (client) => {
    const r = await client.query(
      `SELECT schemaname, tablename, n_live_tup
         FROM pg_stat_user_tables
        ORDER BY schemaname, tablename`,
    );
    return r.rows.map((row: { schemaname: string; tablename: string; n_live_tup: number | string }) => ({
      schema: row.schemaname,
      name: row.tablename,
      rowEstimate: typeof row.n_live_tup === 'string' ? parseInt(row.n_live_tup, 10) : row.n_live_tup,
    }));
  });
}

async function pgDescribe(c: ResolvedConnection, table: string, schema?: string): Promise<ColumnInfo[]> {
  return withPg(c, async (client) => {
    const r = await client.query(
      `SELECT
          c.column_name,
          c.data_type || COALESCE('('||c.character_maximum_length||')','') AS data_type,
          c.is_nullable = 'YES' AS nullable,
          (
            SELECT COUNT(*) > 0 FROM information_schema.key_column_usage k
              JOIN information_schema.table_constraints tc
                ON tc.constraint_name = k.constraint_name AND tc.constraint_schema = k.constraint_schema
            WHERE k.table_schema = c.table_schema AND k.table_name = c.table_name
              AND k.column_name = c.column_name AND tc.constraint_type = 'PRIMARY KEY'
          ) AS is_pk,
          c.column_default
         FROM information_schema.columns c
        WHERE c.table_name = $1 AND ($2::text IS NULL OR c.table_schema = $2)
        ORDER BY c.ordinal_position`,
      [table, schema ?? null],
    );
    return r.rows.map((row: { column_name: string; data_type: string; nullable: boolean; is_pk: boolean; column_default: string | null }) => ({
      name: row.column_name,
      type: row.data_type,
      nullable: row.nullable,
      primaryKey: row.is_pk,
      defaultValue: row.column_default,
    }));
  });
}

async function pgQuery(c: ResolvedConnection, sql: string): Promise<QueryResult> {
  return withPg(c, async (client) => {
    const start = Date.now();
    const r = await client.query({ text: sql, rowMode: 'array' });
    const dur = Date.now() - start;
    const cols = (r.fields ?? []).map((f) => f.name);
    const rows = (r.rows as unknown[][]) ?? [];
    const truncated = rows.length > ROW_CAP;
    return {
      columns: cols,
      rows: rows.slice(0, ROW_CAP),
      rowCount: rows.length,
      truncated,
      affected: typeof r.rowCount === 'number' && cols.length === 0 ? r.rowCount : undefined,
      durationMs: dur,
    };
  });
}

// ---------- SQLite ----------

async function withSqlite<T>(c: ResolvedConnection, fn: (db: import('better-sqlite3').Database) => T): Promise<T> {
  const Database = (await import('better-sqlite3')).default;
  const db = new Database(c.database, { readonly: c.readOnly, fileMustExist: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

async function sqliteListDatabases(): Promise<string[]> {
  return ['(file)'];
}

async function sqliteListTables(c: ResolvedConnection): Promise<TableInfo[]> {
  return withSqlite(c, (db) => {
    const rows = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      )
      .all() as Array<{ name: string }>;
    return rows.map((r) => ({ name: r.name }));
  });
}

async function sqliteDescribe(c: ResolvedConnection, table: string): Promise<ColumnInfo[]> {
  return withSqlite(c, (db) => {
    // PRAGMA table_info is parameter-less, so quote-safe interpolation only:
    const safe = table.replace(/[^A-Za-z0-9_]/g, '');
    const rows = db.prepare(`PRAGMA table_info(${safe})`).all() as Array<{
      name: string;
      type: string;
      notnull: number;
      pk: number;
      dflt_value: string | null;
    }>;
    return rows.map((r) => ({
      name: r.name,
      type: r.type,
      nullable: r.notnull === 0,
      primaryKey: r.pk > 0,
      defaultValue: r.dflt_value,
    }));
  });
}

async function sqliteQuery(c: ResolvedConnection, sql: string): Promise<QueryResult> {
  return withSqlite(c, (db) => {
    const start = Date.now();
    const stmt = db.prepare(sql);
    if (stmt.reader) {
      const rowsObj = stmt.raw().all() as unknown[][];
      const cols = stmt.columns().map((c) => c.name);
      const truncated = rowsObj.length > ROW_CAP;
      return {
        columns: cols,
        rows: rowsObj.slice(0, ROW_CAP),
        rowCount: rowsObj.length,
        truncated,
        durationMs: Date.now() - start,
      };
    }
    const info = stmt.run();
    return {
      columns: [],
      rows: [],
      rowCount: 0,
      truncated: false,
      affected: info.changes,
      durationMs: Date.now() - start,
    };
  });
}

// ---------- Dispatch ----------

export async function listDatabases(c: ResolvedConnection): Promise<string[]> {
  if (c.driver === 'mysql' || c.driver === 'mariadb') return mysqlListDatabases(c);
  if (c.driver === 'postgres') return pgListDatabases(c);
  if (c.driver === 'sqlite') return sqliteListDatabases();
  throw new Error(`Unknown driver: ${c.driver}`);
}

export async function listTables(c: ResolvedConnection, database?: string): Promise<TableInfo[]> {
  if (c.driver === 'mysql' || c.driver === 'mariadb') return mysqlListTables(c, database);
  if (c.driver === 'postgres') return pgListTables(c);
  if (c.driver === 'sqlite') return sqliteListTables(c);
  throw new Error(`Unknown driver: ${c.driver}`);
}

export async function describeTable(c: ResolvedConnection, table: string, schema?: string): Promise<ColumnInfo[]> {
  if (c.driver === 'mysql' || c.driver === 'mariadb') return mysqlDescribe(c, table, schema);
  if (c.driver === 'postgres') return pgDescribe(c, table, schema);
  if (c.driver === 'sqlite') return sqliteDescribe(c, table);
  throw new Error(`Unknown driver: ${c.driver}`);
}

export async function runQuery(c: ResolvedConnection, sql: string, database?: string): Promise<QueryResult> {
  if (c.readOnly && !isReadOnlySql(sql)) {
    throw new Error('Connection is read-only — only SELECT/SHOW/EXPLAIN/PRAGMA/WITH/DESCRIBE are allowed.');
  }
  if (c.driver === 'mysql' || c.driver === 'mariadb') return mysqlQuery(c, sql, database);
  if (c.driver === 'postgres') return pgQuery(c, sql);
  if (c.driver === 'sqlite') return sqliteQuery(c, sql);
  throw new Error(`Unknown driver: ${c.driver}`);
}
