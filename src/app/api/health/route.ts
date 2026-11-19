import { NextResponse } from "next/server";
import { missingAdminConfig } from "@/lib/admin/auth";
import { missingDatabaseConfig } from "@/lib/db/config";

/**
 * Liveness and readiness probe.
 *
 * `GET /api/health` confirms the server is up and exposes nothing else.
 *
 * `GET /api/health?check=config` reports which configuration is missing and
 * whether the database works. It returns variable NAMES and fixed category
 * words only — never a value, an error message, a host or an account name —
 * so it cannot leak anything. The underlying error goes to the server log.
 *
 * This exists because the most common deployment failure is a missing
 * environment variable, and without it the only symptom is a login page that
 * rejects correct credentials with no explanation.
 *
 * Deliberately unauthenticated: it is needed precisely when logging in is
 * impossible, and it discloses nothing an attacker can use.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DATABASE_HINTS = {
  ok: undefined,
  not_checked: "Set the missing database variables first.",
  schema_missing: "The views or procedures are missing, or this account lacks grants on them. Run db/mariadb/setup.sh in the website repository.",
  unreachable: "The database could not be reached or refused the connection. See the server log.",
} as const;

export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get("check") !== "config") {
    return NextResponse.json(
      { status: "ok", timestamp: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const adminMissing = missingAdminConfig();
  const databaseMissing = missingDatabaseConfig();

  let database: keyof typeof DATABASE_HINTS = "not_checked";
  if (databaseMissing.length === 0) {
    const { probeDatabase } = await import("@/lib/db/client");
    const probe = await probeDatabase();
    database = probe.state;
    if (probe.detail) console.error(`[admin/health] database ${probe.state}:`, probe.detail);
  }

  const ready = adminMissing.length === 0 && databaseMissing.length === 0 && database === "ok";

  return NextResponse.json(
    {
      status: ready ? "ready" : "not_ready",
      timestamp: new Date().toISOString(),
      login: { ready: adminMissing.length === 0, missing: adminMissing },
      databaseConfig: { ready: databaseMissing.length === 0, missing: databaseMissing },
      database,
      ...(DATABASE_HINTS[database] ? { hint: DATABASE_HINTS[database] } : {}),
    },
    { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
