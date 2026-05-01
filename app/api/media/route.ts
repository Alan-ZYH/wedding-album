import { NextRequest, NextResponse } from 'next/server'
import { adminDb, COLLECTIONS } from '@/lib/firebase-admin'
import { isAdminAuthenticated } from '@/lib/auth'
import { Media } from '@/types'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const guestId = searchParams.get('guestId')
    const isAdmin = await isAdminAuthenticated(req)

    const col = adminDb.collection(COLLECTIONS.MEDIA)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = col

    if (!isAdmin) {
      q = q.where('status', '==', 'active').where('approved', '==', true)
      if (guestId) {
        q = q.where('guestId', '==', guestId)
      }
    }

    q = q.orderBy('uploadTime', 'desc').limit(500)

    const snapshot = await q.get()
    const media: Media[] = snapshot.docs.map((doc: { data: () => unknown }) => doc.data() as Media)

    return NextResponse.json({ success: true, data: media })
  } catch (err) {
    console.error('GET /api/media error:', err)
    return NextResponse.json({ success: false, error: '無法取得媒體列表' }, { status: 500 })
  }
}
