import { adminDb, COLLECTIONS } from './firebase-admin'
import type { Media } from '@/types'

/**
 * Order playing photos the way the display does: the admin's dragged order
 * where both photos have one, otherwise how long they have been playing.
 * Kept identical to DisplayClient's comparator so the admin panel's "播放"
 * list and what actually reaches the screen never disagree.
 */
function byPlayOrder(a: Partial<Media>, b: Partial<Media>): number {
  if (a.sortOrder != null && b.sortOrder != null) return a.sortOrder - b.sortOrder
  return String(a.displayStateAt || '').localeCompare(String(b.displayStateAt || ''))
}

/**
 * Mask playing photos that no longer fit the carousel.
 *
 * Shrinking 輪播照片數量 doesn't remove anything by itself — the display just
 * stops drawing the overflow, which leaves photos labelled 播放 in the admin
 * panel that no guest will ever see. This demotes the longest-playing ones to
 * 遮蔽 so the label matches reality. Pinned photos occupy slots and are never
 * demoted here; if they alone fill the carousel, every playing photo is masked.
 *
 * Returns the number of photos masked.
 */
export async function enforceCarouselCapacity(size: number): Promise<number> {
  const [pinnedSnap, playingSnap] = await Promise.all([
    adminDb.collection(COLLECTIONS.MEDIA).where('displayState', '==', 'pinned').get(),
    adminDb.collection(COLLECTIONS.MEDIA).where('displayState', '==', 'playing').get(),
  ])

  const slots = Math.max(0, size - pinnedSnap.size)
  const overflow = playingSnap.size - slots
  if (overflow <= 0) return 0

  const now = new Date().toISOString()
  const doomed = playingSnap.docs
    .map((d) => ({ ref: d.ref, ...(d.data() as Partial<Media>) }))
    .sort(byPlayOrder)
    .slice(0, overflow) // oldest first — the same ones the display was dropping

  // carouselSize maxes out at 100, so this stays well under the 500-write cap
  const batch = adminDb.batch()
  doomed.forEach((d) => batch.update(d.ref, { displayState: 'masked', displayStateAt: now }))
  await batch.commit()
  return doomed.length
}
