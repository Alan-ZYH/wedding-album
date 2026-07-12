#!/usr/bin/env node
/**
 * 婚禮相簿備份腳本 — 祝福文字 + 照片/影片
 *
 * 用法：
 *   node scripts/backup.mjs            # 全部備份（祝福 + 媒體）
 *   node scripts/backup.mjs messages   # 只備份祝福文字
 *   node scripts/backup.mjs media      # 只備份照片/影片
 *   node scripts/backup.mjs nas        # 同步備份資料夾到 NAS（需 NAS 開機）
 *
 * 備份位置：~/wedding-backup/
 *   ├── 祝福文字備份.txt        （所有祝福：時間 + 名稱 + 內容）
 *   └── media/                  （所有照片與影片原始檔）
 *
 * NAS 目的地：alan-nas:~/wedding-backup/（Synology 192.168.1.166）
 *
 * 特性：
 *   - 媒體採增量下載：已存在且大小相符的檔案自動跳過，可重複執行
 *   - 包含賓客「已刪除/隱藏」的內容（備份求完整；狀態會標注在文字檔中）
 */
import { readFileSync, mkdirSync, writeFileSync, existsSync, statSync, createWriteStream } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { google } from 'googleapis'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BACKUP_DIR = join(homedir(), 'wedding-backup')
const MEDIA_DIR = join(BACKUP_DIR, 'media')
const NAS_HOST = 'alan-nas'
const NAS_DEST = '~/wedding-backup/'

// ── Load .env.local ──────────────────────────────────────────────
const envPath = join(__dirname, '..', '.env.local')
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}

initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
    clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
})
const db = getFirestore()

function getDrive() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/drive'],
  })
  return google.drive({ version: 'v3', auth })
}

const fmtTime = (iso) => {
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ── 祝福文字備份 ─────────────────────────────────────────────────
async function backupMessages() {
  console.log('📝 備份祝福文字...')
  const snap = await db.collection('messages').orderBy('createdAt', 'asc').get()

  const lines = [
    '════════════════════════════════════',
    '        婚禮祝福文字備份',
    `        匯出時間：${fmtTime(new Date().toISOString())}`,
    `        共 ${snap.size} 則祝福`,
    '════════════════════════════════════',
    '',
  ]

  for (const doc of snap.docs) {
    const m = doc.data()
    const statusNote = m.status !== 'active' ? `（已${m.status === 'hidden' ? '隱藏' : '刪除'}）` : ''
    lines.push(`【${fmtTime(m.createdAt)}】${m.guestName}${statusNote}`)
    lines.push(`  ${m.message}`)
    lines.push('')
  }

  mkdirSync(BACKUP_DIR, { recursive: true })
  const outPath = join(BACKUP_DIR, '祝福文字備份.txt')
  writeFileSync(outPath, lines.join('\n'), 'utf8')
  console.log(`✅ 已儲存 ${snap.size} 則祝福 → ${outPath}`)
}

// ── 媒體備份（增量） ─────────────────────────────────────────────
async function backupMedia() {
  console.log('📷 備份照片/影片...')
  mkdirSync(MEDIA_DIR, { recursive: true })
  const drive = getDrive()
  const snap = await db.collection('media').orderBy('uploadTime', 'asc').get()

  let downloaded = 0, skipped = 0, failed = 0
  for (const doc of snap.docs) {
    const m = doc.data()
    if (!m.googleDriveFileId || !m.fileName) continue
    const dest = join(MEDIA_DIR, m.fileName)

    // 增量：已存在且大小相符 → 跳過
    if (existsSync(dest) && m.fileSize && statSync(dest).size === m.fileSize) {
      skipped++
      continue
    }

    try {
      const res = await drive.files.get(
        { fileId: m.googleDriveFileId, alt: 'media', supportsAllDrives: true },
        { responseType: 'stream' }
      )
      await new Promise((resolve, reject) => {
        const ws = createWriteStream(dest)
        res.data.pipe(ws)
        ws.on('finish', resolve)
        ws.on('error', reject)
        res.data.on('error', reject)
      })
      downloaded++
      console.log(`  ↓ ${m.fileName}`)
    } catch (e) {
      failed++
      console.error(`  ✗ ${m.fileName}：${String(e).slice(0, 80)}`)
    }
  }
  console.log(`✅ 媒體備份完成：新下載 ${downloaded}、已存在跳過 ${skipped}、失敗 ${failed}`)
  console.log(`   位置：${MEDIA_DIR}`)
}

// ── NAS 同步 ─────────────────────────────────────────────────────
// 用 tar over SSH 而非 rsync：Synology 預設未啟用 rsync 服務，
// tar 只需要 SSH 即可，且 COPYFILE_DISABLE 避免 macOS ._ 檔汙染
function syncToNas() {
  console.log(`🖥  同步到 NAS（${NAS_HOST}）...`)
  try {
    execSync(`ssh -o ConnectTimeout=8 -o BatchMode=yes ${NAS_HOST} "mkdir -p ${NAS_DEST}"`, { stdio: 'pipe' })
  } catch {
    console.error('❌ NAS 無法連線（可能未開機）。請 NAS 恢復後重新執行：node scripts/backup.mjs nas')
    process.exit(1)
  }
  execSync(
    `COPYFILE_DISABLE=1 tar -C "${BACKUP_DIR}" -cf - --exclude '.DS_Store' . | ssh ${NAS_HOST} "tar -C ${NAS_DEST} -xf -"`,
    { stdio: 'inherit', shell: '/bin/zsh' }
  )
  console.log('✅ NAS 同步完成')
}

// ── Main ─────────────────────────────────────────────────────────
const cmd = process.argv[2] || 'all'
if (cmd === 'messages') {
  await backupMessages()
} else if (cmd === 'media') {
  await backupMedia()
} else if (cmd === 'nas') {
  syncToNas()
} else if (cmd === 'all') {
  await backupMessages()
  await backupMedia()
  console.log('\n提示：執行 node scripts/backup.mjs nas 可再同步到 NAS')
} else {
  console.error(`未知指令：${cmd}（可用：all / messages / media / nas）`)
  process.exit(1)
}
process.exit(0)
