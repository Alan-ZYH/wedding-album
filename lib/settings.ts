import { adminDb, COLLECTIONS } from './firebase-admin'
import { Settings, DEFAULT_SETTINGS } from '@/types'

const SETTINGS_DOC = 'config'

export async function getSettings(): Promise<Settings> {
  try {
    const doc = await adminDb.collection(COLLECTIONS.SETTINGS).doc(SETTINGS_DOC).get()
    if (!doc.exists) {
      // Initialize with defaults
      await adminDb.collection(COLLECTIONS.SETTINGS).doc(SETTINGS_DOC).set(DEFAULT_SETTINGS)
      return DEFAULT_SETTINGS
    }
    return { ...DEFAULT_SETTINGS, ...doc.data() } as Settings
  } catch {
    return DEFAULT_SETTINGS
  }
}

export async function updateSettings(partial: Partial<Settings>): Promise<void> {
  await adminDb.collection(COLLECTIONS.SETTINGS).doc(SETTINGS_DOC).set(partial, { merge: true })
}
