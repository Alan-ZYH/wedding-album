/**
 * The plate colours the couple may give a blessing. A fixed list rather than
 * a free picker: the server accepts nothing else, so every colour on screen is
 * one that was chosen to read well against the projection.
 */
export const BLESSING_COLORS = [
  { hex: '#c9a84c', name: '香檳金' },
  { hex: '#e8b4b8', name: '玫瑰粉' },
  { hex: '#a8c5b5', name: '霧綠' },
  { hex: '#b8c4de', name: '霧藍' },
] as const

export const DEFAULT_BLESSING_COLOR = BLESSING_COLORS[0].hex

export function isBlessingColor(value: unknown): value is string {
  return typeof value === 'string' && BLESSING_COLORS.some((c) => c.hex === value.toLowerCase())
}
