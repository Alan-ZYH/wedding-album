#!/usr/bin/env node
/**
 * 婚禮相簿備份 — 照片/影片複製到個人雲端硬碟，祝福文字匯出為 txt
 *
 * 用法：
 *   node scripts/backup.mjs            # 全部備份（媒體 + 祝福）
 *   node scripts/backup.mjs media      # 只備份照片/影片
 *   node scripts/backup.mjs messages   # 只匯出祝福文字
 *   node scripts/backup.mjs status     # 只比對，不寫入
 *   node scripts/backup.mjs local      # 額外下載一份到本機（選用）
 *   node scripts/backup.mjs nas        # 把本機那份同步到 NAS（選用）
 *
 * 備份位置：專案資料夾底下的「備份相本/」
 *   由 Google Drive 桌面版自動同步到個人雲端硬碟：
 *   https://drive.google.com/drive/folders/1IJsox9j7uMzKqWiZFRuJ2R24FfjqXerT
 *
 * 為什麼寫本機而不是用 API 複製到雲端：
 *   服務帳號本身沒有儲存空間配額，無法在個人雲端硬碟建立檔案（403
 *   storageQuotaExceeded）。寫進已掛載的同步資料夾，由 Drive 桌面版代為
 *   上傳，檔案就會以你的身分存在個人雲端硬碟，也才是真正獨立的第二份。
 *
 * 為什麼掃 Drive 而不是掃 Firestore：
 *   上傳分兩步（傳檔案 → 建立記錄）。第二步若失敗，檔案會留在 Drive 但系統
 *   沒有記錄。照 Firestore 備份會漏掉這些檔案，直接掃 Drive 才保得住全部。
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
// 專案底下的同步資料夾；Drive 桌面版會把它上傳到個人雲端硬碟「備份相本」
const BACKUP_DIR = join(__dirname, '..', '備份相本')
const BACKUP_FOLDER_URL = 'https://drive.google.com/drive/folders/1IJsox9j7uMzKqWiZFRuJ2R24FfjqXerT'
const LOCAL_DIR = join(homedir(), 'wedding-backup')
const NAS_HOST = 'alan-nas'
const NAS_DEST = '~/wedding-backup/'

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

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, '\n'),
  },
  scopes: ['https://www.googleapis.com/auth/drive'],
})
const drive = google.drive({ version: 'v3', auth })

const DRIVE_OPTS = { supportsAllDrives: true, includeItemsFromAllDrives: true }

/** 列出資料夾下所有項目（自動翻頁） */
async function listAll(parentId) {
  const out = []
  let pageToken
  do {
    const res = await drive.files.list({
      q: `'${parentId}' in parents and trashed=false`,
      fields: 'nextPageToken, files(id,name,mimeType,size,createdTime)',
      pageSize: 1000,
      pageToken,
      ...DRIVE_OPTS,
    })
    out.push(...(res.data.files ?? []))
    pageToken = res.data.nextPageToken ?? undefined
  } while (pageToken)
  return out
}

