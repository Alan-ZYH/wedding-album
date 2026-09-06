import { initializeApp, getApps, cert, App } from 'firebase-admin/app'
import { getFirestore, Firestore } from 'firebase-admin/firestore'

function getAdminApp(): App {
  if (getApps().length > 0) return getApps()[0]

  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY
    ? process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, '\n')
    : undefined

  return initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey,
    }),
  })
}

// Lazy singleton — does NOT initialize Firebase at module import time
// (prevents build-time crash when env vars are unavailable)
let _db: Firestore | null = null
function getDb(): Firestore {
  if (!_db) _db = getFirestore(getAdminApp())
  return _db
}

export const adminDb = new Proxy({} as Firestore, {
  get(_target, prop: string | symbol) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (getDb() as any)[prop as string]
  },
})

// Collection helpers
export const COLLECTIONS = {
  MEDIA: 'media',
  MESSAGES: 'messages',
  SETTINGS: 'settings',
  GUESTS: 'guests',
} as const
