import { LRUCache } from 'lru-cache'
import { NextRequest } from 'next/server'

const rateLimit = new LRUCache<string, number[]>({
  max: 2000,
  ttl: 60 * 1000, // 1 minute window
})

/**
 * Sliding-window rate limit.
 *
 * The key combines IP and guestId so wedding guests sharing the venue WiFi
 * (same public IP) don't block each other, while a single guest still can't
 * spam uploads.
 *
 * Note: this is in-memory, so each Vercel serverless instance has its own
 * counter. Good enough as a soft brake for a wedding event; not a hard
 * security boundary.
 */
export function checkRateLimit(
  req: NextRequest,
  maxRequests = 10,
  guestId?: string
): boolean {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  const key = guestId ? `${ip}:${guestId}` : ip

  const now = Date.now()
  const windowMs = 60 * 1000 // 1 minute

  const requests = rateLimit.get(key) || []
  const recentRequests = requests.filter((time) => now - time < windowMs)

  if (recentRequests.length >= maxRequests) {
    return false // Rate limited
  }

  recentRequests.push(now)
  rateLimit.set(key, recentRequests)
  return true
}
