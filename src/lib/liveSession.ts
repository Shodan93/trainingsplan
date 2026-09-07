// Kern des Live-Trackings: Session-Modell, Zeit-/Zonenrechnung und Persistenz.
// Alles Zeitliche rechnet über Timestamps (nicht über Tick-Zähler), damit die
// Session einen Reload, App-Wechsel oder Browser-Kill unbeschadet übersteht.
// Pure Funktionen ohne React – von den Unit-Tests direkt abgedeckt.

export type Zone = { min: number; max: number }
export type ZoneStatus = 'below' | 'in' | 'above'
export type HrSample = { t: number; bpm: number }
export type LivePhase = 'running' | 'paused' | 'done'

export type LiveSession = {
  v: 1
  machine: string
  zone: Zone
  startedAt: number
  phase: LivePhase
  pausedAccumMs: number
  pausedSince: number | null
  samples: HrSample[]
  inZoneMs: number
  lastStatus: ZoneStatus | null
  lastSampleAt: number | null
}

export const HYST = 2                    // bpm-Hysterese gegen Ton-Geflacker an der Zonengrenze
export const ALERT_REPEAT_MS = 6000      // Erinnerungston, solange man außerhalb der Zone bleibt
const MAX_SAMPLES = 4 * 3600             // ~4 h bei 1 Sample/s
const MAX_SESSION_AGE_MS = 20 * 3600_000 // ältere Reste gelten als verwaist
const KEY = 'cardio-live-session'

export function newSession(machine: string, zone: Zone, now = Date.now()): LiveSession {
  return {
    v: 1, machine, zone, startedAt: now, phase: 'running',
    pausedAccumMs: 0, pausedSince: null,
    samples: [], inZoneMs: 0, lastStatus: null, lastSampleAt: null
  }
}

// Netto-Trainingszeit (Pausen abgezogen)
export function elapsedMs(s: LiveSession, now = Date.now()): number {
  const pausedNow = s.pausedSince != null ? Math.max(0, now - s.pausedSince) : 0
  return Math.max(0, now - s.startedAt - s.pausedAccumMs - pausedNow)
}
export const elapsedSec = (s: LiveSession, now = Date.now()) => Math.round(elapsedMs(s, now) / 1000)

export function pause(s: LiveSession, now = Date.now()): LiveSession {
  if (s.phase !== 'running') return s
  return { ...s, phase: 'paused', pausedSince: now }
}

export function resume(s: LiveSession, now = Date.now()): LiveSession {
  if (s.phase !== 'paused' || s.pausedSince == null) return s
  return {
    ...s, phase: 'running',
    pausedAccumMs: s.pausedAccumMs + Math.max(0, now - s.pausedSince),
    pausedSince: null,
    // Nach der Pause nicht die Pausenzeit als „in Zone" verbuchen
    lastSampleAt: null
  }
}

// Beenden friert die Uhr ein (Zusammenfassung, dann speichern/verwerfen)
export function finish(s: LiveSession, now = Date.now()): LiveSession {
  const p = s.phase === 'running' ? pause(s, now) : s
  return { ...p, phase: 'done' }
}

export function statusFor(bpm: number, zone: Zone, prev: ZoneStatus | null): ZoneStatus {
  // Wer IN der Zone ist, fällt erst nach HYST bpm wieder raus
  if (prev === 'in') {
    if (bpm < zone.min - HYST) return 'below'
    if (bpm > zone.max + HYST) return 'above'
    return 'in'
  }
  if (bpm < zone.min) return 'below'
  if (bpm > zone.max) return 'above'
  return 'in'
}

// Neues Puls-Sample einarbeiten. Mutiert das samples-Array bewusst in place
// (1 Sample/s, kein Array-Copy nötig); gibt den Zonen-Übergang zurück,
// falls einer stattfand (für Ton/Vibration).
export function addSample(s: LiveSession, bpm: number, now = Date.now()):
  { session: LiveSession; transition: ZoneStatus | null } {
  if (s.phase !== 'running') return { session: s, transition: null }
  s.samples.push({ t: now, bpm })
  if (s.samples.length > MAX_SAMPLES) s.samples.shift()

  const st = statusFor(bpm, s.zone, s.lastStatus)
  let inZoneMs = s.inZoneMs
  if (s.lastSampleAt != null && s.lastStatus === 'in') {
    inZoneMs += Math.min(now - s.lastSampleAt, 5000)
  }
  const transition = st !== s.lastStatus ? st : null
  return {
    session: { ...s, inZoneMs, lastStatus: st, lastSampleAt: now },
    transition
  }
}

export type LiveStats = {
  durationSec: number
  avgHr: number | null
  maxHr: number | null
  inZonePct: number
}
export function liveStats(s: LiveSession, now = Date.now()): LiveStats {
  const durationSec = elapsedSec(s, now)
  const bpms = s.samples.map(x => x.bpm)
  return {
    durationSec,
    avgHr: bpms.length ? Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length) : null,
    maxHr: bpms.length ? Math.max(...bpms) : null,
    inZonePct: durationSec > 0 ? Math.min(100, Math.round(s.inZoneMs / (durationSec * 10)) ) : 0
  }
}

// Zonen-Presets aus HFmax (220 − Alter), Fallback generisch
export function zonePresets(hfMax: number | null): { label: string; min: number; max: number }[] {
  const base = hfMax ?? 190
  const mk = (lo: number, hi: number) => ({ min: Math.round(base * lo), max: Math.round(base * hi) })
  return [
    { label: 'GA1 · locker', ...mk(0.6, 0.7) },
    { label: 'GA2 · zügig', ...mk(0.7, 0.8) },
    { label: 'Schwelle', ...mk(0.8, 0.9) }
  ]
}

// ---- Persistenz (übersteht Reload & App-Kill) ----
// Samples kompakt als [Δt in s, bpm] ablegen, damit auch lange Sessions
// problemlos in den localStorage passen.
type StoredSession = Omit<LiveSession, 'samples'> & { samples: [number, number][] }

function storage(): Storage | null {
  try { return globalThis.localStorage ?? null } catch { return null }
}

export function saveLive(s: LiveSession) {
  const st = storage()
  if (!st) return
  try {
    const compact: StoredSession = {
      ...s,
      samples: s.samples.map(x => [Math.round((x.t - s.startedAt) / 1000), x.bpm])
    }
    st.setItem(KEY, JSON.stringify(compact))
  } catch { /* voller/gesperrter Storage darf das Training nie stören */ }
}

export function loadLive(now = Date.now()): LiveSession | null {
  const st = storage()
  if (!st) return null
  try {
    const raw = st.getItem(KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as StoredSession
    if (p?.v !== 1 || typeof p.startedAt !== 'number' || !Array.isArray(p.samples)) return null
    if (now - p.startedAt > MAX_SESSION_AGE_MS) { st.removeItem(KEY); return null }
    return {
      ...p,
      // Ohne Sensorverbindung nach Reload: Zonen-Zählung sauber neu ansetzen
      lastSampleAt: null,
      samples: p.samples
        .filter(x => Array.isArray(x) && x.length === 2)
        .map(([dt, bpm]) => ({ t: p.startedAt + dt * 1000, bpm }))
    }
  } catch {
    return null
  }
}

export function clearLive() {
  try { storage()?.removeItem(KEY) } catch { /* ignore */ }
}
