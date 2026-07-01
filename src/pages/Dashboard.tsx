import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../lib/auth'
import {
  getStats, getActivePlan, getDays, tipOfTheDay, getWeeklyTarget, ensureWeeklyTarget,
  getProfiles, getOpenSession, deleteSession, countCompletedSessionsInWeek
} from '../lib/db'
import { UserStats, Plan, PlanDay, MotivationTip, WeeklyTarget, Profile, WorkoutSession } from '../lib/types'
import { greeting, levelProgress, isoWeekStart, cls, fmtDateTime } from '../lib/utils'
import { PageSkeleton, ProgressBar, Stat, Chip, Modal } from '../components/ui'

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
      const [stats, plan, tip, allProfiles, openSession] = await Promise.all([
        getStats(uid), getActivePlan(uid), tipOfTheDay(), getProfiles(), getOpenSession(uid)
      ])
      const days = plan ? await getDays(plan.id) : []
      await ensureWeeklyTarget(uid, ws)
      const [week, weekDone] = await Promise.all([getWeeklyTarget(uid, ws), countCompletedSessionsInWeek(uid, ws)])
      return { stats, plan, days, tip, partners: allProfiles.filter(p => p.id !== uid), openSession, week, weekDone }
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
  const showResume = !!openSession && !dismissedResume

  const todayWd = WD[new Date().getDay()]
  const suggestedDay = useMemo(
    () => days.find(d => d.weekday === todayWd) ?? null,
    [days, todayWd]
  )

  if (isLoading) return <PageSkeleton rows={5} />
  const lp = stats ? levelProgress(stats.xp, stats.level) : { pct: 0, next: 0 }

  return (
    <div className="space-y-5 py-2">
      <header className="pt-2">
        <p className="text-white/50">{greeting()},</p>
        <h1 className="text-2xl font-extrabold">{profile?.avatar_emoji} {profile?.display_name}</h1>
      </header>

      {/* Laufendes Training */}
      {openSession && (
        <button onClick={() => nav(`/workout/run/${openSession.id}`)}
          className="card w-full text-left border-accent/50 bg-accent/10 flex items-center justify-between active:scale-[0.99]">
          <div>
            <p className="font-bold text-accent">▶ Laufendes Training fortsetzen</p>
            <p className="text-xs text-white/55 mt-0.5">{openSession.day_title} · {fmtDateTime(openSession.started_at)}</p>
          </div>
          <span className="text-2xl">↩︎</span>
        </button>
      )}

      {/* Wiedereinstiegs-Dialog */}
      {openSession && (
        <Modal open={showResume} onClose={() => setDismissedResume(true)} title="🏋️ Laufendes Training gefunden">
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

      {/* Level + XP */}
      <div className="card">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-2xl">⭐</span>
            <div>
              <p className="font-bold leading-none">Level {stats?.level ?? 1}</p>
              <p className="text-xs text-white/50">{stats?.xp ?? 0} XP</p>
            </div>
          </div>
          <span className="text-xs text-white/40">noch {Math.max(0, lp.next - (stats?.xp ?? 0))} XP</span>
        </div>
        <ProgressBar pct={lp.pct} color="#f59e0b" />
      </div>

      {/* Stat row */}
      <div className="flex gap-3">
        <Stat icon="🔥" value={stats?.current_streak ?? 0} label="Tage Streak" color="#f59e0b" />
        <Stat icon="🏆" value={stats?.total_workouts ?? 0} label="Workouts" color="#22c55e" />
        <Stat icon="⚡" value={stats?.longest_streak ?? 0} label="Best Streak" color="#0ea5e9" />
      </div>

      {/* Weekly goal */}
      {week && (
        <div className="card">
          <div className="flex items-center justify-between mb-2">
            <p className="font-bold flex items-center gap-2">🎯 Wochenziel</p>
            <span className={cls('chip', weekDone >= week.target_workouts ? 'bg-success/20 text-success' : 'bg-white/10 text-white/60')}>
              {weekDone}/{week.target_workouts} {weekDone >= week.target_workouts ? '✓' : ''}
            </span>
          </div>
          <ProgressBar pct={(weekDone / week.target_workouts) * 100} color="#22c55e" />
        </div>
      )}

      {/* Start training */}
      <div className="card bg-gradient-to-br from-primary/20 to-accent/10 border-primary/20">
        <p className="text-sm text-white/60">Heute ({todayWd})</p>
        {suggestedDay ? (
          <>
            <h2 className="text-xl font-extrabold mt-0.5">{suggestedDay.title}</h2>
            {suggestedDay.effort && <p className="text-sm text-white/50 mt-0.5">{suggestedDay.effort}</p>}
          </>
        ) : (
          <h2 className="text-xl font-extrabold mt-0.5">Kein fester Tag – frei wählen</h2>
        )}
        <button className="btn-primary w-full mt-3 text-base py-3" onClick={() => nav('/workout')}>
          🔥 Training starten
        </button>
      </div>

      {/* Tip of the day */}
      {tip && (
        <div className="card border-accent/20">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">💡</span>
            <span className="font-bold">Tipp des Tages</span>
            <Chip color="#f59e0b">{CAT_LABEL[tip.category] ?? tip.category}</Chip>
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
      <span className="text-3xl">{p.avatar_emoji}</span>
      <div className="min-w-0">
        <p className="font-bold truncate">{p.display_name}</p>
        <p className="text-xs text-white/50">Lvl {st?.level ?? 1} · 🔥 {st?.current_streak ?? 0} · {st?.total_workouts ?? 0} WO</p>
      </div>
    </div>
  )
}
