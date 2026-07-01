import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, LineChart, Line,
  PieChart, Pie, Cell, CartesianGrid
} from 'recharts'
import { useAuth } from '../lib/auth'
import { getSessions, setLogsForSessions } from '../lib/db'
import { SetLog, MUSCLE_LABELS, MUSCLE_HEX } from '../lib/types'
import { PageSkeleton, EmptyState, Stat } from '../components/ui'
import { fmtDate, fmtDuration, isoWeekStart, MOODS } from '../lib/utils'

export default function Stats() {
  const { profile } = useAuth()
  const [exPick, setExPick] = useState<string>('')

  const { data, isLoading } = useQuery({
    queryKey: ['stats', profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const ss = await getSessions(profile!.id, 200)
      const lg = await setLogsForSessions(ss.map(s => s.id))
      return { sessions: ss, logs: lg }
    }
  })
  const sessions = data?.sessions ?? []
  const logs: SetLog[] = data?.logs ?? []

  const setCountBySession = useMemo(() => {
    const m: Record<string, number> = {}
    logs.forEach(l => { m[l.session_id] = (m[l.session_id] ?? 0) + 1 })
    return m
  }, [logs])

  // weekly volume / workouts / sets (last 8 weeks)
  const weekly = useMemo(() => {
    const map: Record<string, { volume: number; count: number; sets: number }> = {}
    sessions.forEach(s => {
      const wk = isoWeekStart(new Date(s.completed_at ?? s.started_at))
      map[wk] ??= { volume: 0, count: 0, sets: 0 }
      map[wk].volume += Number(s.total_volume) || 0
      map[wk].count += 1
      map[wk].sets += setCountBySession[s.id] ?? 0
    })
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).slice(-8)
      .map(([wk, v]) => ({ week: fmtDate(wk).slice(0, 5), volume: Math.round(v.volume), count: v.count, sets: v.sets }))
  }, [sessions, setCountBySession])

  // kumulierter Volumenverlauf
  const cumVolume = useMemo(() => {
    const sorted = [...sessions].sort((a, b) => (a.completed_at ?? '').localeCompare(b.completed_at ?? ''))
    let c = 0
    return sorted.map(s => { c += Number(s.total_volume) || 0; return { date: fmtDate(s.completed_at ?? s.started_at).slice(0, 5), vol: Math.round(c) } })
  }, [sessions])

  // Bestleistungen je Übung (max Gewicht)
  const prs = useMemo(() => {
    const m: Record<string, { weight: number; reps: number | null }> = {}
    logs.forEach(l => {
      if (l.weight == null) return
      const w = Number(l.weight)
      if (!m[l.exercise_name] || w > m[l.exercise_name].weight) m[l.exercise_name] = { weight: w, reps: l.reps }
    })
    return Object.entries(m).filter(([, v]) => v.weight > 0).sort((a, b) => b[1].weight - a[1].weight)
  }, [logs])

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

  if (isLoading) return <PageSkeleton rows={5} />

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

      {/* Stimmungs-Übersicht: wie viele Trainings welche Bewertung */}
      <div className="card">
        <p className="font-bold mb-3 text-sm">Bewertung der Trainings</p>
        <div className="flex justify-between gap-1">
          {MOODS.map(m => {
            const n = sessions.filter(s => s.mood === m.v).length
            return (
              <div key={m.v} className="flex-1 flex flex-col items-center gap-1 bg-surface2 rounded-xl py-3">
                <span className="text-3xl leading-none">{m.e}</span>
                <span className="text-lg font-extrabold leading-none">{n}</span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Stat icon="🏆" value={sessions.length} label="Workouts" color="#22c55e" />
        <Stat icon="⏱️" value={fmtDuration(Math.round(avgDur))} label="Ø Dauer" color="#a855f7" />
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

      <Card title="Volumenverlauf gesamt (kumuliert, kg)">
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={cumVolume}>
            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
            <XAxis dataKey="date" tick={{ fill: '#ffffff60', fontSize: 11 }} />
            <YAxis tick={{ fill: '#ffffff60', fontSize: 11 }} width={48} />
            <Tooltip contentStyle={tipStyle} />
            <Line type="monotone" dataKey="vol" stroke="#22c55e" strokeWidth={3} dot={false} name="kumuliert" />
          </LineChart>
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

      <Card title="Sätze pro Woche">
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={weekly}>
            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
            <XAxis dataKey="week" tick={{ fill: '#ffffff60', fontSize: 11 }} />
            <YAxis allowDecimals={false} tick={{ fill: '#ffffff60', fontSize: 11 }} width={28} />
            <Tooltip contentStyle={tipStyle} cursor={{ fill: '#ffffff08' }} />
            <Bar dataKey="sets" fill="#a855f7" radius={[6, 6, 0, 0]} />
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

      {prs.length > 0 && (
        <Card title="🏅 Bestleistungen (Top-Gewicht je Übung)">
          <div className="space-y-1.5">
            {prs.map(([name, v]) => (
              <div key={name} className="flex items-center justify-between text-sm">
                <span className="text-white/80 truncate pr-2">{name}</span>
                <span className="font-semibold text-accent shrink-0">{v.weight} kg{v.reps ? ` × ${v.reps}` : ''}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <p className="text-center text-xs text-white/35 pb-2">Einzelne Trainings findest du im Tab „Verlauf".</p>
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
