import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../lib/auth'
import {
  getStats, getActivePlan, getDays, tipOfTheDay, getWeeklyTarget, ensureWeeklyTarget,
  getProfiles, getOpenSession, deleteSession, countCompletedSessionsInWeek, getDeloadInfo, startSession
} from '../lib/db'
import { UserStats, Profile } from '../lib/types'
import { greeting, isoWeekStart, cls, fmtDateTime } from '../lib/utils'
import { PageSkeleton, ProgressBar, Chip, Modal } from '../components/ui'

const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
const CAT_LABEL: Record<string, string> = {
  motivation: 'Motivation', technik: 'Technik', progression: 'Progression',
  ernaehrung: 'Ernährung', regeneration: 'Regeneration', mindset: 'Mindset'
}

export default function Dashboard() {
  const { profile } = useAuth()
  const nav = useNavigate()
  const qc = useQueryClient()
  const [dismissedResume, setDismissedResume] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const uid = profile!.id
      const ws = isoWeekStart()
      const [stats, plan, tip, allProfiles, openSession, deload] = await Promise.all([
        getStats(uid), getActivePlan(uid), tipOfTheDay(), getProfiles(), getOpenSession(uid), getDeloadInfo(uid)
      ])
      const days = plan ? await getDays(plan.id) : []
      // Standard-Wochenziel = Anzahl der Plan-Tage (im Profil weiter anpassbar)
      await ensureWeeklyTarget(uid, ws, days.length || 4)
      const [week, weekDone] = await Promise.all([getWeeklyTarget(uid, ws), countCompletedSessionsInWeek(uid, ws)])
      const anchor = deload.lastDeload ?? deload.firstSession
      const deloadDue = !!anchor && (Date.now() - new Date(anchor).getTime()) > 42 * 86400000
      return { stats, plan, days, tip, partners: allProfiles.filter(p => p.id !== uid), openSession, week, weekDone, deloadDue }
    }
  })

  const stats = data?.stats ?? null
  const plan = data?.plan ?? null
  const days = data?.days ?? []
  const tip = data?.tip ?? null
  const week = data?.week ?? null
  const weekDone = data?.weekDone ?? 0
  const partners = data?.partners ?? []
  const openSession = data?.openSession ?? null
  const deloadDue = data?.deloadDue ?? false
  const showResume = !!openSession && !dismissedResume

  const todayWd = WD[new Date().getDay()]
  const suggestedDay = useMemo(
    () => days.find(d => d.weekday === todayWd) ?? null,
    [days, todayWd]
  )

  const [starting, setStarting] = useState(false)
  // Direktstart: heutiges Training sofort beginnen (offene Session wird fortgesetzt)
  async function startToday() {
    if (starting || !profile) return
    setStarting(true)
    try {
      if (openSession) { nav(`/workout/run/${openSession.id}`); return }
      if (plan && suggestedDay) {
        const s = await startSession({
          user_id: profile.id, plan_id: plan.id, plan_day_id: suggestedDay.id,
          day_title: `${suggestedDay.weekday} · ${suggestedDay.title}`, is_deload: false
        })
        qc.invalidateQueries({ queryKey: ['dashboard'] })
        nav(`/workout/run/${s.id}`)
        return
      }
      nav('/workout')
    } catch { nav('/workout') } finally { setStarting(false) }
  }

  if (isLoading) return <PageSkeleton rows={5} />

  return (
    <div className="space-y-4 py-2">
      <header className="pt-2">
        <p className="text-sm text-white/45">{greeting()},</p>
        <h1 className="text-2xl font-bold">{profile?.display_name}</h1>
      </header>

      {/* Laufendes Training */}
      {openSession && (
        <button onClick={() => nav(`/workout/run/${openSession.id}`)}
          className="card w-full text-left border-accent/40 flex items-center justify-between active:scale-[0.99]">
          <div>
            <p className="font-semibold text-accent">Laufendes Training fortsetzen</p>
            <p className="text-xs text-white/55 mt-0.5">{openSession.day_title} · {fmtDateTime(openSession.started_at)}</p>
          </div>
          <span className="text-xl text-white/40">›</span>
        </button>
      )}

      {/* Wiedereinstiegs-Dialog */}
      {openSession && (
        <Modal open={showResume} onClose={() => setDismissedResume(true)} title="Laufendes Training gefunden">
          <div className="space-y-4">
            <p className="text-white/75">
              Du hast ein nicht beendetes Training: <b>{openSession.day_title}</b>
              <span className="text-white/45"> · gestartet {fmtDateTime(openSession.started_at)}</span>.
              Deine bereits eingetragenen Sätze sind gespeichert.
            </p>
            <div className="flex gap-2">
              <button className="btn-ghost flex-1" onClick={async () => {
                if (confirm('Training wirklich verwerfen?')) { await deleteSession(openSession.id); setDismissedResume(true); qc.invalidateQueries({ queryKey: ['dashboard'] }) }
              }}>Verwerfen</button>
              <button className="btn-primary flex-1" onClick={() => nav(`/workout/run/${openSession.id}`)}>Fortsetzen</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Start training */}
      <div className="card border-primary/25">
        <p className="text-sm text-white/55">Heute · {todayWd}</p>
        {suggestedDay ? (
          <>
            <h2 className="text-xl font-bold mt-0.5">{suggestedDay.title}</h2>
            {suggestedDay.effort && <p className="text-sm text-white/50 mt-0.5">{suggestedDay.effort}</p>}
          </>
        ) : (
          <h2 className="text-xl font-bold mt-0.5">Kein fester Tag – frei wählen</h2>
        )}
        <button className="btn-primary w-full mt-3 text-base py-3" disabled={starting} onClick={startToday}>
          {starting ? 'Startet…' : openSession ? 'Training fortsetzen' : 'Training starten'}
        </button>
        <button className="w-full mt-2 text-xs text-white/45 underline underline-offset-2" onClick={() => nav('/workout')}>
          Anderes Training wählen
        </button>
      </div>

      {/* Streak + Wochenziel (dezent) */}
      <div className="card">
        <div className="grid grid-cols-2 gap-4 items-center">
          <div>
            <p className="text-2xl font-bold leading-none">{stats?.current_streak ?? 0} <span className="text-sm font-medium text-white/45">Tage</span></p>
            <p className="text-xs text-white/45 mt-1">Streak · Best: {stats?.longest_streak ?? 0}</p>
          </div>
          <div>
            <div className="flex items-baseline justify-between mb-1.5">
              <p className="text-xs text-white/45">Wochenziel</p>
              <p className={cls('text-sm font-semibold', week && weekDone >= week.target_workouts ? 'text-success' : 'text-white/70')}>
                {weekDone}/{week?.target_workouts ?? 4}
              </p>
            </div>
            <ProgressBar pct={week ? (weekDone / week.target_workouts) * 100 : 0} color="#22c55e" />
          </div>
        </div>
      </div>

      {/* Deload-Hinweis (autoreguliert) */}
      {deloadDue && (
        <div className="card border-accent/25">
          <p className="font-semibold text-sm">Deload empfohlen</p>
          <p className="text-xs text-white/55 mt-1 leading-relaxed">
            Mehr als 6 Wochen ohne leichtere Woche. Plane ein Training mit ~50 % Gewicht
            (Deload-Schalter beim Start) – das schützt Gelenke und hält die Progression am Laufen.
          </p>
        </div>
      )}

      {/* Tipp des Tages */}
      {tip && (
        <div className="card">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold text-white/70">Tipp des Tages</span>
            <Chip>{CAT_LABEL[tip.category] ?? tip.category}</Chip>
          </div>
          <p className="text-white/80 leading-relaxed text-[15px]">{tip.text}</p>
        </div>
      )}

      {/* Partner */}
      {partners.length > 0 && (
        <div>
          <p className="text-sm font-semibold text-white/50 mb-2 px-1">Trainingspartner</p>
          <div className="flex gap-3">
            {partners.map(p => <PartnerCard key={p.id} p={p} />)}
          </div>
        </div>
      )}
    </div>
  )
}

function PartnerCard({ p }: { p: Profile }) {
  const [st, setSt] = useState<UserStats | null>(null)
  useEffect(() => { getStats(p.id).then(setSt) }, [p.id])
  return (
    <div className="card flex-1 flex items-center gap-3">
      <span className="text-2xl">{p.avatar_emoji}</span>
      <div className="min-w-0">
        <p className="font-semibold truncate">{p.display_name}</p>
        <p className="text-xs text-white/50">Streak {st?.current_streak ?? 0} · {st?.total_workouts ?? 0} Workouts</p>
      </div>
    </div>
  )
}
