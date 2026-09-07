import { describe, it, expect, beforeEach } from 'vitest'
import {
  newSession, elapsedMs, elapsedSec, pause, resume, finish, addSample,
  statusFor, liveStats, zonePresets, saveLive, loadLive, clearLive, HYST
} from '../liveSession'

const ZONE = { min: 120, max: 150 }
const T0 = 1_700_000_000_000

// localStorage-Stub für Node
class MemStorage {
  private m = new Map<string, string>()
  getItem(k: string) { return this.m.get(k) ?? null }
  setItem(k: string, v: string) { this.m.set(k, v) }
  removeItem(k: string) { this.m.delete(k) }
  clear() { this.m.clear() }
  key(i: number) { return [...this.m.keys()][i] ?? null }
  get length() { return this.m.size }
}

beforeEach(() => {
  ;(globalThis as Record<string, unknown>).localStorage = new MemStorage()
})

describe('Zeitrechnung (Reload-fest über Timestamps)', () => {
  it('läuft ohne Pause einfach mit der Uhr', () => {
    const s = newSession('Laufband', ZONE, T0)
    expect(elapsedMs(s, T0 + 90_000)).toBe(90_000)
    expect(elapsedSec(s, T0 + 90_400)).toBe(90)
  })

  it('zieht Pausen ab und friert die Uhr während der Pause ein', () => {
    let s = newSession('Laufband', ZONE, T0)
    s = pause(s, T0 + 60_000)
    // 30 s in der Pause: Uhr steht bei 60 s
    expect(elapsedSec(s, T0 + 90_000)).toBe(60)
    s = resume(s, T0 + 100_000)
    // 40 s Pause insgesamt, danach läuft sie weiter
    expect(elapsedSec(s, T0 + 130_000)).toBe(90)
    // zweite Pause
    s = pause(s, T0 + 160_000)
    s = resume(s, T0 + 170_000)
    expect(elapsedSec(s, T0 + 200_000)).toBe(150)
  })

  it('finish friert die Uhr endgültig ein', () => {
    let s = newSession('Laufband', ZONE, T0)
    s = finish(s, T0 + 300_000)
    expect(s.phase).toBe('done')
    expect(elapsedSec(s, T0 + 999_000)).toBe(300)
  })

  it('pause/resume sind idempotent bei falscher Phase', () => {
    const s = newSession('Laufband', ZONE, T0)
    expect(resume(s, T0 + 10_000)).toBe(s)
    const p = pause(s, T0 + 10_000)
    expect(pause(p, T0 + 20_000)).toBe(p)
  })
})

describe('Zonen-Status mit Hysterese', () => {
  it('meldet unter/in/über der Zone', () => {
    expect(statusFor(100, ZONE, null)).toBe('below')
    expect(statusFor(130, ZONE, null)).toBe('in')
    expect(statusFor(160, ZONE, null)).toBe('above')
  })
  it('fällt aus der Zone erst nach der Hysterese', () => {
    expect(statusFor(ZONE.min - 1, ZONE, 'in')).toBe('in')        // knapp drunter: bleibt „in"
    expect(statusFor(ZONE.min - HYST - 1, ZONE, 'in')).toBe('below')
    expect(statusFor(ZONE.max + 1, ZONE, 'in')).toBe('in')
    expect(statusFor(ZONE.max + HYST + 1, ZONE, 'in')).toBe('above')
  })
  it('kommt ohne Hysterese in die Zone zurück', () => {
    expect(statusFor(ZONE.min, ZONE, 'below')).toBe('in')
  })
})

