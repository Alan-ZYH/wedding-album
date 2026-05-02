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
  displayError?: boolean  // true when display client reports a playback/load failure
  transcript?: string     // auto-generated caption from OpenAI Whisper (videos only)
  transcriptStatus?: 'pending' | 'done' | 'error' // Whisper job state
  transcriptNote?: string   // debug info (e.g. file too large, error message)
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
