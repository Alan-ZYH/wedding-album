import { LRUCache } from 'lru-cache'
import { NextRequest } from 'next/server'

const rateLimit = new LRUCache<string, number[]>({
  max: 500,
  ttl: 60 * 1000, // 1 minute window
})

export function checkRateLimit(req: NextRequest, maxRequests = 10): boolean {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'

  const now = Date.now()
  const windowMs = 60 * 1000 // 1 minute

  const requests = rateLimit.get(ip) || []
  const recentRequests = requests.filter((time) => now - time < windowMs)

  if (recentRequests.length >= maxRequests) {
    return false // Rate limited
  }

  recentRequests.push(now)
  rateLimit.set(ip, recentRequests)
  return true
}
