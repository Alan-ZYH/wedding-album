'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Media, Message, DEFAULT_SETTINGS } from '@/types'
import QrCodePanel from '@/components/admin/QrCodePanel'

/**
 * Straight into Google Drive, where the originals actually are. The folder ids
 * come from an admin-only API rather than the bundle: this repo is public, and
 * a folder id is the whole address of the album.
 */
function DriveLinks() {
  const [links, setLinks] = useState<{ photos: string; videos: string; backup: string | null } | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    fetch('/api/admin/drive-links')
      .then((r) => r.json())
      .then((d) => (d.success ? setLinks(d.data) : setFailed(true)))
      .catch(() => setFailed(true))
  }, [])

  if (failed) return <p className="text-xs text-gray-400">雲端連結讀取失敗</p>
  if (!links) return <p className="text-xs text-gray-400">讀取中…</p>

  const items = [
    { label: '照片原檔', href: links.photos, hint: '賓客上傳的原始照片' },
    { label: '備份相本', href: links.backup, hint: '每小時自動備份的副本' },
  ].filter((i) => i.href)

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((i) => (
        <a
          key={i.label}
          href={i.href!}
          target="_blank"
          rel="noopener noreferrer"
          title={i.hint}
          className="flex items-center gap-2 px-3 py-2 rounded-xl border border-[#e8d5a3] bg-[#fdf8f0] hover:bg-[#f8f0dd] transition-colors"
        >
          <span>📁</span>
          <span className="text-sm text-[#7a5c2e]">{i.label}</span>
          <span className="text-xs text-gray-400">↗</span>
        </a>
      ))}
    </div>
  )
}

function CopyUrlRow({ label, path }: { label: string; path: string }) {
  const [copied, setCopied] = useState(false)
  const [url, setUrl] = useState('')
  useEffect(() => { setUrl(`${window.location.origin}${path}`) }, [path])
  const copy = () => {
    navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-16 text-gray-500 shrink-0">{label}</span>
      <code className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-700 truncate">{url}</code>
      <button
        onClick={copy}
        className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${copied ? 'bg-green-500 text-white' : 'bg-[#c9a84c] hover:bg-[#b8953d] text-white'}`}
      >
        {copied ? '✓ 已複製' : '複製'}
      </button>
    </div>
  )
}

export default function DashboardPage() {
  const [media, setMedia] = useState<Media[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [albumName, setAlbumName] = useState(DEFAULT_SETTINGS.albumName)

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d) => { if (d.success && d.data?.albumName) setAlbumName(d.data.albumName) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    Promise.all([
      fetch('/api/media').then((r) => r.json()),
      fetch('/api/messages').then((r) => r.json()),
    ]).then(([mediaData, msgData]) => {
      if (mediaData.success) setMedia(mediaData.data)
      if (msgData.success) setMessages(msgData.data)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const photos = media.filter((m) => m.fileType === 'photo' && m.status !== 'deleted')
  const videos = media.filter((m) => m.fileType === 'video' && m.status !== 'deleted')
  const pending = media.filter((m) => !m.approved && m.status === 'active')
  const activeMessages = messages.filter((m) => m.status === 'active')
  const recentMedia = [...media]
    .filter((m) => m.status !== 'deleted')
    .sort((a, b) => new Date(b.uploadTime).getTime() - new Date(a.uploadTime).getTime())
    .slice(0, 8)

  const stats = [
    { label: '照片', value: photos.length, icon: '📷', href: '/admin/media?type=photo' },
    { label: '影片', value: videos.length, icon: '🎬', href: '/admin/media?type=video' },
    { label: '待審核', value: pending.length, icon: '⏳', href: '/admin/media?pending=true' },
    { label: '祝福', value: activeMessages.length, icon: '💌', href: '/admin/messages' },
  ]

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-400 text-sm">載入中...</p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-serif text-gray-800">概覽</h1>
          <p className="text-sm text-gray-400 mt-0.5">Dashboard</p>
        </div>
      </div>

      <QrCodePanel albumName={albumName} />

      {/* Access URLs */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-6">
        <h2 className="text-base font-medium text-gray-700 mb-3 flex items-center gap-2">
          <span>🔗</span> 入口連結
        </h2>
        <div className="space-y-2">
          <CopyUrlRow
            label="賓客端"
            path="/guest"
          />
          <CopyUrlRow
            label="投放端"
            path="/display"
          />
        </div>
        <p className="text-xs text-gray-400 mt-3">將賓客端連結製成 QR Code 印在婚禮現場；投放端連結僅供工作人員使用</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {stats.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="bg-white rounded-2xl border border-gray-200 p-4 hover:border-[#c9a84c] transition-colors"
          >
            <div className="text-2xl mb-1">{s.icon}</div>
            <div className="text-2xl font-bold text-gray-800">{s.value}</div>
            <div className="text-sm text-gray-500">{s.label}</div>
          </Link>
        ))}
      </div>

      {/* Google Drive */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-6">
        <h2 className="font-medium text-gray-700 mb-3">雲端硬碟</h2>
        <DriveLinks />
      </div>

      {/* Pending approval alert */}
      {pending.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-4 mb-6 flex justify-between items-center">
          <div>
            <p className="text-sm font-medium text-yellow-800">有 {pending.length} 個媒體待審核</p>
            <p className="text-xs text-yellow-600 mt-0.5">審核通過後才會在投放端顯示</p>
          </div>
          <Link
            href="/admin/media?pending=true"
            className="text-xs bg-yellow-500 text-white px-3 py-1.5 rounded-lg hover:bg-yellow-600 transition-colors"
          >
            立即審核
          </Link>
        </div>
      )}

      {/* Recent uploads */}
      {recentMedia.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-medium text-gray-700">最新上傳</h2>
            <Link href="/admin/media" className="text-xs text-[#c9a84c] hover:underline">
              查看全部
            </Link>
          </div>
          <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
            {recentMedia.map((item) => (
              <div
                key={item.id}
                className="aspect-square bg-gray-100 rounded-lg overflow-hidden relative"
              >
                {item.fileType === 'photo' ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.thumbnailUrl}
                    alt={item.guestName}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gray-800 text-xl">
                    🎬
                  </div>
                )}
                {!item.approved && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <span className="text-yellow-400 text-xs">待審</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
