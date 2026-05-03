'use client'

import { useState, useRef, useCallback } from 'react'

interface Props {
  guestId: string
  guestName: string
}

interface FileWithPreview {
  file: File
  preview: string
  type: 'image' | 'video'
}

// ── FFmpeg singleton ─────────────────────────────────────────────────────────
// Loaded lazily on first .mov upload. The WASM (~30 MB) is fetched from CDN
// and cached by the browser — subsequent conversions start instantly.

type FFmpegInstance = import('@ffmpeg/ffmpeg').FFmpeg
let _ffmpeg: FFmpegInstance | null = null
let _ffmpegLoading: Promise<FFmpegInstance> | null = null

async function getFFmpeg(): Promise<FFmpegInstance> {
  if (_ffmpeg) return _ffmpeg
  if (_ffmpegLoading) return _ffmpegLoading

  _ffmpegLoading = (async () => {
    const { FFmpeg } = await import('@ffmpeg/ffmpeg')
    const { toBlobURL } = await import('@ffmpeg/util')
    const instance = new FFmpeg()
    const base = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd'
    await instance.load({
      coreURL:  await toBlobURL(`${base}/ffmpeg-core.js`,   'text/javascript'),
      wasmURL:  await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
    })
    _ffmpeg = instance
    return instance
  })()

  return _ffmpegLoading
}

/**
 * Convert a .mov file to H.264 MP4 using FFmpeg WASM (runs entirely in browser).
 * onProgress receives 0–100.
 */
async function convertMovToMp4(
  file: File,
  onProgress: (pct: number) => void,
): Promise<File> {
  const { fetchFile } = await import('@ffmpeg/util')
  const ffmpeg = await getFFmpeg()

  // Attach progress listener
  const handler = ({ progress }: { progress: number }) =>
    onProgress(Math.min(99, Math.round(progress * 100)))
  ffmpeg.on('progress', handler)

  try {
    await ffmpeg.writeFile('input.mov', await fetchFile(file))
    await ffmpeg.exec([
      '-i', 'input.mov',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',   // fastest encode, acceptable quality for 8 s clips
      '-crf', '23',
      '-c:a', 'aac',
      '-movflags', '+faststart', // metadata first → instant web playback
      'output.mp4',
    ])
    const rawData = await ffmpeg.readFile('output.mp4')
    // readFile returns Uint8Array<ArrayBufferLike> | string.
    // .slice() produces Uint8Array<ArrayBuffer> which is accepted by the Blob constructor.
    const arr = (rawData instanceof Uint8Array
      ? rawData
      : new TextEncoder().encode(rawData as string)
    ).slice()
    const blob = new Blob([arr], { type: 'video/mp4' })
    onProgress(100)
    const newName = file.name.replace(/\.mov$/i, '.mp4')
    return new File([blob], newName, { type: 'video/mp4' })
  } finally {
    ffmpeg.off('progress', handler)
    // Clean up temp files to free WASM memory
    ffmpeg.deleteFile('input.mov').catch(() => {})
    ffmpeg.deleteFile('output.mp4').catch(() => {})
  }
}

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime']
const MAX_IMAGE_SIZE = 50 * 1024 * 1024   // 50 MB
const MAX_VIDEO_SIZE = 500 * 1024 * 1024  // 500 MB (duration enforced separately)
const MAX_VIDEO_DURATION = 8              // seconds
const MAX_FILES = 20

function validateFile(file: File): string | null {
  if (ALLOWED_IMAGE_TYPES.includes(file.type)) {
    if (file.size > MAX_IMAGE_SIZE) return `${file.name}：圖片超過 50MB`
    return null
  }
  if (ALLOWED_VIDEO_TYPES.includes(file.type)) {
    if (file.size > MAX_VIDEO_SIZE) return `${file.name}：影片超過 500MB`
    return null
  }
  // HEIC by extension
  if (file.name.toLowerCase().endsWith('.heic') || file.name.toLowerCase().endsWith('.heif')) {
    return null
  }
  return `${file.name}：不支援的格式`
}

// Returns a promise that resolves to an error string, or null if OK
function checkVideoDuration(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url)
      // Allow up to 8.9 s to cover iOS encoding overhead on 8-second clips
      if (video.duration > 8.9) {
        resolve(`${file.name}：影片超過 ${MAX_VIDEO_DURATION} 秒（目前 ${Math.round(video.duration)} 秒）`)
      } else {
        resolve(null)
      }
    }
    video.onerror = () => { URL.revokeObjectURL(url); resolve(null) } // allow if can't read
    video.src = url
  })
}

/** Returns true for .mov / video/quicktime files that should be auto-converted. */
function isMov(file: File): boolean {
  return file.type === 'video/quicktime' || file.name.toLowerCase().endsWith('.mov')
}

