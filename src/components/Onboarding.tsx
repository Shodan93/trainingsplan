import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { updateSettings, addWeightLog } from '../lib/db'
import { Settings } from '../lib/types'
import { GOAL_LABEL, GoalType, recommendedGoalWeight } from '../lib/health'
import { cls, parseNum } from '../lib/utils'

const GOAL_HINT: Record<GoalType, string> = {
  cut: 'Optimale Abnehmrate (~0,5 % KG/Woche), um Muskeln zu halten',
  lose: 'Zügiger abnehmen (~0,75 % KG/Woche)',
  maintain: 'Gewicht halten, Kraft & Muskeln aufbauen',
  lean_bulk: 'Langsam Muskeln aufbauen ohne unnötiges Fett'
}

// Erstes Login: persönliche Daten abfragen – Basis für Kalorienziel, BMI & Co.
export default function Onboarding({ settings }: { settings: Settings | null }) {
  const { profile, refreshProfile } = useAuth()
  const qc = useQueryClient()
  const [name, setName] = useState(profile?.display_name ?? '')
  const [birthYear, setBirthYear] = useState(settings?.birth_year ? String(settings.birth_year) : '')
  const [height, setHeight] = useState(settings?.height_cm ? String(settings.height_cm) : '')
  const [sex, setSex] = useState<string | null>(settings?.sex ?? null)
  const [goal, setGoal] = useState<GoalType>((settings?.goal_type as GoalType) ?? 'maintain')
  const [goalWeight, setGoalWeight] = useState(settings?.goal_weight ? String(settings.goal_weight) : '')
  const [weight, setWeight] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const h = parseNum(height)
  const rec = h && sex ? recommendedGoalWeight(h, sex) : null

  async function save() {
    const by = parseNum(birthYear)
    const yearNow = new Date().getFullYear()
    if (!name.trim()) { setErr('Bitte deinen Namen eingeben.'); return }
    if (!by || by < yearNow - 100 || by > yearNow - 10) { setErr('Bitte ein gültiges Geburtsjahr eingeben.'); return }
    if (!h || h < 120 || h > 230) { setErr('Bitte eine gültige Größe in cm eingeben.'); return }
    if (!sex) { setErr('Bitte Geschlecht wählen (wird für die Kalorienformel gebraucht).'); return }
    setBusy(true); setErr(null)
    try {
      await supabase.from('profiles').update({ display_name: name.trim() }).eq('id', profile!.id)
      await updateSettings(profile!.id, {
        birth_year: Math.round(by), height_cm: h, sex, goal_type: goal,
        goal_weight: parseNum(goalWeight)
      })
      const w = parseNum(weight)
      if (w && w > 20 && w < 400) await addWeightLog(profile!.id, w)
      await refreshProfile()
      qc.invalidateQueries()
    } catch {
      setErr('Speichern fehlgeschlagen – bitte nochmal versuchen.')
    }
    setBusy(false)
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-bg to-[#0e1530] px-5 py-10 flex justify-center overflow-y-auto">
      <div className="w-full max-w-md animate-slideup space-y-4 pb-10">
        <div className="text-center">
          <h1 className="text-2xl font-extrabold tracking-tight">Willkommen! 👋</h1>
          <p className="text-sm text-white/50 mt-1">
            Kurz ein paar Angaben – daraus berechnen wir dein Kalorienziel, BMI und Empfehlungen.
          </p>
        </div>

        <div className="card space-y-4">
          <div>
            <label className="label">Dein Name</label>
            <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="z. B. Max" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Geburtsjahr</label>
              <input className="input" type="text" inputMode="numeric" value={birthYear}
                onChange={e => setBirthYear(e.target.value)} placeholder="z. B. 1993" />
            </div>
            <div>
              <label className="label">Größe (cm)</label>
              <input className="input" type="text" inputMode="numeric" value={height}
                onChange={e => setHeight(e.target.value)} placeholder="z. B. 180" />
            </div>
          </div>
          <div>
            <label className="label">Geschlecht</label>
            <div className="flex gap-1.5">
              {[['m', 'Männlich'], ['f', 'Weiblich']].map(([v, l]) => (
                <button key={v} onClick={() => setSex(v)}
                  className={cls('btn flex-1 !py-2 text-sm', sex === v ? 'btn-primary' : 'btn-ghost')}>{l}</button>
              ))}
            </div>
          </div>
        </div>

        <div className="card space-y-3">
          <p className="font-semibold text-sm">Dein Ziel</p>
          <div className="grid grid-cols-2 gap-1.5">
            {(Object.keys(GOAL_LABEL) as GoalType[]).map(g => (
              <button key={g} onClick={() => setGoal(g)}
                className={cls('btn !py-2 !px-1 text-[13px]', goal === g ? 'btn-primary' : 'btn-ghost')}>{GOAL_LABEL[g]}</button>
            ))}
          </div>
          <p className="text-[11px] text-white/45">{GOAL_HINT[goal]}</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Zielgewicht (kg)</label>
              <input className="input" type="text" inputMode="decimal" value={goalWeight}
                onChange={e => setGoalWeight(e.target.value)} placeholder={rec ? `Empfehlung: ~${rec}` : 'optional'} />
            </div>
            <div>
              <label className="label">Aktuelles Gewicht (kg)</label>
              <input className="input" type="text" inputMode="decimal" value={weight}
                onChange={e => setWeight(e.target.value)} placeholder="optional" />
            </div>
          </div>
          {rec != null && !goalWeight && (
            <button className="text-xs text-primary underline underline-offset-2 text-left"
              onClick={() => setGoalWeight(String(rec))}>Empfehlung übernehmen: {rec} kg</button>
          )}
        </div>

        {err && <p className="text-danger text-sm px-1">{err}</p>}
        <button className="btn-primary w-full !py-3 text-base" disabled={busy} onClick={save}>
          {busy ? 'Speichern…' : 'Los geht’s 💪'}
        </button>
        <p className="text-[11px] text-white/35 text-center">Alles später im Profil änderbar.</p>
      </div>
    </div>
  )
}
