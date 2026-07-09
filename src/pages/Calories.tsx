import { lazy, Suspense, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../lib/auth'
import {
  getSettings, updateSettings, getCalorieLogs, addCalorieLog, deleteCalorieLog,
  trainingLoad, getWeightLogs
} from '../lib/db'
import { CalorieLog, Settings } from '../lib/types'
import { calorieTarget, GOAL_LABEL, GoalType, lookupBarcode, OffProduct, recommendedGoalWeight } from '../lib/health'
import { PageSkeleton, Modal, ProgressBar, Spinner } from '../components/ui'
import { BottomBar, SegmentRow } from '../components/Layout'
import { cls, fmtDate, parseNum, todayISO } from '../lib/utils'

const BarcodeScanner = lazy(() => import('../components/BarcodeScanner'))

const SEGMENTS = ['Heute', 'Verlauf', 'Ziel'] as const
type Segment = typeof SEGMENTS[number]

export default function Calories() {
  const { profile } = useAuth()
  const qc = useQueryClient()
  const [seg, setSeg] = useState<Segment>('Heute')

  // Eintrags-Aktionen (Buttons liegen unten in der Daumen-Zone)
  const [quickOpen, setQuickOpen] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  const [product, setProduct] = useState<{ code: string; p: OffProduct } | null>(null)
  const [lookupBusy, setLookupBusy] = useState(false)
  const [lookupErr, setLookupErr] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['calories', profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const since = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10)
      const [settings, logs, load, weights] = await Promise.all([
        getSettings(profile!.id), getCalorieLogs(profile!.id, since),
        trainingLoad(profile!.id), getWeightLogs(profile!.id, 1)
      ])
      return { settings, logs, load, currentWeight: weights[0] ? Number(weights[0].weight) : null }
    }
  })
  const refresh = () => qc.invalidateQueries({ queryKey: ['calories'] })

  const settings = data?.settings ?? null
  const logs = data?.logs ?? []
  // Geplante Frequenz: manuelle Einstellung > Plan-Tage > beobachtete Trainings
  const plannedWpw = settings?.planned_workouts
    ?? data?.load.plannedPerWeek
    ?? Math.round(data?.load.observedPerWeek ?? 0)
  const breakdown = useMemo(() => {
    if (!settings?.birth_year || !settings.height_cm || !data?.currentWeight) return null
    return calorieTarget({
      weightKg: data.currentWeight, heightCm: Number(settings.height_cm),
      birthYear: settings.birth_year, sex: settings.sex ?? 'm',
      goal: (settings.goal_type ?? 'maintain') as GoalType,
      trainingLink: settings.calorie_training_link,
      workoutsPerWeek: plannedWpw,
      avgSessionMin: data.load.avgSessionMin,
      avgTonnageKg: data.load.avgTonnageKg
    })
  }, [settings, data, plannedWpw])
  const target = settings?.calorie_override ?? breakdown?.target ?? null

  const today = todayISO()
  const uid = profile?.id ?? ''

  async function onDetect(code: string) {
    setScanOpen(false); setLookupBusy(true); setLookupErr(null)
    try {
      const p = await lookupBarcode(code)
      if (!p || p.kcal100 == null) setLookupErr(`Produkt ${code} nicht gefunden – bitte Kalorien manuell eintragen.`)
      else setProduct({ code, p })
    } catch { setLookupErr('Lookup fehlgeschlagen – bist du online?') }
    setLookupBusy(false)
  }

  if (isLoading) return <PageSkeleton rows={4} />

  return (
    <div className="space-y-4 py-2">
      <h1 className="text-2xl font-bold pt-2">Kalorien</h1>

      {/* Desktop-Segmente – mobil unten in der Daumen-Zone */}
      <div className="hidden md:flex gap-1">
        {SEGMENTS.map(s => (
          <button key={s} onClick={() => setSeg(s)}
            className={cls('btn flex-1 !py-1.5 text-sm', seg === s ? 'btn-primary' : 'btn-ghost')}>{s}</button>
        ))}
      </div>
      {seg === 'Heute' && (
        <div className="hidden md:grid grid-cols-2 gap-3">
          <button className="btn-primary py-3" onClick={() => setQuickOpen(true)}>+ Kalorien</button>
          <button className="btn-ghost py-3 border border-white/10" onClick={() => setScanOpen(true)}>Barcode scannen</button>
        </div>
      )}

      {lookupBusy && <div className="card"><Spinner label="Produkt wird gesucht…" /></div>}
      {lookupErr && <div className="card text-sm text-red-200 bg-danger/10 border-danger/25">{lookupErr}</div>}

      {seg === 'Heute' && <Today logs={logs} target={target} onChange={refresh} />}
      {seg === 'Verlauf' && <History logs={logs} target={target} />}
      {seg === 'Ziel' && settings && (
        <GoalSettings uid={uid} settings={settings} breakdown={breakdown}
          currentWeight={data?.currentWeight ?? null}
          autoWpw={data?.load.plannedPerWeek ?? null} load={data!.load} onChange={refresh} />
      )}

      {/* Daumen-Zone: Aktionen + Segmente unten über der Navigation */}
      <BottomBar>
        {seg === 'Heute' && (
          <div className="flex gap-2">
            <button className="btn-primary flex-1 !py-3 text-base shadow-lg shadow-primary/30"
              onClick={() => setQuickOpen(true)}>+ Kalorien</button>
            <button className="btn-ghost flex-1 !py-3 text-base bg-surface/95 backdrop-blur border border-white/10"
              onClick={() => setScanOpen(true)}>Barcode</button>
          </div>
        )}
        <SegmentRow>
          {SEGMENTS.map(s => (
            <button key={s} onClick={() => setSeg(s)}
              className={cls('btn flex-1 !py-2 text-sm', seg === s ? 'btn-primary' : 'btn-ghost')}>{s}</button>
          ))}
        </SegmentRow>
      </BottomBar>

      {quickOpen && (
        <QuickAdd onClose={() => setQuickOpen(false)} onSave={async (kcal, label) => {
          await addCalorieLog({ user_id: uid, kcal, label: label || null, source: 'manual', day: today })
          setQuickOpen(false); refresh()
        }} />
      )}
      {scanOpen && (
        <Suspense fallback={<div className="fixed inset-0 z-[60] bg-black grid place-items-center"><Spinner label="Scanner lädt…" /></div>}>
          <BarcodeScanner onDetect={onDetect} onClose={() => setScanOpen(false)} />
        </Suspense>
      )}
      {product && (
        <ProductAmount code={product.code} p={product.p} onClose={() => setProduct(null)} onSave={async (amount) => {
          const f = amount / 100
          await addCalorieLog({
            user_id: uid, day: today, source: 'barcode', barcode: product.code,
            product_name: product.p.brand ? `${product.p.name} (${product.p.brand})` : product.p.name,
            amount_g: amount,
            kcal: Math.round((product.p.kcal100 ?? 0) * f),
            protein_g: product.p.protein100 != null ? Math.round(product.p.protein100 * f * 10) / 10 : null,
            carbs_g: product.p.carbs100 != null ? Math.round(product.p.carbs100 * f * 10) / 10 : null,
            fat_g: product.p.fat100 != null ? Math.round(product.p.fat100 * f * 10) / 10 : null
          })
          setProduct(null); refresh()
        }} />
      )}
    </div>
  )
}

