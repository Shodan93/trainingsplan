import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../lib/auth'
import {
  getSessions, setLogsForSessions, deleteSession,
  getSessionLogs, updateSetLogById, deleteSetLog, updateSession, recomputeSessionVolume, recomputeStats
} from '../lib/db'
import { WorkoutSession, SetLog } from '../lib/types'
import { Spinner, PageSkeleton, EmptyState, Modal } from '../components/ui'
import { fmtDate, fmtDuration, parseNum, MOODS, moodEmoji, cls } from '../lib/utils'

export default function History() {
  const { profile } = useAuth()
  const [sessions, setSessions] = useState<WorkoutSession[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [editSession, setEditSession] = useState<WorkoutSession | null>(null)

  async function load() {
    if (!profile) return
    setLoading(true)
    const ss = await getSessions(profile.id, 300)
    setSessions(ss)
    const logs = await setLogsForSessions(ss.map(s => s.id))
    const c: Record<string, number> = {}
    logs.forEach(l => { c[l.session_id] = (c[l.session_id] ?? 0) + 1 })
    setCounts(c)
    setLoading(false)
  }
  useEffect(() => { load() }, [profile])

  if (loading) return <PageSkeleton rows={5} />

  return (
    <div className="space-y-4 py-2">
      <h1 className="text-2xl font-extrabold pt-2">📖 Trainingsverlauf</h1>
      {!sessions.length ? (
        <EmptyState icon="📭" title="Noch keine Trainings" hint="Deine abgeschlossenen Trainings erscheinen hier – mit Übungen und Notiz." />
      ) : (
        <div className="space-y-2">
          {sessions.map(s => (
            <button key={s.id} onClick={() => setEditSession(s)} className="card w-full text-left active:scale-[0.99] flex gap-3 items-start">
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold truncate">{s.day_title ?? 'Training'} {s.is_deload && '🧘'}</p>
                  <span className="text-xs text-white/40 shrink-0">{fmtDate(s.completed_at ?? s.started_at)}</span>
                </div>
                <p className="text-xs text-white/45 mt-0.5">
                  {fmtDuration(s.duration_seconds)} · {Math.round(Number(s.total_volume)).toLocaleString('de-DE')} kg · {counts[s.id] ?? 0} Sätze · +{s.xp_earned} XP
                </p>
                {s.notes && <p className="text-xs text-white/55 mt-1 line-clamp-2">📔 {s.notes}</p>}
              </div>
              {s.mood && <span className="text-3xl leading-none shrink-0" title="Bewertung">{moodEmoji(s.mood)}</span>}
            </button>
          ))}
        </div>
      )}
      {editSession && (
        <SessionEditor session={editSession} onClose={() => setEditSession(null)}
          onChanged={() => { setEditSession(null); load() }} />
      )}
    </div>
  )
}

function SessionEditor({ session, onClose, onChanged }:
  { session: WorkoutSession; onClose: () => void; onChanged: () => void }) {
  const [logs, setLogs] = useState<SetLog[]>([])
  const [notes, setNotes] = useState(session.notes ?? '')
  const [mood, setMood] = useState<number | null>(session.mood ?? null)
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
    await updateSession(session.id, { notes: notes.trim() || null, mood })
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
          <p className="text-xs text-white/45">{session.day_title} · {fmtDate(session.completed_at ?? session.started_at)} · {fmtDuration(session.duration_seconds)}</p>
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
            <label className="label">Bewertung (Tagebuch)</label>
            <div className="flex justify-between gap-1">
              {MOODS.map(m => (
                <button key={m.v} onClick={() => setMood(mood === m.v ? null : m.v)}
                  className={cls('flex-1 flex flex-col items-center gap-0.5 py-2 rounded-xl transition active:scale-90',
                    mood === m.v ? 'bg-primary/20 ring-2 ring-primary' : 'bg-white/5')}>
                  <span className="text-2xl">{m.e}</span>
                  <span className="text-[10px] text-white/50">{m.l}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label">Notiz / Kommentar (Tagebuch)</label>
            <textarea className="input min-h-[70px]" value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <button className="btn-danger" onClick={async () => { if (confirm('Ganzes Training löschen?')) { await deleteSession(session.id); await recomputeStats(session.user_id); onChanged() } }}>Löschen</button>
            <button className="btn-primary flex-1" disabled={busy} onClick={save}>{busy ? 'Speichern…' : 'Speichern'}</button>
          </div>
        </div>
      )}
    </Modal>
  )
}
