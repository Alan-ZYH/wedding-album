import { NextRequest, NextResponse } from 'next/server'
import { adminDb, COLLECTIONS } from '@/lib/firebase-admin'
import { isAdminAuthenticated } from '@/lib/auth'
import { Guest } from '@/types'

export const dynamic = 'force-dynamic'

/** GET /api/guests — admin-only guest list, most recently active first. */
export async function GET(req: NextRequest) {
  if (!(await isAdminAuthenticated(req))) {
    return NextResponse.json({ success: false, error: '無權限' }, { status: 403 })
  }
  try {
    const snap = await adminDb
      .collection(COLLECTIONS.GUESTS)
      .orderBy('lastActiveAt', 'desc')
      .limit(500)
      .get()
    const guests = snap.docs.map((d) => d.data() as Guest)
    return NextResponse.json({ success: true, data: guests })
  } catch (err) {
    console.error('GET /api/guests error:', err)
    return NextResponse.json({ success: false, error: '無法取得賓客清單' }, { status: 500 })
  }
}
