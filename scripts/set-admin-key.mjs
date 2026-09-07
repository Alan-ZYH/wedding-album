#!/usr/bin/env node
/**
 * 設定 / 更換管理端密鑰
 *
 * 用法：
 *   node scripts/set-admin-key.mjs           # 隨機產生一把新的
 *   node scripts/set-admin-key.mjs <密鑰>    # 指定
 *   node scripts/set-admin-key.mjs show      # 只看目前的
 *
 * 密鑰存在 Firestore（settings/config.adminAccessKey），不在原始碼裡——
 * 這個 repo 是公開的。也刻意不放 Vercel 環境變數，因為改環境變數要重新
 * 部署，而婚禮當天不會想碰部署。
 *
 * 換了密鑰之後，已經拿過 cookie 的裝置仍然進得去（cookie 30 天）；要把
 * 所有裝置踢出去，得清掉它們的 cookie，或改 middleware 的 cookie 名稱。
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
const ref = db.collection('settings').doc('config')
const site = process.env.NEXT_PUBLIC_SITE_URL || 'https://<你的網址>'

const arg = process.argv[2]

if (arg === 'show') {
  const key = (await ref.get()).data()?.adminAccessKey
  console.log(key ? `目前密鑰：${key}\n進入網址：${site}/api/admin/unlock?key=${key}` : '尚未設定密鑰（管理端目前無保護）')
  process.exit(0)
}

const key = arg || randomBytes(16).toString('hex')
await ref.set({ adminAccessKey: key }, { merge: true })
console.log(`已設定密鑰：${key}\n\n用這個網址進入管理端（每台裝置開一次就好，記住 30 天）：\n${site}/api/admin/unlock?key=${key}`)
