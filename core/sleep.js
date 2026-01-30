// core/sleep.js (ESM)
export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
