import { createHmac, timingSafeEqual } from 'node:crypto'
import { adminDb } from './firebase-admin'

/**
 * Admin secrets live in private/admin, a path the Firestore rules close to
 * browsers entirely.
 *
 * They used to sit in settings/config, which the guest page and the display
 * read straight from the browser — so the rules let anyone read it, and with
 * it the admin key. Firebase's client config ships in every page, so that was
 * one request away for anybody. Nothing a browser may read belongs here.
 */
const REF = () => adminDb.collection('private').doc('admin')

export interface AdminSecrets {
  adminAccessKey?: string
  backupFolderId?: string
}

// Admin API routes check the session on every call; a short cache keeps that
// from costing a read each time. A rotated key takes effect within this long.
const TTL_MS = 30_000
let cached: { at: number; value: AdminSecrets } | null = null

export async function getAdminSecrets(fresh = false): Promise<AdminSecrets> {
  if (!fresh && cached && Date.now() - cached.at < TTL_MS) return cached.value
  const snap = await REF().get()
  const value = (snap.data() ?? {}) as AdminSecrets
  cached = { at: Date.now(), value }
  return value
}

/**
 * What the admin cookie holds: a signature derived from the key, never a flag.
 * The cookie used to be the literal value "1", and this repo is public — so
 * anyone reading middleware.ts could set it by hand and skip the key entirely.
 * A signature can only be produced by someone who has the key, and rotating
 * the key voids every session signed with the old one.
 */
export function sessionTokenFor(key: string): string {
  return createHmac('sha256', key).update('wedding-album admin session').digest('hex')
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export const ADMIN_COOKIE = 'admin_session_v3'
