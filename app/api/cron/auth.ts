/** Shared by every scheduled route: the bearer secret, or nothing. */
export function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // Without a secret configured the route stays shut rather than open: an
  // unauthenticated endpoint here can send mail to suppliers.
  if (!secret) return false;

  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}
