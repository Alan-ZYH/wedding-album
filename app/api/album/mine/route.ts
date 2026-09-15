import { NextRequest, NextResponse } from 'next/server'
import { adminDb, COLLECTIONS } from '@/lib/firebase-admin'
import { AlbumItem } from '@/types'

export const dynamic = 'force-dynamic'

/**
 * GET /api/album/mine?guestId=… — what this guest kept for the couple.
 *
 * Served by the API because the album collection is closed to browsers. Same
 * trust as the rest of the guest API: the id is the guest's own, from their
 * browser.
 */
export async function GET(req: NextRequest) {
  const guestId = req.nextUrl.searchParams.get('guestId')
  if (!guestId) return NextResponse.json({ success: false, error: '缺少賓客資訊' }, { status: 400 })
  try {
    const snap = await adminDb.collection(COLLECTIONS.ALBUM).where('guestId', '==', guestId).get()
    const items = snap.docs
      .map((d) => d.data() as AlbumItem)
      .filter((m) => m.status === 'active')
      .sort((a, b) => b.uploadTime.localeCompare(a.uploadTime))
    return NextResponse.json({ success: true, data: items })
  } catch (err) {
    console.error('GET /api/album/mine error:', err)
    return NextResponse.json({ success: false, error: '無法取得相簿' }, { status: 500 })
  }
}
