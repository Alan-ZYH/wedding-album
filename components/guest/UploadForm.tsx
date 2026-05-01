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
const MAX_IMAGE_SIZE = 20 * 1024 * 1024
const MAX_VIDEO_SIZE = 300 * 1024 * 1024
const MAX_FILES = 20

function validateFile(file: File): string | null {
  if (ALLOWED_IMAGE_TYPES.includes(file.type)) {
    if (file.size > MAX_IMAGE_SIZE) return `${file.name}：圖片超過 20MB`
    return null
  }
  if (ALLOWED_VIDEO_TYPES.includes(file.type)) {
    if (file.size > MAX_VIDEO_SIZE) return `${file.name}：影片超過 300MB`
    return null
  }
  // HEIC by extension
  if (file.name.toLowerCase().endsWith('.heic') || file.name.toLowerCase().endsWith('.heif')) {
    return null
  }
  return `${file.name}：不支援的格式`
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

  const addFiles = useCallback((newFiles: File[]) => {
    const combined = [...files]
    const errs: string[] = []

    for (const f of newFiles) {
      if (combined.length >= MAX_FILES) {
        errs.push(`最多只能選 ${MAX_FILES} 個檔案`)
        break
      }
      const err = validateFile(f)
      if (err) {
        errs.push(err)
        continue
      }
      const isImage = ALLOWED_IMAGE_TYPES.includes(f.type) ||
                      f.name.toLowerCase().match(/\.(jpg|jpeg|png|webp|heic|heif)$/)
      const preview = isImage ? URL.createObjectURL(f) : ''
      combined.push({ file: f, preview, type: isImage ? 'image' : 'video' })
    }

    setFiles(combined)
    if (errs.length) setErrors(errs)
  }, [files])

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(Array.from(e.target.files))
    e.target.value = '' // allow re-selecting same file
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (e.dataTransfer.files) addFiles(Array.from(e.dataTransfer.files))
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

    const formData = new FormData()
    formData.append('guestId', guestId)
    formData.append('guestName', guestName)
    files.forEach((f) => formData.append('files', f.file))

    try {
      // Simulate progress
      const progressInterval = setInterval(() => {
        setProgress((p) => Math.min(p + 5, 90))
      }, 500)

      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      })

      clearInterval(progressInterval)
      setProgress(100)

      const data = await res.json()

      if (data.results) {
        const succeeded = data.results.filter((r: { success: boolean }) => r.success).length
        const failed = data.results
          .filter((r: { success: boolean; error?: string }) => !r.success)
          .map((r: { error?: string }) => r.error || '上傳失敗')
        setSuccessCount(succeeded)
        if (failed.length) setErrors(failed)
      }

      if (data.success || (data.results && data.results.some((r: { success: boolean }) => r.success))) {
        setDone(true)
        setFiles([])
      }
    } catch {
      setErrors(['網路錯誤，請重試'])
    } finally {
      setUploading(false)
    }
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
          圖片 ≤ 20MB ｜ 影片 ≤ 300MB ｜ 最多 {MAX_FILES} 個
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
