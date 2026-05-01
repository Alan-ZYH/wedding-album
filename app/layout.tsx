import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '婚禮紀念相簿',
  description: '上傳您的祝福與照片，一起見證幸福時刻',
  viewport: 'width=device-width, initial-scale=1, maximum-scale=1',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-TW">
      <body className="antialiased">{children}</body>
    </html>
  )
}
