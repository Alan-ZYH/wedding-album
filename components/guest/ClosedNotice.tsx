import { CLOSED_MESSAGE } from '@/lib/guest-access'

/** Shown in place of a form the couple has not opened yet. */
export default function ClosedNotice({ title }: { title: string }) {
  return (
    <div>
      <h2 className="text-lg font-serif text-[#7a5c2e] mb-4">{title}</h2>
      <div className="bg-white rounded-2xl border border-[#e8d5a3] px-6 py-14 text-center">
        <div className="text-4xl mb-4">💐</div>
        <p className="text-base font-serif text-[#7a5c2e] leading-relaxed">{CLOSED_MESSAGE}</p>
      </div>
    </div>
  )
}
