/**
 * Cookie name only — kept in its own module with zero imports.
 *
 * middleware.ts runs on the Edge runtime, which has no node:crypto. Importing
 * this constant from lib/auth.ts would drag that module (and its crypto import)
 * into the Edge bundle and fail at load.
 */
export const SESSION_COOKIE = "changai_session";
