import type { Settings } from '@/types'

/** What guests see, and what the API answers, while a switch is off. */
export const CLOSED_MESSAGE = '目前尚未開放，期待幸福降臨'

// Absent means open: the album worked before these switches existed, and a
// settings document written back then must not close anything.
export const photosOpen = (s: Partial<Settings>) => s.guestPhotosOpen !== false
export const messagesOpen = (s: Partial<Settings>) => s.guestMessagesOpen !== false
export const albumOpen = (s: Partial<Settings>) => s.guestAlbumOpen !== false
