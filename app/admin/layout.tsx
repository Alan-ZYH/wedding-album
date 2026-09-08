'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'

const NAV = [
  { href: '/admin/dashboard', label: '概覽', icon: '📊' },
  { href: '/admin/upload', label: '上傳', icon: '⬆️' },
  { href: '/admin/media', label: '媒體', icon: '🖼️' },
  { href: '/admin/messages', label: '祝福', icon: '💌' },
  { href: '/admin/guests', label: '賓客', icon: '👥' },
  { href: '/admin/settings', label: '設定', icon: '⚙️' },
]

/**
 * Two shapes for one panel.
 *
 * On a phone the couple is holding it one-handed between courses, so the nav
 * sits at the bottom within thumb reach and the content gets the full width —
 * a 224px sidebar left barely more than half a screen for the photo grid.
 * From md up the sidebar returns, which is what a laptop at the venue wants.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isActive = (href: string) => pathname.startsWith(href)

  return (
    <div className="min-h-[100dvh] bg-gray-50 md:flex">
      {/* Phone: title bar */}
      <header className="md:hidden sticky top-0 z-20 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <h1 className="text-base font-serif text-[#7a5c2e]">婚禮管理後台</h1>
        <div className="flex gap-2">
          <Link href="/guest" target="_blank" className="text-xs bg-gray-100 text-gray-600 px-2.5 py-1.5 rounded-lg">賓客端</Link>
          <Link href="/display" target="_blank" className="text-xs bg-gray-100 text-gray-600 px-2.5 py-1.5 rounded-lg">投放端</Link>
        </div>
      </header>

      {/* Desktop: sidebar */}
      <aside className="hidden md:flex w-56 shrink-0 bg-white border-r border-gray-200 flex-col">
        <div className="px-4 py-5 border-b border-gray-200">
          <h1 className="text-base font-serif text-[#7a5c2e]">婚禮管理後台</h1>
          <p className="text-xs text-gray-400 mt-0.5">Wedding Admin</p>
        </div>

        <nav className="flex-1 py-4 px-2">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm mb-1 transition-colors ${
                isActive(item.href)
                  ? 'bg-[#c9a84c]/10 text-[#7a5c2e] font-medium'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <span>{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="px-4 py-4 border-t border-gray-200">
          <div className="flex gap-2">
            <Link href="/guest" target="_blank" className="flex-1 text-center text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 py-1.5 rounded-lg transition-colors">賓客端</Link>
            <Link href="/display" target="_blank" className="flex-1 text-center text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 py-1.5 rounded-lg transition-colors">投放端</Link>
          </div>
        </div>
      </aside>

      {/* Bottom padding on phones clears the tab bar and the home indicator */}
      <main className="flex-1 min-w-0 p-4 md:p-6 pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))] md:pb-6">
        {children}
      </main>

      {/* Phone: bottom tabs */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-20 bg-white border-t border-gray-200 flex"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-[11px] transition-colors ${
              isActive(item.href) ? 'text-[#7a5c2e] font-medium' : 'text-gray-400'
            }`}
          >
            <span className="text-lg leading-none">{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  )
}
