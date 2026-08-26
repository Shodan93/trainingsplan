import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid
} from 'recharts'
import { useAuth } from '../lib/auth'
import { getCardioSessions } from '../lib/db'
import { CardioSession, CardioMetricKey, CARDIO_METRICS, cardioMachineInfo } from '../lib/types'
import { PageSkeleton, EmptyState, Modal, Stat } from '../components/ui'
import CardioForm, { CardioEntryRow } from '../components/CardioForm'
import { fmtDate, fmtDuration, cls } from '../lib/utils'

// Kumulative Werte (mehr in gleicher Zeit = Fortschritt) vs. Intensitätswerte
const CUMULATIVE: CardioMetricKey[] = ['floors', 'distance_km', 'calories']

// Leit-Metrik eines Geräts: Vorlage, sonst erstes Feld mit Daten
function primaryMetric(machine: string, sessions: CardioSession[]): CardioMetricKey | null {
  const preset = cardioMachineInfo(machine)
  const has = (k: CardioMetricKey) => sessions.some(s => s[k] != null)
  if (preset && has(preset.primary)) return preset.primary
  return (Object.keys(CARDIO_METRICS) as CardioMetricKey[]).find(has) ?? null
}

// Vergleichswert für die Progression: kumulative Metriken pro Minute,
// Intensitätswerte absolut
function progressValue(s: CardioSession, k: CardioMetricKey): number | null {
  const v = s[k]
  if (v == null) return null
  if (CUMULATIVE.includes(k)) return s.duration_seconds > 0 ? Number(v) / (s.duration_seconds / 60) : null
  return Number(v)
}

export default function Cardio() {
  const { profile } = useAuth()
  const qc = useQueryClient()
  const nav = useNavigate()
  const [form, setForm] = useState<{ open: boolean; edit: CardioSession | null }>({ open: false, edit: null })
  const [machinePick, setMachinePick] = useState<string | null>(null)

  const { data: sessions, isLoading } = useQuery({
    queryKey: ['cardio', profile?.id],
    enabled: !!profile,
    queryFn: () => getCardioSessions(profile!.id)
  })
  const all = useMemo(() => sessions ?? [], [sessions])

  const byMachine = useMemo(() => {
    const m: Record<string, CardioSession[]> = {}
    all.forEach(s => { (m[s.machine] ??= []).push(s) })
    // pro Gerät neueste zuerst (kommt sortiert aus der DB, zur Sicherheit)
    Object.values(m).forEach(list => list.sort((a, b) => b.performed_at.localeCompare(a.performed_at)))
    return m
  }, [all])

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['cardio'] })
    qc.invalidateQueries({ queryKey: ['history'] })
    setForm({ open: false, edit: null })
  }

  if (isLoading) return <PageSkeleton rows={4} />

  const totalMin = Math.round(all.reduce((a, s) => a + s.duration_seconds, 0) / 60)
  const totalKcal = all.reduce((a, s) => a + (s.calories ?? 0), 0)
  const thisWeekStart = (() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); d.setHours(0, 0, 0, 0); return d })()
  const thisWeek = all.filter(s => new Date(s.performed_at) >= thisWeekStart).length

  return (
    <div className="space-y-4 py-2">
      <div className="flex items-center justify-between pt-2">
        <h1 className="text-2xl font-bold">Ausdauer</h1>
        <button className="btn-primary" onClick={() => setForm({ open: true, edit: null })}>＋ Eintragen</button>
      </div>

      {/* Gegenstück zum Kraft-Bereich: gleiche Umschaltung wie auf „Training starten" */}
      <div className="flex gap-1 bg-white/5 rounded-2xl p-1">
        <button className="btn-ghost flex-1 !py-2 text-sm" onClick={() => nav('/workout')}>🏋️ Kraft</button>
        <button className="btn-primary flex-1 !py-2 text-sm">🏃 Ausdauer</button>
      </div>

      <p className="text-sm text-white/50">Cardio pro Gerät tracken – manuell oder per Foto vom Display.</p>

      {/* Live-Monitoring mit BLE-Pulssensor (z. B. Coospo HW6) */}
      <button onClick={() => nav('/ausdauer/live')}
        className="card w-full text-left border-accent/40 bg-accent/10 flex items-center justify-between active:scale-[0.99]">
        <div>
          <p className="font-semibold text-accent">🫀 Live-Puls mit Zielzone</p>
          <p className="text-xs text-white/55 mt-0.5">HW6 verbinden · Ton-Feedback, wenn du die Zone verlässt</p>
        </div>
        <span className="text-xl text-white/40">›</span>
      </button>

      {!all.length ? (
        <EmptyState icon="🏃" title="Noch keine Ausdauer-Einheiten"
          hint="Trage deine erste Einheit ein – am schnellsten mit einem Foto vom Gerätedisplay." />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Stat icon="🔁" value={thisWeek} label="diese Woche" color="#22c55e" />
            <Stat icon="⏱️" value={`${totalMin} min`} label="gesamt" color="#a855f7" />
            <Stat icon="🔥" value={totalKcal.toLocaleString('de-DE')} label="kcal gesamt" color="#f59e0b" />
          </div>

          <p className="text-sm font-bold px-1">Deine Geräte</p>
          <div className="space-y-2">
            {Object.entries(byMachine).map(([machine, list]) => {
              const preset = cardioMachineInfo(machine)
              const pm = primaryMetric(machine, list)
              const last = list[0]
              // Trend: letzte vs. vorletzte Einheit auf der Leit-Metrik
              let trend: { pct: number; up: boolean } | null = null
              if (pm && list.length >= 2) {
                const [a, b] = [progressValue(list[0], pm), progressValue(list[1], pm)]
                if (a != null && b != null && b !== 0) {
                  const pct = ((a - b) / b) * 100
                  trend = { pct: Math.abs(pct), up: pct >= 0 }
                }
              }
              return (
                <button key={machine} onClick={() => setMachinePick(machine)}
                  className="card w-full text-left flex items-center gap-3 active:scale-[0.99]">
                  <span className="text-3xl">{preset?.icon ?? '🏷️'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold truncate">{machine}</p>
                    <p className="text-xs text-white/45 mt-0.5">
                      {list.length}× · zuletzt {fmtDate(last.performed_at)} · {fmtDuration(last.duration_seconds)}
                      {pm && last[pm] != null && <> · {Number(last[pm]).toLocaleString('de-DE')} {CARDIO_METRICS[pm].unit || CARDIO_METRICS[pm].label}</>}
                    </p>
                  </div>
                  {trend && (
                    <span className={cls('text-xs font-bold shrink-0', trend.up ? 'text-green-400' : 'text-red-400')}>
                      {trend.up ? '▲' : '▼'} {trend.pct.toFixed(0)} %
                    </span>
                  )}
                  <span className="text-xl text-white/40 shrink-0">›</span>
                </button>
              )
            })}
          </div>

          <p className="text-sm font-bold px-1">Letzte Einheiten</p>
          <div className="space-y-2">
            {all.slice(0, 8).map(s => (
              <CardioEntryRow key={s.id} s={s} onClick={() => setForm({ open: true, edit: s })} />
            ))}
          </div>
        </>
      )}

      {form.open && profile && (
        <CardioForm uid={profile.id} existing={form.edit}
          knownMachines={Object.keys(byMachine)}
          onClose={() => setForm({ open: false, edit: null })} onSaved={refresh} />
      )}

      {machinePick && byMachine[machinePick] && (
        <MachineDetail machine={machinePick} sessions={byMachine[machinePick]}
          onClose={() => setMachinePick(null)}
          onEdit={s => { setMachinePick(null); setForm({ open: true, edit: s }) }} />
      )}
    </div>
  )
}

