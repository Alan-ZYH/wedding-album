#!/usr/bin/env node
/**
 * 一次性遷移：為輪播狀態機與賓客管理準備資料
 *
 *   node scripts/migrate-v2.mjs check    # 只檢查，不寫入
 *   node scripts/migrate-v2.mjs apply    # 實際寫入
 *
 * 做兩件事（皆為「只新增欄位」，不刪除任何既有資料）：
 *   1. media 補上 displayState / displayStateAt
 *      - status=active 且 approved=true → 'pending'
 *      - 其餘（隱藏、待審核、已刪除）    → 'masked'
 *   2. 依現有 media + messages 回填 guests 集合
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const __dirname = dirname(fileURLToPath(import.meta.url))
for (const line of readFileSync(join(__dirname, '..', '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
    clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
})
const db = getFirestore()
const apply = process.argv[2] === 'apply'

const mediaSnap = await db.collection('media').get()
const msgSnap = await db.collection('messages').get()

// ── 1. media.displayState ────────────────────────────────────────
const mediaUpdates = []
for (const doc of mediaSnap.docs) {
  const m = doc.data()
  if (m.displayState) continue // 已遷移過，跳過
  const state = m.status === 'active' && m.approved === true ? 'pending' : 'masked'
  mediaUpdates.push({ ref: doc.ref, state, name: m.fileName })
}

// ── 2. guests 回填 ───────────────────────────────────────────────
const guests = new Map()
const touch = (guestId, guestName, at, kind) => {
  if (!guestId) return
  let g = guests.get(guestId)
  if (!g) {
    g = { guestId, guestName: guestName || '賓客', firstSeenAt: at, lastActiveAt: at,
          photoCount: 0, messageCount: 0, blocked: false }
    guests.set(guestId, g)
  }
  if (guestName) g.guestName = guestName
  if (at < g.firstSeenAt) g.firstSeenAt = at
  if (at > g.lastActiveAt) g.lastActiveAt = at
  if (kind === 'photo') {
    g.photoCount++
    if (!g.lastPhotoAt || at > g.lastPhotoAt) g.lastPhotoAt = at
  } else {
    g.messageCount++
    if (!g.lastMessageAt || at > g.lastMessageAt) g.lastMessageAt = at
  }
}
for (const d of mediaSnap.docs) {
  const m = d.data()
  touch(m.guestId, m.guestName, m.uploadTime, 'photo')
}
for (const d of msgSnap.docs) {
  const m = d.data()
  touch(m.guestId, m.guestName, m.createdAt, 'message')
}

// ── 報告 ─────────────────────────────────────────────────────────
console.log(`media 共 ${mediaSnap.size} 筆，需補 displayState：${mediaUpdates.length} 筆`)
const byState = {}
mediaUpdates.forEach((u) => { byState[u.state] = (byState[u.state] || 0) + 1 })
console.log('  →', JSON.stringify(byState))
console.log(`guests 將建立/更新：${guests.size} 位`)
for (const g of guests.values()) {
  console.log(`  ${g.guestName} #${g.guestId.slice(0, 4)}  照片 ${g.photoCount}  祝福 ${g.messageCount}`)
}

if (!apply) {
  console.log('\n（check 模式，未寫入。確認無誤後執行：node scripts/migrate-v2.mjs apply）')
  process.exit(0)
}

// ── 寫入 ─────────────────────────────────────────────────────────
const now = new Date().toISOString()
let batch = db.batch()
let n = 0
const flush = async () => { if (n) { await batch.commit(); batch = db.batch(); n = 0 } }

for (const u of mediaUpdates) {
  batch.update(u.ref, { displayState: u.state, displayStateAt: now })
  if (++n >= 400) await flush()
}
await flush()

for (const g of guests.values()) {
  batch.set(db.collection('guests').doc(g.guestId), g, { merge: true })
  if (++n >= 400) await flush()
}
await flush()

console.log('\n✅ 遷移完成')
process.exit(0)