async function findChildFolder(parentId, name) {
  const res = await drive.files.list({
    q: `'${parentId}' in parents and name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id)',
    ...DRIVE_OPTS,
  })
  return res.data.files?.[0]?.id ?? null
}

/** 來源：Wedding Uploads 底下的 photos / videos */
async function getSourceFiles() {
  const root = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID
  const weddingId = await findChildFolder(root, 'Wedding Uploads')
  if (!weddingId) throw new Error('找不到 Wedding Uploads 資料夾')
  const out = []
  for (const sub of ['photos', 'videos']) {
    const id = await findChildFolder(weddingId, sub)
    if (!id) continue
    for (const f of await listAll(id)) out.push({ ...f, kind: sub })
  }
  return out
}

const fmtTime = (iso) => {
  const d = new Date(iso)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// ── 祝福文字 ─────────────────────────────────────────────────────
async function backupMessages({ dryRun = false } = {}) {
  console.log('📝 匯出祝福文字...')
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
    const note = m.status !== 'active' ? `（已${m.status === 'hidden' ? '隱藏' : '刪除'}）` : ''
    lines.push(`【${fmtTime(m.createdAt)}】${m.guestName}${note}`)
    lines.push(`  ${m.message}`)
    lines.push('')
  }
  const content = lines.join('\n')

  if (dryRun) {
    console.log(`   （status 模式）共 ${snap.size} 則，未寫入`)
    return
  }

  mkdirSync(BACKUP_DIR, { recursive: true })
  writeFileSync(join(BACKUP_DIR, '祝福文字備份.txt'), content, 'utf8')
  console.log(`✅ ${snap.size} 則祝福已寫入備份相本`)
}

// ── 媒體：下載到同步資料夾（增量） ──────────────────────────────
async function backupMedia({ dryRun = false } = {}) {
  console.log('📷 比對照片/影片...')
  const source = await getSourceFiles()

  // 以「檔名 + 大小」判斷是否已備份，可重複執行
  const todo = source.filter((f) => {
    const dest = join(BACKUP_DIR, f.kind, f.name)
    return !(existsSync(dest) && String(statSync(dest).size) === String(f.size))
  })

  // Firestore 記錄外的孤兒檔案（上傳第二步失敗留下的）也一併備份
  const tracked = new Set((await db.collection('media').get()).docs.map((d) => d.data().googleDriveFileId))
  const orphans = source.filter((f) => !tracked.has(f.id)).length

  console.log(`   來源 ${source.length} 個｜已備份 ${source.length - todo.length} 個｜待備份 ${todo.length} 個`)
  if (orphans) console.log(`   （其中 ${orphans} 個為系統無記錄的孤兒檔案，一併保存）`)

  if (dryRun) { console.log('   （status 模式，未寫入）'); return }
  if (todo.length === 0) { console.log('✅ 已是最新，無需下載'); return }

  for (const sub of ['photos', 'videos']) mkdirSync(join(BACKUP_DIR, sub), { recursive: true })

  let ok = 0, fail = 0
  for (const f of todo) {
    const dest = join(BACKUP_DIR, f.kind, f.name)
    try {
      const res = await drive.files.get(
        { fileId: f.id, alt: 'media', supportsAllDrives: true },
        { responseType: 'stream' }
      )
      await new Promise((resolve, reject) => {
        const ws = createWriteStream(dest)
        res.data.pipe(ws)
        ws.on('finish', resolve)
        ws.on('error', reject)
        res.data.on('error', reject)
      })
      ok++
      if (ok % 10 === 0 || ok === todo.length) console.log(`   ${ok}/${todo.length}`)
    } catch (e) {
      fail++
      console.error(`   ✗ ${f.name}：${String(e.message).slice(0, 70)}`)
    }
  }
  console.log(`✅ 媒體備份完成：新下載 ${ok} 個${fail ? `、失敗 ${fail} 個` : ''}`)
  console.log(`   本機：${BACKUP_DIR}`)
  console.log(`   Drive 桌面版會自動同步到：${BACKUP_FOLDER_URL}`)
}

// ── 選用：下載一份到本機 ─────────────────────────────────────────
async function backupLocal() {
  console.log('💾 下載到本機...')
  const mediaDir = join(LOCAL_DIR, 'media')
  mkdirSync(mediaDir, { recursive: true })
  const source = await getSourceFiles()
  let got = 0, skip = 0, fail = 0
  for (const f of source) {
    const dest = join(mediaDir, f.name)
    if (existsSync(dest) && String(statSync(dest).size) === String(f.size)) { skip++; continue }
    try {
      const res = await drive.files.get(
        { fileId: f.id, alt: 'media', supportsAllDrives: true },
        { responseType: 'stream' }
      )
      await new Promise((resolve, reject) => {
        const ws = createWriteStream(dest)
        res.data.pipe(ws)
        ws.on('finish', resolve)
        ws.on('error', reject)
        res.data.on('error', reject)
      })
      got++
      console.log(`   ↓ ${f.name}`)
    } catch (e) {
      fail++
      console.error(`   ✗ ${f.name}：${String(e.message).slice(0, 70)}`)
    }
  }
  // 祝福文字也放一份
  const snap = await db.collection('messages').orderBy('createdAt', 'asc').get()
  const lines = [`婚禮祝福文字備份（${fmtTime(new Date().toISOString())}，共 ${snap.size} 則）`, '']
  snap.docs.forEach((d) => {
    const m = d.data()
    const note = m.status !== 'active' ? `（已${m.status === 'hidden' ? '隱藏' : '刪除'}）` : ''
    lines.push(`【${fmtTime(m.createdAt)}】${m.guestName}${note}`, `  ${m.message}`, '')
  })
  writeFileSync(join(LOCAL_DIR, '祝福文字備份.txt'), lines.join('\n'), 'utf8')
  console.log(`✅ 本機備份：新下載 ${got}、已存在 ${skip}${fail ? `、失敗 ${fail}` : ''} → ${LOCAL_DIR}`)
}

// ── 選用：本機那份同步到 NAS ────────────────────────────────────
function syncToNas() {
  console.log(`🖥  同步到 NAS（${NAS_HOST}）...`)
  if (!existsSync(LOCAL_DIR)) {
    console.error('❌ 尚未有本機備份，請先執行：node scripts/backup.mjs local')
    process.exit(1)
  }
  try {
    execSync(`ssh -o ConnectTimeout=8 -o BatchMode=yes ${NAS_HOST} "mkdir -p ${NAS_DEST}"`, { stdio: 'pipe' })
  } catch {
    console.error('❌ NAS 無法連線（可能未開機）。開機後重新執行：node scripts/backup.mjs nas')
    process.exit(1)
  }
  // tar over SSH：Synology 未啟用 rsync 服務，tar 只需要 SSH
  execSync(
    `COPYFILE_DISABLE=1 tar -C "${LOCAL_DIR}" -cf - --exclude '.DS_Store' . | ssh ${NAS_HOST} "tar -C ${NAS_DEST} -xf -"`,
    { stdio: 'inherit', shell: '/bin/zsh' }
  )
  console.log('✅ NAS 同步完成')
}

const cmd = process.argv[2] || 'all'
const run = {
  all: async () => { await backupMessages(); await backupMedia() },
  media: () => backupMedia(),
  messages: () => backupMessages(),
  status: async () => { await backupMessages({ dryRun: true }); await backupMedia({ dryRun: true }) },
  local: () => backupLocal(),
  nas: async () => syncToNas(),
}[cmd]

if (!run) {
  console.error(`未知指令：${cmd}（可用：all / media / messages / status / local / nas）`)
  process.exit(1)
}
run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
