'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { uploadToDrive, mimeOf, videoThumbnail, UploadAborted, FinalResponseUnreadable, CHUNK, type DriveSession } from '@/lib/drive-upload'

const MAX_IMAGE_MB = 30
const MAX_VIDEO_MB = 500
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/x-m4v', 'video/3gpp', 'video/webm']
/** Files uploading at once. Enough to be quick, few enough for a phone on venue WiFi. */
const PARALLEL = 3

interface Limits {
  maxFiles: number
  /** Seconds to wait after a batch; 0 for none */
  cooldownSeconds: number
}

interface Props {
  guestId: string
  guestName: string
  onViewUploads?: () => void
  /** Limits for photos going to the screen. */
  maxFiles?: number
  cooldownSeconds?: number
  /** Whether guests may send photos to the screen right now. */
  projectionOpen?: boolean
  /** Offer 存入新人相簿 with these limits; omitted, the option is not shown. */
  album?: Limits | null
}

type Status = 'queued' | 'uploading' | 'done' | 'failed'

interface Item {
  key: string
  file: File
  mime: string
  kind: 'photo' | 'video'
  /** Object URL for photos, a captured frame for videos, null for an icon */
  thumb: string | null
  status: Status
  progress: number
  error?: string
  /** Kept across retries so a dropped upload continues instead of restarting */
  session?: DriveSession & { mediaId: string; fileName: string; driveId?: string }
  /** Set once the whole batch must stop — a cooldown, a block, a closed switch */
  fatal?: boolean
}

let keySeq = 0

function check(file: File, mime: string, album: boolean): string | null {
  if (file.size === 0) return `${file.name}：檔案是空的`
  if (IMAGE_TYPES.includes(mime)) {
    return file.size > MAX_IMAGE_MB * 1024 * 1024 ? `${file.name}：照片超過 ${MAX_IMAGE_MB}MB` : null
  }
  if (VIDEO_TYPES.includes(mime)) {
    if (!album) return `${file.name}：投影只接受照片，影片請選「存入新人相簿」`
    return file.size > MAX_VIDEO_MB * 1024 * 1024 ? `${file.name}：影片超過 ${MAX_VIDEO_MB}MB` : null
  }
  return `${file.name}：不支援的格式`
}

const mb = (n: number) => (n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)

