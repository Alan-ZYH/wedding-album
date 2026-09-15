import { DEFAULT_SETTINGS, type Settings } from '@/types'

/** How many photos one selection may hold when the admin turns limits off. */
export const UNTHROTTLED_MAX_FILES = 50
/** The album's ceiling per selection, limits on or off. */
export const ALBUM_MAX_FILES = 100

export interface PhotoLimits {
  enabled: boolean
  /** Photos per batch — and per cooldown window, which is the same thing */
  burst: number
  /** Seconds to wait after a batch; 0 means no wait */
  windowSec: number
}

/**
 * The guest photo limits as 設定 describes them, clamped so a stray value in
 * Firestore can never lock guests out (burst 0) or wedge the page.
 * Used by the server gate and by the guest page, so both enforce one rule.
 */
export function photoLimits(s: Partial<Settings>): PhotoLimits {
  const clamp = (v: unknown, lo: number, hi: number, dflt: number) => {
    const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : dflt
    return Math.min(hi, Math.max(lo, n))
  }
  return {
    enabled: s.uploadThrottleEnabled !== false,
    burst: clamp(s.uploadBurst, 1, 20, DEFAULT_SETTINGS.uploadBurst),
    windowSec: clamp(s.uploadCooldownSec, 0, 600, DEFAULT_SETTINGS.uploadCooldownSec),
  }
}

/**
 * Limits for 存入新人相簿. Its own count and wait, but the same master switch:
 * 啟用上傳限流 governs every guest upload.
 */
export function albumLimits(s: Partial<Settings>): PhotoLimits {
  const clamp = (v: unknown, lo: number, hi: number, dflt: number) => {
    const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : dflt
    return Math.min(hi, Math.max(lo, n))
  }
  return {
    enabled: s.uploadThrottleEnabled !== false,
    burst: clamp(s.albumMaxFiles, 1, ALBUM_MAX_FILES, DEFAULT_SETTINGS.albumMaxFiles),
    windowSec: clamp(s.albumCooldownSec, 0, 600, DEFAULT_SETTINGS.albumCooldownSec),
  }
}

/**
 * Requests per minute the init route's anti-abuse limiter should allow. It
 * sits in front of the cooldown, so it must never be the stricter of the two:
 * a guest allowed 10 photos every 5 seconds would otherwise hit 請求過於頻繁
 * after the tenth photo of the first minute.
 */
export function initRequestsPerMinute(l: PhotoLimits): number {
  if (!l.enabled || l.windowSec === 0) return 120
  const perMinute = Math.ceil(60 / l.windowSec) * l.burst
  return Math.max(10, perMinute + 5)
}
