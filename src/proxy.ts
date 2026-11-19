import { NextResponse, type NextRequest } from "next/server";

/**
 * Redirects unauthenticated navigation to the login page.
 *
 * This checks only that a session cookie is PRESENT, not that it is valid.
 * It exists to send a signed-out visitor to the login page, nothing more.
 * (Next.js 16 renamed middleware.ts to proxy.ts; behaviour is unchanged.)
 *
 * The real boundary is server-side. The (protected) layout and every /api
 * handler call getAdminContext(), which verifies the signature and expiry, so a
 * forged cookie gets past this file and no further.
 */
const SESSION_COOKIE = "eshifa_admin_session";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (request.cookies.get(SESSION_COOKIE)?.value) return NextResponse.next();

  const loginUrl = new URL("/login", request.url);
  // Remember the destination, but only ever a same-site path.
  if (pathname !== "/") loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Everything except the login page, the API (which guards itself and must
  // return JSON rather than a redirect), and static assets.
  matcher: ["/((?!login|api|robots.txt|_next/static|_next/image|favicon.ico|.*\\.png$).*)"],
};
