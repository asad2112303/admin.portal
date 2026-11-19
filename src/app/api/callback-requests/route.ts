import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/auth";
import { listCallbackRequests } from "@/lib/db/client";
import { databaseFailure } from "@/lib/db/respond";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Paged, filtered list of callback requests. Staff only. */
export async function GET(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  try {
    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") ?? 25) || 25));

    // Two independent checks: requireAdmin() above decides who may use the
    // portal at all; the database's row-level policies decide which rows the
    // portal's account may see. Neither trusts the other.
    const { requests, total } = await listCallbackRequests({
      status: url.searchParams.get("status"),
      service: url.searchParams.get("service"),
      search: url.searchParams.get("search"),
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to"),
      page,
      pageSize,
    });

    return NextResponse.json({ ok: true, requests, total, page, pageSize });
  } catch (error) {
    return databaseFailure(error, "admin/callback-requests", "Could not load requests.");
  }
}
