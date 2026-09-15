import { NextRequest, NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb, COLLECTIONS } from '@/lib/firebase-admin'
import { getSettings } from '@/lib/settings'
import { photoLimits } from '@/lib/upload-limits'
import { photosOpen, CLOSED_MESSAGE } from '@/lib/guest-access'
import { checkGuestGate, gateErrorMessage, recordGuestAction } from '@/lib/guests'
import { moveAlbumToProjection } from '@/lib/album-move'
import type { Media } from '@/types'

export const dynamic = 'force-dynamic'

/**
 * POST /api/guest/project  body: { guestId, id }
 *
 * 投影 from 我的上傳: a guest sends one of their own photos to the screen
 * queue — a projection photo that has already played and been pushed out, or
 * a photo they had kept for the couple.
 *
 * It is treated as sending a photo to the screen, because to the screen that
 * is what it is: the photo switch must be open, a blocked guest is refused,
 * and it spends the same cooldown allowance as uploading, so nobody can keep
 * one photo circling on repeat. A photo the couple masked stays masked.
 */
export async function POST(req: NextRequest) {
  try {
    const { guestId, id } = await req.json()
    if (!guestId || !id) return NextResponse.json({ success: false, error: '缺少必要資訊' }, { status: 400 })

    const settings = await getSettings()
    if (!photosOpen(settings)) {
      return NextResponse.json({ success: false, error: CLOSED_MESSAGE, reason: 'closed' }, { status: 403 })
    }
    const limits = photoLimits(settings)
    const gate = await checkGuestGate(guestId, 'photo', limits)
    if (!gate.ok) {
      return NextResponse.json(
        { success: false, error: gateErrorMessage(gate, 'project'), reason: gate.reason, remaining: gate.reason === 'cooldown' ? gate.remaining : undefined },
        { status: gate.reason === 'blocked' ? 403 : 429 }
      )
    }

    const mediaRef = adminDb.collection(COLLECTIONS.MEDIA).doc(String(id))
    const mediaSnap = await mediaRef.get()

    let guestName: string
    if (mediaSnap.exists) {
      const m = mediaSnap.data() as Media
      if (m.guestId !== guestId) return NextResponse.json({ success: false, error: '無權限' }, { status: 403 })
      if (m.status !== 'active') return NextResponse.json({ success: false, error: '這張照片已移除' }, { status: 400 })
      if (m.displayState === 'pending' || m.displayState === 'playing' || m.displayState === 'pinned') {
        return NextResponse.json({ success: false, error: '這張照片已經在投影中' }, { status: 400 })
      }
      if (m.maskedBy !== 'rotation') {
        return NextResponse.json({ success: false, error: '這張照片目前無法投影' }, { status: 403 })
      }
      await mediaRef.update({
        displayState: 'pending',
        displayStateAt: new Date().toISOString(),
        maskedBy: FieldValue.delete(),
      })
      guestName = m.guestName
    } else {
      const albumSnap = await adminDb.collection(COLLECTIONS.ALBUM).doc(String(id)).get()
      guestName = String(albumSnap.data()?.guestName ?? '')
      const result = await moveAlbumToProjection(String(id), settings, guestId)
      if (result === 'not-owner') return NextResponse.json({ success: false, error: '無權限' }, { status: 403 })
      if (result === 'missing') return NextResponse.json({ success: false, error: '找不到這張照片' }, { status: 404 })
      if (result === 'video') return NextResponse.json({ success: false, error: '影片無法投影，大螢幕只播放照片' }, { status: 400 })
    }

    await recordGuestAction(guestId, guestName, 'photo', limits)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('POST /api/guest/project error:', err)
    return NextResponse.json({ success: false, error: '投影失敗，請稍後再試' }, { status: 500 })
  }
}
