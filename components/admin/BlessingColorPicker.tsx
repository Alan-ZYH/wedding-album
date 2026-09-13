'use client'

import { BLESSING_COLORS } from '@/lib/blessing-colors'

/**
 * Chooses the plate for the blessing about to be sent — or none, so it looks
 * like any guest's. The choice belongs to that one blessing: it is written into
 * the message when sent and never changes afterwards.
 */
export default function BlessingColorPicker({
  name,
  color,
  onChange,
}: {
  name: string
  color: string | null
  onChange: (c: string | null) => void
}) {
  return (
    <div>
      {/* Previewed on the projection's dark ground, not the admin's white page */}
      <div className="bg-gray-900 rounded-lg py-5 px-3 flex justify-center mb-3">
        {color ? (
          <span
            className="px-5 py-2 rounded-full text-base font-medium"
            style={{
              backgroundColor: `${color}26`,
              color,
              border: `1px solid ${color}66`,
              boxShadow: `0 0 20px ${color}40`,
            }}
          >
            {name || '新人'}：新婚快樂
          </span>
        ) : (
          <span
            className="text-base"
            style={{ color: '#fff8dc', fontFamily: 'Georgia, serif', textShadow: '1px 1px 3px rgba(0,0,0,0.8)' }}
          >
            {name || '新人'}：新婚快樂
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => onChange(null)}
          title="不要色塊，和賓客的祝福一樣"
          className={`h-9 px-3 rounded-full border-2 text-xs transition-colors ${
            color === null ? 'border-gray-800 text-gray-800 font-medium' : 'border-gray-200 text-gray-500 hover:border-gray-300'
          }`}
        >
          不要
        </button>
        {BLESSING_COLORS.map((c) => (
          <button
            key={c.hex}
            type="button"
            onClick={() => onChange(c.hex)}
            title={c.name}
            className={`w-9 h-9 rounded-full border-2 transition-transform hover:scale-110 ${
              color === c.hex ? 'border-gray-800 scale-110' : 'border-gray-200'
            }`}
            style={{ backgroundColor: c.hex }}
          />
        ))}
        <span className="text-xs text-gray-400 ml-auto">
          {color ? BLESSING_COLORS.find((c) => c.hex === color)?.name : '與賓客相同'}
        </span>
      </div>
    </div>
  )
}
