import { createPool, type Pool, type PoolConfig } from "mariadb";
import { databaseConfigFromEnv, type DatabaseConfig } from "@/lib/db/config";
import { CALLBACK_STATUSES, type CallbackActivity, type CallbackRequest, type CallbackStatus } from "@/lib/db/types";

/**
 * The admin portal's database access.
 *
 * Every read goes through a *_secure view and every change through a stored
 * procedure, never a base table: the eshifa_admin account has no privilege on
 * the tables at all. What it may see and change is decided inside the database
 * by the row-level policies in access_policies (website repo,
 * db/mariadb/0003_row_level_security.sql), so a bug here cannot widen access.
 *
 * Every value is a bound parameter (`?`); no input is ever spliced into SQL.
 */

export class DatabaseTimeoutError extends Error {
  constructor() {
    super("The database did not answer in time.");
    this.name = "DatabaseTimeoutError";
  }
}

const TIMEOUT_MS = (() => {
  const value = Number(process.env.DATABASE_TIMEOUT_MS);
  return Number.isInteger(value) && value > 0 ? value : 8_000;
})();

const TIMEOUT_ERRNOS = new Set([45012, 45026, 45028, 1969]);

interface DriverError {
  errno?: number;
  sqlState?: string | null;
  sqlMessage?: string | null;
  code?: string | null;
}

const asDriverError = (error: unknown): DriverError =>
  typeof error === "object" && error !== null ? (error as DriverError) : {};

export function isDatabaseTimeout(error: unknown): boolean {
  if (error instanceof DatabaseTimeoutError) return true;
  const { errno, code } = asDriverError(error);
  return (errno !== undefined && TIMEOUT_ERRNOS.has(errno)) || code === "ER_STATEMENT_TIMEOUT";
}

/** The fixed refusal code of a SIGNAL raised by one of our procedures, if it is one. */
export function refusalCode(error: unknown): string | null {
  const { sqlState, sqlMessage } = asDriverError(error);
  if (sqlState !== "45000" || !sqlMessage) return null;
  return /^[a-z_]{3,40}$/.test(sqlMessage) ? sqlMessage : null;
}

/** One log line: the error and its cause, never a statement or a value. */
export function describeDatabaseError(error: unknown): string {
  if (!(error instanceof Error)) return "unknown";
  const cause = (error as Error & { cause?: unknown }).cause;
  const causeText = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "";
  const strip = (message: string) => message.split(/\bsql:/)[0].trim();
  const main = strip(error.message);
  const why = causeText ? strip(causeText) : "";
  const text = why && !main.includes(why) ? `${main} (cause: ${why})` : main;
  return text.replace(/\s+/g, " ").slice(0, 400);
}

export function poolOptions(config: DatabaseConfig, timeoutMs: number): PoolConfig {
  const transport =
    config.transport.kind === "socket"
      ? { socketPath: config.transport.socketPath }
      : {
          host: config.transport.host,
          port: config.transport.port,
          ssl: {
            rejectUnauthorized: true,
            minVersion: "TLSv1.2" as const,
            ...(config.transport.ca ? { ca: config.transport.ca } : {}),
          },
        };

  return {
    ...transport,
    database: config.database,
    user: config.user,
    password: config.password,
    connectionLimit: 5,
    minimumIdle: 1,
    idleTimeout: 300,
    acquireTimeout: timeoutMs,
    connectTimeout: Math.min(timeoutMs, 5_000),
    // DATETIME columns hold UTC, but this driver turns a DATETIME into a Date
    // in the Node process's LOCAL time zone whatever `timezone` says (that
    // option only sets the session time zone). So dates are read as text and
    // marked as UTC explicitly (asUtcIso), and sent as UTC text (toSqlUtc):
    // correct on any machine, and microseconds are kept.
    timezone: "Z",
    dateStrings: true,
    bigIntAsNumber: true,
    decimalAsNumber: true,
    insertIdAsNumber: true,
    permitLocalInfile: false,
    multipleStatements: false,
    // The driver's real default is true: it would append every bound value
    // (names, phone numbers) to error messages, and from there to the logs.
    logParam: false,
  };
}

const store = globalThis as unknown as { __eshifaAdminDbPool?: Pool };

function pool(): Pool {
  if (!store.__eshifaAdminDbPool) {
    store.__eshifaAdminDbPool = createPool(poolOptions(databaseConfigFromEnv(), TIMEOUT_MS));
  }
  return store.__eshifaAdminDbPool;
}

/** Runs one statement with a deadline that backs up the driver's own timeouts. */
async function run<T>(sql: string, values: unknown[] = []): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DatabaseTimeoutError()), TIMEOUT_MS + 1_500);
  });
  try {
    return (await Promise.race([pool().query({ sql, timeout: TIMEOUT_MS }, values), deadline])) as T;
  } finally {
    clearTimeout(timer);
  }
}

