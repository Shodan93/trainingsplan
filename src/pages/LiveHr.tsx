import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../lib/auth'
import { getSettings, getCardioSessions } from '../lib/db'
import { CardioSession, CARDIO_MACHINES, cardioMachineInfo } from '../lib/types'
import { bluetoothSupported, connectHeartRate, HrConnection } from '../lib/hr'
import { beep, successSound } from '../lib/sound'
import { vibrate, cls } from '../lib/utils'
import {
  LiveSession, Zone, ZoneStatus, newSession, elapsedSec, pause, resume, finish,
  addSample, liveStats, zonePresets, saveLive, loadLive, clearLive, ALERT_REPEAT_MS
} from '../lib/liveSession'
import CardioForm from '../components/CardioForm'

// Ausdauer-Tracker: Gerät wählen → Training läuft (mit oder ohne Puls-Sensor,
// z. B. Coospo HW6) → Pause/Weiter → Zusammenfassung → als Einheit speichern.
// Die laufende Session wird durchgehend im localStorage gesichert und nach
// einem Reload nahtlos fortgesetzt (nur der Sensor braucht einen neuen Tap –
// Web Bluetooth erlaubt das Verbinden ausschließlich per Nutzergeste).

const STATUS_UI: Record<ZoneStatus, { color: string; label: string }> = {
  below: { color: '#3b82f6', label: 'unter der Zone – Tempo rauf' },
  in: { color: '#22c55e', label: 'in der Zone 👌' },
  above: { color: '#ef4444', label: 'über der Zone – rausnehmen' }
}

function belowSound() { beep(330, 0.15, 'sine', 0.25); setTimeout(() => beep(262, 0.2, 'sine', 0.25), 170) }
function aboveSound() { beep(1175, 0.12, 'square', 0.18); setTimeout(() => beep(1175, 0.12, 'square', 0.18), 150); setTimeout(() => beep(1318, 0.16, 'square', 0.18), 300) }

