import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { getActivePlan, getDays, getDayExercises, startSession } from '../lib/db'
import { Plan, PlanDay, PlanExercise } from '../lib/types'
import { Spinner, EmptyState } from '../components/ui'
import { cls } from '../lib/utils'

const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

export default function WorkoutPicker() {
  const { profile } = useAuth()
  const nav = useNavigate()
  const [plan, setPlan] = useState<Plan | null>(null)
  const [days, setDays] = useState<PlanDay[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [deload, setDeload] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!profile) return
    ;(async () => {
      const pl = await getActivePlan(profile.id)
      setPlan(pl)
      if (pl) {
        const d = await getDays(pl.id)
        setDays(d)
        const ex = await getDayExercises(d.map(x => x.id))
        const c: Record<string, number> = {}
        ex.forEach((e: PlanExercise) => { c[e.plan_day_id] = (c[e.plan_day_id] ?? 0) + 1 })
        setCounts(c)
      }
      setLoading(false)
    })()
  }, [profile])

  async function start(day: PlanDay) {
    if (!profile || !plan) return
    setBusy(true)
    const session = await startSession({
      user_id: profile.id, plan_id: plan.id, plan_day_id: day.id,
      day_title: `${day.weekday} · ${day.title}`, is_deload: deload
    })
    nav(`/workout/run/${session.id}`)
  }

  if (loading) return <Spinner label="Lade Training…" />
  const todayWd = WD[new Date().getDay()]

  return (
    <div className="space-y-4 py-2">
      <h1 className="text-2xl font-extrabold pt-2">🔥 Training starten</h1>

      {!plan ? (
        <EmptyState icon="📋" title="Kein aktiver Plan" hint={'Lege zuerst im Tab „Plan“ einen Plan an.'} />
      ) : (
        <>
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
