import { lazy, Suspense, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import {
  getSettings, updateSettings, getCalorieLogs, addCalorieLog, deleteCalorieLog, updateCalorieLog,
  trainingLoad, getWeightLogs, getMeals, addMeal, deleteMeal
} from '../lib/db'
import { CalorieLog, Meal, MealItem, Settings } from '../lib/types'
import {
  calorieTarget, GOAL_LABEL, GoalType, lookupBarcode, searchProducts,
  OffProduct, AiEstimate, recommendedGoalWeight
} from '../lib/health'
import { PageSkeleton, Modal, ProgressBar, Spinner } from '../components/ui'
import { BottomBar, SegmentRow } from '../components/Layout'
import { cls, fmtDate, parseNum, todayISO, localDateISO } from '../lib/utils'

const BarcodeScanner = lazy(() => import('../components/BarcodeScanner'))

const SEGMENTS = ['Heute', 'Kalender', 'Ziel'] as const
type Segment = typeof SEGMENTS[number]

const sum = (xs: (number | null | undefined)[]) => xs.reduce((a: number, b) => a + (Number(b) || 0), 0)
const r1 = (v: number) => Math.round(v * 10) / 10

export default function Calories() {
  const { profile } = useAuth()
  const qc = useQueryClient()
  const [seg, setSeg] = useState<Segment>('Heute')

  // Eintrags-Pipeline: Sheet mit 5 Wegen, Ziel-Tag (heute oder Kalendertag)
  const [forDay, setForDay] = useState(todayISO())
  const [sheetOpen, setSheetOpen] = useState(false)
  const [quickOpen, setQuickOpen] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [mealsOpen, setMealsOpen] = useState(false)
  const [product, setProduct] = useState<{ p: OffProduct; source: 'barcode' | 'search' } | null>(null)
  const [editEntry, setEditEntry] = useState<CalorieLog | null>(null)
  const [dayDetail, setDayDetail] = useState<string | null>(null)
  const [lookupBusy, setLookupBusy] = useState(false)
  const [lookupErr, setLookupErr] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['calories', profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const since = localDateISO(new Date(Date.now() - 400 * 86400000))
      const [settings, logs, load, weights, meals] = await Promise.all([
        getSettings(profile!.id), getCalorieLogs(profile!.id, since),
        trainingLoad(profile!.id), getWeightLogs(profile!.id, 1), getMeals(profile!.id)
      ])
      return { settings, logs, load, meals, currentWeight: weights[0] ? Number(weights[0].weight) : null }
    }
  })
  const refresh = () => qc.invalidateQueries({ queryKey: ['calories'] })

  const settings = data?.settings ?? null
  const logs = data?.logs ?? []
  const meals = data?.meals ?? []
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
  const uid = profile?.id ?? ''

  function openSheet(day?: string) {
    setForDay(day ?? todayISO())
    setSheetOpen(true)
  }

  async function onDetect(code: string) {
    setScanOpen(false); setLookupBusy(true); setLookupErr(null)
    try {
      const p = await lookupBarcode(code)
      if (!p || p.kcal100 == null) setLookupErr(`Produkt ${code} nicht gefunden – bitte manuell eintragen oder suchen.`)
      else setProduct({ p, source: 'barcode' })
    } catch { setLookupErr('Lookup fehlgeschlagen – bist du online?') }
    setLookupBusy(false)
  }

  if (isLoading) return <PageSkeleton rows={4} />

  return (
    <div className="space-y-4 py-2">
      <h1 className="text-2xl font-bold pt-2">Kalorien</h1>

      {/* Desktop: Segmente + Aktion oben */}
      <div className="hidden md:flex gap-1">
        {SEGMENTS.map(s => (
          <button key={s} onClick={() => setSeg(s)}
            className={cls('btn flex-1 !py-1.5 text-sm', seg === s ? 'btn-primary' : 'btn-ghost')}>{s}</button>
        ))}
        <button className="btn-primary !py-1.5" onClick={() => openSheet()}>+ Eintrag</button>
      </div>

      {lookupBusy && <div className="card"><Spinner label="Produkt wird gesucht…" /></div>}
      {lookupErr && <div className="card text-sm text-red-200 bg-danger/10 border-danger/25">{lookupErr}</div>}

      {seg === 'Heute' && <Today logs={logs} target={target} onEdit={setEditEntry} />}
      {seg === 'Kalender' && <CalendarView logs={logs} target={target} onDay={setDayDetail} />}
      {seg === 'Ziel' && settings && (
        <GoalSettings uid={uid} settings={settings} breakdown={breakdown}
          currentWeight={data?.currentWeight ?? null}
          autoWpw={data?.load.plannedPerWeek ?? null} load={data!.load} onChange={refresh} />
      )}

      {/* Daumen-Zone */}
      <BottomBar>
        {seg !== 'Ziel' && (
          <div className="flex justify-center">
            <button className="btn-primary !px-10 !py-3 text-base shadow-lg shadow-primary/30"
              onClick={() => openSheet()}>+ Eintrag</button>
          </div>
        )}
        <SegmentRow>
          {SEGMENTS.map(s => (
            <button key={s} onClick={() => setSeg(s)}
              className={cls('btn flex-1 !py-2 text-sm', seg === s ? 'btn-primary' : 'btn-ghost')}>{s}</button>
          ))}
        </SegmentRow>
      </BottomBar>

      {/* Eintrag-Sheet: 5 Wege */}
      {sheetOpen && (
        <Modal open onClose={() => setSheetOpen(false)} title={`Eintrag für ${fmtDate(forDay)}`}>
          <div className="space-y-2">
            {[
              { icon: '✏️', label: 'Kalorien eintragen', hint: 'Zahl direkt eingeben', fn: () => setQuickOpen(true) },
              { icon: '📷', label: 'Barcode scannen', hint: 'Produkt mit der Kamera erfassen', fn: () => setScanOpen(true) },
              { icon: '🔎', label: 'Lebensmittel suchen', hint: 'Open-Food-Facts-Datenbank durchsuchen', fn: () => setSearchOpen(true) },
              { icon: '✨', label: 'AI fragen', hint: '„Schweinebraten mit 2 Knödeln und Bier…"', fn: () => setAiOpen(true) },
              { icon: '🍽️', label: 'Meine Mahlzeiten', hint: 'Gespeicherte Mahlzeiten eintragen', fn: () => setMealsOpen(true) }
            ].map(o => (
              <button key={o.label} onClick={() => { setSheetOpen(false); o.fn() }}
                className="w-full card !p-3.5 flex items-center gap-3 text-left active:scale-[0.99]">
                <span className="text-2xl">{o.icon}</span>
                <span className="min-w-0">
                  <span className="block font-semibold text-sm">{o.label}</span>
                  <span className="block text-[11px] text-white/40 truncate">{o.hint}</span>
                </span>
              </button>
            ))}
          </div>
        </Modal>
      )}

      {quickOpen && (
        <QuickAdd onClose={() => setQuickOpen(false)} onSave={async (kcal, label) => {
          await addCalorieLog({ user_id: uid, kcal, label: label || null, source: 'manual', day: forDay })
          setQuickOpen(false); refresh()
        }} />
      )}
      {scanOpen && (
        <Suspense fallback={<div className="fixed inset-0 z-[60] bg-black grid place-items-center"><Spinner label="Scanner lädt…" /></div>}>
          <BarcodeScanner onDetect={onDetect} onClose={() => setScanOpen(false)} />
        </Suspense>
      )}
      {searchOpen && (
        <SearchModal onClose={() => setSearchOpen(false)}
          onPick={p => { setSearchOpen(false); setProduct({ p, source: 'search' }) }} />
      )}
      {aiOpen && (
        <AiModal onClose={() => setAiOpen(false)} onSave={async (est) => {
          await addCalorieLog({
            user_id: uid, day: forDay, source: 'ai',
            label: est.items.map(i => i.name).join(', ').slice(0, 120),
            kcal: Math.round(sum(est.items.map(i => i.kcal))),
            protein_g: r1(sum(est.items.map(i => i.protein_g))),
            carbs_g: r1(sum(est.items.map(i => i.carbs_g))),
            fat_g: r1(sum(est.items.map(i => i.fat_g)))
          })
          setAiOpen(false); refresh()
        }} />
      )}
      {mealsOpen && (
        <MealsModal meals={meals} uid={uid}
          onClose={() => setMealsOpen(false)}
          onChanged={refresh}
          onLog={async (m) => {
            await addCalorieLog({
              user_id: uid, day: forDay, source: 'meal', label: m.name,
              kcal: Math.round(Number(m.kcal)), protein_g: m.protein_g, carbs_g: m.carbs_g, fat_g: m.fat_g,
              image_url: m.image_url
            })
            setMealsOpen(false); refresh()
          }} />
      )}
      {product && (
        <ProductAmount p={product.p} onClose={() => setProduct(null)} onSave={async (amount) => {
          const f = amount / 100
          await addCalorieLog({
            user_id: uid, day: forDay, source: product.source, barcode: product.p.code || null,
            product_name: product.p.brand ? `${product.p.name} (${product.p.brand})` : product.p.name,
            amount_g: amount,
            kcal: Math.round((product.p.kcal100 ?? 0) * f),
            protein_g: product.p.protein100 != null ? r1(product.p.protein100 * f) : null,
            carbs_g: product.p.carbs100 != null ? r1(product.p.carbs100 * f) : null,
            fat_g: product.p.fat100 != null ? r1(product.p.fat100 * f) : null,
            image_url: product.p.image
          })
          setProduct(null); refresh()
        }} />
      )}
      {editEntry && (
        <EditEntry entry={editEntry} onClose={() => setEditEntry(null)} onChanged={() => { setEditEntry(null); refresh() }} />
      )}
      {dayDetail && (
        <DayDetail day={dayDetail} logs={logs.filter(l => l.day === dayDetail)} target={target}
          onClose={() => setDayDetail(null)}
          onAdd={() => { setDayDetail(null); openSheet(dayDetail) }}
          onEdit={l => { setDayDetail(null); setEditEntry(l) }} />
      )}
    </div>
  )
}

