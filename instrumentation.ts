export async function register() {
  // Node.js 22+ added an experimental/incomplete localStorage global.
  // It exists but is missing methods like getItem/setItem, which causes
  // Next.js SSR to crash. Patch it with a no-op implementation for SSR.
  if (typeof globalThis !== 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ls = (globalThis as any).localStorage
    if (ls !== undefined && typeof ls.getItem !== 'function') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(globalThis as any).localStorage = {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
        clear: () => {},
        key: () => null,
        length: 0,
      }
    }
  }
}
