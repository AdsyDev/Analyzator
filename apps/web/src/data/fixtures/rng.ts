/** Zgomot determinist pentru date fictive: aceeași cheie dă mereu aceeași valoare (fără Math.random). */
export function hash32(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Valoare în [0, 1) derivată din cheie. */
export function unit(input: string): number {
  let t = (hash32(input) + 0x6d2b79f5) >>> 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** Șir hexazecimal de 32 de caractere, pentru payload hash fictiv. */
export function fakeHash(input: string): string {
  return [0, 1, 2, 3].map((i) => hash32(`${input}:${i}`).toString(16).padStart(8, '0')).join('')
}
