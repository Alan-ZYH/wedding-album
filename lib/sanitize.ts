// Pure Node.js sanitization — no JSDOM, no browser globals needed
// React handles XSS by default when rendering text, so we just strip HTML tags

function stripHtml(input: string): string {
  // Remove HTML tags and decode common entities
  return input
    .replace(/<[^>]*>/g, '')           // strip all HTML tags
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .trim()
}

export function sanitizeText(input: string): string {
  if (!input) return ''
  // A backstop against oversized payloads only; the real limit is
  // MESSAGE_MAX_CHARS, refused with a message rather than silently cut
  return stripHtml(input).slice(0, 2000)
}

/**
 * Blessings are read as they fly across the screen, so they are kept short.
 * Counted in code points, like names, so an emoji costs one character.
 */
export const MESSAGE_MAX_CHARS = 100

export function messageTooLong(text: string): string | null {
  return [...text].length > MESSAGE_MAX_CHARS ? `祝福不可超過 ${MESSAGE_MAX_CHARS} 字` : null
}

export function sanitizeName(input: string): string {
  if (!input) return ''
  return stripHtml(input).slice(0, 50)
}

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
export const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/x-m4v', 'video/3gpp', 'video/webm']
export const MAX_IMAGE_MB = 30
export const MAX_VIDEO_MB = 500
const MAX_IMAGE_SIZE = MAX_IMAGE_MB * 1024 * 1024
const MAX_VIDEO_SIZE = MAX_VIDEO_MB * 1024 * 1024

export interface FileValidation {
  valid: boolean
  error?: string
  fileType?: 'photo' | 'video'
}

/**
 * `projection` takes photos only — the screen no longer plays video. `album`
 * takes photos and videos, which only the couple will ever open.
 */
export function validateFile(
  mimeType: string,
  fileSize: number,
  mode: 'projection' | 'album' = 'projection'
): FileValidation {
  if (ALLOWED_IMAGE_TYPES.includes(mimeType)) {
    if (fileSize > MAX_IMAGE_SIZE) return { valid: false, error: `圖片大小不可超過 ${MAX_IMAGE_MB}MB` }
    return { valid: true, fileType: 'photo' }
  }
  if (ALLOWED_VIDEO_TYPES.includes(mimeType)) {
    if (mode !== 'album') return { valid: false, error: '投影只接受照片，影片請存入新人相簿' }
    if (fileSize > MAX_VIDEO_SIZE) return { valid: false, error: `影片大小不可超過 ${MAX_VIDEO_MB}MB` }
    return { valid: true, fileType: 'video' }
  }
  return { valid: false, error: `不支援的檔案格式：${mimeType || '未知'}` }
}
