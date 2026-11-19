import { NextResponse } from "next/server";
import { DatabaseNotConfiguredError } from "@/lib/db/config";
import { describeDatabaseError, isDatabaseTimeout } from "@/lib/db/client";

/**
 * The one way the API routes turn a database failure into a response.
 *
 * Three cases, kept distinct so a fault is diagnosable from the screen and
 * the log: not configured (a deployment problem), too slow (try again), and
 * anything else. The log line names the error and its cause but never a
 * statement or a value, because the values are patient details.
 */
export function databaseFailure(error: unknown, context: string, fallbackMessage: string): NextResponse {
  if (error instanceof DatabaseNotConfiguredError) {
    console.error(`[${context}] not configured:`, error.message);
    return NextResponse.json(
      {
        ok: false,
        message:
          "The database connection is not configured. Set DATABASE_SOCKET_PATH (or DATABASE_HOST), DATABASE_USER and DATABASE_PASSWORD, then restart the server.",
      },
      { status: 503 },
    );
  }
  if (isDatabaseTimeout(error)) {
    console.error(`[${context}] database timeout:`, describeDatabaseError(error));
    return NextResponse.json(
      { ok: false, message: "The database is slow to respond. Please try again." },
      { status: 503, headers: { "Retry-After": "15" } },
    );
  }
  console.error(`[${context}] failed:`, describeDatabaseError(error));
  return NextResponse.json({ ok: false, message: fallbackMessage }, { status: 500 });
}
