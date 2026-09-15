import { adminDb, COLLECTIONS } from './firebase-admin'
import type { AlbumItem, Media, Settings } from '@/types'

export type MoveResult = 'ok' | 'missing' | 'video' | 'not-owner'

/**
 * Move a kept photo into the projection queue: an ordinary queued photo in
 * media, same id and Drive file, leaving the album collection in the same
 * transaction so it is never in both. Photos only — the screen does not play
 * video. `ownerGuestId`, when given, must be the guest who uploaded it.
 */
export async function moveAlbumToProjection(
  id: string,
  settings: Pick<Settings, 'requireApproval'>,
  ownerGuestId?: string
): Promise<MoveResult> {
  const albumRef = adminDb.collection(COLLECTIONS.ALBUM).doc(id)
  const mediaRef = adminDb.collection(COLLECTIONS.MEDIA).doc(id)
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(albumRef)
    if (!snap.exists) return 'missing'
    const item = snap.data() as AlbumItem
    if (item.status !== 'active') return 'missing'
    if (ownerGuestId && item.guestId !== ownerGuestId) return 'not-owner'
    if (item.fileType !== 'photo') return 'video'

    const now = new Date().toISOString()
    const media: Media = {
      id: item.id,
      guestId: item.guestId,
      guestName: item.guestName,
      fileType: 'photo',
      fileName: item.fileName,
      mimeType: item.mimeType,
      fileSize: item.fileSize,
      googleDriveFileId: item.googleDriveFileId,
      googleDriveUrl: item.googleDriveUrl,
      thumbnailUrl: item.thumbnailUrl,
      uploadTime: item.uploadTime,
      status: 'active',
      approved: !settings.requireApproval,
      displayState: 'pending',
      displayStateAt: now,
    }
    tx.set(mediaRef, media)
    tx.delete(albumRef)
    return 'ok'
  })
}
