export function cls(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ')
}

// Akzeptiert Komma UND Punkt als Dezimaltrennzeichen (z. B. "1,5" und "1.5")
export function parseNum(raw: string): number | null {
  const norm = raw.replace(',', '.').trim()
  if (norm === '') return null
  const n = parseFloat(norm)
  return isNaN(n) ? null : n
}

export function fmtDate(d: string | Date) {
  const date = typeof d === 'string' ? new Date(d) : d
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function fmtDateTime(d: string | Date) {
  const date = typeof d === 'string' ? new Date(d) : d
  return date.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function fmtDuration(seconds: number | null | undefined) {
  if (!seconds || seconds < 0) return '–'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m < 60) return `${m}:${String(s).padStart(2, '0')} min`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}min`
}

export function fmtWeight(w: number | null | undefined, unit = 'kg') {
  if (w === null || w === undefined) return '–'
  return `${Number(w) % 1 === 0 ? w : Number(w).toFixed(2).replace(/\.?0+$/, '')} ${unit}`
}

// XP needed to reach a given level (inverse of level_for_xp on the server)
export function xpForLevel(level: number) {
  // level n requires (n-1)*n/2 * 100 XP cumulative
  const l = level - 1
  return Math.round((l * (l + 1) / 2) * 100)
}

export function levelProgress(xp: number, level: number) {
  const cur = xpForLevel(level)
  const next = xpForLevel(level + 1)
  const span = next - cur || 1
  return { cur, next, pct: Math.min(100, Math.max(0, ((xp - cur) / span) * 100)) }
}

// Lokales Datum als YYYY-MM-DD – toISOString() würde nach UTC springen
// (aus Montag 00:00 deutscher Zeit wird sonst Sonntag 22:00 UTC)
export function localDateISO(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function isoWeekStart(d = new Date()) {
  const date = new Date(d)
  const day = (date.getDay() + 6) % 7 // Mon=0
  date.setDate(date.getDate() - day)
  return localDateISO(date)
}

export function todayISO() {
  return localDateISO()
}

// Anstrengungs-Anweisung pro Übung (evidenzbasiert, statt RIR-Logging)
export const EFFORT: Record<string, { label: string; explain: string }> = {
  tech: {
    label: 'Technik-Fokus',
    explain: 'Qualität vor Last: langsame, saubere Wiederholungen. Haltungs- und Aufwärmarbeit – nicht bis zur Erschöpfung trainieren.'
  },
  rir12: {
    label: '1–2 RIR',
    explain: 'Beende jeden Satz, wenn noch 1–2 saubere Wiederholungen möglich wären. Die Forschung (Refalo 2024) zeigt: gleiches Muskelwachstum wie bis zum Versagen – bei deutlich weniger Ermüdung.'
  },
  rir23: {
    label: '2–3 RIR · kein Versagen',
    explain: 'Schwere Grundübung: 2–3 Wiederholungen Reserve lassen und nie bis zum Versagen gehen. Kraftzuwachs ist von der Nähe zum Versagen unabhängig – Gelenke, Sehnen und Sicherheit gehen vor.'
  },
  fail_last: {
    label: 'Letzter Satz bis Muskelversagen',
    explain: 'Sichere Maschine/Isolation: die ersten Sätze mit 1–2 Wiederholungen Reserve, den letzten Satz bis zum technischen Muskelversagen ausreizen – hier ist das Risiko gering und der Reiz maximal.'
  }
}
export const effortInfo = (code: string | null | undefined) => EFFORT[code ?? 'rir12'] ?? EFFORT.rir12

// Stimmungs-Bewertung (Tagebuch & Training – ein gemeinsames Modell)
export const MOODS = [
  { v: 1, e: '😣', l: 'mies' },
  { v: 2, e: '😕', l: 'okay' },
  { v: 3, e: '🙂', l: 'gut' },
  { v: 4, e: '💪', l: 'stark' },
  { v: 5, e: '🔥', l: 'top' }
]
export const moodEmoji = (m: number | null | undefined) => MOODS.find(x => x.v === m)?.e ?? ''
export const moodLabel = (m: number | null | undefined) => MOODS.find(x => x.v === m)?.l ?? ''

export function greeting() {
  const h = new Date().getHours()
  if (h < 11) return 'Guten Morgen'
  if (h < 18) return 'Servus'
  return 'Guten Abend'
}

export function vibrate(pattern: number | number[]) {
  if ('vibrate' in navigator) {
    try { navigator.vibrate(pattern) } catch { /* ignore */ }
  }
}