export default function UploadForm({
  guestId,
  guestName,
  onViewUploads,
  maxFiles = 3,
  cooldownSeconds = 30,
  projectionOpen = true,
  album = null,
}: Props) {
  // When the screen is closed to guests but the album is open, the album is
  // the only way in
  const albumForced = !!album && !projectionOpen
  const [albumMode, setAlbumMode] = useState(albumForced)
  useEffect(() => { if (albumForced) setAlbumMode(true) }, [albumForced])
  const inAlbum = !!album && albumMode

  const limits: Limits = inAlbum ? album! : { maxFiles, cooldownSeconds }

  const [items, setItems] = useState<Item[]>([])
  const [uploading, setUploading] = useState(false)
  const [notice, setNotice] = useState<string[]>([])
  const [finished, setFinished] = useState<{ count: number; album: boolean } | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const itemsRef = useRef(items)
  itemsRef.current = items

  // Each destination keeps its own wait, as the server does
  const [cooldowns, setCooldowns] = useState({ projection: 0, album: 0 })
  const cooldown = inAlbum ? cooldowns.album : cooldowns.projection
  const setCooldownFor = useCallback((isAlbum: boolean, seconds: number) => {
    setCooldowns((c) => ({ ...c, [isAlbum ? 'album' : 'projection']: seconds }))
  }, [])

  // A shortened or lifted wait applies to a countdown already running
  useEffect(() => {
    setCooldowns((c) => ({
      projection: Math.min(c.projection, cooldownSeconds),
      album: Math.min(c.album, album?.cooldownSeconds ?? 0),
    }))
  }, [cooldownSeconds, album?.cooldownSeconds])

  useEffect(() => {
    if (cooldowns.projection <= 0 && cooldowns.album <= 0) return
    const t = setTimeout(() => setCooldowns((c) => ({
      projection: Math.max(0, c.projection - 1),
      album: Math.max(0, c.album - 1),
    })), 1000)
    return () => clearTimeout(t)
  }, [cooldowns])

  const patch = useCallback((key: string, fields: Partial<Item>) => {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...fields } : it)))
  }, [])

  // Release object URLs when items go away
  useEffect(() => () => {
    itemsRef.current.forEach((it) => { if (it.thumb?.startsWith('blob:')) URL.revokeObjectURL(it.thumb) })
  }, [])

  // ── Choosing files ───────────────────────────────────────────
  const addFiles = useCallback(async (picked: File[]) => {
    const errs: string[] = []
    const room = limits.maxFiles - itemsRef.current.length
    const accepted: Item[] = []
    for (const file of picked) {
      if (accepted.length >= room) {
        errs.push(`一次最多 ${limits.maxFiles} 個檔案，其餘沒有加入`)
        break
      }
      const mime = mimeOf(file)
      const err = check(file, mime, inAlbum)
      if (err) { errs.push(err); continue }
      const kind = mime.startsWith('video/') ? 'video' : 'photo'
      accepted.push({
        key: `f${++keySeq}`, file, mime, kind,
        thumb: kind === 'photo' ? URL.createObjectURL(file) : null,
        status: 'queued', progress: 0,
      })
    }
    setItems((prev) => [...prev, ...accepted])
    setNotice(errs)
    setFinished(null)
    // Video stills one at a time: decoding several videos at once is what
    // makes a phone stutter
    for (const it of accepted.filter((a) => a.kind === 'video')) {
      const still = await videoThumbnail(it.file)
      if (still) patch(it.key, { thumb: still })
    }
  }, [limits.maxFiles, inAlbum, patch])

  const removeItem = (key: string) => {
    setItems((prev) => {
      const it = prev.find((x) => x.key === key)
      if (it?.thumb?.startsWith('blob:')) URL.revokeObjectURL(it.thumb)
      return prev.filter((x) => x.key !== key)
    })
  }

  const switchMode = (toAlbum: boolean) => {
    if (uploading || albumForced) return
    if (items.length && !confirm('切換後會清除目前選好但還沒上傳的檔案，確定嗎？')) return
    items.forEach((it) => { if (it.thumb?.startsWith('blob:')) URL.revokeObjectURL(it.thumb) })
    setItems([])
    setNotice([])
    setFinished(null)
    setAlbumMode(toAlbum)
  }

  // ── Uploading one file ───────────────────────────────────────
  const uploadOne = useCallback(async (it: Item, isAlbum: boolean): Promise<'done' | 'failed' | 'stop'> => {
    patch(it.key, { status: 'uploading', error: undefined })
    let session = it.session
    try {
      if (!session) {
        const res = await fetch('/api/upload/init', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            guestId, guestNameRaw: guestName, mimeType: it.mime,
            fileSize: it.file.size, originalName: it.file.name, albumOnly: isAlbum,
          }),
        })
        const data = await res.json()
        if (!data.success) {
          if (typeof data.remaining === 'number') setCooldownFor(isAlbum, data.remaining)
          const stop = data.reason === 'cooldown' || data.reason === 'blocked' || data.reason === 'closed'
          patch(it.key, { status: stop ? 'queued' : 'failed', error: data.error || '無法開始上傳', fatal: stop })
          return stop ? 'stop' : 'failed'
        }
        session = { uploadUrl: data.uploadUrl, sent: 0, mediaId: data.mediaId, fileName: data.fileName }
        patch(it.key, { session })
      }

      // A retry of a file that may already be in Drive: the last attempt could
      // have delivered every byte and lost only the answer. Resending then is
      // not harmless — Drive, given the final chunk again long after finishing,
      // stores a second copy (seen in testing, 14 minutes on). So ask the server
      // to look for it by name first, and only upload what is not there.
      // Only the final chunk can have finished the file; a failure before it
      // means Drive is still waiting, and resuming is safe.
      const finalChunkWasInFlight = session.sent + CHUNK >= it.file.size
      if (session.driveId === undefined && it.status === 'failed' && finalChunkWasInFlight) {
        const probe = await fetch('/api/upload/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mediaId: session.mediaId, guestId, guestName, fileName: session.fileName,
            mimeType: it.mime, fileSize: it.file.size, albumOnly: isAlbum,
          }),
        }).then((r) => r.json()).catch(() => null)
        if (probe?.success) {
          patch(it.key, { status: 'done', progress: 1 })
          return 'done'
        }
      }

      if (session.driveId === undefined) {
        try {
          session.driveId = await uploadToDrive(session, it.file, it.mime, (p) => patch(it.key, { progress: p }))
        } catch (err) {
          if (!(err instanceof FinalResponseUnreadable)) throw err
          // Sent in full; let the server find it by name
          session.driveId = ''
        }
        patch(it.key, { session: { ...session } })
      }

      const res = await fetch('/api/upload/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mediaId: session.mediaId, guestId, guestName, fileName: session.fileName,
          mimeType: it.mime, fileSize: it.file.size, albumOnly: isAlbum,
          googleDriveFileId: session.driveId || undefined,
        }),
      })
      const data = await res.json()
      if (!data.success) {
        patch(it.key, { status: 'failed', error: data.error || '儲存失敗' })
        return 'failed'
      }
      patch(it.key, { status: 'done', progress: 1 })
      return 'done'
    } catch (err) {
      const pct = session ? Math.round((session.sent / it.file.size) * 100) : 0
      patch(it.key, {
        status: 'failed',
        session: session ? { ...session } : undefined,
        error: err instanceof UploadAborted
          ? pct > 0 ? `連線中斷，重試會從 ${pct}% 接著傳` : '連線中斷，請重試'
          : '上傳失敗，請重試',
      })
      return 'failed'
    }
  }, [guestId, guestName, patch, setCooldownFor])

  // ── Keeping the phone awake while uploading ──────────────────
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null)
  const holdAwake = async () => {
    try {
      // Supported by Safari 16.4+ and Chrome; elsewhere the warning has to do
      const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }
      wakeLock.current = (await nav.wakeLock?.request('screen')) ?? null
    } catch { /* not allowed or not supported */ }
  }
  const releaseAwake = () => { wakeLock.current?.release().catch(() => {}); wakeLock.current = null }

  useEffect(() => {
    if (!uploading) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    // The lock is dropped whenever the page is hidden; take it back on return
    const onVisible = () => { if (document.visibilityState === 'visible') holdAwake() }
    window.addEventListener('beforeunload', warn)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('beforeunload', warn)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [uploading])

  // ── Running a batch ──────────────────────────────────────────
  const run = async (onlyFailed: boolean) => {
    const isAlbum = inAlbum
    const todo = itemsRef.current.filter((it) =>
      onlyFailed ? it.status === 'failed' || (it.status === 'queued' && it.fatal) : it.status === 'queued' || it.status === 'failed'
    )
    if (!todo.length) return
    setUploading(true)
    setNotice([])
    await holdAwake()

    let stopped = false
    const queue = [...todo]
    // Outcomes are tallied here, not read back from state: when the last file
    // finishes, React has not re-rendered yet, so the items in state still show
    // it uploading — which once left a finished batch on screen with no
    // confirmation and no cooldown.
    const outcomes = new Map<string, 'done' | 'failed' | 'stop'>()
    const worker = async () => {
      while (!stopped && queue.length) {
        const it = queue.shift()!
        const outcome = await uploadOne({ ...itemsRef.current.find((x) => x.key === it.key)!, fatal: false }, isAlbum)
        outcomes.set(it.key, outcome)
        if (outcome === 'stop') stopped = true
      }
    }
    await Promise.all(Array.from({ length: Math.min(PARALLEL, todo.length) }, worker))

    releaseAwake()
    setUploading(false)

    const doneNow = [...outcomes.values()].filter((o) => o === 'done').length
    // Files outside this run kept whatever status they had
    const allDone = itemsRef.current.every((it) =>
      outcomes.has(it.key) ? outcomes.get(it.key) === 'done' : it.status === 'done'
    )
    const doneTotal = itemsRef.current.filter((it) =>
      outcomes.has(it.key) ? outcomes.get(it.key) === 'done' : it.status === 'done'
    ).length

    if (doneNow > 0 && limits.cooldownSeconds > 0 && !stopped) setCooldownFor(isAlbum, limits.cooldownSeconds)

    if (allDone) {
      itemsRef.current.forEach((it) => { if (it.thumb?.startsWith('blob:')) URL.revokeObjectURL(it.thumb) })
      setItems([])
      setFinished({ count: doneTotal, album: isAlbum })
    } else if (stopped) {
      // The item that stopped the batch carries the reason; read it after the
      // render that recorded it
      setTimeout(() => {
        const reason = itemsRef.current.find((it) => it.fatal)?.error
        if (reason) setNotice([reason])
      }, 0)
    }
  }

  // Coming back to the page after the phone locked or another app took over:
  // uploads interrupted by that pick up again on their own
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || uploading) return
      if (itemsRef.current.some((it) => it.status === 'failed' && it.session)) run(true)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  })

  // ── Rendering ────────────────────────────────────────────────
  const counts = {
    done: items.filter((i) => i.status === 'done').length,
    failed: items.filter((i) => i.status === 'failed').length,
    total: items.length,
  }
  const totalBytes = items.reduce((n, i) => n + i.file.size, 0)
  const sentBytes = items.reduce((n, i) => n + i.file.size * (i.status === 'done' ? 1 : i.progress), 0)
  const overall = totalBytes ? Math.round((sentBytes / totalBytes) * 100) : 0

  if (finished) {
    return (
      <div className="text-center py-12">
        <div className="text-5xl mb-4">{finished.album ? '💝' : '🎉'}</div>
        <h2 className="text-xl font-serif text-[#7a5c2e] mb-2">
          {finished.album ? '已存入新人相簿' : '上傳成功！'}
        </h2>
        <p className="text-sm text-gray-500 mb-6">
          {finished.album
            ? `${finished.count} 個檔案已悄悄留給新人，不會出現在大螢幕上`
            : `已上傳 ${finished.count} 個檔案，感謝您的分享`}
        </p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={() => setFinished(null)}
            disabled={cooldown > 0}
            className={`px-6 py-2.5 rounded-xl text-sm font-medium transition-colors ${
              cooldown > 0 ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-[#c9a84c] hover:bg-[#b8953d] text-white'
            }`}
          >
            {cooldown > 0 ? `請稍候 ${cooldown} 秒` : '繼續上傳'}
          </button>
          {onViewUploads && (
            <button
              onClick={onViewUploads}
              className="bg-white border border-[#c9a84c] text-[#7a5c2e] hover:bg-[#c9a84c]/10 px-6 py-2.5 rounded-xl text-sm font-medium transition-colors"
            >
              查看我的上傳
            </button>
          )}
        </div>
      </div>
    )
  }

  const canPick = cooldown === 0 && !uploading && items.length < limits.maxFiles

  return (
    <div>
      <h2 className="text-lg font-serif text-[#7a5c2e] mb-4">上傳照片</h2>

      {/* 存入新人相簿 */}
      {album && (
        <div className={`rounded-2xl border p-4 mb-4 transition-colors ${inAlbum ? 'border-[#c9a84c] bg-[#fdf8f0]' : 'border-[#e8d5a3] bg-white'}`}>
          <label className={`flex items-start gap-3 ${albumForced || uploading ? '' : 'cursor-pointer'}`}>
            <input
              type="checkbox"
              checked={inAlbum}
              disabled={albumForced || uploading}
              onChange={(e) => switchMode(e.target.checked)}
              className="mt-1 w-5 h-5 accent-[#c9a84c] shrink-0"
            />
            <span>
              <span className="block text-sm font-medium text-[#7a5c2e]">僅存入新人相簿，不上大螢幕</span>
              <span className="block text-xs text-gray-500 mt-1 leading-relaxed">
                有想私下分享給新人的照片或影片嗎？存進相簿就好，不會出現在大螢幕上。
              </span>
              {albumForced && (
                <span className="block text-xs text-amber-700 mt-1">目前大螢幕投影尚未開放，檔案會存入新人相簿</span>
              )}
            </span>
          </label>
        </div>
      )}

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); if (canPick) setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); if (canPick) addFiles(Array.from(e.dataTransfer.files)) }}
        onClick={() => { if (canPick) fileInputRef.current?.click() }}
        className={`border-2 border-dashed rounded-2xl p-6 text-center transition-all ${
          !canPick
            ? 'border-gray-200 bg-gray-50 cursor-not-allowed'
            : dragging
            ? 'border-[#c9a84c] bg-[#c9a84c]/10 cursor-pointer'
            : 'border-[#e8d5a3] hover:border-[#c9a84c] hover:bg-[#c9a84c]/5 cursor-pointer'
        }`}
      >
        {cooldown > 0 ? (
          <>
            <div className="text-3xl mb-2">⏳</div>
            <p className="text-sm font-medium text-gray-500">請稍候 {cooldown} 秒</p>
            <p className="text-xs text-gray-400 mt-1">為了讓每位賓客都有機會分享，上傳後需要間隔一下</p>
          </>
        ) : (
          <>
            <div className="text-3xl mb-2">{inAlbum ? '💝' : '📸'}</div>
            <p className="text-sm font-medium text-[#7a5c2e]">
              {items.length >= limits.maxFiles ? '已達單次上限' : items.length ? '點擊加入更多' : '點擊或拖曳上傳'}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {inAlbum
                ? `照片 ≤ ${MAX_IMAGE_MB}MB ｜ 影片 ≤ ${MAX_VIDEO_MB}MB`
                : `JPG、PNG、WEBP、HEIC ｜ 單張 ≤ ${MAX_IMAGE_MB}MB`}
            </p>
            <p className="text-xs text-[#c9a84c] mt-1.5 font-medium">
              一次最多 {limits.maxFiles} {inAlbum ? '個檔案' : '張'}
              {limits.cooldownSeconds > 0 && `，上傳後需等待 ${limits.cooldownSeconds} 秒`}
            </p>
          </>
        )}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={inAlbum
            ? 'image/*,video/*,.heic,.heif,.mov'
            : 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif'}
          onChange={(e) => { if (e.target.files) addFiles(Array.from(e.target.files)); e.target.value = '' }}
          className="hidden"
        />
      </div>

      {notice.length > 0 && (
        <div className="mt-3 bg-red-50 border border-red-200 rounded-xl p-3 space-y-0.5">
          {notice.slice(0, 6).map((e, i) => <p key={i} className="text-xs text-red-600">{e}</p>)}
          {notice.length > 6 && <p className="text-xs text-red-400">…另有 {notice.length - 6} 則</p>}
        </div>
      )}

      {items.length > 0 && (
        <div className="mt-4">
          {/* Keep the phone awake */}
          {uploading && (
            <div className="mb-3 rounded-xl bg-amber-50 border border-amber-300 px-3 py-2.5">
              <p className="text-sm font-medium text-amber-800">⚠️ 上傳中，請保持這個畫面開啟</p>
              <p className="text-xs text-amber-700 mt-0.5">不要鎖定手機或切換到其他 App，否則上傳會中斷。</p>
            </div>
          )}

          <div className="flex justify-between items-center text-xs text-gray-500 mb-2">
            <span>
              已選 {counts.total} 個 · {mb(totalBytes)}MB
              {counts.done > 0 && <span className="text-green-600"> · 完成 {counts.done}</span>}
              {counts.failed > 0 && <span className="text-red-500"> · 失敗 {counts.failed}</span>}
            </span>
            {(uploading || counts.done > 0) && <span>{overall}%</span>}
          </div>
          {(uploading || counts.done > 0) && (
            <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden mb-3">
              <div className="h-full bg-[#c9a84c] rounded-full transition-all" style={{ width: `${overall}%` }} />
            </div>
          )}

          <div className="grid grid-cols-3 gap-2">
            {items.map((it) => (
              <div key={it.key} className="relative aspect-square bg-gray-100 rounded-xl overflow-hidden">
                {it.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={it.thumb}
                    alt={it.file.name}
                    loading="lazy"
                    decoding="async"
                    className={`w-full h-full object-cover ${it.status === 'done' ? 'opacity-60' : ''}`}
                    onError={() => patch(it.key, { thumb: null })}
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center bg-gray-800 text-white">
                    <span className="text-2xl">{it.kind === 'video' ? '🎬' : '🖼️'}</span>
                    <span className="text-[10px] mt-1 px-1 truncate w-full text-center opacity-70">{it.file.name}</span>
                  </div>
                )}

                {it.kind === 'video' && it.thumb && (
                  <span className="absolute top-1 left-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded">▶ 影片</span>
                )}

                {/* Status */}
                {it.status === 'uploading' && (
                  <div className="absolute inset-x-0 bottom-0 bg-black/55 px-1.5 py-1">
                    <div className="h-1 bg-white/30 rounded-full overflow-hidden">
                      <div className="h-full bg-[#f5d88a] transition-all" style={{ width: `${Math.round(it.progress * 100)}%` }} />
                    </div>
                    <p className="text-[10px] text-white text-center mt-0.5">{Math.round(it.progress * 100)}%</p>
                  </div>
                )}
                {it.status === 'done' && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="bg-green-500 text-white rounded-full w-8 h-8 flex items-center justify-center text-lg shadow">✓</span>
                  </div>
                )}
                {it.status === 'failed' && (
                  <div className="absolute inset-0 bg-red-900/55 flex flex-col items-center justify-center px-1 text-center">
                    <span className="text-white text-lg">!</span>
                    <span className="text-[10px] text-white leading-tight">{it.error}</span>
                  </div>
                )}
                {it.status === 'queued' && !uploading && (
                  <button
                    onClick={(e) => { e.stopPropagation(); removeItem(it.key) }}
                    aria-label="移除"
                    className="absolute top-1 right-1 bg-black/60 hover:bg-black/80 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm"
                  >
                    ×
                  </button>
                )}
                {it.status === 'queued' && !it.fatal && (
                  <span className="absolute bottom-1 left-1 text-[10px] bg-black/50 text-white rounded px-1 py-0.5">
                    {uploading ? '等待中' : `${mb(it.file.size)}MB`}
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Which files stopped, by name */}
          {counts.failed > 0 && !uploading && (
            <div className="mt-3 bg-red-50 border border-red-200 rounded-xl p-3">
              <p className="text-xs font-medium text-red-700 mb-1">以下檔案沒有上傳成功：</p>
              {items.filter((i) => i.status === 'failed').map((i) => (
                <p key={i.key} className="text-xs text-red-600 truncate">• {i.file.name} — {i.error}</p>
              ))}
            </div>
          )}

          {counts.failed > 0 && !uploading ? (
            <div className="grid grid-cols-2 gap-2 mt-4">
              <button
                onClick={() => run(true)}
                disabled={cooldown > 0}
                className="py-3 rounded-xl font-medium text-sm bg-[#c9a84c] hover:bg-[#b8953d] text-white disabled:bg-gray-200 disabled:text-gray-400"
              >
                重試失敗的 {counts.failed} 個
              </button>
              <button
                onClick={() => setItems((prev) => prev.filter((i) => i.status !== 'failed'))}
                className="py-3 rounded-xl font-medium text-sm bg-white border border-gray-300 text-gray-600"
              >
                略過失敗的
              </button>
            </div>
          ) : (
            <button
              onClick={() => run(false)}
              disabled={uploading || cooldown > 0 || items.every((i) => i.status === 'done')}
              className={`mt-4 w-full py-3 rounded-xl font-medium text-sm transition-all ${
                uploading || cooldown > 0
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-[#c9a84c] hover:bg-[#b8953d] text-white'
              }`}
            >
              {uploading
                ? `上傳中… ${counts.done} / ${counts.total}`
                : cooldown > 0
                ? `請稍候 ${cooldown} 秒`
                : inAlbum
                ? `存入相簿 ${counts.total - counts.done} 個檔案`
                : `上傳 ${counts.total - counts.done} 個檔案`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
