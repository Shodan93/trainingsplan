import { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, LineChart, Line,
  PieChart, Pie, Cell, CartesianGrid
} from 'recharts'
import { useAuth } from '../lib/auth'
import {
  getSessions, setLogsForSessions, deleteSession,
  getSessionLogs, updateSetLogById, deleteSetLog, updateSession, recomputeSessionVolume
} from '../lib/db'
import { WorkoutSession, SetLog, MUSCLE_LABELS, MUSCLE_HEX } from '../lib/types'
import { Spinner, EmptyState, Stat, Modal } from '../components/ui'
import { fmtDate, fmtDuration, isoWeekStart, parseNum } from '../lib/utils'

export default function Stats() {
  const { profile } = useAuth()
  const [sessions, setSessions] = useState<WorkoutSession[]>([])
  const [logs, setLogs] = useState<SetLog[]>([])
  const [loading, setLoading] = useState(true)
  const [exPick, setExPick] = useState<string>('')
  const [editSession, setEditSession] = useState<WorkoutSession | null>(null)

  async function load() {
    if (!profile) return
    setLoading(true)
    const ss = await getSessions(profile.id, 200)
    setSessions(ss)
    setLogs(await setLogsForSessions(ss.map(s => s.id)))
    setLoading(false)
  }
  useEffect(() => { load() }, [profile])

  const logsBySession = useMemo(() => {
    const m: Record<string, SetLog[]> = {}
    logs.forEach(l => { (m[l.session_id] ??= []).push(l) })
    return m
  }, [logs])

  // weekly volume (last 8 weeks)
  const weekly = useMemo(() => {
    const map: Record<string, { volume: number; count: number }> = {}
    sessions.forEach(s => {
      const wk = isoWeekStart(new Date(s.completed_at ?? s.started_at))
      map[wk] ??= { volume: 0, count: 0 }
      map[wk].volume += Number(s.total_volume) || 0
      map[wk].count += 1
    })
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).slice(-8)
      .map(([wk, v]) => ({ week: fmtDate(wk).slice(0, 5), volume: Math.round(v.volume), count: v.count }))
  }, [sessions])

  // muscle distribution (set count)
  const muscle = useMemo(() => {
    const map: Record<string, number> = {}
    logs.forEach(l => { const g = l.muscle_group ?? 'other'; map[g] = (map[g] ?? 0) + 1 })
    return Object.entries(map).map(([g, v]) => ({ name: MUSCLE_LABELS[g] ?? g, value: v, color: MUSCLE_HEX[g] ?? '#64748b' }))
      .sort((a, b) => b.value - a.value)
  }, [logs])

  const exerciseNames = useMemo(
    () => Array.from(new Set(logs.map(l => l.exercise_name))).sort(),
    [logs]
  )
  useEffect(() => { if (!exPick && exerciseNames.length) setExPick(exerciseNames[0]) }, [exerciseNames, exPick])

  // progression for selected exercise: max weight per session date
  const progression = useMemo(() => {
    if (!exPick) return []
    const bySession: Record<string, { date: string; weight: number; volume: number }> = {}
    logs.filter(l => l.exercise_name === exPick && l.weight != null).forEach(l => {
      const s = sessions.find(x => x.id === l.session_id)
      if (!s) return
      const d = (s.completed_at ?? s.started_at).slice(0, 10)
      bySession[l.session_id] ??= { date: d, weight: 0, volume: 0 }
      bySession[l.session_id].weight = Math.max(bySession[l.session_id].weight, Number(l.weight))
      bySession[l.session_id].volume += (Number(l.weight) || 0) * (Number(l.reps) || 0)
    })
    return Object.values(bySession).sort((a, b) => a.date.localeCompare(b.date))
      .map(p => ({ date: fmtDate(p.date).slice(0, 5), weight: p.weight, volume: Math.round(p.volume) }))
  }, [exPick, logs, sessions])

  if (loading) return <Spinner label="Lade Statistik…" />

  const totalVolume = sessions.reduce((a, s) => a + (Number(s.total_volume) || 0), 0)
  const avgDur = sessions.length ? sessions.reduce((a, s) => a + (s.duration_seconds || 0), 0) / sessions.length : 0
  const thisMonth = sessions.filter(s => (s.completed_at ?? '').slice(0, 7) === new Date().toISOString().slice(0, 7)).length

  if (!sessions.length) return (
    <div className="py-2">
      <h1 className="text-2xl font-extrabold pt-2 mb-4">📈 Statistik</h1>
      <EmptyState icon="📊" title="Noch keine Trainingsdaten" hint="Absolviere dein erstes Workout, dann erscheinen hier Auswertungen." />
    </div>
  )

  return (
    <div className="space-y-5 py-2">
      <h1 className="text-2xl font-extrabold pt-2">📈 Statistik</h1>

      <div className="flex gap-3">
        <Stat icon="🏆" value={sessions.length} label="Workouts" color="#22c55e" />
        <Stat icon="🏋️" value={`${(totalVolume / 1000).toFixed(1)}t`} label="Gesamtvolumen" color="#f59e0b" />
        <Stat icon="📅" value={thisMonth} label="diesen Monat" color="#0ea5e9" />
      </div>

      <Card title="Volumen pro Woche (kg)">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={weekly}>
            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
            <XAxis dataKey="week" tick={{ fill: '#ffffff60', fontSize: 11 }} />
            <YAxis tick={{ fill: '#ffffff60', fontSize: 11 }} width={40} />
            <Tooltip contentStyle={tipStyle} cursor={{ fill: '#ffffff08' }} />
            <Bar dataKey="volume" fill="#0ea5e9" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card title="Workouts pro Woche">
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={weekly}>
            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
            <XAxis dataKey="week" tick={{ fill: '#ffffff60', fontSize: 11 }} />
            <YAxis allowDecimals={false} tick={{ fill: '#ffffff60', fontSize: 11 }} width={28} />
            <Tooltip contentStyle={tipStyle} cursor={{ fill: '#ffffff08' }} />
            <Bar dataKey="count" fill="#22c55e" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card title="Verteilung nach Muskelgruppe (Sätze)">
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie data={muscle} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} innerRadius={45} paddingAngle={2}>
              {muscle.map((m, i) => <Cell key={i} fill={m.color} />)}
            </Pie>
            <Tooltip contentStyle={tipStyle} />
          </PieChart>
        </ResponsiveContainer>
        <div className="flex flex-wrap gap-2 justify-center mt-2">
          {muscle.map(m => (
            <span key={m.name} className="text-xs text-white/60 flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: m.color }} />{m.name} ({m.value})
            </span>
          ))}
        </div>
      </Card>

      <Card title="Kraftverlauf pro Übung (Dynamic Double Progression)">
        <select className="input mb-3" value={exPick} onChange={e => setExPick(e.target.value)}>
          {exerciseNames.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        {progression.length > 1 ? (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={progression}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
              <XAxis dataKey="date" tick={{ fill: '#ffffff60', fontSize: 11 }} />
              <YAxis tick={{ fill: '#ffffff60', fontSize: 11 }} width={40} domain={['dataMin - 5', 'dataMax + 5']} />
              <Tooltip contentStyle={tipStyle} />
              <Line type="monotone" dataKey="weight" stroke="#f59e0b" strokeWidth={3} dot={{ r: 4, fill: '#f59e0b' }} name="Top-Gewicht" />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-sm text-white/40 text-center py-6">Mehr Daten nötig – trainiere diese Übung mehrmals, um den Verlauf zu sehen.</p>
        )}
      </Card>

      {editSession && (
        <SessionEditor session={editSession} onClose={() => setEditSession(null)}
          onChanged={() => { setEditSession(null); load() }} />
      )}

      {/* History */}
      <div>
        <p className="text-sm font-semibold text-white/50 mb-2 px-1">Verlauf</p>
        <div className="space-y-2">
          {sessions.map(s => (
            <div key={s.id} className="card flex items-center justify-between !py-3">
              <button className="min-w-0 text-left flex-1" onClick={() => setEditSession(s)}>
                <p className="font-semibold truncate">{s.day_title ?? 'Training'} {s.is_deload && '🧘'}</p>
                <p className="text-xs text-white/45">
                  {fmtDate(s.completed_at ?? s.started_at)} · {fmtDuration(s.duration_seconds)} ·
                  {' '}{Math.round(Number(s.total_volume)).toLocaleString('de-DE')} kg · {(logsBySession[s.id] ?? []).filter(l => l.completed).length} Sätze
                </p>
              </button>
              <div className="flex gap-1 shrink-0">
                <button className="btn-ghost !px-2 !py-1 text-sm" onClick={() => setEditSession(s)}>✏️</button>
                <button className="btn-ghost !px-2 !py-1 text-sm text-white/40"
                  onClick={async () => { if (confirm('Diese Session löschen?')) { await deleteSession(s.id); load() } }}>🗑️</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const tipStyle = { background: '#1c2440', border: '1px solid #ffffff20', borderRadius: 12, color: '#fff', fontSize: 12 }

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <p className="font-bold mb-3 text-sm">{title}</p>
      {children}
    </div>
  )
}

function SessionEditor({ session, onClose, onChanged }:
  { session: WorkoutSession; onClose: () => void; onChanged: () => void }) {
  const [logs, setLogs] = useState<SetLog[]>([])
  const [notes, setNotes] = useState(session.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => { getSessionLogs(session.id).then(l => { setLogs(l); setLoading(false) }) }, [session.id])

  const grouped = useMemo(() => {
    const m: Record<string, SetLog[]> = {}
    logs.forEach(l => { (m[l.exercise_name] ??= []).push(l) })
    return Object.entries(m)
  }, [logs])

  function patch(id: string, p: Partial<SetLog>) {
    setLogs(prev => prev.map(l => l.id === id ? { ...l, ...p } : l))
  }

  async function save() {
    setBusy(true)
    for (const l of logs) {
      await updateSetLogById(l.id, { weight: l.weight, reps: l.reps, completed: l.completed })
    }
    await updateSession(session.id, { notes })
    await recomputeSessionVolume(session.id)
    setBusy(false); onChanged()
  }

  async function removeSet(id: string) {
    await deleteSetLog(id)
    setLogs(prev => prev.filter(l => l.id !== id))
  }

  return (
    <Modal open onClose={onClose} title="Training bearbeiten">
      {loading ? <Spinner /> : (
        <div className="space-y-4">
          <p className="text-xs text-white/45">{session.day_title} · {fmtDate(session.completed_at ?? session.started_at)}</p>
          {grouped.map(([name, sets]) => (
            <div key={name}>
              <p className="font-semibold text-sm mb-1">{name}</p>
              <div className="space-y-1.5">
                {sets.sort((a, b) => a.set_number - b.set_number).map(l => (
                  <div key={l.id} className="grid grid-cols-[1.5rem_1fr_1fr_2rem] gap-2 items-center">
                    <span className="text-center text-xs text-white/50">{l.set_number}</span>
                    <input className="input !py-1.5 text-center" type="text" inputMode="decimal" value={l.weight ?? ''}
                      placeholder="kg" onChange={e => patch(l.id, { weight: parseNum(e.target.value) })} />
                    <input className="input !py-1.5 text-center" type="text" inputMode="numeric" value={l.reps ?? ''}
                      placeholder="reps" onChange={e => patch(l.id, { reps: parseNum(e.target.value) })} />
                    <button className="text-white/30 text-sm" onClick={() => removeSet(l.id)}>🗑️</button>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {!grouped.length && <p className="text-sm text-white/40">Keine Sätze geloggt.</p>}
          <div>
            <label className="label">Notiz</label>
            <textarea className="input min-h-[60px]" value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <button className="btn-danger" onClick={async () => { if (confirm('Ganzes Training löschen?')) { await deleteSession(session.id); onChanged() } }}>Training löschen</button>
            <button className="btn-primary flex-1" disabled={busy} onClick={save}>{busy ? 'Speichern…' : 'Speichern'}</button>
          </div>
        </div>
      )}
    </Modal>
  )
}
