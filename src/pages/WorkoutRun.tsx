import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import {
  getExercises, getSettings, saveSetLog, finalizeSession, deleteSession,
  ddpSuggestion, lastSetsForExercise, getStats, getWeeklyTarget, getTips, getBadges,
  setExerciseTargetWeight, addDiary, getSessionLogs
} from '../lib/db'
import { PlanExercise, WorkoutSession, Settings, MUSCLE_HEX, Badge, SetLog } from '../lib/types'
import { Spinner, Modal, ProgressBar } from '../components/ui'
import { cls, fmtWeight, isoWeekStart, vibrate, todayISO } from '../lib/utils'
import { timerDoneSound, successSound, beep } from '../lib/sound'
import { evaluateBadges } from '../lib/gamification'
import { confetti } from '../lib/confetti'

type Row = { weight: number | null; reps: number | null; completed: boolean; failure: boolean }
type Sug = { action: string; message: string }

export default function WorkoutRun() {
  const { sessionId } = useParams()
  const { profile } = useAuth()
  const nav = useNavigate()

  const [session, setSession] = useState<WorkoutSession | null>(null)
  const [exs, setExs] = useState<PlanExercise[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [rows, setRows] = useState<Record<string, Row[]>>({})
  const rowsRef = useRef<Record<string, Row[]>>({})
  const persistTimers = useRef<Record<string, number>>({})
  const [sugs, setSugs] = useState<Record<string, Sug>>({})
  const [idx, setIdx] = useState(0)
  const [loading, setLoading] = useState(true)

  // rest timer (timestamp-based, übersteht Throttling im Hintergrund)
  const [restTotal, setRestTotal] = useState(90)
  const [restLeft, setRestLeft] = useState<number | null>(null)
  const [restEndAt, setRestEndAt] = useState<number | null>(null)
  const firedRef = useRef(false)
  const wakeRef = useRef<WakeLockSentinel | null>(null)

  // summary
  const [summary, setSummary] = useState<null | {
    xp: number; volume: number; streak: number; level: number; badges: Badge[]; tip: string
  }>(null)

  // Dynamic Double Progression celebration
  const [ddp, setDdp] = useState<null | { exId: string; name: string; current: number; suggested: number; unit: string }>(null)
  const celebrated = useRef<Set<string>>(new Set())
  const progressed = useRef<Set<string>>(new Set())

  // Gesamt-Dauer der Session
  const [elapsed, setElapsed] = useState(0)
  const [showTech, setShowTech] = useState(false)

  // Post-Workout-Tagebuch
  const [mood, setMood] = useState<number | null>(null)
  const [diaryText, setDiaryText] = useState('')
  const [savedDiary, setSavedDiary] = useState(false)

  const load = useCallback(async () => {
    if (!sessionId || !profile) return
    const { data: s } = await supabase.from('workout_sessions').select('*').eq('id', sessionId).single()
    const sess = s as WorkoutSession
    setSession(sess)
    const [st, list] = await Promise.all([
      getSettings(profile.id),
      sess.plan_day_id ? getExercises(sess.plan_day_id) : Promise.resolve([] as PlanExercise[])
    ])
    setSettings(st)
    setRestTotal(st?.default_rest_seconds ?? 90)
    setExs(list)

    // Bereits in DIESER Session gespeicherte Sätze (z. B. nach Browser-Reload)
    const existing = await getSessionLogs(sess.id)
    const byKey: Record<string, SetLog> = {}
    existing.forEach(l => { if (l.plan_exercise_id) byKey[`${l.plan_exercise_id}|${l.set_number}`] = l })

    const r: Record<string, Row[]> = {}
    const sg: Record<string, Sug> = {}
    await Promise.all(list.map(async (ex) => {
      const [last, sug] = await Promise.all([
        lastSetsForExercise(ex.id),
        ddpSuggestion(ex.id).catch(() => null)
      ])
      if (sug) sg[ex.id] = sug
      r[ex.id] = Array.from({ length: ex.sets }, (_, i) => {
        const saved = byKey[`${ex.id}|${i + 1}`]
        if (saved) {
          return {
            weight: saved.weight ?? null, reps: saved.reps ?? null,
            completed: saved.completed, failure: saved.is_failure
          }
        }
        const prev = last[i]
        let w = prev?.weight ?? ex.target_weight ?? null
        if (sess.is_deload && w != null) w = Math.round((w * 0.5) / 0.25) * 0.25
        return { weight: w, reps: null, completed: false, failure: false }
      })
    }))
    setRows(r); rowsRef.current = r; setSugs(sg); setLoading(false)
  }, [sessionId, profile])

  useEffect(() => { load() }, [load])

  // timer tick – Restzeit aus Endzeitstempel berechnen
  useEffect(() => {
    if (restEndAt === null) { setRestLeft(null); return }
    const tick = () => {
      const left = Math.max(0, Math.round((restEndAt - Date.now()) / 1000))
      setRestLeft(left)
      if (left <= 0 && !firedRef.current) {
        firedRef.current = true
        if (settings?.sound_enabled) timerDoneSound()
        if (settings?.vibration_enabled) vibrate([300, 150, 300, 150, 400])
        setRestEndAt(null); setRestLeft(null)
      }
    }
    tick()
    const id = window.setInterval(tick, 250)
    return () => clearInterval(id)
  }, [restEndAt, settings])

  // Screen Wake Lock: Bildschirm während des Trainings anlassen, damit der Timer läuft
  useEffect(() => {
    let active = true
    async function acquire() {
      try {
        if ('wakeLock' in navigator && active) {
          wakeRef.current = await navigator.wakeLock.request('screen')
        }
      } catch { /* z. B. wenn Tab nicht sichtbar – wird bei visibility neu versucht */ }
    }
    acquire()
    const onVis = () => { if (document.visibilityState === 'visible') acquire() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      active = false
      document.removeEventListener('visibilitychange', onVis)
      wakeRef.current?.release?.().catch(() => {})
      wakeRef.current = null
    }
  }, [])

  useEffect(() => { setShowTech(false) }, [idx])

  // Gesamt-Timer ab Session-Start
  useEffect(() => {
    if (!session) return
    const start = new Date(session.started_at).getTime()
    const upd = () => setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000)))
    upd()
    const id = window.setInterval(upd, 1000)
    return () => clearInterval(id)
  }, [session])

  function startRest() { firedRef.current = false; setRestEndAt(Date.now() + restTotal * 1000) }
  function stopRest() { setRestEndAt(null); setRestLeft(null) }
  function adjustRest(delta: number) {
    setRestTotal(t => Math.max(15, t + delta))
    if (restEndAt !== null) setRestEndAt(e => (e ? e + delta * 1000 : e))
  }

  const ex = exs[idx]

  function updateRow(exId: string, i: number, patch: Partial<Row>) {
    setRows(prev => {
      const copy = { ...prev }
      copy[exId] = copy[exId].map((row, j) => j === i ? { ...row, ...patch } : row)
      rowsRef.current = copy
      return copy
    })
    debouncedPersist(exId, i)
  }

  // Eingetippte Werte automatisch sichern (auch ohne Abhaken) → übersteht Reload
  function debouncedPersist(exId: string, i: number) {
    const key = `${exId}|${i}`
    if (persistTimers.current[key]) clearTimeout(persistTimers.current[key])
    persistTimers.current[key] = window.setTimeout(() => persistSet(exId, i), 500)
  }
  async function persistSet(exId: string, i: number) {
    const ex2 = exs.find(e => e.id === exId)
    const row = rowsRef.current[exId]?.[i]
    if (!ex2 || !row) return
    if (row.weight == null && row.reps == null && !row.completed) return // nichts zu speichern
    await saveSetLog({
      session_id: sessionId!, plan_exercise_id: exId, exercise_name: ex2.name,
      muscle_group: ex2.muscle_group, set_number: i + 1,
      target_rep_min: ex2.rep_min, target_rep_max: ex2.rep_max,
      weight: row.weight, reps: row.reps, is_failure: row.failure,
      completed: row.completed, rest_seconds: restTotal
    })
  }

  async function toggleComplete(exId: string, i: number) {
    const ex2 = exs.find(e => e.id === exId)!
    const next = !rows[exId][i].completed
    const updated = rows[exId].map((r, j) => j === i ? { ...r, completed: next } : r)
    setRows(prev => { const c = { ...prev, [exId]: updated }; rowsRef.current = c; return c })
    const row = updated[i]
    if (next) {
      if (settings?.sound_enabled) beep(740, 0.1)
      if (settings?.vibration_enabled) vibrate(40)
      await saveSetLog({
        session_id: sessionId!, plan_exercise_id: exId, exercise_name: ex2.name,
        muscle_group: ex2.muscle_group, set_number: i + 1,
        target_rep_min: ex2.rep_min, target_rep_max: ex2.rep_max,
        weight: row.weight, reps: row.reps, is_failure: row.failure,
        completed: true, rest_seconds: restTotal
      })
      startRest()
      maybeCelebrateDDP(ex2, updated)
    } else {
      await saveSetLog({
        session_id: sessionId!, plan_exercise_id: exId, exercise_name: ex2.name,
        set_number: i + 1, weight: row.weight, reps: row.reps, completed: false
      })
    }
  }

  // Dynamic Double Progression: alle Arbeitssätze erledigt UND alle am oberen Rep-Ende → feiern + Gewicht erhöhen
  function maybeCelebrateDDP(ex2: PlanExercise, list: Row[]) {
    if (celebrated.current.has(ex2.id)) return
    const allDone = list.every(r => r.completed)
    const allTop = list.every(r => (r.reps ?? 0) >= ex2.rep_max)
    const weights = list.map(r => r.weight ?? 0).filter(w => w > 0)
    if (!allDone || !allTop || !weights.length) return
    const w = Math.max(...weights)
    celebrated.current.add(ex2.id)
    confetti()
    if (settings?.sound_enabled) successSound()
    if (settings?.vibration_enabled) vibrate([60, 40, 60, 40, 120])
    const step = ex2.unit === 'kg' ? 2.5 : 5
    setDdp({ exId: ex2.id, name: ex2.name, current: w, suggested: w + step, unit: ex2.unit })
  }

  async function applyIncrease() {
    if (!ddp) return
    await setExerciseTargetWeight(ddp.exId, ddp.suggested)
    setExs(prev => prev.map(e => e.id === ddp.exId ? { ...e, target_weight: ddp.suggested } : e))
    progressed.current.add(ddp.exId)
    setDdp(null)
  }

  const totalSets = exs.reduce((a, e) => a + e.sets, 0)
  const doneSets = Object.values(rows).flat().filter(r => r.completed).length

  async function finish() {
    if (!profile || !sessionId) return
    // persist any rows that have data but weren't toggled complete? Only completed count for stats.
    const res = await finalizeSession(sessionId)
    if (settings?.sound_enabled) successSound()
    vibrate([100, 60, 100, 60, 200])

    // DDP progression happened if the user confirmed at least one weight increase
    const didIncrease = progressed.current.size > 0
    const [stats, week, tips, allBadges] = await Promise.all([
      getStats(profile.id), getWeeklyTarget(profile.id, isoWeekStart()), getTips(), getBadges()
    ])
    const newCodes = stats ? await evaluateBadges(profile.id, stats, {
      totalVolume: res.total_volume, isDeload: session?.is_deload ?? false,
      startedHour: session ? new Date(session.started_at).getHours() : 12,
      didIncrease, weeklyAchieved: week?.achieved ?? false
    }) : []
    const badgeObjs = allBadges.filter(b => newCodes.includes(b.code))
    const tip = tips.length ? tips[Math.floor(Math.random() * tips.length)].text : ''
    setSummary({ xp: res.xp_earned, volume: res.total_volume, streak: res.streak, level: res.level, badges: badgeObjs, tip })
  }

  const MOODS = [
    { v: 1, e: '😣', l: 'mies' },
    { v: 2, e: '😕', l: 'okay' },
    { v: 3, e: '🙂', l: 'gut' },
    { v: 4, e: '💪', l: 'stark' },
    { v: 5, e: '🔥', l: 'top' }
  ]

  async function finishAndGoHome() {
    if (profile && (mood || diaryText.trim()) && !savedDiary) {
      const moodLabel = MOODS.find(m => m.v === mood)?.l
      const parts = [`${session?.day_title ?? 'Training'} abgeschlossen`]
      if (moodLabel) parts.push(`Gefühl: ${moodLabel}`)
      const head = parts.join(' · ')
      const content = diaryText.trim() ? `${head}\n${diaryText.trim()}` : head
      await addDiary({ user_id: profile.id, content, entry_date: todayISO(), mood: mood ?? undefined })
      setSavedDiary(true)
    }
    nav('/')
  }

  async function cancel() {
    if (confirm('Training abbrechen und verwerfen?')) {
      await deleteSession(sessionId!)
      nav('/workout')
    }
  }

  if (loading) return <div className="min-h-screen grid place-items-center"><Spinner label="Training wird geladen…" /></div>
  if (!ex) return (
    <div className="min-h-screen grid place-items-center p-6 text-center">
      <div>
        <p className="text-white/60 mb-4">Keine Übungen in dieser Session.</p>
        <button className="btn-primary" onClick={() => nav('/workout')}>Zurück</button>
      </div>
    </div>
  )

  const sug = sugs[ex.id]
  const color = MUSCLE_HEX[ex.muscle_group] ?? '#64748b'

  return (
    <div className="min-h-screen flex flex-col bg-bg">
      {/* Header */}
      <header className="pt-safe px-4 pt-3 pb-2 sticky top-0 bg-bg/95 backdrop-blur z-10 border-b border-white/5">
        <div className="flex items-center justify-between mb-2">
          <button className="btn-ghost !px-3 !py-1.5 text-sm" onClick={cancel}>✕</button>
          <div className="text-center min-w-0 px-2">
            <p className="text-[11px] text-white/45 truncate">{session?.day_title}</p>
            <p className="text-base font-bold tabular-nums leading-none">
              ⏱ {Math.floor(elapsed / 3600) > 0 ? `${Math.floor(elapsed / 3600)}:` : ''}{String(Math.floor((elapsed % 3600) / 60)).padStart(Math.floor(elapsed / 3600) > 0 ? 2 : 1, '0')}:{String(elapsed % 60).padStart(2, '0')}
            </p>
          </div>
          <button className="btn-accent !px-3 !py-1.5 text-sm" onClick={finish}>Fertig ✓</button>
        </div>
        <div className="flex items-center gap-2">
          <ProgressBar pct={(doneSets / Math.max(1, totalSets)) * 100} color="#22c55e" />
          <span className="text-xs text-white/50 shrink-0">{doneSets}/{totalSets}</span>
        </div>
        {session?.is_deload && <p className="text-xs text-accent mt-1">🧘 Deload – Gewichte ~50 %</p>}
      </header>

      {/* Exercise body */}
      <main className="flex-1 px-4 py-4 pb-40 overflow-y-auto">
        <p className="text-xs text-white/40">Übung {idx + 1} / {exs.length}</p>
        <h1 className="text-2xl font-extrabold flex items-center gap-2 mt-1" style={{ color }}>
          <span>{ex.color}</span> <span className="text-white">{ex.name}</span>
        </h1>
        <p className="text-white/55 mt-1">
          Ziel: {ex.sets} × {ex.rep_min}-{ex.rep_max}{ex.per_side ? '/Seite' : ''}
          {ex.target_weight != null && <> · {fmtWeight(ex.target_weight, ex.unit)}</>}
        </p>
        {ex.is_warning && ex.cue && (
          <div className="mt-3 text-sm bg-danger/10 border border-danger/20 rounded-xl p-3 text-red-200/90">⚠️ {ex.cue}</div>
        )}
        {!ex.is_warning && ex.cue && <p className="text-sm text-white/45 mt-2 leading-snug">💬 {ex.cue}</p>}

        {ex.technique && (
          <div className="mt-3">
            <button className="btn-ghost w-full !justify-between text-sm" onClick={() => setShowTech(s => !s)}>
              <span>ℹ️ Ausführung im Detail</span>
              <span className={cls('transition-transform', showTech && 'rotate-180')}>▾</span>
            </button>
            {showTech && (
              <p className="text-sm text-white/70 leading-relaxed mt-2 bg-surface2 rounded-xl p-3 whitespace-pre-wrap">{ex.technique}</p>
            )}
          </div>
        )}

        {sug && (
          <div className={cls('mt-3 text-sm rounded-xl p-3 border',
            sug.action === 'increase' ? 'bg-success/10 border-success/30 text-green-200'
              : sug.action === 'hold' ? 'bg-white/5 border-white/10 text-white/70'
                : 'bg-primary/10 border-primary/20 text-sky-200')}>
            📈 {sug.message}
          </div>
        )}

        {/* Sets */}
        <div className="mt-5 space-y-2">
          <div className="grid grid-cols-[2rem_1fr_1fr_3rem] gap-2 px-1 text-[11px] text-white/40 font-medium">
            <span>Satz</span><span>Gewicht ({ex.unit})</span><span>Reps</span><span className="text-center">✓</span>
          </div>
          {(rows[ex.id] ?? []).map((row, i) => (
            <div key={i} className={cls('grid grid-cols-[2rem_1fr_1fr_3rem] gap-2 items-center rounded-xl p-2 transition',
              row.completed ? 'bg-success/15 border border-success/30' : 'bg-surface2')}>
              <span className="text-center font-bold text-white/60">{i + 1}</span>
              <NumberStepper value={row.weight} step={ex.unit === 'kg' ? 2.5 : 5}
                onChange={(v) => updateRow(ex.id, i, { weight: v })} />
              <NumberStepper value={row.reps} step={1} placeholder={`${ex.rep_min}-${ex.rep_max}`}
                onChange={(v) => updateRow(ex.id, i, { reps: v })} />
              <button onClick={() => toggleComplete(ex.id, i)}
                className={cls('h-10 rounded-lg font-bold text-lg transition active:scale-90',
                  row.completed ? 'bg-success text-white' : 'bg-white/10 text-white/40')}>
                {row.completed ? '✓' : '○'}
              </button>
            </div>
          ))}
          <label className="flex items-center gap-2 text-xs text-white/50 px-1 pt-1">
            <input type="checkbox"
              checked={(rows[ex.id] ?? []).slice(-1)[0]?.failure ?? false}
              onChange={(e) => updateRow(ex.id, (rows[ex.id]?.length ?? 1) - 1, { failure: e.target.checked })} />
            Letzter Satz bis zum Muskelversagen
          </label>
        </div>

        {/* Exercise nav */}
        <div className="flex gap-2 mt-6">
          <button className="btn-ghost flex-1" disabled={idx === 0} onClick={() => { setIdx(i => i - 1); window.scrollTo(0, 0) }}>← Zurück</button>
          {idx < exs.length - 1
            ? <button className="btn-primary flex-1" onClick={() => { setIdx(i => i + 1); window.scrollTo(0, 0) }}>Nächste →</button>
            : <button className="btn-accent flex-1" onClick={finish}>Training beenden ✓</button>}
        </div>
      </main>

      {/* Rest timer bar */}
      <div className="fixed bottom-0 inset-x-0 z-20 bg-surface/95 backdrop-blur border-t border-white/10 pb-safe">
        <div className="px-4 py-3 max-w-2xl mx-auto">
          {restLeft !== null ? (
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-white/60">Pause</span>
                  <span className="text-2xl font-extrabold tabular-nums" style={{ color: restLeft <= 5 ? '#ef4444' : '#0ea5e9' }}>
                    {Math.floor(restLeft / 60)}:{String(restLeft % 60).padStart(2, '0')}
                  </span>
                </div>
                <ProgressBar pct={(restLeft / restTotal) * 100} color={restLeft <= 5 ? '#ef4444' : '#0ea5e9'} />
              </div>
              <button className="btn-ghost !px-3" onClick={() => adjustRest(-15)}>-15</button>
              <button className="btn-ghost !px-3" onClick={() => adjustRest(15)}>+15</button>
              <button className="btn-primary !px-3" onClick={stopRest}>Skip</button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <button className="btn-ghost !px-3" onClick={() => adjustRest(-15)}>-15</button>
              <button className="btn-primary flex-1" onClick={startRest}>⏱️ Pause {restTotal}s starten</button>
              <button className="btn-ghost !px-3" onClick={() => adjustRest(15)}>+15</button>
            </div>
          )}
        </div>
      </div>

      {/* DDP celebration */}
      {ddp && (
        <Modal open onClose={() => setDdp(null)} title="🎉 Rep-Range geknackt!">
          <div className="space-y-4 text-center">
            <p className="text-5xl animate-pop">📈🎊</p>
            <p className="text-white/80">
              Du hast bei <span className="font-bold text-white">{ddp.name}</span> alle Sätze am
              oberen Ende der Wiederholungs-Range geschafft – <b>Dynamic Double Progression!</b>
            </p>
            <div className="card bg-success/10 border-success/30">
              <p className="text-sm text-white/60">Neues Arbeitsgewicht</p>
              <p className="text-2xl font-extrabold text-success">
                {fmtWeight(ddp.current, ddp.unit)} → {fmtWeight(ddp.suggested, ddp.unit)}
              </p>
            </div>
            <div className="flex items-center justify-center gap-2">
              <button className="btn-ghost !px-3" onClick={() => setDdp(d => d && { ...d, suggested: Math.max(d.current, d.suggested - (ddp.unit === 'kg' ? 2.5 : 5)) })}>−</button>
              <span className="text-sm text-white/60">Gewicht anpassen</span>
              <button className="btn-ghost !px-3" onClick={() => setDdp(d => d && { ...d, suggested: d.suggested + (ddp.unit === 'kg' ? 2.5 : 5) })}>+</button>
            </div>
            <div className="flex gap-2">
              <button className="btn-ghost flex-1" onClick={() => setDdp(null)}>Später</button>
              <button className="btn-accent flex-1" onClick={applyIncrease}>Gewicht erhöhen ✓</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Summary */}
      {summary && (
        <Modal open onClose={finishAndGoHome} title="🎉 Workout abgeschlossen!">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <SumBox icon="⚡" v={`+${summary.xp}`} l="XP verdient" />
              <SumBox icon="⭐" v={`Lvl ${summary.level}`} l="Level" />
              <SumBox icon="🔥" v={`${summary.streak}`} l="Tage Streak" />
              <SumBox icon="🏋️" v={`${Math.round(summary.volume).toLocaleString('de-DE')} kg`} l="Volumen" />
            </div>
            {summary.badges.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-white/60 mb-2">Neue Abzeichen 🏅</p>
                <div className="flex flex-wrap gap-2">
                  {summary.badges.map(b => (
                    <div key={b.code} className="bg-accent/15 border border-accent/30 rounded-xl px-3 py-2 text-sm animate-pop">
                      <span className="text-lg mr-1">{b.icon}</span>{b.name}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tagebuch-Abfrage */}
            <div className="card bg-surface2 border-white/5">
              <p className="font-semibold mb-2">📔 Wie war dein Training?</p>
              <div className="flex justify-between gap-1 mb-3">
                {MOODS.map(m => (
                  <button key={m.v} onClick={() => setMood(m.v)}
                    className={cls('flex-1 flex flex-col items-center gap-0.5 py-2 rounded-xl transition active:scale-90',
                      mood === m.v ? 'bg-primary/20 ring-2 ring-primary' : 'bg-white/5')}>
                    <span className="text-2xl">{m.e}</span>
                    <span className="text-[10px] text-white/50">{m.l}</span>
                  </button>
                ))}
              </div>
              <textarea className="input min-h-[64px]" value={diaryText} onChange={e => setDiaryText(e.target.value)}
                placeholder="Notiz fürs Tagebuch (optional) – Gedanken, Schmerzen, Highlights…" />
              <p className="text-[11px] text-white/35 mt-1">Wird mit Datum automatisch ins Tagebuch übernommen.</p>
            </div>

            {summary.tip && (
              <div className="card bg-primary/5 border-primary/15 text-sm text-white/80">💡 {summary.tip}</div>
            )}
            <button className="btn-primary w-full" onClick={finishAndGoHome}>
              {mood || diaryText.trim() ? 'Speichern & zum Dashboard' : 'Zum Dashboard'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function SumBox({ icon, v, l }: { icon: string; v: string; l: string }) {
  return (
    <div className="card flex flex-col items-center py-3">
      <span className="text-2xl">{icon}</span>
      <span className="text-xl font-extrabold mt-1">{v}</span>
      <span className="text-xs text-white/50">{l}</span>
    </div>
  )
}

function NumberStepper({ value, step, onChange, placeholder }:
  { value: number | null; step: number; onChange: (v: number | null) => void; placeholder?: string }) {
  return (
    <div className="flex items-center bg-bg rounded-lg overflow-hidden border border-white/10">
      <button className="px-2.5 py-2 text-white/50 active:bg-white/10 text-lg leading-none"
        onClick={() => onChange(Math.max(0, (value ?? 0) - step))}>−</button>
      <input className="w-full bg-transparent text-center font-semibold outline-none py-2 text-[15px]"
        type="number" inputMode="decimal" value={value ?? ''} placeholder={placeholder ?? '0'}
        onChange={(e) => onChange(e.target.value === '' ? null : +e.target.value)} />
      <button className="px-2.5 py-2 text-white/50 active:bg-white/10 text-lg leading-none"
        onClick={() => onChange((value ?? 0) + step)}>+</button>
    </div>
  )
}
