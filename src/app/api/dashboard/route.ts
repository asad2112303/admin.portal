import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/auth";
import { dashboardStats } from "@/lib/db/client";
import { databaseFailure } from "@/lib/db/respond";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Start of "today" in Pakistan (UTC+5), as a UTC instant. */
function startOfPakistanDay(offsetDays = 0): Date {
  const now = new Date();
  const pk = new Date(now.getTime() + 5 * 60 * 60 * 1000);
  pk.setUTCHours(0, 0, 0, 0);
  pk.setUTCDate(pk.getUTCDate() + offsetDays);
  return new Date(pk.getTime() - 5 * 60 * 60 * 1000);
}

/** Counts for the summary cards, over the rows this account's policy allows. */
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  try {
    const stats = await dashboardStats(startOfPakistanDay());
    return NextResponse.json({ ok: true, stats });
  } catch (error) {
    return databaseFailure(error, "admin/dashboard", "Could not load dashboard data.");
  }
}