describe('Samples & Statistik', () => {
  it('zählt Zeit in der Zone und liefert Übergänge', () => {
    let s = newSession('Treppensteiger', ZONE, T0)
    let r = addSample(s, 100, T0 + 1000)
    expect(r.transition).toBe('below')
    r = addSample(r.session, 125, T0 + 2000)
    expect(r.transition).toBe('in')
    r = addSample(r.session, 130, T0 + 3000)   // 1 s „in Zone"
    expect(r.transition).toBeNull()
    r = addSample(r.session, 131, T0 + 4000)   // +1 s
    s = r.session
    expect(s.inZoneMs).toBe(2000)
    const st = liveStats(s, T0 + 4000)
    expect(st.durationSec).toBe(4)
    expect(st.avgHr).toBe(Math.round((100 + 125 + 130 + 131) / 4))
    expect(st.maxHr).toBe(131)
    expect(st.inZonePct).toBe(50)
  })

  it('ignoriert Samples während der Pause', () => {
    let s = newSession('Treppensteiger', ZONE, T0)
    s = addSample(s, 130, T0 + 1000).session
    s = pause(s, T0 + 2000)
    const r = addSample(s, 140, T0 + 3000)
    expect(r.session.samples.length).toBe(1)
    expect(r.transition).toBeNull()
  })

  it('deckelt Lücken bei der In-Zone-Zeit (z. B. nach Funkloch)', () => {
    let s = newSession('Rudergerät', ZONE, T0)
    s = addSample(s, 130, T0 + 1000).session
    s = addSample(s, 132, T0 + 60_000).session  // 59 s Lücke → max. 5 s zählen
    expect(s.inZoneMs).toBe(5000)
  })
})

describe('Persistenz (Reload-Bugfix)', () => {
  it('speichert und lädt eine laufende Session inkl. Samples', () => {
    let s = newSession('Ergometer', ZONE, T0)
    s = addSample(s, 118, T0 + 1000).session
    s = addSample(s, 126, T0 + 2000).session
    saveLive(s)
    const back = loadLive(T0 + 10_000)
    expect(back).not.toBeNull()
    expect(back!.machine).toBe('Ergometer')
    expect(back!.phase).toBe('running')
    expect(back!.startedAt).toBe(T0)
    expect(back!.samples.map(x => x.bpm)).toEqual([118, 126])
    expect(back!.samples[1].t).toBe(T0 + 2000)
    expect(back!.inZoneMs).toBe(s.inZoneMs)
    // Nach Reload keine Zonen-Zeit über die Offline-Lücke hinweg verbuchen
    expect(back!.lastSampleAt).toBeNull()
  })

  it('überlebt Pause-Zustand und rechnet danach korrekt weiter', () => {
    let s = newSession('Laufband', ZONE, T0)
    s = pause(s, T0 + 30_000)
    saveLive(s)
    const back = loadLive(T0 + 500_000)!
    expect(back.phase).toBe('paused')
    expect(elapsedSec(back, T0 + 500_000)).toBe(30)
    const res = resume(back, T0 + 500_000)
    expect(elapsedSec(res, T0 + 510_000)).toBe(40)
  })

  it('verwirft verwaiste Sessions (>20 h alt)', () => {
    saveLive(newSession('Laufband', ZONE, T0))
    expect(loadLive(T0 + 21 * 3600_000)).toBeNull()
  })

  it('übersteht kaputte Daten und fehlenden Storage', () => {
    localStorage.setItem('cardio-live-session', '{kaputt')
    expect(loadLive()).toBeNull()
    clearLive()
    delete (globalThis as Record<string, unknown>).localStorage
    expect(loadLive()).toBeNull()
    expect(() => saveLive(newSession('x', ZONE))).not.toThrow()
  })
})

describe('Zonen-Presets', () => {
  it('rechnet aus HFmax die Trainingsbereiche', () => {
    const p = zonePresets(190)
    expect(p[0]).toMatchObject({ min: 114, max: 133 })  // GA1 60–70 %
    expect(p[2]).toMatchObject({ min: 152, max: 171 })  // Schwelle 80–90 %
  })
  it('fällt ohne Alter auf generische Werte zurück', () => {
    expect(zonePresets(null)[0].min).toBe(114)
  })
})
