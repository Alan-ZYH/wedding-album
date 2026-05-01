import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app'
import {
  initializeFirestore,
  memoryLocalCache,
  getFirestore,
  type Firestore,
} from 'firebase/firestore'

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

// Only initialize Firebase on the client side
// Server side: return null — client components handle the null case via useEffect
let app: FirebaseApp | null = null
let db: Firestore | null = null

if (typeof window !== 'undefined') {
  app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig)
  if (getApps().length === 1 && !getApps()[0].name.includes('initialized')) {
    try {
      initializeFirestore(app, { localCache: memoryLocalCache() })
    } catch {
      // Already initialized
    }
  }
  db = getFirestore(app)
}

export { db, app }
