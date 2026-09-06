export type MediaStatus = 'active' | 'hidden' | 'deleted'
export type FileType = 'photo' | 'video'

/**
 * Where a photo currently sits in the display pipeline.
 *
 *   pending → waiting to be promoted into the carousel
 *   playing → in the carousel (non-pinned slot)
 *   pinned  → in the carousel, never evicted, occupies a slot
 *   masked  → played and evicted; only returns if an admin promotes it
 */
export type DisplayState = 'pending' | 'playing' | 'pinned' | 'masked'

export interface Media {
  id: string
  guestId: string
  guestName: string
  fileType: FileType
  fileName: string
  mimeType: string
  fileSize: number
  googleDriveFileId: string
  googleDriveUrl: string
  thumbnailUrl: string
  uploadTime: string // ISO string
  status: MediaStatus
  approved: boolean
  displayError?: boolean  // true when display client reports a playback/load failure
  displayState: DisplayState
  displayStateAt: string  // ISO — when displayState last changed (pending queue order)
  pinnedOrder?: number    // ordering among pinned photos (time the pin was set)
}

export interface Message {
  id: string
  guestId: string
  guestName: string
  message: string
  createdAt: string
  updatedAt: string
  status: 'active' | 'hidden' | 'deleted'
  priority: number // 1 = normal, 2 = high
}

export type SlideTransition = 'fade' | 'slide' | 'zoom' | 'none'
export type DanmakuStyle = 'scroll' | 'scroll-reverse' | 'float' | 'fade'

export interface Settings {
  albumName: string         // event/album title shown on guest page
  slideInterval: number     // seconds per slide
  danmakuSpeed: number      // 1-5 scale
  danmakuDensity: number    // 1-5 scale
  showGuestName: boolean
  showDanmaku: boolean
  playVideos: boolean
  muteVideos: boolean
  randomPlayback: boolean
  requireApproval: boolean
  danmakuFontSize: number   // px
  slideTransition: SlideTransition
  danmakuStyle: DanmakuStyle
  carouselSize: number      // max photos in the carousel (pinned + playing)
  allowInsert: boolean      // when false, new uploads stay in 'pending'
}

export const DEFAULT_SETTINGS: Settings = {
  albumName: '婚禮紀念相簿',
  slideInterval: 5,
  danmakuSpeed: 3,
  danmakuDensity: 3,
  showGuestName: true,
  showDanmaku: true,
  playVideos: true,
  muteVideos: true,
  randomPlayback: false,
  requireApproval: false,
  danmakuFontSize: 24,
  slideTransition: 'fade',
  danmakuStyle: 'scroll',
  carouselSize: 50,
  allowInsert: true,
}

/**
 * A guest, keyed by the UUID stored in their browser's localStorage.
 *
 * lastPhotoAt / lastMessageAt drive the upload cooldowns: checking them is a
 * single document read, so no composite index or extra query is needed.
 */
export interface Guest {
  guestId: string
  guestName: string
  firstSeenAt: string
  lastActiveAt: string
  lastPhotoAt?: string     // start of the current photo cooldown window
  photoBurst?: number      // uploads already used inside that window (max 3)
  lastMessageAt?: string   // start of the current blessing cooldown window
  messageBurst?: number    // blessings already used inside that window (max 1)
  photoCount: number
  messageCount: number
  blocked: boolean
  blockedAt?: string
}

/**
 * Shared playback position so multiple display screens stay in sync.
 * One display client is the controller and writes; the rest follow.
 */
export interface PlaybackState {
  controllerId: string
  heartbeatAt: string
  currentMediaId: string
  currentIndex: number
}

export interface UploadResult {
  success: boolean
  mediaId?: string
  error?: string
}

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}
