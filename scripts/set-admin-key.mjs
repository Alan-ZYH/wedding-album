#!/usr/bin/env node
/**
 * 設定 / 更換管理端密鑰
 *
 * 用法：
 *   node scripts/set-admin-key.mjs           # 隨機產生一把新的
 *   node scripts/set-admin-key.mjs <密鑰>    # 指定
 *   node scripts/set-admin-key.mjs show      # 只看目前的
 *
 * 密鑰存在 Firestore 的 private/admin——Firestore 規則不讓瀏覽器讀取這個位置。
 * 千萬不要放回 settings/config：賓客端和投放端會從瀏覽器直接讀那份資料，
 * 放在那裡等於公開。
 *
 * 管理端的通行 cookie 是用密鑰簽出來的，所以換了密鑰，所有裝置的登入
 * 會在 30 秒內一起失效，要用新的解鎖網址重新開一次。
 */
import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
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
const ref = db.collection('private').doc('admin')
const site = process.env.NEXT_PUBLIC_SITE_URL || 'https://wedding-album-mu.vercel.app'

const arg = process.argv[2]

if (arg === 'show') {
  const key = (await ref.get()).data()?.adminAccessKey
  console.log(key ? `目前密鑰：${key}\n進入網址：${site}/api/admin/unlock?key=${key}` : '尚未設定密鑰（正式站管理端無法解鎖）')
  process.exit(0)
}

const key = arg || randomBytes(24).toString('hex')
await ref.set({ adminAccessKey: key }, { merge: true })
console.log(`已設定密鑰：${key}\n\n用這個網址進入管理端（每台裝置開一次就好，記住 30 天）：\n${site}/api/admin/unlock?key=${key}`)