export default function UploadForm({ guestId, guestName }: Props) {
  const [files, setFiles] = useState<FileWithPreview[]>([])
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [successCount, setSuccessCount] = useState(0)
  const [errors, setErrors] = useState<string[]>([])
  const [done, setDone] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  // FFmpeg conversion state
  const [converting, setConverting] = useState(false)
  const [convertProgress, setConvertProgress] = useState(0)
  const [convertingName, setConvertingName] = useState('')

  const addFiles = useCallback(async (newFiles: File[]) => {
    const combined = [...files]
    const errs: string[] = []

    for (const f of newFiles) {
      if (combined.length >= MAX_FILES) {
        errs.push(`最多只能選 ${MAX_FILES} 個檔案`)
        break
      }
      const err = validateFile(f)
      if (err) { errs.push(err); continue }

      const isImage = ALLOWED_IMAGE_TYPES.includes(f.type) ||
                      !!f.name.toLowerCase().match(/\.(jpg|jpeg|png|webp|heic|heif)$/)
      const isVideo = ALLOWED_VIDEO_TYPES.includes(f.type) ||
                      !!f.name.toLowerCase().match(/\.(mp4|mov)$/)

      // Auto-convert .mov → MP4 before duration check (HEVC codec fix)
      let fileToAdd = f
      if (isVideo && isMov(f)) {
        setConverting(true)
        setConvertingName(f.name)
        setConvertProgress(0)
        try {
          fileToAdd = await convertMovToMp4(f, setConvertProgress)
        } catch (e) {
          console.error('FFmpeg conversion failed:', e)
          errs.push(`${f.name}：自動轉檔失敗，請改用 .mp4 格式上傳`)
          setConverting(false)
          continue
        } finally {
          setConverting(false)
          setConvertProgress(0)
          setConvertingName('')
        }
      }

      // Check video duration (client-side, async)
      if (isVideo) {
        const durationErr = await checkVideoDuration(fileToAdd)
        if (durationErr) { errs.push(durationErr); continue }
      }

      const preview = isImage ? URL.createObjectURL(fileToAdd) : ''
      combined.push({ file: fileToAdd, preview, type: isImage ? 'image' : 'video' })
    }

    setFiles(combined)
    if (errs.length) setErrors(errs)
  }, [files])

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) await addFiles(Array.from(e.target.files))
    e.target.value = '' // allow re-selecting same file
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (e.dataTransfer.files) await addFiles(Array.from(e.dataTransfer.files))
  }

  const removeFile = (index: number) => {
    const updated = [...files]
    URL.revokeObjectURL(updated[index].preview)
    updated.splice(index, 1)
    setFiles(updated)
  }

  const handleUpload = async () => {
    if (files.length === 0) return
    setUploading(true)
    setProgress(0)
    setErrors([])
    setDone(false)

    const errs: string[] = []
    let succeeded = 0

    for (let i = 0; i < files.length; i++) {
      const { file, type } = files[i]
      const fileType = type === 'image' ? 'photo' : 'video'

      try {
        // ── Step 1: Ask server to create a Google Drive resumable session ──
        const initRes = await fetch('/api/upload/init', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            guestId,
            guestNameRaw: guestName,
            mimeType: file.type,
            fileSize: file.size,
            originalName: file.name,
          }),
        })
        const initData = await initRes.json()
        if (!initData.success) {
          errs.push(initData.error || `${file.name}：初始化失敗`)
          continue
        }
        const { uploadUrl, mediaId, fileName } = initData

        // ── Step 2: Upload directly to Google Drive (bypasses Vercel) ──
        // Note: Google Drive CORS policy may block reading the response body,
        // but the upload itself succeeds (server returns 200). We proceed
        // regardless and let the server find the file by name.
        try {
          await fetch(uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Type': file.type },
            body: file,
          })
        } catch {
          // ERR_FAILED with 200 is a known CORS issue with Drive service-account uploads.
          // The file IS uploaded — continue to the complete step.
        }

        // ── Step 3: Server finds the file by name, sets it public, saves to Firestore ──
        const completeRes = await fetch('/api/upload/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mediaId,
            guestId,
            guestName,
            fileName,   // server uses this to look up the Drive file
            mimeType: file.type,
            fileSize: file.size,
            fileType,
          }),
        })
        const completeData = await completeRes.json()
        if (!completeData.success) {
          errs.push(completeData.error || `${file.name}：儲存失敗`)
          continue
        }

        succeeded++
      } catch (err) {
        console.error('Upload error', err)
        errs.push(`${file.name}：網路錯誤，請重試`)
      }

      // Update progress bar per-file
      setProgress(Math.round(((i + 1) / files.length) * 100))
    }

    setSuccessCount(succeeded)
    if (errs.length) setErrors(errs)
    if (succeeded > 0) {
      setDone(true)
      setFiles([])
    }
    setUploading(false)
  }

  if (done && successCount > 0) {
    return (
      <div className="text-center py-12">
        <div className="text-5xl mb-4">🎉</div>
        <h2 className="text-xl font-serif text-[#7a5c2e] mb-2">上傳成功！</h2>
        <p className="text-sm text-gray-500 mb-6">已上傳 {successCount} 個檔案，感謝您的分享</p>
        <button
          onClick={() => { setDone(false); setSuccessCount(0); setProgress(0) }}
          className="bg-[#c9a84c] hover:bg-[#b8953d] text-white px-6 py-2.5 rounded-xl text-sm font-medium transition-colors"
        >
          繼續上傳
        </button>
      </div>
    )
  }

  return (
    <div>
      <h2 className="text-lg font-serif text-[#7a5c2e] mb-4">上傳照片 / 影片</h2>

      {/* Drop zone */}
      <div
        ref={dragRef}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${
          dragging
            ? 'border-[#c9a84c] bg-[#c9a84c]/10'
            : 'border-[#e8d5a3] hover:border-[#c9a84c] hover:bg-[#c9a84c]/5'
        }`}
      >
        <div className="text-3xl mb-2">📸</div>
        <p className="text-sm font-medium text-[#7a5c2e]">點擊或拖曳上傳</p>
        <p className="text-xs text-gray-400 mt-1">
          JPG、PNG、WEBP、HEIC、MP4、MOV
        </p>
        <p className="text-xs text-gray-400">
          圖片 ≤ 50MB ｜ 影片 ≤ {MAX_VIDEO_DURATION} 秒 ｜ 最多 {MAX_FILES} 個
        </p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,video/mp4,video/quicktime,.heic,.heif,.mov"
          onChange={handleFileInput}
          className="hidden"
        />
      </div>

      {/* Error messages */}
      {errors.length > 0 && (
        <div className="mt-3 bg-red-50 border border-red-200 rounded-xl p-3">
          {errors.map((e, i) => (
            <p key={i} className="text-xs text-red-600">{e}</p>
          ))}
        </div>
      )}

      {/* FFmpeg converting overlay */}
      {converting && (
        <div className="mt-4 bg-[#fdf8ef] border border-[#e8d5a3] rounded-2xl p-5 text-center">
          <div className="text-3xl mb-2 animate-spin">⚙️</div>
          <p className="text-sm font-medium text-[#7a5c2e] mb-1">正在轉換影片格式…</p>
          <p className="text-xs text-gray-400 truncate mb-3">{convertingName}</p>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-[#c9a84c] rounded-full transition-all duration-300"
              style={{ width: `${convertProgress}%` }}
            />
          </div>
          <p className="text-xs text-gray-400 mt-1.5">{convertProgress}%（請稍候，勿關閉頁面）</p>
        </div>
      )}

      {/* Preview grid */}
      {!converting && files.length > 0 && (
        <div className="mt-4">
          <p className="text-xs text-gray-500 mb-2">已選擇 {files.length} 個檔案</p>
          <div className="grid grid-cols-3 gap-2">
            {files.map((f, i) => (
              <div key={i} className="relative aspect-square bg-gray-100 rounded-xl overflow-hidden">
                {f.type === 'image' ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={f.preview}
                    alt={f.file.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center bg-gray-800">
                    <span className="text-2xl">🎬</span>
                    <span className="text-xs text-white mt-1 px-1 text-center truncate w-full text-center">
                      {f.file.name}
                    </span>
                  </div>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); removeFile(i) }}
                  className="absolute top-1 right-1 bg-black/60 hover:bg-black/80 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs transition-colors"
                >
                  ×
                </button>
                <div className="absolute bottom-1 left-1 right-1">
                  <span className="text-xs bg-black/50 text-white rounded px-1 py-0.5">
                    {f.type === 'image' ? '📷' : '🎬'} {(f.file.size / 1024 / 1024).toFixed(1)}MB
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Upload progress */}
          {uploading && (
            <div className="mt-4">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>上傳中...</span>
                <span>{progress}%</span>
              </div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#c9a84c] rounded-full upload-progress"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {/* Upload button */}
          <button
            onClick={handleUpload}
            disabled={uploading || converting}
            className={`mt-4 w-full py-3 rounded-xl font-medium text-sm transition-all ${
              uploading || converting
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : 'bg-[#c9a84c] hover:bg-[#b8953d] text-white'
            }`}
          >
            {uploading ? '上傳中...' : `上傳 ${files.length} 個檔案`}
          </button>
        </div>
      )}
    </div>
  )
}
