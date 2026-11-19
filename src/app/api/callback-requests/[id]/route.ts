import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/auth";
import { getCallbackRequest, setCallbackStatus } from "@/lib/db/client";
import { databaseFailure } from "@/lib/db/respond";
import { CALLBACK_STATUSES, type CallbackStatus } from "@/lib/db/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteParams = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Single request with its activity timeline. */
export async function GET(_request: Request, { params }: RouteParams) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ ok: false, message: "Not found." }, { status: 404 });

  try {
    // Read through the secure views: a request outside this account's row
    // policy is indistinguishable from one that does not exist.
    const found = await getCallbackRequest(id.toLowerCase());
    if (!found) return NextResponse.json({ ok: false, message: "Not found." }, { status: 404 });
    return NextResponse.json({ ok: true, request: found.request, activity: found.activity });
  } catch (error) {
    return databaseFailure(error, "admin/callback-request", "Could not load the request.");
  }
}

/**
 * Update a request's status.
 *
 * set_callback_status() does the whole job in the database, in one
 * transaction: it checks this account's update policy (for the current AND
 * the new status), skips a no-op so the timeline gets no misleading entry,
 * changes the status, and writes the timeline entry with the signed-in
 * admin's email. contacted_at and completed_at are stamped by a trigger.
 * (In the Supabase version the update and the timeline entry were two
 * separate calls, so a failure between them lost the audit record.)
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ ok: false, message: "Not found." }, { status: 404 });

  try {
    const body = (await request.json().catch(() => ({}))) as { status?: string };

    if (body.status === undefined) {
      return NextResponse.json({ ok: false, message: "Nothing to update." }, { status: 422 });
    }
    if (!CALLBACK_STATUSES.includes(body.status as CallbackStatus)) {
      return NextResponse.json({ ok: false, message: "Invalid status." }, { status: 422 });
    }

    const result = await setCallbackStatus(id.toLowerCase(), body.status as CallbackStatus, auth.email);
    if (!result.ok) {
      if (result.refusal === "not_found") return NextResponse.json({ ok: false, message: "Not found." }, { status: 404 });
      if (result.refusal === "invalid_status") return NextResponse.json({ ok: false, message: "Invalid status." }, { status: 422 });
      throw new Error(`Unexpected refusal from set_callback_status: ${result.refusal}`);
    }

    return NextResponse.json({ ok: true, request: result.request });
  } catch (error) {
    return databaseFailure(error, "admin/callback-request", "Could not update the request.");
  }
}
