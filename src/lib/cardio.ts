// Auswertungen für den Ausdauer-Bereich – pure Funktionen (Unit-getestet).
import { CardioSession, CardioMetricKey, CARDIO_METRICS, cardioMachineInfo } from './types'
import { isoWeekStart } from './utils'

// Kumulative Werte (mehr in gleicher Zeit = Fortschritt) vs. Intensitätswerte
export const CUMULATIVE: CardioMetricKey[] = ['floors', 'distance_km', 'calories']

// Leit-Metrik eines Geräts: Vorlage, sonst erstes Feld mit Daten
export function primaryMetric(machine: string, sessions: CardioSession[]): CardioMetricKey | null {
  const preset = cardioMachineInfo(machine)
  const has = (k: CardioMetricKey) => sessions.some(s => s[k] != null)
  if (preset && has(preset.primary)) return preset.primary
  return (Object.keys(CARDIO_METRICS) as CardioMetricKey[]).find(has) ?? null
}

// Vergleichswert für die Progression: kumulative Metriken pro Minute
// (sonst zählt „länger trainiert" fälschlich als Fortschritt), Intensität absolut
export function progressValue(s: CardioSession, k: CardioMetricKey): number | null {
  const v = s[k]
  if (v == null) return null
  if (CUMULATIVE.includes(k)) return s.duration_seconds > 0 ? Number(v) / (s.duration_seconds / 60) : null
  return Number(v)
}

// Trend letzte vs. vorletzte Einheit (Liste neueste zuerst)
export function machineTrend(machine: string, sessions: CardioSession[]):
  { pct: number; up: boolean } | null {
  const pm = primaryMetric(machine, sessions)
  if (!pm || sessions.length < 2) return null
  const a = progressValue(sessions[0], pm)
  const b = progressValue(sessions[1], pm)
  if (a == null || b == null || b === 0) return null
  const pct = ((a - b) / b) * 100
  return { pct: Math.abs(pct), up: pct >= 0 }
}

export type WeekAgg = { week: string; minutes: number; count: number; kcal: number }

// Wochen-Aggregation (Mo–So, lokale Zeit), lückenlos bis zur aktuellen Woche
export function weeklyCardio(sessions: CardioSession[], weeks = 8, now = new Date()): WeekAgg[] {
  const byWeek: Record<string, WeekAgg> = {}
  const starts: string[] = []
  const cur = new Date(now)
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(cur)
    d.setDate(d.getDate() - i * 7)
    const wk = isoWeekStart(d)
    starts.push(wk)
    byWeek[wk] = { week: wk, minutes: 0, count: 0, kcal: 0 }
  }
  sessions.forEach(s => {
    const wk = isoWeekStart(new Date(s.performed_at))
    const agg = byWeek[wk]
    if (!agg) return
    agg.minutes += s.duration_seconds / 60
    agg.count += 1
    agg.kcal += s.calories ?? 0
  })
  return starts.map(wk => ({ ...byWeek[wk], minutes: Math.round(byWeek[wk].minutes) }))
}
