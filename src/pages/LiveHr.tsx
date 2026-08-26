import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../lib/auth'
import { getSettings } from '../lib/db'
import { CardioSession } from '../lib/types'
import { bluetoothSupported, connectHeartRate, HrConnection } from '../lib/hr'
import { beep, successSound } from '../lib/sound'
import { vibrate, cls, fmtDuration } from '../lib/utils'
import CardioForm from '../components/CardioForm'

// Live-Puls-Monitor für BLE-Sensoren (z. B. Coospo HW6):
// Zielzone einstellen, großer Live-Wert, Ton + Vibration beim Verlassen/Erreichen
// der Zone, am Ende Übernahme als Ausdauer-Einheit.

type ZoneStatus = 'below' | 'in' | 'above'
const HYST = 2                 // bpm-Hysterese gegen Ton-Geflacker an der Grenze
const REPEAT_MS = 6000         // Erinnerungston, solange außerhalb der Zone

function statusFor(bpm: number, min: number, max: number, prev: ZoneStatus | null): ZoneStatus {
  // An den Grenzen erst nach HYST bpm umschalten, sonst piept es bei jedem Schwanken
  if (prev === 'in') {
    if (bpm < min - HYST) return 'below'
    if (bpm > max + HYST) return 'above'
    return 'in'
  }
  if (bpm < min) return 'below'
  if (bpm > max) return 'above'
  return 'in'
}

const STATUS_UI: Record<ZoneStatus, { color: string; label: string }> = {
  below: { color: '#3b82f6', label: 'unter der Zone – Tempo rauf' },
  in: { color: '#22c55e', label: 'in der Zone 👌' },
  above: { color: '#ef4444', label: 'über der Zone – rausnehmen' }
}

function belowSound() { beep(330, 0.15, 'sine', 0.25); setTimeout(() => beep(262, 0.2, 'sine', 0.25), 170) }
function aboveSound() { beep(1175, 0.12, 'square', 0.18); setTimeout(() => beep(1175, 0.12, 'square', 0.18), 150); setTimeout(() => beep(1318, 0.16, 'square', 0.18), 300) }

