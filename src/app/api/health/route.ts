import { NextResponse } from "next/server";
import { missingAdminConfig } from "@/lib/admin/auth";
import { missingPublicConfig, supabaseServiceKey } from "@/lib/supabase/env";

/**
 * Liveness and readiness probe.
 *
 * `GET /api/health` confirms the server is up and exposes nothing else.
 *
 * `GET /api/health?check=config` reports which configuration is missing and
 * whether the database is actually reachable. It returns booleans and variable
 * NAMES only — never a value, prefix or length — so it cannot leak a key.
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

export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get("check") !== "config") {
    return NextResponse.json(
      { status: "ok", timestamp: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const adminMissing = missingAdminConfig();
  const supabaseMissing = [...missingPublicConfig()];
  if (!supabaseServiceKey()) supabaseMissing.push("SUPABASE_SECRET_KEY");

  let database = "not checked: Supabase configuration is incomplete";
  if (supabaseMissing.length === 0) {
    try {
      const { createAdminSupabase } = await import("@/lib/supabase/server");
      const { error } = await createAdminSupabase()
        .from("callback_requests")
        .select("id", { count: "exact", head: true });

      database = !error
        ? "ok"
        : error.code === "PGRST205"
          ? "unreachable: table callback_requests does not exist. Run the migration."
          : `unreachable: ${error.message}`;
    } catch (error) {
      database = `unreachable: ${error instanceof Error ? error.message : "unknown error"}`;
    }
  }

  const ready = adminMissing.length === 0 && supabaseMissing.length === 0 && database === "ok";

  return NextResponse.json(
    {
      status: ready ? "ready" : "not_ready",
      timestamp: new Date().toISOString(),
      login: { ready: adminMissing.length === 0, missing: adminMissing },
      supabase: { ready: supabaseMissing.length === 0, missing: supabaseMissing },
      database,
    },
    { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
