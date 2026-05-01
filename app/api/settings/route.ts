import { NextRequest, NextResponse } from 'next/server'
import { getSettings, updateSettings } from '@/lib/settings'
import { isAdminAuthenticated } from '@/lib/auth'

export async function GET() {
  try {
    const settings = await getSettings()
    return NextResponse.json({ success: true, data: settings })
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
    await updateSettings(body)
    const updated = await getSettings()
    return NextResponse.json({ success: true, data: updated })
  } catch (err) {
    console.error('PATCH /api/settings error:', err)
    return NextResponse.json({ success: false, error: '更新設定失敗' }, { status: 500 })
  }
}