export default function LiveHr() {
  const { profile } = useAuth()
  const nav = useNavigate()
  const qc = useQueryClient()

  const { data: settings } = useQuery({
    queryKey: ['onboarding-settings', profile?.id],
    enabled: !!profile,
    queryFn: () => getSettings(profile!.id)
  })
  const age = settings?.birth_year ? new Date().getFullYear() - settings.birth_year : null
  const hfMax = age ? 220 - age : null

  // Zielzone – zuletzt genutzte Zone bleibt gespeichert
  const [zone, setZone] = useState<{ min: number; max: number }>(() => {
    try {
      const raw = localStorage.getItem('hr-zone')
      if (raw) return JSON.parse(raw)
    } catch { /* ignore */ }
    return { min: 120, max: 150 }
  })
  useEffect(() => { try { localStorage.setItem('hr-zone', JSON.stringify(zone)) } catch { /* ignore */ } }, [zone])

  const [conn, setConn] = useState<'idle' | 'connecting' | 'connected' | 'lost'>('idle')
  const [deviceName, setDeviceName] = useState('')
  const [bpm, setBpm] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [soundOn, setSoundOn] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saveInitial, setSaveInitial] = useState<Partial<CardioSession> | null>(null)

  const connRef = useRef<HrConnection | null>(null)
  const wakeRef = useRef<WakeLockSentinel | null>(null)
  const startRef = useRef<number | null>(null)
  const samplesRef = useRef<{ t: number; bpm: number }[]>([])
  const statusRef = useRef<ZoneStatus | null>(null)
  const lastAlertRef = useRef(0)
  const inZoneMsRef = useRef(0)
  const lastSampleRef = useRef<number | null>(null)
  const zoneRef = useRef(zone)
  const soundRef = useRef(soundOn)
  zoneRef.current = zone
  soundRef.current = soundOn

  const [status, setStatus] = useState<ZoneStatus | null>(null)
  const [, forceTick] = useState(0)

  // Laufende Uhr + Sparkline-Refresh
  useEffect(() => {
    if (conn !== 'connected') return
    const iv = setInterval(() => {
      if (startRef.current) setElapsed(Math.round((Date.now() - startRef.current) / 1000))
      forceTick(x => x + 1)
    }, 1000)
    return () => clearInterval(iv)
  }, [conn])

  // Bildschirm anlassen, solange der Monitor läuft
  useEffect(() => {
    if (conn !== 'connected') return
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
  }, [conn])

  useEffect(() => () => { connRef.current?.disconnect() }, [])

  function onSample(v: number) {
    const now = Date.now()
    if (!startRef.current) startRef.current = now
    samplesRef.current.push({ t: now, bpm: v })
    if (samplesRef.current.length > 7200) samplesRef.current.shift()

    const prev = statusRef.current
    const st = statusFor(v, zoneRef.current.min, zoneRef.current.max, prev)

    // Zeit in der Zone aufsummieren (Abstand zum letzten Sample, gedeckelt)
    if (lastSampleRef.current != null && prev === 'in') {
      inZoneMsRef.current += Math.min(now - lastSampleRef.current, 5000)
    }
    lastSampleRef.current = now

    if (st !== prev) {
      statusRef.current = st
      setStatus(st)
      lastAlertRef.current = now
      if (soundRef.current) {
        if (st === 'in') { successSound(); vibrate(80) }
        else if (st === 'below') { belowSound(); vibrate([120, 80, 120]) }
        else { aboveSound(); vibrate([180, 80, 180, 80, 180]) }
      }
    } else if (st !== 'in' && soundRef.current && now - lastAlertRef.current > REPEAT_MS) {
      // Erinnerung, solange man außerhalb bleibt
      lastAlertRef.current = now
      if (st === 'below') belowSound(); else aboveSound()
    }
    setBpm(v)
  }

  async function connect() {
    setError(null)
    setConn('connecting')
    try {
      const c = await connectHeartRate(onSample, () => setConn('lost'))
      connRef.current = c
      setDeviceName(c.deviceName)
      setConn('connected')
      // kurzer Bestätigungston = Audio-Kontext ist durch die Nutzergeste freigeschaltet
      beep(880, 0.1)
    } catch (e) {
      setConn(samplesRef.current.length ? 'lost' : 'idle')
      const msg = e instanceof Error ? e.message : ''
      if (!msg.toLowerCase().includes('cancel')) {
        setError('Verbindung fehlgeschlagen. Ist der HW6 an, aufgeladen und nicht mit einer anderen App verbunden?')
      }
    }
  }

  function stopAndSave() {
    connRef.current?.disconnect()
    connRef.current = null
    const samples = samplesRef.current
    const dur = startRef.current ? Math.round((Date.now() - startRef.current) / 1000) : 0
    const avg = samples.length ? Math.round(samples.reduce((a, s) => a + s.bpm, 0) / samples.length) : null
    const max = samples.length ? Math.max(...samples.map(s => s.bpm)) : null
    const inPct = dur > 0 ? Math.round((inZoneMsRef.current / (dur * 1000)) * 100) : 0
    setConn('idle')
    setSaveInitial({
      performed_at: startRef.current ? new Date(startRef.current).toISOString() : new Date().toISOString(),
      duration_seconds: Math.max(dur, 1),
      avg_hr: avg,
      max_hr: max,
      notes: `Live-Monitor: ${inPct} % in Zone ${zone.min}–${zone.max} bpm`
    })
  }

  function discard() {
    connRef.current?.disconnect()
    connRef.current = null
    nav('/ausdauer')
  }

  const running = conn === 'connected' || conn === 'lost'
  const ui = status ? STATUS_UI[status] : null
  const avg = samplesRef.current.length
    ? Math.round(samplesRef.current.reduce((a, s) => a + s.bpm, 0) / samplesRef.current.length) : null
  const maxBpm = samplesRef.current.length ? Math.max(...samplesRef.current.map(s => s.bpm)) : null
  const inPct = elapsed > 0 ? Math.round((inZoneMsRef.current / (elapsed * 1000)) * 100) : 0

  // Zonen-Presets aus dem Alter (220 − Alter), sonst generische Bereiche
  const presets = useMemo(() => {
    const base = hfMax ?? 190
    const mk = (lo: number, hi: number) => ({ min: Math.round(base * lo), max: Math.round(base * hi) })
    return [
      { label: 'GA1 · locker', ...mk(0.6, 0.7) },
      { label: 'GA2 · zügig', ...mk(0.7, 0.8) },
      { label: 'Schwelle', ...mk(0.8, 0.9) }
    ]
  }, [hfMax])

  return (
    <div className="min-h-screen flex flex-col px-4 pt-safe pb-safe max-w-2xl mx-auto w-full">
      <div className="flex items-center justify-between py-3">
        <div>
          <p className="font-bold">🫀 Live-Puls</p>
          <p className="text-xs text-white/45">
            {conn === 'connected' ? `Verbunden: ${deviceName}` :
             conn === 'lost' ? 'Verbindung verloren' :
             conn === 'connecting' ? 'Verbinde…' : 'Nicht verbunden'}
          </p>
        </div>
        <div className="flex gap-2">
          {running && (
            <button className="btn-ghost !px-3" onClick={() => setSoundOn(s => !s)} title="Ton an/aus">
              {soundOn ? '🔊' : '🔇'}
            </button>
          )}
          <button className="btn-ghost !px-3" onClick={() => {
            if (!running || samplesRef.current.length === 0 || confirm('Live-Monitor beenden ohne zu speichern?')) discard()
          }}>✕</button>
        </div>
      </div>

      {!bluetoothSupported() ? (
        <div className="card text-center py-10 space-y-2">
          <p className="text-4xl">🚫</p>
          <p className="font-semibold">Web Bluetooth wird hier nicht unterstützt</p>
          <p className="text-sm text-white/50">
            Öffne die App in <b>Chrome auf Android</b> (oder Chrome/Edge am Desktop).
            iOS-Safari unterstützt kein Web Bluetooth.
          </p>
        </div>
      ) : !running ? (
        <div className="flex-1 flex flex-col justify-center gap-4 pb-10">
          <div className="card text-center py-8 space-y-3">
            <p className="text-5xl">🫀</p>
            <p className="font-bold text-lg">HW6 verbinden</p>
            <p className="text-sm text-white/50 px-4">
              Armband anziehen und aktivieren, dann verbinden – der Sensor taucht als
              „HW6…“ in der Geräteliste auf.
            </p>
            <button className="btn-primary w-full !py-3 text-base" disabled={conn === 'connecting'} onClick={connect}>
              {conn === 'connecting' ? 'Verbinde…' : '🔗 Sensor verbinden'}
            </button>
            {error && <p className="text-sm text-red-400 px-2">{error}</p>}
          </div>
          <ZoneEditor zone={zone} setZone={setZone} presets={presets} hfMax={hfMax} />
        </div>
      ) : (
        <div className="flex-1 flex flex-col gap-4">
          {conn === 'lost' && (
            <button className="card w-full text-center border-red-400/40 bg-red-400/10 text-red-300 font-semibold" onClick={connect}>
              ⚠️ Verbindung verloren – erneut verbinden
            </button>
          )}

          <div className="text-center py-6 rounded-3xl transition-colors duration-500"
            style={{ background: ui ? `${ui.color}1a` : 'rgba(255,255,255,.04)', border: `1px solid ${ui ? `${ui.color}55` : 'rgba(255,255,255,.08)'}` }}>
            <p className="text-[88px] leading-none font-extrabold tabular-nums" style={{ color: ui?.color ?? '#fff' }}>
              {bpm ?? '–'}
            </p>
            <p className="text-sm text-white/60 mt-1">bpm</p>
            {ui && <p className="text-sm font-semibold mt-2" style={{ color: ui.color }}>{ui.label}</p>}
          </div>

          <Sparkline samples={samplesRef.current} zone={zone} />

          <div className="grid grid-cols-4 gap-2 text-center">
            <MiniStat label="Zeit" value={fmtDuration(elapsed)} />
            <MiniStat label="Ø Puls" value={avg != null ? `${avg}` : '–'} />
            <MiniStat label="Max" value={maxBpm != null ? `${maxBpm}` : '–'} />
            <MiniStat label="in Zone" value={`${inPct} %`} />
          </div>

          <ZoneEditor zone={zone} setZone={setZone} presets={presets} hfMax={hfMax} />

          <div className="mt-auto pb-4">
            <button className="btn-primary w-full !py-3 text-base" onClick={stopAndSave}>
              ⏹ Beenden & als Einheit speichern
            </button>
          </div>
        </div>
      )}

      {saveInitial && profile && (
        <CardioForm uid={profile.id} initial={saveInitial}
          onClose={() => { setSaveInitial(null); nav('/ausdauer') }}
          onSaved={() => {
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
    <div className="bg-white/5 rounded-xl py-2">
      <p className="text-base font-extrabold leading-tight">{value}</p>
      <p className="text-[10px] text-white/45">{label}</p>
    </div>
  )
}

function ZoneEditor({ zone, setZone, presets, hfMax }: {
  zone: { min: number; max: number }
  setZone: (z: { min: number; max: number }) => void
  presets: { label: string; min: number; max: number }[]
  hfMax: number | null
}) {
  return (
    <div className="card space-y-2">
      <div className="flex items-center justify-between">
        <p className="font-bold text-sm">Zielzone</p>
        {hfMax && <p className="text-[11px] text-white/40">HFmax ≈ {hfMax} (220 − Alter)</p>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {presets.map(p => (
          <button key={p.label}
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
    </div>
  )
}

// Verlauf der letzten ~3 Minuten als leichte SVG-Linie mit Zonen-Band
function Sparkline({ samples, zone }: { samples: { t: number; bpm: number }[]; zone: { min: number; max: number } }) {
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
