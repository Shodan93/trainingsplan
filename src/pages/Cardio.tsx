import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid
} from 'recharts'
import { useAuth } from '../lib/auth'
import { getCardioSessions } from '../lib/db'
import { CardioSession, CardioMetricKey, CARDIO_METRICS, cardioMachineInfo } from '../lib/types'
import { primaryMetric, machineTrend, weeklyCardio } from '../lib/cardio'
import { loadLive, elapsedSec, LiveSession } from '../lib/liveSession'
import { PageSkeleton, EmptyState, Modal } from '../components/ui'
import CardioForm, { CardioEntryRow } from '../components/CardioForm'
import { fmtDate, fmtDuration, cls } from '../lib/utils'

// Ausdauer-Hub: Training starten/fortsetzen, Wochenbilanz, Progression pro
// Gerät und die letzten Einheiten – Erfassung manuell oder per Display-Foto.

export default function Cardio() {
  const { profile } = useAuth()
  const qc = useQueryClient()
  const nav = useNavigate()
  const [form, setForm] = useState<{ open: boolean; edit: CardioSession | null }>({ open: false, edit: null })
  const [machinePick, setMachinePick] = useState<string | null>(null)

  // Läuft gerade ein Live-Training? (übersteht Reload – liegt im localStorage)
  const [live, setLive] = useState<LiveSession | null>(() => loadLive())
  useEffect(() => {
    const check = () => setLive(loadLive())
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [])

  const { data: sessions, isLoading } = useQuery({
    queryKey: ['cardio', profile?.id],
    enabled: !!profile,
    queryFn: () => getCardioSessions(profile!.id)
  })
  const all = useMemo(() => sessions ?? [], [sessions])

  const byMachine = useMemo(() => {
    const m: Record<string, CardioSession[]> = {}
    all.forEach(s => { (m[s.machine] ??= []).push(s) })
    Object.values(m).forEach(list => list.sort((a, b) => b.performed_at.localeCompare(a.performed_at)))
    return m
  }, [all])

  const weeks = useMemo(() => weeklyCardio(all, 8), [all])
  const thisWeek = weeks[weeks.length - 1]
  const lastWeek = weeks[weeks.length - 2]

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['cardio'] })
    qc.invalidateQueries({ queryKey: ['history'] })
    setForm({ open: false, edit: null })
  }

  if (isLoading) return <PageSkeleton rows={4} />

  return (
    <div className="space-y-4 py-2">
      <div className="flex items-center justify-between pt-2">
        <h1 className="text-2xl font-bold">Ausdauer</h1>
        <button className="btn-ghost" onClick={() => setForm({ open: true, edit: null })}>＋ Nachtragen</button>
      </div>

      {/* Gegenstück zum Kraft-Bereich: gleiche Umschaltung wie auf „Training starten" */}
      <div className="flex gap-1 bg-white/5 rounded-2xl p-1">
        <button className="btn-ghost flex-1 !py-2 text-sm" onClick={() => nav('/workout')}>🏋️ Kraft</button>
        <button className="btn-primary flex-1 !py-2 text-sm">🏃 Ausdauer</button>
      </div>

      {/* Start / Fortsetzen */}
      {live ? (
        <button onClick={() => nav('/ausdauer/live')}
          className="card w-full text-left border-accent/40 bg-accent/10 flex items-center justify-between active:scale-[0.99]">
          <div>
            <p className="font-semibold text-accent">
              {live.phase === 'paused' ? '⏸' : '🟢'} Laufendes Training fortsetzen
            </p>
            <p className="text-xs text-white/55 mt-0.5">
              {cardioMachineInfo(live.machine)?.icon ?? '🏃'} {live.machine || 'Training'} · {fmtDuration(elapsedSec(live))}
              {live.phase === 'paused' && ' · pausiert'}
            </p>
          </div>
          <span className="text-xl text-white/40">›</span>
        </button>
      ) : (
        <button onClick={() => nav('/ausdauer/live')}
          className="btn-primary w-full !py-4 text-base !rounded-2xl">
          ▶️ Training starten
        </button>
      )}

      {!all.length && !live ? (
        <EmptyState icon="🏃" title="Noch keine Ausdauer-Einheiten"
          hint="Starte dein erstes Training – mit Live-Puls (HW6) oder einfach mit der Stoppuhr. Vergangene Einheiten kannst du oben nachtragen." />
      ) : (
        <>
          {/* Wochenbilanz mit Vergleich zur Vorwoche */}
          <div className="card">
            <div className="flex items-center justify-between mb-2">
              <p className="font-bold text-sm">Diese Woche</p>
              {lastWeek && <p className="text-[11px] text-white/40">Vorwoche: {lastWeek.minutes} min · {lastWeek.count}×</p>}
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <WeekStat value={`${thisWeek?.minutes ?? 0}`} unit="min" delta={delta(thisWeek?.minutes, lastWeek?.minutes)} />
              <WeekStat value={`${thisWeek?.count ?? 0}`} unit="Einheiten" delta={delta(thisWeek?.count, lastWeek?.count)} />
              <WeekStat value={`${Math.round(thisWeek?.kcal ?? 0).toLocaleString('de-DE')}`} unit="kcal" delta={delta(thisWeek?.kcal, lastWeek?.kcal)} />
            </div>
          </div>

          {/* Minuten pro Woche */}
          {weeks.some(w => w.minutes > 0) && (
            <div className="card">
              <p className="font-bold mb-3 text-sm">Minuten pro Woche</p>
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={weeks.map(w => ({ ...w, label: fmtDate(w.week).slice(0, 5) }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: '#ffffff60', fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fill: '#ffffff60', fontSize: 11 }} width={32} />
                  <Tooltip contentStyle={tipStyle} cursor={{ fill: '#ffffff08' }} />
                  <Bar dataKey="minutes" name="Minuten" fill="#f59e0b" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Geräte mit Progression */}
          {Object.keys(byMachine).length > 0 && (
            <>
              <p className="text-sm font-bold px-1">Deine Geräte</p>
              <div className="space-y-2">
                {Object.entries(byMachine).map(([machine, list]) => {
                  const preset = cardioMachineInfo(machine)
                  const pm = primaryMetric(machine, list)
                  const last = list[0]
                  const trend = machineTrend(machine, list)
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
            </>
          )}

          {/* Letzte Einheiten */}
          {all.length > 0 && (
            <>
              <p className="text-sm font-bold px-1">Letzte Einheiten</p>
              <div className="space-y-2">
                {all.slice(0, 10).map(s => (
                  <CardioEntryRow key={s.id} s={s} onClick={() => setForm({ open: true, edit: s })} />
                ))}
              </div>
            </>
          )}
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
          onEdit={s => { setMachinePick(null); setForm({ open: true, edit: s }) }}
          onLive={() => nav(`/ausdauer/live?machine=${encodeURIComponent(machinePick)}`)} />
      )}
    </div>
  )
}

function delta(cur?: number, prev?: number): number | null {
  if (cur == null || prev == null || prev === 0) return null
  return Math.round(((cur - prev) / prev) * 100)
}

function WeekStat({ value, unit, delta }: { value: string; unit: string; delta: number | null }) {
  return (
    <div className="bg-white/5 rounded-xl py-3 px-1">
      <p className="text-xl font-extrabold leading-none">{value}</p>
      <p className="text-[10px] text-white/45 mt-1">{unit}</p>
      {delta != null && (
        <p className={cls('text-[10px] font-bold mt-0.5', delta >= 0 ? 'text-green-400' : 'text-red-400')}>
          {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)} %
        </p>
      )}
    </div>
  )
}

const tipStyle = { background: '#1c2440', border: '1px solid #ffffff20', borderRadius: 12, color: '#fff', fontSize: 12 }

// Progression eines Geräts: Metrik wählbar, Verlauf als Linie + alle Einheiten
function MachineDetail({ machine, sessions, onClose, onEdit, onLive }: {
  machine: string
  sessions: CardioSession[]
  onClose: () => void
  onEdit: (s: CardioSession) => void
  onLive: () => void
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
        <button className="btn w-full bg-accent/15 text-accent border border-accent/30" onClick={onLive}>
          ▶️ Training an diesem Gerät starten
        </button>
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
