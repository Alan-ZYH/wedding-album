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
  return stripHtml(input).slice(0, 500)
}

export function sanitizeName(input: string): string {
  if (!input) return ''
  return stripHtml(input).slice(0, 50)
}

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime']
const MAX_IMAGE_SIZE = 20 * 1024 * 1024
const MAX_VIDEO_SIZE = 300 * 1024 * 1024
const MAX_FILES = 20

export interface FileValidation {
  valid: boolean
  error?: string
  fileType?: 'photo' | 'video'
}

export function validateFile(mimeType: string, fileSize: number): FileValidation {
  if (ALLOWED_IMAGE_TYPES.includes(mimeType)) {
    if (fileSize > MAX_IMAGE_SIZE) return { valid: false, error: `圖片大小不可超過 20MB` }
    return { valid: true, fileType: 'photo' }
  }
  if (ALLOWED_VIDEO_TYPES.includes(mimeType)) {
    if (fileSize > MAX_VIDEO_SIZE) return { valid: false, error: `影片大小不可超過 300MB` }
    return { valid: true, fileType: 'video' }
  }
  // HEIC by extension fallback
  return { valid: false, error: `不支援的檔案格式：${mimeType}` }
}

export { MAX_FILES }
