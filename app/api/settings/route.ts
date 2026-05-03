import { NextRequest, NextResponse } from 'next/server'
import { getSettings, updateSettings } from '@/lib/settings'
import { isAdminAuthenticated } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/** Strip sensitive fields before sending settings to clients. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sanitizeSettings(s: Record<string, any>) {
  // adminPassword is stored in the same Firestore document but must never be
  // returned via this public API endpoint.
  const { adminPassword: _pw, ...safe } = s
  return safe
}

export async function GET() {
  try {
    const settings = await getSettings()
    return NextResponse.json({ success: true, data: sanitizeSettings(settings as never) })
  } catch (err) {
    console.error('GET /api/settings error:', err)
    return NextResponse.json({ success: false, error: '無法取得設定' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const isAdmin = await isAdminAuthenticated(req)
    if (!isAdmin) {
      return NextResponse.json({ success: false, error: '無權限' }, { status: 403 })
    }

    const body = await req.json()
    // Prevent accidental overwrite of adminPassword via this endpoint
    delete body.adminPassword
    await updateSettings(body)
    const updated = await getSettings()
    return NextResponse.json({ success: true, data: sanitizeSettings(updated as never) })
  } catch (err) {
    console.error('PATCH /api/settings error:', err)
    return NextResponse.json({ success: false, error: '更新設定失敗' }, { status: 500 })
  }
}
