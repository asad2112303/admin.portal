import { readFileSync } from "node:fs";

/**
 * MariaDB connection settings, read from the environment.
 *
 * The admin portal connects as eshifa_admin. It holds no privilege on any
 * table: it reads through the *_secure views, which apply the row-level
 * policies in access_policies, and changes a status only through
 * set_callback_status(). (Website repo: db/mariadb/0003, 0004.)
 *
 * Two ways to reach the server:
 *
 *   DATABASE_SOCKET_PATH  the Unix socket, when the portal runs on the database
 *                         server itself (the Hetzner setup). Never leaves the
 *                         machine; the database need not listen on a network
 *                         port at all.
 *   DATABASE_HOST         TCP. TLS is then always on and the server
 *                         certificate is always verified — against
 *                         DATABASE_SSL_CA / DATABASE_SSL_CA_FILE if given,
 *                         otherwise the system CAs. There is deliberately no
 *                         switch to turn verification off.
 */

export type DatabaseTransport =
  | { kind: "socket"; socketPath: string }
  | { kind: "tcp"; host: string; port: number; ca?: string };

export interface DatabaseConfig {
  database: string;
  user: string;
  password: string;
  transport: DatabaseTransport;
}

export class DatabaseNotConfiguredError extends Error {
  constructor(detail: string) {
    super(`The database is not configured: ${detail}`);
    this.name = "DatabaseNotConfiguredError";
  }
}

const value = (env: NodeJS.ProcessEnv, name: string) => env[name]?.trim() || undefined;

/** Names of required variables that are unset. Names only, never values. */
export function missingDatabaseConfig(env: NodeJS.ProcessEnv = process.env): string[] {
  const missing: string[] = [];
  if (!value(env, "DATABASE_SOCKET_PATH") && !value(env, "DATABASE_HOST")) missing.push("DATABASE_SOCKET_PATH");
  if (!value(env, "DATABASE_USER")) missing.push("DATABASE_USER");
  if (!env.DATABASE_PASSWORD) missing.push("DATABASE_PASSWORD");
  return missing;
}

export function databaseConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DatabaseConfig {
  const missing = missingDatabaseConfig(env);
  if (missing.length) throw new DatabaseNotConfiguredError(`missing ${missing.join(", ")}`);

  const socketPath = value(env, "DATABASE_SOCKET_PATH");
  const host = value(env, "DATABASE_HOST");
  if (socketPath && host) {
    throw new DatabaseNotConfiguredError("set DATABASE_SOCKET_PATH or DATABASE_HOST, not both");
  }

  let transport: DatabaseTransport;
  if (socketPath) {
    transport = { kind: "socket", socketPath };
  } else {
    const port = Number(value(env, "DATABASE_PORT") ?? 3306);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new DatabaseNotConfiguredError("DATABASE_PORT must be a port number");
    }
    let ca = env.DATABASE_SSL_CA?.trim() || undefined;
    const caFile = value(env, "DATABASE_SSL_CA_FILE");
    if (!ca && caFile) {
      try {
        // The path is an operator setting, not a project file, so the bundler
        // must not try to trace it (which would ship the whole repo).
        ca = readFileSync(/*turbopackIgnore: true*/ caFile, "utf8");
      } catch {
        throw new DatabaseNotConfiguredError("DATABASE_SSL_CA_FILE cannot be read");
      }
    }
    transport = { kind: "tcp", host: host!, port, ca };
  }

  return {
    database: value(env, "DATABASE_NAME") ?? "eshifa",
    user: value(env, "DATABASE_USER")!,
    password: env.DATABASE_PASSWORD!,
    transport,
  };
}
