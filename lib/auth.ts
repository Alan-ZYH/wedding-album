import { NextRequest } from 'next/server'

/**
 * Admin authentication has been removed by design — the admin panel is
 * protected only by URL secrecy (only the couple knows the /admin URL).
 *
 * The function signature is kept so the ~10 API routes that call it
 * don't need to change. It now always grants access.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function isAdminAuthenticated(_req?: NextRequest): Promise<boolean> {
  return true
}