// ---------- Heute ----------
function Today({ logs, target, onChange }:
  { logs: CalorieLog[]; target: number | null; onChange: () => void }) {
  const today = todayISO()
  const todayLogs = logs.filter(l => l.day === today)
  const eaten = todayLogs.reduce((a, l) => a + Number(l.kcal), 0)
  const remaining = target != null ? target - eaten : null
  const protein = todayLogs.reduce((a, l) => a + (Number(l.protein_g) || 0), 0)

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex items-baseline justify-between">
          <p className="text-xs text-white/45">Übrig heute</p>
          <p className="text-xs text-white/45">Ziel {target ?? '–'} kcal</p>
        </div>
        <p className={cls('text-4xl font-bold mt-1', remaining != null && remaining < 0 && 'text-danger')}>
          {remaining != null ? Math.round(remaining) : '–'} <span className="text-lg font-medium text-white/45">kcal</span>
        </p>
        <ProgressBar className="mt-3" pct={target ? (eaten / target) * 100 : 0} color={remaining != null && remaining < 0 ? '#ef4444' : '#0ea5e9'} />
        <p className="text-xs text-white/45 mt-2">{Math.round(eaten)} kcal gegessen{protein > 0 ? ` · ${Math.round(protein)} g Protein` : ''}</p>
      </div>

      <div className="card divide-y divide-white/5">
        {!todayLogs.length && <p className="text-sm text-white/45 py-2">Heute noch nichts eingetragen – unten „+ Kalorien" oder „Barcode".</p>}
        {todayLogs.map(l => (
          <div key={l.id} className="flex items-center justify-between py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{l.product_name ?? l.label ?? 'Eintrag'}</p>
              <p className="text-[11px] text-white/40">
                {new Date(l.logged_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                {l.amount_g ? ` · ${l.amount_g} g` : ''}{l.source === 'barcode' ? ' · gescannt' : ''}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="font-semibold">{Math.round(Number(l.kcal))} kcal</span>
              <button className="text-white/30" onClick={async () => { await deleteCalorieLog(l.id); onChange() }}>✕</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function QuickAdd({ onClose, onSave }: { onClose: () => void; onSave: (kcal: number, label: string) => void }) {
  const [kcal, setKcal] = useState('')
  const [label, setLabel] = useState('')
  return (
    <Modal open onClose={onClose} title="Kalorien eintragen">
      <div className="space-y-3">
        <input className="input text-center text-2xl font-bold" type="text" inputMode="numeric"
          value={kcal} onChange={e => setKcal(e.target.value)} placeholder="kcal" autoFocus />
        <input className="input" value={label} onChange={e => setLabel(e.target.value)} placeholder="Bezeichnung (optional), z. B. Mittagessen" />
        <button className="btn-primary w-full" onClick={() => { const v = parseNum(kcal); if (v && v > 0) onSave(v, label.trim()) }}>Speichern</button>
      </div>
    </Modal>
  )
}

function ProductAmount({ code, p, onClose, onSave }:
  { code: string; p: OffProduct; onClose: () => void; onSave: (amountG: number) => void }) {
  const [amount, setAmount] = useState('100')
  const g = parseNum(amount) ?? 0
  return (
    <Modal open onClose={onClose} title="Menge angeben">
      <div className="space-y-3">
        <div className="card bg-surface2 !p-3">
          <p className="font-semibold text-sm">{p.name}{p.brand ? ` · ${p.brand}` : ''}</p>
          <p className="text-xs text-white/45 mt-0.5">{p.kcal100} kcal / 100 g · Code {code}</p>
        </div>
        <div>
          <label className="label">Gegessene Menge (g/ml)</label>
          <input className="input text-center text-xl font-bold" type="text" inputMode="numeric"
            value={amount} onChange={e => setAmount(e.target.value)} autoFocus />
        </div>
        <div className="flex gap-1.5">
          {[50, 100, 150, 200, 250].map(v => (
            <button key={v} className="btn-ghost flex-1 !py-1.5 text-xs" onClick={() => setAmount(String(v))}>{v} g</button>
          ))}
        </div>
        <p className="text-center text-sm text-white/60">= <b className="text-white">{Math.round((p.kcal100 ?? 0) * g / 100)} kcal</b>
          {p.protein100 != null && <> · {Math.round(p.protein100 * g / 100)} g Protein</>}</p>
        <button className="btn-primary w-full" disabled={!g} onClick={() => onSave(g)}>Eintragen</button>
      </div>
    </Modal>
  )
}

// ---------- Verlauf ----------
function History({ logs, target }: { logs: CalorieLog[]; target: number | null }) {
  const days = useMemo(() => {
    const m = new Map<string, { kcal: number; protein: number; count: number }>()
    logs.forEach(l => {
      const e = m.get(l.day) ?? { kcal: 0, protein: 0, count: 0 }
      e.kcal += Number(l.kcal); e.protein += Number(l.protein_g) || 0; e.count++
      m.set(l.day, e)
    })
    return Array.from(m.entries()).sort((a, b) => b[0].localeCompare(a[0]))
  }, [logs])

  if (!days.length) return <div className="card text-white/50 text-sm">Noch keine Einträge.</div>
  return (
    <div className="card divide-y divide-white/5">
      {days.map(([day, v]) => {
        const diff = target != null ? v.kcal - target : null
        return (
          <div key={day} className="flex items-center justify-between py-2.5">
            <div>
              <p className="text-sm font-medium">{fmtDate(day)}</p>
              <p className="text-[11px] text-white/40">{v.count} Einträge{v.protein > 0 ? ` · ${Math.round(v.protein)} g Protein` : ''}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-semibold">{Math.round(v.kcal)} kcal</span>
              {diff != null && (
                <span className={cls('chip', diff > 50 ? 'bg-danger/15 text-red-300' : 'bg-success/15 text-green-300')}>
                  {diff > 0 ? '+' : ''}{Math.round(diff)}
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---------- Ziel & persönliche Daten ----------
function GoalSettings({ uid, settings, breakdown, currentWeight, autoWpw, load, onChange }: {
  uid: string; settings: Settings; breakdown: ReturnType<typeof calorieTarget> | null
  currentWeight: number | null; autoWpw: number | null
  load: { avgSessionMin: number | null; avgTonnageKg: number | null; observedPerWeek: number }
  onChange: () => void
}) {
  const save = async (patch: Partial<Settings>) => { await updateSettings(uid, patch); onChange() }
  const [showWhy, setShowWhy] = useState(true)
  const goalRec = settings.height_cm ? recommendedGoalWeight(Number(settings.height_cm), settings.sex ?? 'm') : null

  return (
    <div className="space-y-4">
      {breakdown && (
        <div className="card border-primary/25">
          <p className="text-xs text-white/45">Dein Kalorienziel</p>
          <p className="text-3xl font-bold mt-1">{settings.calorie_override ?? breakdown.target} <span className="text-base font-medium text-white/45">kcal/Tag</span></p>
          {settings.calorie_override != null && <p className="text-xs text-accent mt-1">Manuell überschrieben (berechnet: {breakdown.target} kcal)</p>}
          <button className="text-xs text-white/50 underline underline-offset-2 mt-2" onClick={() => setShowWhy(s => !s)}>
            {showWhy ? 'Berechnung ausblenden' : 'Warum dieses Ziel?'}
          </button>
          {showWhy && (
            <div className="mt-3 space-y-2">
              {breakdown.parts.map(p => (
                <div key={p.label} className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium">{p.label}</p>
                    <p className="text-[11px] text-white/40 leading-snug">{p.note}</p>
                  </div>
                  <span className="font-semibold shrink-0">{p.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="card space-y-3">
        <p className="font-semibold text-sm">Ziel</p>
        <div className="grid grid-cols-2 gap-1.5">
          {(Object.keys(GOAL_LABEL) as GoalType[]).map(g => (
            <button key={g} onClick={() => save({ goal_type: g })}
              className={cls('btn !py-2 text-sm', settings.goal_type === g ? 'btn-primary' : 'btn-ghost')}>{GOAL_LABEL[g]}</button>
          ))}
        </div>
        <p className="text-[11px] text-white/40">
          Cut = optimale Abnehmrate (~0,5 % Körpergewicht/Woche), um Muskeln zu halten.
          Abnehmen = zügiger, dafür etwas mehr Muskelverlust-Risiko.
        </p>
        <div className="flex items-center justify-between pt-1">
          <div>
            <p className="text-sm">Training einbeziehen</p>
            <p className="text-[11px] text-white/40">
              Ø {load.avgSessionMin ?? '–'} min · Ø {load.avgTonnageKg?.toLocaleString('de-DE') ?? '–'} kg Volumen pro Einheit (aus deinem Verlauf)
            </p>
          </div>
          <button onClick={() => save({ calorie_training_link: !settings.calorie_training_link })}
            className={cls('w-12 h-7 rounded-full transition relative shrink-0', settings.calorie_training_link ? 'bg-primary' : 'bg-white/15')}>
            <span className={cls('absolute top-1 w-5 h-5 rounded-full bg-white transition-all', settings.calorie_training_link ? 'left-6' : 'left-1')} />
          </button>
        </div>
        <Field label={`Geplante Trainings/Woche (auto: ${autoWpw ?? Math.round(load.observedPerWeek)} aus deinem Plan)`}
          value={settings.planned_workouts} placeholder="auto"
          onSave={v => save({ planned_workouts: Math.round(v) })} onClear={() => save({ planned_workouts: null })} />
      </div>

      <div className="card space-y-3">
        <p className="font-semibold text-sm">Persönliche Daten</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Geburtsjahr" value={settings.birth_year} onSave={v => save({ birth_year: Math.round(v) })} />
          <Field label="Größe (cm)" value={settings.height_cm != null ? Number(settings.height_cm) : null} onSave={v => save({ height_cm: v })} />
        </div>
        <div>
          <label className="label">Geschlecht</label>
          <div className="flex gap-1.5">
            {[['m', 'Männlich'], ['f', 'Weiblich']].map(([v, l]) => (
              <button key={v} onClick={() => save({ sex: v })}
                className={cls('btn flex-1 !py-2 text-sm', settings.sex === v ? 'btn-primary' : 'btn-ghost')}>{l}</button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Zielgewicht (kg)" value={settings.goal_weight != null ? Number(settings.goal_weight) : null} onSave={v => save({ goal_weight: v })} />
          <Field label="Kalorien-Override" value={settings.calorie_override} placeholder="auto"
            onSave={v => save({ calorie_override: Math.round(v) })} onClear={() => save({ calorie_override: null })} />
        </div>
        {goalRec != null && <p className="text-[11px] text-white/40">Zielgewicht-Empfehlung für dich: ~{goalRec} kg{currentWeight ? ` (aktuell ${currentWeight.toFixed(1)} kg)` : ''}</p>}
      </div>
    </div>
  )
}

function Field({ label, value, onSave, onClear, placeholder }: {
  label: string; value: number | null; onSave: (v: number) => void; onClear?: () => void; placeholder?: string
}) {
  const [draft, setDraft] = useState(value != null ? String(value) : '')
  return (
    <div>
      <label className="label">{label}</label>
      <input className="input" type="text" inputMode="decimal" value={draft} placeholder={placeholder ?? '–'}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => {
          const v = parseNum(draft)
          if (v != null) onSave(v)
          else if (draft.trim() === '' && onClear) onClear()
        }} />
    </div>
  )
}
