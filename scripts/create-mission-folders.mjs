// 在闖關任務的 Drive 資料夾裡，一次把每個任務的子資料夾建好。
//   node scripts/create-mission-folders.mjs
// 已存在的同名資料夾會沿用，重跑不會產生重複。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { google } from 'googleapis'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

for (const line of fs.readFileSync(path.join(root, '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
}

// Read the folder names straight out of lib/missions.ts so the two never drift.
const source = fs.readFileSync(path.join(root, 'lib/missions.ts'), 'utf8')
const folders = [...source.matchAll(/folder:\s*'([^']+)'/g)].map((m) => m[1])
if (!folders.length) throw new Error('lib/missions.ts 裡找不到任何 folder 名稱')

const parent = process.env.MISSION_DRIVE_FOLDER_ID
if (!parent) throw new Error('缺少 MISSION_DRIVE_FOLDER_ID')

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, '\n'),
  },
  scopes: ['https://www.googleapis.com/auth/drive'],
})
const drive = google.drive({ version: 'v3', auth })

for (const name of folders) {
  const found = await drive.files.list({
    q: `name='${name}' and '${parent}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  })
  if (found.data.files?.length) {
    console.log(`已存在  ${name}`)
    continue
  }
  await drive.files.create({
    requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parent] },
    fields: 'id',
    supportsAllDrives: true,
  })
  console.log(`已建立  ${name}`)
}
