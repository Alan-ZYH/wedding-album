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
  error?: string
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
      if (video.duration > MAX_VIDEO_DURATION) {
        resolve(`${file.name}：影片超過 ${MAX_VIDEO_DURATION} 秒（目前 ${Math.round(video.duration)} 秒）`)
      } else {
        resolve(null)
      }
    }
    video.onerror = () => { URL.revokeObjectURL(url); resolve(null) } // allow if can't read
    video.src = url
  })
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

      // Check video duration (client-side, async)
      if (isVideo) {
        const durationErr = await checkVideoDuration(f)
        if (durationErr) { errs.push(durationErr); continue }
      }

      const preview = isImage ? URL.createObjectURL(f) : ''
      combined.push({ file: f, preview, type: isImage ? 'image' : 'video' })
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

      {/* Preview grid */}
      {files.length > 0 && (
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
            disabled={uploading}
            className={`mt-4 w-full py-3 rounded-xl font-medium text-sm transition-all ${
              uploading
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
