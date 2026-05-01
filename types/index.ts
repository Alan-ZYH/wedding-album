export type MediaStatus = 'active' | 'hidden' | 'deleted'
export type FileType = 'photo' | 'video'

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
}

export const DEFAULT_SETTINGS: Settings = {
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