const tipStyle = { background: '#1c2440', border: '1px solid #ffffff20', borderRadius: 12, color: '#fff', fontSize: 12 }

// Progression eines Geräts: Metrik wählbar, Verlauf als Linie + alle Einheiten
function MachineDetail({ machine, sessions, onClose, onEdit }: {
  machine: string
  sessions: CardioSession[]
  onClose: () => void
  onEdit: (s: CardioSession) => void
}) {
  const metricOptions: { key: CardioMetricKey | 'duration'; label: string }[] = [
    { key: 'duration', label: 'Dauer (min)' },
    ...(Object.keys(CARDIO_METRICS) as CardioMetricKey[])
      .filter(k => sessions.some(s => s[k] != null))
      .map(k => ({ key: k as CardioMetricKey | 'duration', label: `${CARDIO_METRICS[k as CardioMetricKey].label}${CARDIO_METRICS[k as CardioMetricKey].unit ? ` (${CARDIO_METRICS[k as CardioMetricKey].unit})` : ''}` }))
  ]
  const pm = primaryMetric(machine, sessions)
  const [metric, setMetric] = useState<CardioMetricKey | 'duration'>(pm ?? 'duration')

  const chart = [...sessions]
    .sort((a, b) => a.performed_at.localeCompare(b.performed_at))
    .map(s => ({
      date: fmtDate(s.performed_at).slice(0, 5),
      value: metric === 'duration' ? Math.round(s.duration_seconds / 60 * 10) / 10 : s[metric] != null ? Number(s[metric]) : null
    }))
    .filter(p => p.value != null)

  const preset = cardioMachineInfo(machine)

  return (
    <Modal open onClose={onClose} title={`${preset?.icon ?? '🏷️'} ${machine}`}>
      <div className="space-y-4">
        <select className="input" value={metric} onChange={e => setMetric(e.target.value as CardioMetricKey | 'duration')}>
          {metricOptions.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        {chart.length > 1 ? (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chart}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
              <XAxis dataKey="date" tick={{ fill: '#ffffff60', fontSize: 11 }} />
              <YAxis tick={{ fill: '#ffffff60', fontSize: 11 }} width={44} domain={['auto', 'auto']} />
              <Tooltip contentStyle={tipStyle} />
              <Line type="monotone" dataKey="value" stroke="#f59e0b" strokeWidth={3} dot={{ r: 4, fill: '#f59e0b' }} name={metricOptions.find(o => o.key === metric)?.label} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-sm text-white/40 text-center py-4">Ab der zweiten Einheit siehst du hier deinen Verlauf.</p>
        )}
        <div className="space-y-1.5">
          {sessions.map(s => (
            <button key={s.id} onClick={() => onEdit(s)}
              className="w-full flex items-center justify-between text-sm text-left bg-white/5 rounded-xl px-3 py-2 active:scale-[0.99]">
              <span className="text-white/70">{fmtDate(s.performed_at)}</span>
              <span className="text-white/50 text-xs">
                {fmtDuration(s.duration_seconds)}
                {metric !== 'duration' && s[metric] != null && <> · {Number(s[metric]).toLocaleString('de-DE')} {CARDIO_METRICS[metric].unit}</>}
                {' '}✎
              </span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  )
}