// ---------- Bausteine ----------
function EntryRow({ l, onClick }: { l: CalorieLog; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="w-full flex items-center justify-between py-2.5 text-left gap-3">
      <div className="flex items-center gap-2.5 min-w-0">
        {l.image_url
          ? <img src={l.image_url} alt="" className="w-9 h-9 rounded-lg object-cover bg-white/5 shrink-0" />
          : <span className="w-9 h-9 rounded-lg bg-white/5 grid place-items-center text-sm shrink-0">
              {l.source === 'ai' ? '✨' : l.source === 'meal' ? '🍽️' : '🍎'}
            </span>}
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{l.product_name ?? l.label ?? 'Eintrag'}</p>
          <p className="text-[11px] text-white/40">
            {new Date(l.logged_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
            {l.amount_g ? ` · ${l.amount_g} g` : ''}
            {l.source === 'barcode' ? ' · gescannt' : l.source === 'ai' ? ' · AI-Schätzung' : l.source === 'meal' ? ' · Mahlzeit' : l.source === 'search' ? ' · Suche' : ''}
          </p>
        </div>
      </div>
      <span className="font-semibold shrink-0">{Math.round(Number(l.kcal))} kcal</span>
    </button>
  )
}

function MacroLine({ logs }: { logs: CalorieLog[] }) {
  const p = sum(logs.map(l => l.protein_g)), c = sum(logs.map(l => l.carbs_g)), f = sum(logs.map(l => l.fat_g))
  if (p + c + f === 0) return null
  return (
    <div className="flex gap-2 mt-2">
      <span className="chip bg-sky-500/15 text-sky-300">Protein {Math.round(p)} g</span>
      <span className="chip bg-amber-500/15 text-amber-300">Kohlenhydrate {Math.round(c)} g</span>
      <span className="chip bg-rose-500/15 text-rose-300">Fett {Math.round(f)} g</span>
    </div>
  )
}

// ---------- Heute ----------
function Today({ logs, target, onEdit }:
  { logs: CalorieLog[]; target: number | null; onEdit: (l: CalorieLog) => void }) {
  const today = todayISO()
  const todayLogs = logs.filter(l => l.day === today)
  const eaten = sum(todayLogs.map(l => l.kcal))
  const remaining = target != null ? target - eaten : null

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
        <p className="text-xs text-white/45 mt-2">{Math.round(eaten)} kcal gegessen</p>
        <MacroLine logs={todayLogs} />
      </div>

      <div className="card divide-y divide-white/5">
        {!todayLogs.length && <p className="text-sm text-white/45 py-2">Heute noch nichts eingetragen – unten „+ Eintrag".</p>}
        {todayLogs.map(l => <EntryRow key={l.id} l={l} onClick={() => onEdit(l)} />)}
      </div>
    </div>
  )
}

// ---------- Kalender ----------
function CalendarView({ logs, target, onDay }:
  { logs: CalorieLog[]; target: number | null; onDay: (day: string) => void }) {
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const today = todayISO()

  const totals = useMemo(() => {
    const m = new Map<string, number>()
    logs.forEach(l => m.set(l.day, (m.get(l.day) ?? 0) + Number(l.kcal)))
    return m
  }, [logs])

  const cells = useMemo(() => {
    const y = month.getFullYear(), mo = month.getMonth()
    const offset = (new Date(y, mo, 1).getDay() + 6) % 7 // Mo=0
    const dim = new Date(y, mo + 1, 0).getDate()
    const out: (string | null)[] = Array(offset).fill(null)
    for (let d = 1; d <= dim; d++) out.push(localDateISO(new Date(y, mo, d)))
    return out
  }, [month])

  const monthLabel = month.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })
  const shift = (n: number) => setMonth(m => new Date(m.getFullYear(), m.getMonth() + n, 1))

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button className="btn-ghost !px-4" onClick={() => shift(-1)}>‹</button>
        <p className="font-semibold">{monthLabel}</p>
        <button className="btn-ghost !px-4" onClick={() => shift(1)}>›</button>
      </div>
      <div className="card !p-2.5">
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-white/40 mb-1">
          {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(d => <span key={d}>{d}</span>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((day, i) => {
            if (!day) return <span key={`x${i}`} />
            const kcal = totals.get(day)
            const future = day > today
            const tone = kcal == null ? ''
              : future ? 'bg-primary/15 text-primary'
              : target != null && kcal > target ? 'bg-danger/20 text-red-300'
              : 'bg-success/20 text-green-300'
            return (
              <button key={day} onClick={() => onDay(day)}
                className={cls('rounded-lg py-1.5 flex flex-col items-center gap-0.5 active:scale-95 transition',
                  tone || 'bg-white/[0.03]', day === today && 'ring-1 ring-primary')}>
                <span className={cls('text-xs font-semibold', !kcal && 'text-white/50')}>{Number(day.slice(8))}</span>
                <span className="text-[9px] leading-none opacity-80">{kcal != null ? Math.round(kcal) : '·'}</span>
              </button>
            )
          })}
        </div>
        <p className="text-[10px] text-white/35 mt-2 px-1">
          Grün = im Ziel · Rot = über Ziel · Blau = vorausgeplant · Tag antippen für Details & Planung
        </p>
      </div>
    </div>
  )
}

