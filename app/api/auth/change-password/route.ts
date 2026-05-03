import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthenticated } from '@/lib/auth'
import { adminDb } from '@/lib/firebase-admin'

/**
 * POST /api/auth/change-password
 *
 * Changes the admin password.  The new password is stored in Firestore
 * (settings/config.adminPassword) and takes precedence over the
 * ADMIN_PASSWORD environment variable on subsequent logins.
 *
 * Body: { currentPassword: string, newPassword: string }
 */
export async function POST(req: NextRequest) {
  if (!await isAdminAuthenticated(req)) {
    return NextResponse.json({ success: false, error: '未授權' }, { status: 401 })
  }

  try {
    const { currentPassword, newPassword } = await req.json()

    if (!newPassword || newPassword.trim().length < 4) {
      return NextResponse.json({ success: false, error: '新密碼至少需要 4 個字元' }, { status: 400 })
    }

    // Check current password: Firestore override first, then env var
    const settingsDoc = await adminDb.collection('settings').doc('config').get().catch(() => null)
    const firestorePassword: string | undefined = settingsDoc?.data()?.adminPassword
    const validPassword = firestorePassword || process.env.ADMIN_PASSWORD

    if (!validPassword || currentPassword !== validPassword) {
      return NextResponse.json({ success: false, error: '目前密碼錯誤' }, { status: 400 })
    }

    // Persist new password to Firestore
    await adminDb.collection('settings').doc('config').set(
      { adminPassword: newPassword.trim() },
      { merge: true }
    )

    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
