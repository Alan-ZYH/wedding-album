/**
 * Name lengths. Deliberately not written on the form — most guests never come
 * near them, and a rule stated up front reads as a hurdle. Whoever does hit
 * one gets told then.
 *
 * Counted in code points so an emoji costs one character rather than two.
 */
export const NAME_LIMITS = { real: 5, display: 10 } as const

export function nameLength(s: string) {
  return [...s.trim()].length
}

/** Returns the message to show, or '' when both names are fine. */
export function checkNames(realName: string, guestName: string): string {
  if (nameLength(realName) > NAME_LIMITS.real) return `本名不能超過 ${NAME_LIMITS.real} 個字`
  if (nameLength(guestName) > NAME_LIMITS.display) return `投影顯示名稱不能超過 ${NAME_LIMITS.display} 個字`
  return ''
}
