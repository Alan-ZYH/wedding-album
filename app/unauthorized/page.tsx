export default function UnauthorizedPage() {
  return (
    <div className="min-h-screen bg-[#0f0f0f] flex items-center justify-center px-4">
      <div className="text-center">
        <div className="text-6xl mb-6">🔒</div>
        <h1 className="text-2xl font-serif text-[#c9a84c] mb-3">無法存取此頁面</h1>
        <div className="flex items-center gap-3 justify-center text-[#c9a84c]/40 mb-6">
          <span className="h-px w-12 bg-[#c9a84c]/30"></span>
          <span className="text-xs tracking-widest">UNAUTHORIZED</span>
          <span className="h-px w-12 bg-[#c9a84c]/30"></span>
        </div>
        <p className="text-gray-400 text-sm max-w-xs mx-auto">
          請使用主辦人提供的 QR Code 或邀請連結進入
        </p>
      </div>
    </div>
  )
}
