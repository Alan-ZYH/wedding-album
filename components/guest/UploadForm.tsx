'use client'

import { useState, useRef, useCallback, useEffect } from 'react'

interface Props {
  guestId: string
  guestName: string
  onViewUploads?: () => void
  /** Guests are capped at 3 per batch; the couple's own uploads are not. */
  maxFiles?: number
  /** Seconds to wait after a batch. 0 disables the cooldown entirely. */
  cooldownSeconds?: number
}

interface FileWithPreview {
  file: File
  preview: string
}

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
const MAX_IMAGE_SIZE = 50 * 1024 * 1024   // 50 MB
const MAX_FILES = 3            // guest default
const COOLDOWN_SECONDS = 30    // guest default: wait after each completed batch

function validateFile(file: File): string | null {
  if (ALLOWED_IMAGE_TYPES.includes(file.type)) {
    if (file.size > MAX_IMAGE_SIZE) return `${file.name}：圖片超過 50MB`
    return null
  }
  // HEIC by extension
  if (file.name.toLowerCase().endsWith('.heic') || file.name.toLowerCase().endsWith('.heif')) {
    return null
  }
  return `${file.name}：不支援的格式（僅接受照片）`
}

export default function UploadForm({
  guestId,
  guestName,
  onViewUploads,
  maxFiles = MAX_FILES,
  cooldownSeconds = COOLDOWN_SECONDS,
}: Props) {
  const [files, setFiles] = useState<FileWithPreview[]>([])
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [successCount, setSuccessCount] = useState(0)
  const [errors, setErrors] = useState<string[]>([])
  const [done, setDone] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  // Cooldown: seconds left before another batch may be uploaded
  const [cooldown, setCooldown] = useState(0)

  // Tick the cooldown down to zero
  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  const addFiles = useCallback(async (newFiles: File[]) => {
    const combined = [...files]
    const errs: string[] = []

    for (const f of newFiles) {
      if (combined.length >= maxFiles) {
        errs.push(`最多只能選 ${maxFiles} 個檔案`)
        break
      }
      const err = validateFile(f)
      if (err) { errs.push(err); continue }
      combined.push({ file: f, preview: URL.createObjectURL(f) })
    }

    setFiles(combined)
    if (errs.length) setErrors(errs)
  }, [files, maxFiles])

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
      const { file } = files[i]

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
          // Server is the source of truth for the cooldown / block state
          if (typeof initData.remaining === 'number') setCooldown(initData.remaining)
          errs.push(initData.error || `${file.name}：初始化失敗`)
          if (initData.reason === 'blocked' || initData.reason === 'cooldown') break
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
            fileType: 'photo',
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
      if (cooldownSeconds > 0) setCooldown(cooldownSeconds)
    }
    setUploading(false)
  }

  if (done && successCount > 0) {
    return (
      <div className="text-center py-12">
        <div className="text-5xl mb-4">🎉</div>
        <h2 className="text-xl font-serif text-[#7a5c2e] mb-2">上傳成功！</h2>
        <p className="text-sm text-gray-500 mb-6">已上傳 {successCount} 個檔案，感謝您的分享</p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={() => { setDone(false); setSuccessCount(0); setProgress(0) }}
            disabled={cooldown > 0}
            className={`px-6 py-2.5 rounded-xl text-sm font-medium transition-colors ${
              cooldown > 0
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : 'bg-[#c9a84c] hover:bg-[#b8953d] text-white'
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

  return (
    <div>
      <h2 className="text-lg font-serif text-[#7a5c2e] mb-4">上傳照片</h2>

      {/* Drop zone */}
      <div
        ref={dragRef}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => { if (cooldown === 0) fileInputRef.current?.click() }}
        className={`border-2 border-dashed rounded-2xl p-8 text-center transition-all ${
          cooldown > 0
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
            <div className="text-3xl mb-2">📸</div>
            <p className="text-sm font-medium text-[#7a5c2e]">點擊或拖曳上傳</p>
            <p className="text-xs text-gray-400 mt-1">
              JPG、PNG、WEBP、HEIC ｜ 單張 ≤ 50MB
            </p>
            {cooldownSeconds > 0 ? (
              <p className="text-xs text-[#c9a84c] mt-1.5 font-medium">
                一次最多 {maxFiles} 張，上傳後需等待 {cooldownSeconds} 秒
              </p>
            ) : (
              <p className="text-xs text-[#c9a84c] mt-1.5 font-medium">
                一次最多 {maxFiles} 張
              </p>
            )}
          </>
        )}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
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
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={f.preview}
                  alt={f.file.name}
                  className="w-full h-full object-cover"
                />
                <button
                  onClick={(e) => { e.stopPropagation(); removeFile(i) }}
                  className="absolute top-1 right-1 bg-black/60 hover:bg-black/80 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs transition-colors"
                >
                  ×
                </button>
                <div className="absolute bottom-1 left-1 right-1">
                  <span className="text-xs bg-black/50 text-white rounded px-1 py-0.5">
                    📷 {(f.file.size / 1024 / 1024).toFixed(1)}MB
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
            disabled={uploading || cooldown > 0}
            className={`mt-4 w-full py-3 rounded-xl font-medium text-sm transition-all ${
              uploading || cooldown > 0
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : 'bg-[#c9a84c] hover:bg-[#b8953d] text-white'
            }`}
          >
            {uploading ? '上傳中...'
              : cooldown > 0 ? `請稍候 ${cooldown} 秒`
              : `上傳 ${files.length} 個檔案`}
          </button>
        </div>
      )}
    </div>
  )
}
