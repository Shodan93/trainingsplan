import { describe, it, expect } from 'vitest'
import { primaryMetric, progressValue, machineTrend, weeklyCardio } from '../cardio'
import { CardioSession } from '../types'
import { isoWeekStart } from '../utils'

let n = 0
function sess(p: Partial<CardioSession>): CardioSession {
  return {
    id: String(++n), user_id: 'u', machine: 'Treppensteiger',
    performed_at: new Date().toISOString(), duration_seconds: 1500,
    calories: null, distance_km: null, floors: null, level: null,
    avg_watts: null, avg_hr: null, max_hr: null, cadence: null,
    speed_kmh: null, incline_pct: null, rpe: null, notes: null,
    source: 'manual', created_at: new Date().toISOString(),
    ...p
  }
}

describe('Leit-Metrik & Progressionswert', () => {
  it('nimmt die Vorlagen-Metrik des Geräts, wenn Daten da sind', () => {
    const list = [sess({ floors: 40 })]
    expect(primaryMetric('Treppensteiger', list)).toBe('floors')
  })
  it('weicht auf die erste Metrik mit Daten aus', () => {
    const list = [sess({ floors: null, avg_watts: 56 })]
    expect(primaryMetric('Treppensteiger', list)).toBe('avg_watts')
    expect(primaryMetric('Unbekanntes Gerät', list)).toBe('avg_watts')
  })
  it('normalisiert kumulative Werte auf pro Minute, Intensität bleibt absolut', () => {
    const s = sess({ floors: 40, avg_watts: 56, duration_seconds: 1500 }) // 25 min
    expect(progressValue(s, 'floors')).toBeCloseTo(1.6)
    expect(progressValue(s, 'avg_watts')).toBe(56)
    expect(progressValue(sess({ floors: null }), 'floors')).toBeNull()
  })
})

describe('Geräte-Trend (letzte vs. vorletzte Einheit)', () => {
  it('erkennt Verbesserung fair pro Minute', () => {
    const list = [
      sess({ floors: 44, duration_seconds: 1500 }),  // neueste: 1,76/min
      sess({ floors: 40, duration_seconds: 1500 })   // davor:   1,60/min
    ]
    const t = machineTrend('Treppensteiger', list)!
    expect(t.up).toBe(true)
    expect(t.pct).toBeCloseTo(10, 0)
  })
  it('länger trainiert ≠ Fortschritt: gleiche Rate → 0 %', () => {
    const list = [
      sess({ floors: 80, duration_seconds: 3000 }),
      sess({ floors: 40, duration_seconds: 1500 })
    ]
    const t = machineTrend('Treppensteiger', list)!
    expect(t.pct).toBeCloseTo(0)
  })
  it('braucht mindestens zwei Einheiten', () => {
    expect(machineTrend('Treppensteiger', [sess({ floors: 40 })])).toBeNull()
  })
})

describe('Wochenbilanz', () => {
  it('aggregiert lückenlos, aktuelle Woche zuletzt', () => {
    const now = new Date('2026-09-07T12:00:00') // ein Montag
    const list = [
      sess({ performed_at: '2026-09-07T08:00:00', duration_seconds: 1800, calories: 200 }),
      sess({ performed_at: '2026-09-01T08:00:00', duration_seconds: 3600, calories: 300 }),
      sess({ performed_at: '2026-09-06T08:00:00', duration_seconds: 600, calories: 50 }) // Sonntag derselben Woche
    ]
    const weeks = weeklyCardio(list, 4, now)
    expect(weeks).toHaveLength(4)
    expect(weeks[3].week).toBe(isoWeekStart(now))
    expect(weeks[3].minutes).toBe(30)
    expect(weeks[3].count).toBe(1)
    expect(weeks[2].minutes).toBe(70)  // 60 min Di + 10 min So derselben Vorwoche
    expect(weeks[2].kcal).toBe(350)
    expect(weeks[0].count).toBe(0)     // leere Woche ist trotzdem da
  })
})