// --- Request list ------------------------------------------------------------

export interface RequestFilters {
  status?: string | null;
  service?: string | null;
  search?: string | null;
  from?: string | null;
  to?: string | null;
  page: number;
  pageSize: number;
}

/** Escapes LIKE's own wildcards, so a search for "50%" means the text "50%". */
const likeContains = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const parseInstant = (value: string | null | undefined): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** A Date as the UTC DATETIME text MariaDB stores: "YYYY-MM-DD HH:MM:SS.mmm". */
export const toSqlUtc = (date: Date): string => date.toISOString().replace("T", " ").replace("Z", "");

/**
 * A stored UTC DATETIME ("YYYY-MM-DD HH:MM:SS.ffffff") as ISO 8601 UTC with
 * milliseconds — the only precision every browser's Date parser guarantees.
 */
export function asUtcIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?$/.exec(String(value));
  if (!match) return String(value);
  return `${match[1]}T${match[2]}.${(match[3] ?? "").padEnd(3, "0").slice(0, 3)}Z`;
}

const REQUEST_TIMES = ["created_at", "updated_at", "contacted_at", "completed_at"] as const;

function toRequest(row: Record<string, unknown>): CallbackRequest {
  const out = { ...row } as Record<string, unknown>;
  for (const key of REQUEST_TIMES) out[key] = asUtcIso(row[key]);
  return out as unknown as CallbackRequest;
}

function toActivity(row: Record<string, unknown>): CallbackActivity {
  return { ...row, created_at: asUtcIso(row.created_at) } as unknown as CallbackActivity;
}

/**
 * Digits to look for in phone_number. Numbers are stored as 92XXXXXXXXXX, but
 * staff type them the local way (0300…) or with the country code, so a
 * leading 0 or 92 is dropped: "0300 1234567" finds 923001234567.
 */
export function phoneSearchDigits(search: string): string {
  const digits = search.replace(/\D/g, "");
  const core = digits.replace(/^(?:92|0)/, "");
  return core || digits;
}

/**
 * WHERE clause and parameters for the list, kept pure so it can be tested
 * without a database. Unknown statuses and unreadable dates are ignored, as
 * the Supabase version ignored them.
 */
export function buildRequestFilter(filters: RequestFilters): { where: string; values: unknown[] } {
  const clauses: string[] = [];
  const values: unknown[] = [];

  if (filters.status && CALLBACK_STATUSES.includes(filters.status as CallbackStatus)) {
    clauses.push("status = ?");
    values.push(filters.status);
  }
  if (filters.service) {
    clauses.push("service = ?");
    values.push(filters.service.slice(0, 80));
  }
  const from = parseInstant(filters.from);
  if (from) {
    clauses.push("created_at >= ?");
    values.push(toSqlUtc(from));
  }
  const to = parseInstant(filters.to);
  if (to) {
    clauses.push("created_at <= ?");
    values.push(toSqlUtc(to));
  }

  const search = (filters.search ?? "").trim().slice(0, 100);
  if (search) {
    // Name (case-insensitive by collation), phone digits, or the ESH number.
    const any = ["full_name LIKE ?"];
    values.push(likeContains(search));
    const digits = phoneSearchDigits(search);
    if (digits) {
      any.push("phone_number LIKE ?");
      values.push(likeContains(digits));
    }
    const asNumber = Number(search.replace(/^ESH-?/i, ""));
    if (Number.isSafeInteger(asNumber) && asNumber > 0) {
      any.push("request_no = ?");
      values.push(asNumber);
    }
    clauses.push(`(${any.join(" OR ")})`);
  }

  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", values };
}

export async function listCallbackRequests(filters: RequestFilters): Promise<{ requests: CallbackRequest[]; total: number }> {
  const { where, values } = buildRequestFilter(filters);
  const offset = (filters.page - 1) * filters.pageSize;

  const [rows, counted] = await Promise.all([
    run<Record<string, unknown>[]>(
      `SELECT * FROM callback_requests_secure ${where} ORDER BY created_at DESC, request_no DESC LIMIT ? OFFSET ?`,
      [...values, filters.pageSize, offset],
    ),
    run<Array<{ total: number }>>(`SELECT COUNT(*) AS total FROM callback_requests_secure ${where}`, values),
  ]);

  return { requests: rows.map(toRequest), total: Number(counted[0]?.total ?? 0) };
}

// --- Single request ------------------------------------------------------------