function DayDetail({ day, logs, target, onClose, onAdd, onEdit }: {
  day: string; logs: CalorieLog[]; target: number | null
  onClose: () => void; onAdd: () => void; onEdit: (l: CalorieLog) => void
}) {
  const total = sum(logs.map(l => l.kcal))
  const future = day > todayISO()
  return (
    <Modal open onClose={onClose} title={fmtDate(day)}>
      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <p className="text-2xl font-bold">{Math.round(total)} <span className="text-sm font-medium text-white/45">kcal{future ? ' geplant' : ''}</span></p>
          {target != null && <p className={cls('text-sm font-semibold', total > target ? 'text-danger' : 'text-success')}>Ziel {target}</p>}
        </div>
        <MacroLine logs={logs} />
        <div className="divide-y divide-white/5">
          {!logs.length && <p className="text-sm text-white/45 py-2">Keine Einträge{future ? ' – plane hier Mahlzeiten voraus' : ''}.</p>}
          {logs.map(l => <EntryRow key={l.id} l={l} onClick={() => onEdit(l)} />)}
        </div>
        <button className="btn-primary w-full" onClick={onAdd}>+ Eintrag für diesen Tag</button>
      </div>
    </Modal>
  )
}

// ---------- Eintrag bearbeiten ----------
function EditEntry({ entry, onClose, onChanged }:
  { entry: CalorieLog; onClose: () => void; onChanged: () => void }) {
  const [kcal, setKcal] = useState(String(Math.round(Number(entry.kcal))))
  const [label, setLabel] = useState(entry.product_name ?? entry.label ?? '')
  return (
    <Modal open onClose={onClose} title="Eintrag bearbeiten">
      <div className="space-y-3">
        <p className="text-xs text-white/45">{fmtDate(entry.day)}{entry.amount_g ? ` · ${entry.amount_g} g` : ''}</p>
        <div>
          <label className="label">Kalorien</label>
          <input className="input text-center text-2xl font-bold" type="text" inputMode="numeric"
            value={kcal} onChange={e => setKcal(e.target.value)} />
        </div>
        <div>
          <label className="label">Bezeichnung</label>
          <input className="input" value={label} onChange={e => setLabel(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <button className="btn-danger" onClick={async () => { await deleteCalorieLog(entry.id); onChanged() }}>Löschen</button>
          <button className="btn-primary flex-1" onClick={async () => {
            const v = parseNum(kcal)
            if (v == null || v < 0) return
            const patch: Partial<CalorieLog> = { kcal: Math.round(v) }
            if (entry.product_name != null) patch.product_name = label.trim() || null
            else patch.label = label.trim() || null
            await updateCalorieLog(entry.id, patch)
            onChanged()
          }}>Speichern</button>
        </div>
      </div>
    </Modal>
  )
}

// ---------- Schnelleingabe ----------
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

// ---------- Lebensmittel-Suche ----------
function SearchModal({ onClose, onPick }: { onClose: () => void; onPick: (p: OffProduct) => void }) {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<OffProduct[] | null>(null)
  async function run() {
    if (!q.trim()) return
    setBusy(true)
    try { setResults(await searchProducts(q.trim())) } catch { setResults([]) }
    setBusy(false)
  }
  return (
    <Modal open onClose={onClose} title="Lebensmittel suchen">
      <div className="space-y-3">
        <div className="flex gap-2">
          <input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="z. B. Skyr Vanille"
            autoFocus onKeyDown={e => e.key === 'Enter' && run()} />
          <button className="btn-primary shrink-0" disabled={busy} onClick={run}>{busy ? '…' : 'Suchen'}</button>
        </div>
        {busy && <Spinner label="Suche läuft…" />}
        {results != null && !busy && !results.length && <p className="text-sm text-white/45">Nichts gefunden – anders formulieren oder Barcode scannen.</p>}
        {!!results?.length && (
          <div className="divide-y divide-white/5 max-h-[50vh] overflow-y-auto -mx-1 px-1">
            {results.map(p => (
              <button key={p.code} onClick={() => onPick(p)} className="w-full flex items-center gap-3 py-2.5 text-left">
                {p.image
                  ? <img src={p.image} alt="" className="w-10 h-10 rounded-lg object-cover bg-white/5 shrink-0" />
                  : <span className="w-10 h-10 rounded-lg bg-white/5 grid place-items-center shrink-0">🍎</span>}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{p.name}</p>
                  <p className="text-[11px] text-white/40 truncate">{p.brand ?? '–'}</p>
                </div>
                <span className="text-sm font-semibold shrink-0">{p.kcal100} <span className="text-[10px] text-white/40 font-normal">kcal/100g</span></span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}

// ---------- Menge nach Scan/Suche ----------
function ProductAmount({ p, onClose, onSave }:
  { p: OffProduct; onClose: () => void; onSave: (amountG: number) => void }) {
  const [amount, setAmount] = useState('100')
  const g = parseNum(amount) ?? 0
  return (
    <Modal open onClose={onClose} title="Menge angeben">
      <div className="space-y-3">
        <div className="card bg-surface2 !p-3 flex items-center gap-3">
          {p.image && <img src={p.image} alt="" className="w-12 h-12 rounded-lg object-cover bg-white/5 shrink-0" />}
          <div className="min-w-0">
            <p className="font-semibold text-sm">{p.name}{p.brand ? ` · ${p.brand}` : ''}</p>
            <p className="text-xs text-white/45 mt-0.5">{p.kcal100} kcal / 100 g{p.code ? ` · Code ${p.code}` : ''}</p>
          </div>
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

// ---------- AI fragen ----------
function AiModal({ onClose, onSave }: { onClose: () => void; onSave: (est: AiEstimate) => void }) {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [est, setEst] = useState<AiEstimate | null>(null)

  async function ask() {
    if (!q.trim() || busy) return
    setBusy(true); setErr(null); setEst(null)
    const { data, error } = await supabase.functions.invoke('ai-calories', { body: { question: q.trim() } })
    if (error || data?.error) setErr(data?.error ?? 'Anfrage fehlgeschlagen – bitte erneut versuchen.')
    else setEst(data as AiEstimate)
    setBusy(false)
  }
  const total = est ? Math.round(sum(est.items.map(i => i.kcal))) : 0

  return (
    <Modal open onClose={onClose} title="✨ AI fragen">
      <div className="space-y-3">
        <textarea className="input min-h-[80px]" value={q} onChange={e => setQ(e.target.value)} autoFocus
          placeholder="Beschreibe, was du gegessen hast – z. B. „Schweinebraten im Restaurant mit zwei Knödeln, Soße und einem Bier”" />
        <button className="btn-primary w-full" disabled={busy || !q.trim()} onClick={ask}>
          {busy ? 'Claude schätzt…' : est ? 'Neu schätzen' : 'Kalorien schätzen'}
        </button>
        {err && <p className="text-sm text-red-300 bg-danger/10 rounded-xl p-3">{err}</p>}
        {est && (
          <div className="space-y-2">
            <div className="card bg-surface2 !p-3 divide-y divide-white/5">
              {est.items.map((i, idx) => (
                <div key={idx} className="flex items-center justify-between py-2 gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{i.name}</p>
                    <p className="text-[10px] text-white/40">P {Math.round(i.protein_g)} · KH {Math.round(i.carbs_g)} · F {Math.round(i.fat_g)} g</p>
                  </div>
                  <span className="font-semibold shrink-0">{Math.round(i.kcal)} kcal</span>
                </div>
              ))}
              <div className="flex items-center justify-between pt-2">
                <span className="text-sm font-bold">Gesamt</span>
                <span className="font-bold text-primary">{total} kcal</span>
              </div>
            </div>
            <p className="text-[11px] text-white/40">{est.note}</p>
            <button className="btn-primary w-full" onClick={() => onSave(est)}>Als Eintrag speichern ({total} kcal)</button>
          </div>
        )}
      </div>
    </Modal>
  )
}

// ---------- Mahlzeiten ----------
function MealsModal({ meals, uid, onClose, onChanged, onLog }: {
  meals: Meal[]; uid: string; onClose: () => void; onChanged: () => void; onLog: (m: Meal) => void
}) {
  const [builder, setBuilder] = useState(false)
  if (builder) return <MealBuilder uid={uid} onClose={() => setBuilder(false)} onSaved={() => { setBuilder(false); onChanged() }} />
  return (
    <Modal open onClose={onClose} title="Meine Mahlzeiten">
      <div className="space-y-3">
        {!meals.length && <p className="text-sm text-white/45">Noch keine Mahlzeiten gespeichert – lege deine erste an (z. B. „Frühstück: Skyr + Beeren + Nüsse").</p>}
        <div className="divide-y divide-white/5">
          {meals.map(m => (
            <div key={m.id} className="flex items-center gap-3 py-2.5">
              {m.image_url
                ? <img src={m.image_url} alt="" className="w-10 h-10 rounded-lg object-cover bg-white/5 shrink-0" />
                : <span className="w-10 h-10 rounded-lg bg-white/5 grid place-items-center shrink-0">🍽️</span>}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{m.name}</p>
                <p className="text-[11px] text-white/40">{Math.round(Number(m.kcal))} kcal · {m.items.length} Zutaten</p>
              </div>
              <button className="btn-primary !px-3 !py-1.5 text-xs shrink-0" onClick={() => onLog(m)}>Eintragen</button>
              <button className="text-white/30 shrink-0" onClick={async () => { await deleteMeal(m.id); onChanged() }}>✕</button>
            </div>
          ))}
        </div>
        <button className="btn-ghost w-full border border-white/10" onClick={() => setBuilder(true)}>+ Neue Mahlzeit anlegen</button>
      </div>
    </Modal>
  )
}

function MealBuilder({ uid, onClose, onSaved }: { uid: string; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('')
  const [items, setItems] = useState<MealItem[]>([])
  const [image, setImage] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [product, setProduct] = useState<OffProduct | null>(null)
  // manuelle Zutat
  const [mName, setMName] = useState(''); const [mG, setMG] = useState(''); const [mKcal, setMKcal] = useState('')
  const [busy, setBusy] = useState(false)

  const totals = {
    kcal: Math.round(sum(items.map(i => i.kcal))),
    p: r1(sum(items.map(i => i.protein_g))), c: r1(sum(items.map(i => i.carbs_g))), f: r1(sum(items.map(i => i.fat_g)))
  }

  function addManual() {
    const kcal = parseNum(mKcal)
    if (!mName.trim() || kcal == null || kcal <= 0) return
    setItems(prev => [...prev, { name: mName.trim(), amount_g: parseNum(mG), kcal, protein_g: null, carbs_g: null, fat_g: null }])
    setMName(''); setMG(''); setMKcal('')
  }

  return (
    <Modal open onClose={onClose} title="Neue Mahlzeit">
      <div className="space-y-3">
        <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Name, z. B. Porridge mit Beeren" autoFocus />

        {!!items.length && (
          <div className="card bg-surface2 !p-3 divide-y divide-white/5">
            {items.map((i, idx) => (
              <div key={idx} className="flex items-center justify-between py-1.5 gap-2">
                <p className="text-sm truncate">{i.name}{i.amount_g ? ` (${i.amount_g} g)` : ''}</p>
                <span className="flex items-center gap-2 shrink-0">
                  <span className="text-sm font-semibold">{Math.round(i.kcal)} kcal</span>
                  <button className="text-white/30" onClick={() => setItems(prev => prev.filter((_, j) => j !== idx))}>✕</button>
                </span>
              </div>
            ))}
            <div className="flex items-center justify-between pt-2 text-sm">
              <span className="font-bold">Gesamt · P {totals.p} · KH {totals.c} · F {totals.f} g</span>
              <span className="font-bold text-primary">{totals.kcal} kcal</span>
            </div>
          </div>
        )}

        <button className="btn-ghost w-full border border-white/10" onClick={() => setSearchOpen(true)}>🔎 Zutat aus Lebensmittel-Suche</button>

        <div className="card bg-surface2 !p-3 space-y-2">
          <p className="text-xs text-white/45">Zutat manuell (z. B. 200 g Milch, 30 g Butter)</p>
          <input className="input !py-2" value={mName} onChange={e => setMName(e.target.value)} placeholder="Zutat" />
          <div className="flex gap-2">
            <input className="input !py-2" type="text" inputMode="numeric" value={mG} onChange={e => setMG(e.target.value)} placeholder="Menge g (optional)" />
            <input className="input !py-2" type="text" inputMode="numeric" value={mKcal} onChange={e => setMKcal(e.target.value)} placeholder="kcal" />
            <button className="btn-ghost shrink-0 border border-white/10" onClick={addManual}>+</button>
          </div>
        </div>

        <button className="btn-primary w-full" disabled={busy || !name.trim() || !items.length} onClick={async () => {
          setBusy(true)
          await addMeal({
            user_id: uid, name: name.trim(), kcal: totals.kcal,
            protein_g: totals.p || null, carbs_g: totals.c || null, fat_g: totals.f || null,
            items, image_url: image
          })
          setBusy(false); onSaved()
        }}>Mahlzeit speichern ({totals.kcal} kcal)</button>
      </div>

      {searchOpen && (
        <SearchModal onClose={() => setSearchOpen(false)} onPick={p => { setSearchOpen(false); setProduct(p) }} />
      )}
      {product && (
        <ProductAmount p={product} onClose={() => setProduct(null)} onSave={(g) => {
          const f = g / 100
          setItems(prev => [...prev, {
            name: product.brand ? `${product.name} (${product.brand})` : product.name,
            amount_g: g,
            kcal: Math.round((product.kcal100 ?? 0) * f),
            protein_g: product.protein100 != null ? r1(product.protein100 * f) : null,
            carbs_g: product.carbs100 != null ? r1(product.carbs100 * f) : null,
            fat_g: product.fat100 != null ? r1(product.fat100 * f) : null
          }])
          if (!image && product.image) setImage(product.image)
          setProduct(null)
        }} />
      )}
    </Modal>
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
