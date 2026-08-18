import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "./lib/session-cookie";

/**
 * Gate every page behind the session cookie.
 *
 * Only the cookie's presence and shape are checked here — middleware runs on
 * the Edge runtime, which has no node:crypto, so the HMAC cannot be verified at
 * this layer. That is fine: this is a redirect for convenience, and pages do
 * the real check with currentUser(). Never rely on middleware alone for auth.
 */
export function middleware(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const looksSignedIn = Boolean(token && token.includes("."));
  const isLoginPage = request.nextUrl.pathname === "/login";

  if (!looksSignedIn && !isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (looksSignedIn && isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  /*
   * The cron route carries its own bearer secret and must not be bounced to the
   * login page - a scheduler has no cookie, and a redirect would look like a
   * successful call while nothing ran.
   */
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