export async function getCallbackRequest(id: string): Promise<{ request: CallbackRequest; activity: CallbackActivity[] } | null> {
  const [requests, activity] = await Promise.all([
    run<Record<string, unknown>[]>("SELECT * FROM callback_requests_secure WHERE id = ?", [id]),
    run<Record<string, unknown>[]>(
      "SELECT * FROM callback_request_activity_secure WHERE callback_request_id = ? ORDER BY created_at ASC, id ASC",
      [id],
    ),
  ]);
  if (!requests[0]) return null;
  return { request: toRequest(requests[0]), activity: activity.map(toActivity) };
}

export type StatusChange =
  | { ok: true; changed: boolean; request: CallbackRequest }
  | { ok: false; refusal: "not_found" | "invalid_status" | "invalid_actor" | string };

/**
 * Changes a status through set_callback_status(), which checks the row policy
 * and writes the timeline entry in the same transaction. A request this
 * account may not change is reported as not_found, exactly like a missing one.
 */
export async function setCallbackStatus(id: string, status: CallbackStatus, actorEmail: string): Promise<StatusChange> {
  try {
    const result = await run<unknown>("CALL set_callback_status(?, ?, ?)", [id, status, actorEmail]);
    const row = Array.isArray(result) && Array.isArray(result[0]) ? (result[0][0] as { changed?: unknown }) : undefined;
    const current = await getCallbackRequest(id);
    if (!current) return { ok: false, refusal: "not_found" };
    return { ok: true, changed: Number(row?.changed) === 1, request: current.request };
  } catch (error) {
    const refusal = refusalCode(error);
    if (refusal) return { ok: false, refusal };
    throw error;
  }
}

// --- Dashboard -----------------------------------------------------------------

export interface DashboardStats {
  newCount: number;
  inProgress: number;
  completedToday: number;
  total: number;
  todayTotal: number;
  averageResponseMinutes: number | null;
}

export async function dashboardStats(todayStart: Date): Promise<DashboardStats> {
  const [counts, contacted] = await Promise.all([
    run<Array<Record<string, number | null>>>(
      `SELECT
         COALESCE(SUM(status = 'new'), 0)                                     AS newCount,
         COALESCE(SUM(status = 'in_progress'), 0)                             AS inProgress,
         COALESCE(SUM(status = 'completed' AND completed_at >= ?), 0)         AS completedToday,
         COUNT(*)                                                             AS total,
         COALESCE(SUM(created_at >= ?), 0)                                    AS todayTotal
       FROM callback_requests_secure`,
      [toSqlUtc(todayStart), toSqlUtc(todayStart)],
    ),
    // Average minutes from submission to first contact, over the last 200.
    run<Array<{ created_at: string; contacted_at: string }>>(
      `SELECT created_at, contacted_at FROM callback_requests_secure
       WHERE contacted_at IS NOT NULL ORDER BY contacted_at DESC LIMIT 200`,
    ),
  ]);

  const c = counts[0] ?? {};
  let averageResponseMinutes: number | null = null;
  if (contacted.length) {
    const totalMinutes = contacted.reduce(
      (sum, r) =>
        sum + Math.max(0, Date.parse(asUtcIso(r.contacted_at)!) - Date.parse(asUtcIso(r.created_at)!)) / 60000,
      0,
    );
    averageResponseMinutes = Math.round(totalMinutes / contacted.length);
  }

  return {
    newCount: Number(c.newCount ?? 0),
    inProgress: Number(c.inProgress ?? 0),
    completedToday: Number(c.completedToday ?? 0),
    total: Number(c.total ?? 0),
    todayTotal: Number(c.todayTotal ?? 0),
    averageResponseMinutes,
  };
}

// --- Health ----------------------------------------------------------------------

export type ProbeState = "ok" | "schema_missing" | "unreachable";

/**
 * Proves reads and status changes both work, without changing anything: a
 * read of the view, and a status change the procedure must refuse
 * (invalid_status is checked before anything is touched).
 */
export async function probeDatabase(): Promise<{ state: ProbeState; detail?: string }> {
  try {
    await run("SELECT 1 FROM callback_requests_secure LIMIT 1");
    try {
      await run("CALL set_callback_status(?, ?, ?)", ["00000000-0000-0000-0000-000000000000", "health_probe", "health@probe"]);
      return { state: "unreachable", detail: "set_callback_status accepted an invalid status" };
    } catch (error) {
      if (refusalCode(error) === "invalid_status") return { state: "ok" };
      throw error;
    }
  } catch (error) {
    const { errno } = asDriverError(error);
    const detail = describeDatabaseError(error);
    // Missing view/procedure, or no grant on it: the schema was not applied.
    if (errno && [1146, 1142, 1305, 1370].includes(errno)) return { state: "schema_missing", detail };
    return { state: "unreachable", detail };
  }
}
