'use client'

import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    // Skip auth check on login page
    if (pathname === '/admin/login') {
      setChecking(false)
      return
    }

    fetch('/api/auth/verify')
      .then((r) => {
        if (!r.ok) router.replace('/admin/login')
        else setChecking(false)
      })
      .catch(() => router.replace('/admin/login'))
  }, [pathname, router])

  if (pathname === '/admin/login') return <>{children}</>
  if (checking) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 text-sm">驗證中...</p>
      </div>
    )
  }

  const navItems = [
    { href: '/admin/dashboard', label: '概覽', icon: '📊' },
    { href: '/admin/media', label: '媒體', icon: '🖼️' },
    { href: '/admin/messages', label: '祝福', icon: '💌' },
    { href: '/admin/settings', label: '設定', icon: '⚙️' },
  ]

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/admin/login')
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <aside className="w-56 bg-white border-r border-gray-200 flex flex-col">
        <div className="px-4 py-5 border-b border-gray-200">
          <h1 className="text-base font-serif text-[#7a5c2e]">婚禮管理後台</h1>
          <p className="text-xs text-gray-400 mt-0.5">Wedding Admin</p>
        </div>

        <nav className="flex-1 py-4 px-2">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm mb-1 transition-colors ${
                pathname.startsWith(item.href)
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
          <div className="flex gap-2 mb-3">
            <Link
              href="/guest"
              target="_blank"
              className="flex-1 text-center text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 py-1.5 rounded-lg transition-colors"
            >
              賓客端
            </Link>
            <Link
              href="/display"
              target="_blank"
              className="flex-1 text-center text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 py-1.5 rounded-lg transition-colors"
            >
              投放端
            </Link>
          </div>
          <button
            onClick={handleLogout}
            className="w-full text-xs text-gray-500 hover:text-red-500 py-1.5 transition-colors"
          >
            登出
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto p-6">{children}</main>
    </div>
  )
}
