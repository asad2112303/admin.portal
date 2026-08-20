import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { supabaseUrl, supabaseServiceKey, missingPublicConfig } from "./env";

/**
 * The admin portal's only Supabase client.
 *
 * It uses the secret key, which bypasses Row Level Security. That is required
 * rather than lax: the admin is not a Supabase Auth user, so the database has
 * no identity to authorize and cannot make the decision itself.
 *
 * Authorization therefore happens entirely in this application, before any
 * call reaches here — requireAdmin() verifies the signed session cookie on
 * every API route, and the (protected) layout does the same for every page.
 *
 * Never import this from a "use client" module. The key is read from a
 * non-NEXT_PUBLIC variable so it cannot be inlined into the browser bundle.
 */

export class SupabaseNotConfiguredError extends Error {
  constructor(missing: string[]) {
    super(`Supabase is not configured. Missing: ${missing.join(", ")}`);
    this.name = "SupabaseNotConfiguredError";
  }
}

export function isSupabaseConfigured(): boolean {
  return missingPublicConfig().length === 0 && Boolean(supabaseServiceKey());
}

export function createAdminSupabase() {
  const missing = missingPublicConfig();
  if (!supabaseServiceKey()) missing.push("SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY)");
  if (missing.length) throw new SupabaseNotConfiguredError(missing);

  return createSupabaseClient(supabaseUrl()!, supabaseServiceKey()!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