// Stoppuhr-Format: 24:27 bzw. 1:04:27
function fmtClock(totalSec: number) {
  const s = Math.max(0, totalSec)
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(r).padStart(2, '0')}`
}

export default function LiveTracker() {
  const { profile } = useAuth()
  const nav = useNavigate()
  const qc = useQueryClient()
  const [params] = useSearchParams()

  const { data: settings } = useQuery({
    queryKey: ['onboarding-settings', profile?.id],
    enabled: !!profile,
    queryFn: () => getSettings(profile!.id)
  })
  const age = settings?.birth_year ? new Date().getFullYear() - settings.birth_year : null
  const hfMax = age ? 220 - age : null

  const { data: pastCardio } = useQuery({
    queryKey: ['cardio', profile?.id],
    enabled: !!profile,
    queryFn: () => getCardioSessions(profile!.id)
  })
  const knownMachines = useMemo(
    () => Array.from(new Set([...CARDIO_MACHINES.map(m => m.name), ...(pastCardio ?? []).map(s => s.machine)])),
    [pastCardio]
  )

  // Laufende Session nach Reload direkt wieder aufnehmen
  const [session, setSession] = useState<LiveSession | null>(() => loadLive())
  const [restored] = useState(() => session != null)
  const sessionRef = useRef(session)
  sessionRef.current = session

  const [machine, setMachine] = useState(() => session?.machine ?? params.get('machine') ?? '')
  const [zone, setZoneState] = useState<Zone>(() => {
    if (session) return session.zone
    try {
      const raw = localStorage.getItem('hr-zone')
      if (raw) return JSON.parse(raw)
    } catch { /* ignore */ }
    return { min: 120, max: 150 }
  })
  function setZone(z: Zone) {
    setZoneState(z)
    try { localStorage.setItem('hr-zone', JSON.stringify(z)) } catch { /* ignore */ }
    setSession(s => {
      if (!s) return s
      const next = { ...s, zone: z }
      saveLive(next)
      return next
    })
  }

  const [conn, setConn] = useState<'idle' | 'connecting' | 'connected' | 'lost'>('idle')
  const [deviceName, setDeviceName] = useState('')
  const [bpm, setBpm] = useState<number | null>(null)
  const [soundOn, setSoundOn] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saveInitial, setSaveInitial] = useState<Partial<CardioSession> | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())

  const connRef = useRef<HrConnection | null>(null)
  const wakeRef = useRef<WakeLockSentinel | null>(null)
  const soundRef = useRef(soundOn)
  soundRef.current = soundOn
  const lastAlertRef = useRef(0)
  const tickRef = useRef(0)

  const phase: 'setup' | 'running' | 'paused' | 'done' = session ? session.phase : 'setup'

  // Sekundentakt: Uhr & Sparkline aktualisieren, Session periodisch sichern
  useEffect(() => {
    if (!session) return
    const iv = setInterval(() => {
      setNowMs(Date.now())
      tickRef.current++
      if (tickRef.current % 5 === 0 && sessionRef.current) saveLive(sessionRef.current)
    }, 1000)
    return () => clearInterval(iv)
    // bewusst nur an „gibt es eine Session" gekoppelt
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!session])

  // Beim Verlassen/Minimieren der Seite immer den letzten Stand sichern
  useEffect(() => {
    const persist = () => { if (sessionRef.current) saveLive(sessionRef.current) }
    const onVis = () => { if (document.visibilityState === 'hidden') persist() }
    window.addEventListener('pagehide', persist)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      persist()
      window.removeEventListener('pagehide', persist)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  // Bildschirm anlassen, solange das Training läuft
  useEffect(() => {
    if (phase !== 'running') return
    let active = true
    const acquire = async () => {
      try {
        if ('wakeLock' in navigator && active) wakeRef.current = await navigator.wakeLock.request('screen')
      } catch { /* ignore */ }
    }
    acquire()
    const onVis = () => { if (document.visibilityState === 'visible') acquire() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      active = false
      document.removeEventListener('visibilitychange', onVis)
      wakeRef.current?.release().catch(() => { /* ignore */ })
    }
  }, [phase])

  // Beim Unmount nur den Sensor trennen – die Session bleibt gespeichert
  useEffect(() => () => { connRef.current?.disconnect() }, [])

  const onSample = useCallback((v: number) => {
    const s = sessionRef.current
    if (!s || s.phase !== 'running') return
    const now = Date.now()
    const { session: next, transition } = addSample(s, v, now)
    setSession(next)
    setBpm(v)
    if (transition) {
      lastAlertRef.current = now
      if (soundRef.current) {
        if (transition === 'in') { successSound(); vibrate(80) }
        else if (transition === 'below') { belowSound(); vibrate([120, 80, 120]) }
        else { aboveSound(); vibrate([180, 80, 180, 80, 180]) }
      }
    } else if (next.lastStatus !== 'in' && soundRef.current && now - lastAlertRef.current > ALERT_REPEAT_MS) {
      lastAlertRef.current = now
      if (next.lastStatus === 'below') belowSound(); else aboveSound()
    }
  }, [])

  async function connectSensor(): Promise<boolean> {
    setError(null)
    setConn('connecting')
    try {
      const c = await connectHeartRate(onSample, () => { setConn('lost'); setBpm(null) })
      connRef.current = c
      setDeviceName(c.deviceName)
      setConn('connected')
      beep(880, 0.1) // Audio-Kontext per Nutzergeste freischalten + Bestätigung
      return true
    } catch (e) {
      setConn('idle')
      const msg = e instanceof Error ? e.message : ''
      if (!msg.toLowerCase().includes('cancel')) {
        setError('Sensor-Verbindung fehlgeschlagen. Ist der HW6 an, geladen und nicht mit einer anderen App verbunden?')
      }
      return false
    }
  }

  function startTraining() {
    const s = newSession(machine.trim(), zone)
    saveLive(s)
    setSession(s)
    setNowMs(Date.now())
  }
  async function startWithSensor() {
    if (await connectSensor()) startTraining()
  }

  function togglePause() {
    setSession(s => {
      if (!s) return s
      const next = s.phase === 'running' ? pause(s) : resume(s)
      saveLive(next)
      if (soundRef.current) beep(next.phase === 'paused' ? 440 : 660, 0.12)
      return next
    })
  }

  function finishTraining() {
    connRef.current?.disconnect()
    connRef.current = null
    setConn('idle')
    setBpm(null)
    setSession(s => {
      if (!s) return s
      const next = finish(s)
      saveLive(next)
      return next
    })
  }

  // Aus der Zusammenfassung zurück ins Training (versehentlich beendet)
  function continueTraining() {
    setSession(s => {
      if (!s) return s
      const next = resume({ ...s, phase: 'paused' })
      saveLive(next)
      return next
    })
  }

  function discard() {
    connRef.current?.disconnect()
    connRef.current = null
    clearLive()
    nav('/ausdauer')
  }

  function openSaveForm() {
    const s = sessionRef.current
    if (!s) return
    const stats = liveStats(s)
    const hasHr = s.samples.length > 0
    setSaveInitial({
      machine: s.machine || undefined,
      performed_at: new Date(s.startedAt).toISOString(),
      duration_seconds: Math.max(stats.durationSec, 1),
      avg_hr: stats.avgHr,
      max_hr: stats.maxHr,
      notes: hasHr ? `Live-Tracker: ${stats.inZonePct} % in Zone ${s.zone.min}–${s.zone.max} bpm` : null
    })
  }

  const presets = useMemo(() => zonePresets(hfMax), [hfMax])
  const stats = session ? liveStats(session, nowMs) : null
  const ui = session?.lastStatus && conn === 'connected' ? STATUS_UI[session.lastStatus] : null
  const btSupported = bluetoothSupported()

  return (
    <div className="min-h-screen flex flex-col px-4 pt-safe pb-safe max-w-2xl mx-auto w-full">
      {/* Kopfzeile */}
      <div className="flex items-center justify-between py-3">
        <div className="min-w-0">
          <p className="font-bold truncate">
            {phase === 'setup' ? '🏃 Neues Ausdauer-Training'
              : `${cardioMachineInfo(session!.machine)?.icon ?? '🏃'} ${session!.machine || 'Training'}`}
          </p>
          <p className="text-xs text-white/45">
            {phase === 'setup' ? 'Gerät wählen und starten'
              : conn === 'connected' ? `Sensor: ${deviceName}`
              : conn === 'connecting' ? 'Verbinde Sensor…'
              : conn === 'lost' ? 'Sensor-Verbindung verloren'
              : 'Ohne Puls-Sensor'}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          {session && (
            <button className="btn-ghost !px-3" onClick={() => setSoundOn(s => !s)} title="Ton an/aus">
              {soundOn ? '🔊' : '🔇'}
            </button>
          )}
          <button className="btn-ghost !px-3" onClick={() => {
            if (!session) { nav('/ausdauer'); return }
            if (confirm('Training abbrechen und verwerfen?')) discard()
          }}>✕</button>
        </div>
      </div>

      {/* ---- Phase: Setup ---- */}
      {phase === 'setup' && (
        <div className="flex-1 flex flex-col gap-4 pb-6">
          <div className="card space-y-2">
            <p className="font-bold text-sm">1 · Welches Gerät?</p>
            <div className="flex flex-wrap gap-1.5">
              {knownMachines.map(name => {
                const p = cardioMachineInfo(name)
                const active = machine.trim().toLowerCase() === name.toLowerCase()
                return (
                  <button key={name} type="button"
                    onClick={() => setMachine(active ? '' : name)}
                    className={cls('chip transition',
                      active ? 'bg-primary/25 text-primary ring-1 ring-primary' : 'bg-white/10 text-white/60')}>
                    {p?.icon ?? '🏷️'} {name}
                  </button>
                )
              })}
            </div>
            <input className="input" placeholder="oder eigenes Gerät, z. B. „Laufband Studio 2“"
              value={machine} onChange={e => setMachine(e.target.value)} />
          </div>

          <div className="card space-y-2">
            <p className="font-bold text-sm">2 · Zielzone (Puls)</p>
            <ZoneFields zone={zone} setZone={setZone} presets={presets} hfMax={hfMax} />
            <p className="text-[11px] text-white/35">
              Mit Sensor bekommst du Ton + Vibration, sobald du die Zone verlässt oder erreichst.
            </p>
          </div>

          <div className="card space-y-2">
            <p className="font-bold text-sm">3 · Los geht's</p>
            {btSupported && (
              <button className="btn-primary w-full !py-3 text-base"
                disabled={!machine.trim() || conn === 'connecting'} onClick={startWithSensor}>
                {conn === 'connecting' ? 'Verbinde…' : '🫀 Mit Puls-Sensor starten (HW6)'}
              </button>
            )}
            <button className={cls('w-full !py-3 text-base', btSupported ? 'btn-ghost' : 'btn-primary')}
              disabled={!machine.trim()} onClick={startTraining}>
              ▶️ {btSupported ? 'Ohne Sensor starten' : 'Training starten'}
            </button>
            {!machine.trim() && <p className="text-[11px] text-white/35 text-center">Wähle zuerst ein Gerät.</p>}
            {!btSupported && (
              <p className="text-[11px] text-white/35">
                Puls-Sensor braucht Chrome auf Android bzw. Chrome/Edge am Desktop (iOS-Safari kann kein Web Bluetooth).
              </p>
            )}
            {error && <p className="text-sm text-red-400">{error}</p>}
          </div>
        </div>
      )}

      {/* ---- Phase: Training läuft / Pause ---- */}
      {(phase === 'running' || phase === 'paused') && session && stats && (
        <div className="flex-1 flex flex-col gap-3 pb-4">
          {/* Sensor nach Reload/Abbruch mit einem Tap wieder verbinden */}
          {btSupported && conn !== 'connected' && conn !== 'connecting' && (
            <button onClick={connectSensor}
              className={cls('card w-full text-center font-semibold',
                conn === 'lost' || restored
                  ? 'border-red-400/40 bg-red-400/10 text-red-300'
                  : 'border-accent/40 bg-accent/10 text-accent')}>
              {conn === 'lost' ? '⚠️ Sensor-Verbindung verloren – neu verbinden'
                : restored ? '🫀 Training läuft weiter – Sensor neu verbinden'
                : '🫀 Puls-Sensor verbinden (optional)'}
            </button>
          )}
          {error && <p className="text-sm text-red-400 text-center">{error}</p>}

          {/* Stoppuhr */}
          <div className={cls('text-center py-5 rounded-3xl border transition-colors',
            phase === 'paused' ? 'border-amber-400/40 bg-amber-400/10' : 'border-white/10 bg-white/5')}>
            <p className="text-6xl font-extrabold tabular-nums leading-none">{fmtClock(stats.durationSec)}</p>
            <p className="text-xs text-white/50 mt-2">
              {phase === 'paused' ? '⏸ Pause – Uhr angehalten' : `gestartet ${new Date(session.startedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr`}
            </p>
          </div>

          {/* Live-Puls */}
          {conn === 'connected' && (
            <div className="text-center py-5 rounded-3xl transition-colors duration-500"
              style={{ background: ui ? `${ui.color}1a` : 'rgba(255,255,255,.04)', border: `1px solid ${ui ? `${ui.color}55` : 'rgba(255,255,255,.08)'}` }}>
              <p className="text-[72px] leading-none font-extrabold tabular-nums" style={{ color: ui?.color ?? '#fff' }}>
                {bpm ?? '–'}
              </p>
              <p className="text-sm text-white/60 mt-1">bpm</p>
              {ui && <p className="text-sm font-semibold mt-1" style={{ color: ui.color }}>{ui.label}</p>}
            </div>
          )}

          <Sparkline samples={session.samples} zone={session.zone} />

          <div className="grid grid-cols-4 gap-2 text-center">
            <MiniStat label="Ø Puls" value={stats.avgHr != null ? `${stats.avgHr}` : '–'} />
            <MiniStat label="Max" value={stats.maxHr != null ? `${stats.maxHr}` : '–'} />
            <MiniStat label="in Zone" value={session.samples.length ? `${stats.inZonePct} %` : '–'} />
            <MiniStat label="Zone" value={`${session.zone.min}–${session.zone.max}`} />
          </div>

          <details className="card !py-3">
            <summary className="font-bold text-sm cursor-pointer select-none">Zielzone anpassen</summary>
            <div className="pt-3">
              <ZoneFields zone={zone} setZone={setZone} presets={presets} hfMax={hfMax} />
            </div>
          </details>

          <div className="mt-auto grid grid-cols-2 gap-2 pb-2">
            <button className="btn-ghost !py-3 text-base" onClick={togglePause}>
              {phase === 'paused' ? '▶️ Weiter' : '⏸ Pause'}
            </button>
            <button className="btn-primary !py-3 text-base" onClick={finishTraining}>
              ⏹ Beenden
            </button>
          </div>
        </div>
      )}

      {/* ---- Phase: Zusammenfassung ---- */}
      {phase === 'done' && session && stats && (
        <div className="flex-1 flex flex-col gap-4 pb-6">
          <div className="card text-center py-6 space-y-1">
            <p className="text-4xl">🎉</p>
            <p className="font-bold text-lg">{session.machine || 'Training'} beendet</p>
            <p className="text-5xl font-extrabold tabular-nums py-2">{fmtClock(stats.durationSec)}</p>
            <p className="text-xs text-white/45">
              gestartet {new Date(session.startedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr
            </p>
          </div>

          {session.samples.length > 0 && (
            <>
              <Sparkline samples={session.samples} zone={session.zone} />
              <div className="grid grid-cols-3 gap-2 text-center">
                <MiniStat label="Ø Puls" value={`${stats.avgHr}`} />
                <MiniStat label="Max. Puls" value={`${stats.maxHr}`} />
                <MiniStat label={`in Zone ${session.zone.min}–${session.zone.max}`} value={`${stats.inZonePct} %`} />
              </div>
            </>
          )}

          <div className="space-y-2 mt-auto pb-2">
            <button className="btn-primary w-full !py-3 text-base" onClick={openSaveForm}>
              💾 Als Ausdauer-Einheit speichern
            </button>
            <p className="text-[11px] text-white/35 text-center">
              Im nächsten Schritt kannst du Werte vom Gerätedisplay ergänzen – auch per 📷 Foto.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button className="btn-ghost" onClick={continueTraining}>↩︎ Weiter trainieren</button>
              <button className="btn-ghost text-red-300" onClick={() => { if (confirm('Training wirklich verwerfen?')) discard() }}>
                Verwerfen
              </button>
            </div>
          </div>
        </div>
      )}

      {saveInitial && profile && (
        <CardioForm uid={profile.id} initial={saveInitial} knownMachines={knownMachines}
          onClose={() => setSaveInitial(null)}
          onSaved={() => {
            clearLive()
            qc.invalidateQueries({ queryKey: ['cardio'] })
            qc.invalidateQueries({ queryKey: ['history'] })
            setSaveInitial(null)
            nav('/ausdauer')
          }} />
      )}
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white/5 rounded-xl py-2 px-1">
      <p className="text-base font-extrabold leading-tight">{value}</p>
      <p className="text-[10px] text-white/45">{label}</p>
    </div>
  )
}

function ZoneFields({ zone, setZone, presets, hfMax }: {
  zone: Zone
  setZone: (z: Zone) => void
  presets: { label: string; min: number; max: number }[]
  hfMax: number | null
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {presets.map(p => (
          <button key={p.label} type="button"
            onClick={() => setZone({ min: p.min, max: p.max })}
            className={cls('chip transition',
              zone.min === p.min && zone.max === p.max
                ? 'bg-primary/25 text-primary ring-1 ring-primary' : 'bg-white/10 text-white/60')}>
            {p.label} · {p.min}–{p.max}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[11px] text-white/45">von (bpm)</label>
          <input className="input !py-2 text-center" type="number" inputMode="numeric" value={zone.min}
            onChange={e => setZone({ ...zone, min: Number(e.target.value) || 0 })} />
        </div>
        <div>
          <label className="text-[11px] text-white/45">bis (bpm)</label>
          <input className="input !py-2 text-center" type="number" inputMode="numeric" value={zone.max}
            onChange={e => setZone({ ...zone, max: Number(e.target.value) || 0 })} />
        </div>
      </div>
      {hfMax && <p className="text-[11px] text-white/40">HFmax ≈ {hfMax} (220 − Alter)</p>}
    </div>
  )
}

// Pulsverlauf der letzten ~3 Minuten als leichte SVG-Linie mit Zonen-Band
function Sparkline({ samples, zone }: { samples: { t: number; bpm: number }[]; zone: Zone }) {
  const recent = samples.slice(-180)
  if (recent.length < 2) return null
  const W = 300, H = 80
  const lo = Math.min(zone.min - 10, ...recent.map(s => s.bpm))
  const hi = Math.max(zone.max + 10, ...recent.map(s => s.bpm))
  const y = (v: number) => H - ((v - lo) / (hi - lo || 1)) * H
  const x = (i: number) => (i / (recent.length - 1)) * W
  const points = recent.map((s, i) => `${x(i).toFixed(1)},${y(s.bpm).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-20 rounded-2xl bg-white/5" preserveAspectRatio="none">
      <rect x={0} width={W} y={y(zone.max)} height={Math.max(0, y(zone.min) - y(zone.max))} fill="#22c55e22" />
      <line x1={0} x2={W} y1={y(zone.max)} y2={y(zone.max)} stroke="#22c55e66" strokeDasharray="4 4" strokeWidth={1} />
      <line x1={0} x2={W} y1={y(zone.min)} y2={y(zone.min)} stroke="#22c55e66" strokeDasharray="4 4" strokeWidth={1} />
      <polyline points={points} fill="none" stroke="#ffffffcc" strokeWidth={2} />
    </svg>
  )
}
