import { NextRequest, NextResponse } from 'next/server'
import { adminDb, COLLECTIONS } from '@/lib/firebase-admin'
import { isAdminAuthenticated } from '@/lib/auth'
import type { AlbumItem, DisplayState, Media } from '@/types'

export const dynamic = 'force-dynamic'

/** One entry in 相簿: a projection photo or something kept for the couple. */
export interface AlbumEntry {
  id: string
  source: 'projection' | 'album'
  guestId: string
  guestName: string
  fileType: 'photo' | 'video'
  fileName: string
  fileSize: number
  googleDriveFileId: string
  googleDriveUrl: string
  thumbnailUrl: string
  uploadTime: string
  displayState?: DisplayState
}

const PAGE = 60

const fromMedia = (m: Media): AlbumEntry => ({
  id: m.id, source: 'projection', guestId: m.guestId, guestName: m.guestName, fileType: m.fileType,
  fileName: m.fileName, fileSize: m.fileSize, googleDriveFileId: m.googleDriveFileId,
  googleDriveUrl: m.googleDriveUrl, thumbnailUrl: m.thumbnailUrl, uploadTime: m.uploadTime,
  displayState: m.displayState,
})
const fromAlbum = (a: AlbumItem): AlbumEntry => ({
  id: a.id, source: 'album', guestId: a.guestId, guestName: a.guestName, fileType: a.fileType,
  fileName: a.fileName, fileSize: a.fileSize, googleDriveFileId: a.googleDriveFileId,
  googleDriveUrl: a.googleDriveUrl, thumbnailUrl: a.thumbnailUrl, uploadTime: a.uploadTime,
})

/**
 * GET /api/admin/album?before=<ISO>&guestIds=a,b
 *
 * Projection photos and album items together, newest first. Everything except
 * what sits in 媒體管理's 刪除 (and what guests removed).
 *
 * Without guestIds: a page of PAGE, continuing from `before`. Each collection
 * contributes its own newest PAGE and the union is cut to PAGE, which is
 * exact — anything newer than the cut is in its collection's top PAGE. Deleted
 * entries still take places in those pages, so it keeps reading until the
 * page is full or both run out.
 *
 * With guestIds (one real name can cover several guests): everything by them,
 * unpaged. One person's uploads are a bounded set, and `guestId in` without
 * an ordering needs no composite index.
 */
export async function GET(req: NextRequest) {
  if (!(await isAdminAuthenticated(req))) {
    return NextResponse.json({ success: false, error: '無權限' }, { status: 403 })
  }
  try {
    const params = req.nextUrl.searchParams
    const guestIds = (params.get('guestIds') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    const media = adminDb.collection(COLLECTIONS.MEDIA)
    const album = adminDb.collection(COLLECTIONS.ALBUM)

    // ?since=<ISO>: only what arrived after the newest entry the page holds.
    // The album collection is closed to browsers, so 相簿 cannot listen to it
    // the way 媒體管理 listens to media; it asks this every few seconds instead.
    // A range on uploadTime reads only the new documents — about one read per
    // collection when nothing has arrived.
    const since = params.get('since')
    if (since) {
      const [m, a] = await Promise.all([
        media.where('uploadTime', '>', since).orderBy('uploadTime', 'desc').limit(100).get(),
        album.where('uploadTime', '>', since).orderBy('uploadTime', 'desc').limit(100).get(),
      ])
      const fresh = [
        ...m.docs.map((d) => d.data() as Media).filter((x) => x.status !== 'deleted').map(fromMedia),
        ...a.docs.map((d) => d.data() as AlbumItem).filter((x) => x.status === 'active').map(fromAlbum),
      ].sort((x, y) => y.uploadTime.localeCompare(x.uploadTime))
      return NextResponse.json({ success: true, data: fresh, next: null })
    }

    if (guestIds.length) {
      const entries: AlbumEntry[] = []
      for (let i = 0; i < guestIds.length; i += 30) {
        const chunk = guestIds.slice(i, i + 30)
        const [m, a] = await Promise.all([
          media.where('guestId', 'in', chunk).get(),
          album.where('guestId', 'in', chunk).get(),
        ])
        m.docs.map((d) => d.data() as Media).filter((x) => x.status !== 'deleted').forEach((x) => entries.push(fromMedia(x)))
        a.docs.map((d) => d.data() as AlbumItem).filter((x) => x.status === 'active').forEach((x) => entries.push(fromAlbum(x)))
      }
      entries.sort((x, y) => y.uploadTime.localeCompare(x.uploadTime))
      return NextResponse.json({ success: true, data: entries, next: null })
    }

    let before = params.get('before') ?? '9999'
    const out: AlbumEntry[] = []
    let exhausted = false
    for (let round = 0; round < 6 && out.length < PAGE && !exhausted; round++) {
      const [m, a] = await Promise.all([
        media.where('uploadTime', '<', before).orderBy('uploadTime', 'desc').limit(PAGE).get(),
        album.where('uploadTime', '<', before).orderBy('uploadTime', 'desc').limit(PAGE).get(),
      ])
      const merged = [
        ...m.docs.map((d) => { const x = d.data() as Media; return { entry: fromMedia(x), live: x.status !== 'deleted' } }),
        ...a.docs.map((d) => { const x = d.data() as AlbumItem; return { entry: fromAlbum(x), live: x.status === 'active' } }),
      ].sort((x, y) => y.entry.uploadTime.localeCompare(x.entry.uploadTime))

      const cut = merged.slice(0, PAGE)
      if (cut.length === 0) { exhausted = true; break }
      let processed = 0
      for (const x of cut) {
        if (out.length >= PAGE) break
        before = x.entry.uploadTime
        processed++
        if (x.live) out.push(x.entry)
      }
      // Nothing is left only if both collections came back short, the union
      // fit in one page, and every entry of it was taken
      exhausted = m.size < PAGE && a.size < PAGE && merged.length <= PAGE && processed === cut.length
    }

    return NextResponse.json({ success: true, data: out, next: exhausted ? null : before })
  } catch (err) {
    console.error('GET /api/admin/album error:', err)
    return NextResponse.json({ success: false, error: '無法取得相簿' }, { status: 500 })
  }
}
