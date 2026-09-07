import { cookies } from 'next/headers'
import { NextRequest } from 'next/server'

// Renamed from 'admin_session': the middleware used to hand that cookie to
// anyone who merely opened /admin, and those are valid for 30 days. A new name
// retires them all at once.
const ADMIN_COOKIE = 'admin_key_v2'

/**
 * Admin authentication uses the URL-secrecy model — there is no password.
 *
 * Visiting /api/admin/unlock?key=… with the right key grants an
 * `admin_key_v2` cookie; the middleware then lets that device into /admin.
 * Admin-only API routes call this to check for the same cookie, so guests who
 * only ever received the /guest link cannot perform admin actions (delete
 * others' media, change settings, …) even by calling the API directly.
 */
export async function isAdminAuthenticated(req?: NextRequest): Promise<boolean> {
  try {
    if (req) {
      return req.cookies.get(ADMIN_COOKIE)?.value === '1'
    }
    const cookieStore = await cookies()
    return cookieStore.get(ADMIN_COOKIE)?.value === '1'
  } catch {
    return false
  }
}
