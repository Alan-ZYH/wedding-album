import { NextRequest, NextResponse } from 'next/server'
import { adminDb, COLLECTIONS } from '@/lib/firebase-admin'
import { isAdminAuthenticated } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * POST /api/media/reorder   body: { ids: string[] }
 *
 * Writes the playback order for the given photos. `ids` is the full ordered
 * list as shown in the admin grid; positions are spaced by 10 so a later
 * single-item move can be slotted between two neighbours without rewriting
 * everything.
 */
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthenticated(req))) {
    return NextResponse.json({ success: false, error: '無權限' }, { status: 403 })
  }
  try {
    const { ids } = await req.json()
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ success: false, error: '缺少排序資料' }, { status: 400 })
    }

    let batch = adminDb.batch()
    let pending = 0
    for (let i = 0; i < ids.length; i++) {
      batch.update(adminDb.collection(COLLECTIONS.MEDIA).doc(ids[i]), { sortOrder: (i + 1) * 10 })
      if (++pending >= 400) { await batch.commit(); batch = adminDb.batch(); pending = 0 }
    }
    if (pending) await batch.commit()

    return NextResponse.json({ success: true, count: ids.length })
  } catch (err) {
    console.error('POST /api/media/reorder error:', err)
    return NextResponse.json({ success: false, error: '排序失敗' }, { status: 500 })
  }
}
