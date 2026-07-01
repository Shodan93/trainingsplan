import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../lib/auth'
import { getActivePlan, getDays, getDayExercises, startSession, getOpenSession, deleteSession } from '../lib/db'
import { PlanDay, PlanExercise } from '../lib/types'
import { PageSkeleton, EmptyState } from '../components/ui'
import { cls } from '../lib/utils'

const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

export default function WorkoutPicker() {
  const { profile } = useAuth()
  const nav = useNavigate()
  const [deload, setDeload] = useState(false)
  const [busy, setBusy] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['workout-picker', profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const [plan, open] = await Promise.all([getActivePlan(profile!.id), getOpenSession(profile!.id)])
      let days: PlanDay[] = []
      const counts: Record<string, number> = {}
      const mains: Record<string, string> = {}
      if (plan) {
        days = await getDays(plan.id)
        const ex = await getDayExercises(days.map(x => x.id))
        ex.forEach((e: PlanExercise) => {
          counts[e.plan_day_id] = (counts[e.plan_day_id] ?? 0) + 1
          if (!mains[e.plan_day_id]) mains[e.plan_day_id] = e.name
        })
      }
      return { plan, days, counts, mains, open }
    }
  })
  const plan = data?.plan ?? null
  const days = data?.days ?? []
  const counts = data?.counts ?? {}
  const mains = data?.mains ?? {}
  const open = data?.open ?? null

  async function start(day: PlanDay) {
    if (!profile || !plan) return
    setBusy(true)
    try {
      // Stand frisch prüfen (Constraint: nur eine offene Session pro User)
      const current = await getOpenSession(profile.id)
      if (current && current.plan_day_id === day.id) { nav(`/workout/run/${current.id}`); return }
      if (current) await deleteSession(current.id)
      const session = await startSession({
        user_id: profile.id, plan_id: plan.id, plan_day_id: day.id,
        day_title: `${day.weekday} · ${day.title}`, is_deload: deload
      })
      nav(`/workout/run/${session.id}`)
    } catch (e) {
      console.error(e)
      setBusy(false)
      alert('Training konnte nicht gestartet werden. Bitte erneut versuchen.')
    }
  }

  if (isLoading) return <PageSkeleton rows={4} />
  const todayWd = WD[new Date().getDay()]

  return (
    <div className="space-y-4 py-2">
      <h1 className="text-2xl font-extrabold pt-2">🔥 Training starten</h1>

      {!plan ? (
        <EmptyState icon="📋" title="Kein aktiver Plan" hint={'Lege zuerst im Tab „Plan“ einen Plan an.'} />
      ) : (
        <>
          {open && (
            <button onClick={() => nav(`/workout/run/${open.id}`)}
              className="card w-full text-left border-accent/40 bg-accent/10 flex items-center justify-between active:scale-[0.99]">
              <div>
                <p className="font-bold text-accent">▶ Laufendes Training fortsetzen</p>
                <p className="text-xs text-white/55 mt-0.5">{open.day_title}</p>
              </div>
              <span className="text-2xl">↩︎</span>
            </button>
          )}

          <label className="card flex items-center justify-between cursor-pointer">
            <div>
              <p className="font-semibold">🧘 Deload-Woche</p>
              <p className="text-xs text-white/50">Alle Gewichte ~50 %, gleiches Programm (Woche {plan.deload_week})</p>
            </div>
            <input type="checkbox" className="w-5 h-5" checked={deload} onChange={e => setDeload(e.target.checked)} />
          </label>

          <p className="text-sm text-white/50 px-1">Wähle deinen Trainingstag:</p>
          {days.map(day => {
            const today = day.weekday === todayWd
            return (
              <button key={day.id} disabled={busy} onClick={() => start(day)}
                className={cls('card w-full text-left flex items-center justify-between active:scale-[0.99] transition',
                  today && 'border-primary/40 bg-primary/10')}>
                <div>
                  <p className="font-bold flex items-center gap-2">
                    {day.weekday} · {day.title}
                    {today && <span className="chip bg-primary/20 text-primary">heute</span>}
                  </p>
                  <p className="text-xs text-white/45 mt-0.5">{day.effort} · {counts[day.id] ?? 0} Übungen</p>
                  {mains[day.id] && <p className="text-xs text-primary/80 mt-0.5">🏋️ {mains[day.id]}</p>}
                </div>
                <span className="text-2xl">▶</span>
              </button>
            )
          })}
        </>
      )}
    </div>
  )
}
