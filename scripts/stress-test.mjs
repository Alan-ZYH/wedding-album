#!/usr/bin/env node
/**
 * 壓力測試腳本 — 在正式 Firestore 建立/清除測試資料
 *
 * 用法：
 *   node scripts/stress-test.mjs seed          # 建立 500 筆假媒體 + 100 筆假祝福
 *   node scripts/stress-test.mjs seed 300      # 自訂數量
 *   node scripts/stress-test.mjs concurrent <site-url>   # 20 併發打 /api/upload/init
 *   node scripts/stress-test.mjs status        # 顯示目前測試資料數量
 *   node scripts/stress-test.mjs cleanup       # 刪除所有測試資料
 *
 * 測試資料特徵：
 *   - media doc id 前綴 "stress-test-"
 *   - fileName 含 "STRESS_TEST"
 *   - message doc id 前綴 "stress-test-"
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, FieldPath } from 'firebase-admin/firestore'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── Load .env.local ──────────────────────────────────────────────
const envPath = join(__dirname, '..', '.env.local')
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (m && !process.env[m[1]]) {
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    process.env[m[1]] = v
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

const PREFIX = 'stress-test-'
const GUEST_NAMES = ['王小明', '陳美麗', '林志豪', '張雅婷', '李國強', '黃淑芬', '吳建宏', '劉思妤', '蔡明翰', '鄭家瑜']
const BLESSINGS = [
  '新婚快樂！百年好合！', '祝你們永浴愛河～', '白頭偕老，早生貴子！',
  '今天超美的！', '幸福美滿一輩子', '恭喜恭喜！🎉', '祝福滿滿！',
  '天作之合，佳偶天成', '執子之手，與子偕老', '甜甜蜜蜜到永遠',
]

const args = process.argv.slice(2)
const command = args[0] || 'status'

async function seed(count = 500) {
  console.log(`建立 ${count} 筆測試媒體 + ${Math.round(count / 5)} 筆測試祝福...`)
  const now = Date.now()

  // Firestore batch 上限 500，分批寫
  let written = 0
  const BATCH_SIZE = 400
  for (let start = 0; start < count; start += BATCH_SIZE) {
    const batch = db.batch()
    const end = Math.min(start + BATCH_SIZE, count)
    for (let i = start; i < end; i++) {
      const id = `${PREFIX}media-${String(i).padStart(4, '0')}`
      const guestName = GUEST_NAMES[i % GUEST_NAMES.length]
      // 用 picsum 佔位圖：seed 固定讓每張不同但可快取
      const uploadTime = new Date(now - (count - i) * 30_000).toISOString()
      batch.set(db.collection('media').doc(id), {
        id,
        guestId: `${PREFIX}guest-${i % 20}`,
        guestName,
        fileType: 'photo',
        fileName: `STRESS_TEST_${String(i).padStart(4, '0')}.jpg`,
        mimeType: 'image/jpeg',
        fileSize: 2_000_000 + (i % 10) * 300_000,
        googleDriveFileId: `stress-fake-${i}`,
        googleDriveUrl: `https://picsum.photos/seed/${i}/1920/1080`,
        thumbnailUrl: `https://picsum.photos/seed/${i}/400/300`,
        uploadTime,
        status: 'active',
        approved: true,
        displayState: 'pending',
        displayStateAt: uploadTime,
      })
    }
    await batch.commit()
    written += end - start
    console.log(`  media: ${written}/${count}`)
  }

  const msgCount = Math.round(count / 5)
  const msgBatch = db.batch()
  for (let i = 0; i < msgCount; i++) {
    const id = `${PREFIX}msg-${String(i).padStart(4, '0')}`
    msgBatch.set(db.collection('messages').doc(id), {
      id,
      guestId: `${PREFIX}guest-${i % 20}`,
      guestName: GUEST_NAMES[i % GUEST_NAMES.length],
      message: BLESSINGS[i % BLESSINGS.length],
      createdAt: new Date(now - (msgCount - i) * 60_000).toISOString(),
      status: 'active',
      priority: i % 10 === 0 ? 2 : 1,
    })
  }
  await msgBatch.commit()
  console.log(`  messages: ${msgCount}/${msgCount}`)
  console.log('\n✅ Seed 完成。請開啟投放端與管理端觀察表現。')
  console.log('   注意：測試照片縮圖來自 picsum.photos（顯示正常），')
  console.log('   但投放端大圖用 lh3.googleusercontent.com/d/stress-fake-* 會載入失敗，')
  console.log('   這正好可以同時驗證「照片載入失敗自動跳過」機制。')
}

// Range query over document ids with the stress-test prefix.
// \uf8ff is a very high code point so the range covers every id
// that starts with PREFIX.
function testDocsQuery(coll) {
  return db.collection(coll)
    .where(FieldPath.documentId(), '>=', PREFIX)
    .where(FieldPath.documentId(), '<', PREFIX + '\uf8ff')
}

async function cleanup() {
  console.log('清除測試資料...')
  for (const coll of ['media', 'messages']) {
    let total = 0
    for (;;) {
      const snap = await testDocsQuery(coll).limit(400).get()
      if (snap.empty) break
      const batch = db.batch()
      snap.docs.forEach((d) => batch.delete(d.ref))
      await batch.commit()
      total += snap.size
      console.log(`  ${coll}: 已刪 ${total}`)
    }
    console.log(`  ${coll}: 完成（共 ${total} 筆）`)
  }
  console.log('✅ 清除完成')
}

async function status() {
  for (const coll of ['media', 'messages']) {
    const testSnap = await testDocsQuery(coll).count().get()
    const allSnap = await db.collection(coll).count().get()
    console.log(`${coll}: 測試資料 ${testSnap.data().count} 筆 / 總計 ${allSnap.data().count} 筆`)
  }
}

async function concurrent(siteUrl) {
  if (!siteUrl) {
    console.error('用法：node scripts/stress-test.mjs concurrent https://your-site.vercel.app')
    process.exit(1)
  }
  const N = 20
  console.log(`以 ${N} 併發呼叫 ${siteUrl}/api/upload/init ...`)
  const guestToken = process.env.GUEST_ACCESS_TOKEN
  const results = await Promise.all(
    Array.from({ length: N }, async (_, i) => {
      const t0 = Date.now()
      try {
        const res = await fetch(`${siteUrl}/api/upload/init`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `guest_session=${guestToken}`,
          },
          body: JSON.stringify({
            guestId: `${PREFIX}load-${i % 5}`, // 5 個模擬賓客
            guestNameRaw: `壓測賓客${i % 5}`,
            mimeType: 'image/jpeg',
            fileSize: 3_000_000,
            originalName: `stress_${i}.jpg`,
          }),
        })
        return { i, status: res.status, ms: Date.now() - t0 }
      } catch (e) {
        return { i, status: 'ERR', ms: Date.now() - t0, err: String(e).slice(0, 80) }
      }
    })
  )
  const byStatus = {}
  let totalMs = 0
  for (const r of results) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1
    totalMs += r.ms
  }
  console.log('結果統計：', byStatus)
  console.log(`平均回應時間：${Math.round(totalMs / N)}ms`)
  console.log('（429 = rate limit 生效，200 = 成功建立上傳 session）')
  console.log('注意：此測試會在 Google Drive 建立空的 resumable session（1 週後自動失效，不留檔案）')
}

const run = { seed: () => seed(parseInt(args[1]) || 500), cleanup, status, concurrent: () => concurrent(args[1]) }[command]
if (!run) {
  console.error(`未知指令：${command}（可用：seed / cleanup / status / concurrent）`)
  process.exit(1)
}
run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
