import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine
} from 'recharts'
import { useAuth } from '../lib/auth'
import { getWeightLogs, addWeightLog, updateWeightLog, deleteWeightLog, getSettings, updateSettings } from '../lib/db'
import { WeightLog, Settings } from '../lib/types'
import {
  toPoints, trendSeries, currentTrend, slopePerDay, goalPrognosis, periodStats,
  bmi, bmiCategory, normalWeightRange, recommendedGoalWeight, BMI_CATEGORIES
} from '../lib/health'
import { PageSkeleton, Modal, ProgressBar } from '../components/ui'
import { BottomBar, SegmentRow } from '../components/Layout'
import { cls, fmtDate, parseNum } from '../lib/utils'

const SEGMENTS = ['Übersicht', 'Statistik', 'BMI', 'Verlauf'] as const
type Segment = typeof SEGMENTS[number]
const PERIODS = [
  { label: 'Woche', days: 7 }, { label: 'Monat', days: 30 },
  { label: 'Jahr', days: 365 }, { label: 'Gesamt', days: null as number | null }
]

const fmtKg = (v: number | null | undefined, digits = 1) =>
  v == null ? '–' : `${v.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits })} kg`
const fmtTime = (d: string) => new Date(d).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export default function Weight() {
  const { profile } = useAuth()
  const qc = useQueryClient()
  const [seg, setSeg] = useState<Segment>('Übersicht')
  const [addOpen, setAddOpen] = useState(false)
  const [editLog, setEditLog] = useState<WeightLog | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['weight', profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const [logs, settings] = await Promise.all([getWeightLogs(profile!.id), getSettings(profile!.id)])
      return { logs, settings }
    }
  })
  const logs = data?.logs ?? []
  const settings = data?.settings ?? null
  const points = useMemo(() => toPoints(logs), [logs])
  const refresh = () => qc.invalidateQueries({ queryKey: ['weight'] })

  if (isLoading) return <PageSkeleton rows={5} />

  return (
    <div className="space-y-4 py-2">
      <div className="flex items-center justify-between pt-2">
        <h1 className="text-2xl font-bold">Gewicht</h1>
        {/* Desktop-Aktion – mobil liegt der Button unten in der Daumen-Zone */}
        <button className="btn-primary !px-4 !py-1.5 hidden md:block" onClick={() => setAddOpen(true)}>+ Eintrag</button>
      </div>

      {/* Desktop-Segmente – mobil unten */}
      <div className="hidden md:flex gap-1">
        {SEGMENTS.map(s => (
          <button key={s} onClick={() => setSeg(s)}
            className={cls('btn flex-1 !py-1.5 text-sm', seg === s ? 'btn-primary' : 'btn-ghost')}>{s}</button>
        ))}
      </div>

      {!logs.length ? (
        <div className="card text-center text-white/50 py-10">Noch keine Einträge – starte mit „+ Eintrag".</div>
      ) : (
        <>
          {seg === 'Übersicht' && <Overview points={points} logs={logs} settings={settings} onGoal={async (g) => { await updateSettings(profile!.id, { goal_weight: g }); refresh() }} />}
          {seg === 'Statistik' && <Statistik points={points} settings={settings} />}
          {seg === 'BMI' && <BmiView points={points} settings={settings} />}
          {seg === 'Verlauf' && <Verlauf logs={logs} onEdit={setEditLog} />}
        </>
      )}

      {/* Daumen-Zone: Haupt-Aktion + Segmente unten über der Navigation */}
      <BottomBar>
        <div className="flex justify-center">
          <button className="btn-primary !px-8 !py-3 text-base shadow-lg shadow-primary/30"
            onClick={() => setAddOpen(true)}>+ Eintrag</button>
        </div>
        <SegmentRow>
          {SEGMENTS.map(s => (
            <button key={s} onClick={() => setSeg(s)}
              className={cls('btn flex-1 !py-2 !px-1 text-sm', seg === s ? 'btn-primary' : 'btn-ghost')}>{s}</button>
          ))}
        </SegmentRow>
      </BottomBar>

      {addOpen && (
        <EntryModal title="Gewicht eintragen" initial={logs[0]?.weight ?? 80} onClose={() => setAddOpen(false)}
          onSave={async (w, at) => { await addWeightLog(profile!.id, w, at); setAddOpen(false); refresh() }} />
      )}
      {editLog && (
        <EntryModal title="Eintrag bearbeiten" initial={Number(editLog.weight)} initialAt={editLog.measured_at}
          onClose={() => setEditLog(null)}
          onDelete={async () => { await deleteWeightLog(editLog.id); setEditLog(null); refresh() }}
          onSave={async (w, at) => { await updateWeightLog(editLog.id, { weight: w, ...(at ? { measured_at: at } : {}) }); setEditLog(null); refresh() }} />
      )}
    </div>
  )
}

// ---------- Übersicht ----------
function Overview({ points, logs, settings, onGoal }:
  { points: { t: number; w: number }[]; logs: WeightLog[]; settings: Settings | null; onGoal: (g: number) => void }) {
  const current = points[points.length - 1]?.w ?? null
  const trend = currentTrend(points)
  const goal = settings?.goal_weight != null ? Number(settings.goal_weight) : null
  const prognosis = goal != null ? goalPrognosis(points, goal) : null
  const start = points[0]?.w ?? null
  const pct = goal != null && start != null && current != null && Math.abs(start - goal) > 0.1
    ? Math.min(100, Math.max(0, ((start - current) / (start - goal)) * 100)) : 0
  const [editGoal, setEditGoal] = useState(false)

  const chart = useMemo(() => {
    const since = Date.now() - 90 * 86400000
    const pts = points.filter(p => p.t >= since)
    const tr = trendSeries(points).filter(p => p.t >= since)
    return pts.map((p, i) => ({
      d: new Date(p.t).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }),
      Gewicht: p.w, Trend: tr[i]?.w
    }))
  }, [points])

  return (
    <div className="space-y-4">
      <div className="card">
        <p className="text-xs text-white/45">Aktuelles Gewicht</p>
        <p className="text-4xl font-bold mt-1">{fmtKg(current)}</p>
        <p className="text-sm text-white/55 mt-1">Trend {fmtKg(trend)}</p>
        <div className="flex items-center justify-between mt-4 mb-1.5">
          <button className="text-sm text-white/70 underline underline-offset-2" onClick={() => setEditGoal(true)}>
            Ziel {goal != null ? fmtKg(goal, 1) : 'festlegen'}
          </button>
          <span className="text-sm font-semibold text-primary">{Math.round(pct)} %</span>
        </div>
        <ProgressBar pct={pct} color="#0ea5e9" />
        <p className="text-xs text-white/45 mt-3">
          Prognose {prognosis ? `~${fmtDate(prognosis.toISOString())}` : '— (Trend zeigt aktuell nicht Richtung Ziel)'}
        </p>
      </div>

      <div className="card">
        <p className="font-semibold text-sm mb-3">Letzte 90 Tage</p>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chart}>
            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
            <XAxis dataKey="d" tick={{ fill: '#ffffff60', fontSize: 11 }} minTickGap={30} />
            <YAxis tick={{ fill: '#ffffff60', fontSize: 11 }} width={38} domain={['dataMin - 1', 'dataMax + 1']} />
            <Tooltip contentStyle={{ background: '#1c2440', border: '1px solid #ffffff20', borderRadius: 12, fontSize: 12 }} />
            {goal != null && <ReferenceLine y={goal} stroke="#22c55e" strokeDasharray="4 4" />}
            <Line type="monotone" dataKey="Gewicht" stroke="#64748b" strokeWidth={1.5} dot={false} />
            <Line type="monotone" dataKey="Trend" stroke="#0ea5e9" strokeWidth={2.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {editGoal && (
        <GoalModal current={goal} settings={settings} onClose={() => setEditGoal(false)}
          onSave={(g) => { onGoal(g); setEditGoal(false) }} />
      )}
    </div>
  )
}

function GoalModal({ current, settings, onClose, onSave }:
  { current: number | null; settings: Settings | null; onClose: () => void; onSave: (g: number) => void }) {
  const [val, setVal] = useState(current != null ? String(current) : '')
  const rec = settings?.height_cm ? recommendedGoalWeight(Number(settings.height_cm), settings.sex ?? 'm') : null
  return (
    <Modal open onClose={onClose} title="Zielgewicht">
      <div className="space-y-3">
        <input className="input text-center text-xl" type="text" inputMode="decimal" value={val}
          onChange={e => setVal(e.target.value)} placeholder="z. B. 87" autoFocus />
        {rec != null && (
          <button className="btn-ghost w-full text-sm" onClick={() => setVal(String(rec))}>
            Empfehlung übernehmen: {rec} kg
            <span className="block text-[11px] text-white/40 mt-0.5">Basierend auf Größe, Geschlecht und Kraftsport-Muskelmasse (BMI ~{settings?.sex === 'f' ? '22,5' : '24,5'})</span>
          </button>
        )}
        <button className="btn-primary w-full" onClick={() => { const g = parseNum(val); if (g) onSave(g) }}>Speichern</button>
      </div>
    </Modal>
  )
}

// ---------- Statistik ----------
function Statistik({ points, settings }: { points: { t: number; w: number }[]; settings: Settings | null }) {
  const [period, setPeriod] = useState(PERIODS[3])
  const st = periodStats(points, period.days)
  const all = periodStats(points, null)
  const perWeekLabel = st.perWeek == null ? '–'
    : Math.abs(st.perWeek) < 0.1 ? 'Stagniert' : st.perWeek > 0 ? 'Zunahme' : 'Abnahme'
  const height = settings?.height_cm ? Number(settings.height_cm) : null
  const cur = points[points.length - 1]?.w ?? null
  const curBmi = height && cur ? bmi(cur, height) : null
  const bmiRange = height && all.min != null && all.max != null ? [bmi(all.min, height), bmi(all.max, height)] : null
  const avg = useMemo(() => {
    if (!points.length) return null
    return points.reduce((a, p) => a + p.w, 0) / points.length
  }, [points])
  const firstDate = points.length ? fmtDate(new Date(points[0].t).toISOString()) : ''
  const rangePos = all.min != null && all.max != null && cur != null && all.max > all.min
    ? ((cur - all.min) / (all.max - all.min)) * 100 : 50

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-sm text-white/70">Ausgewählter Zeitraum</p>
        <div className="flex gap-1">
          {PERIODS.map(p => (
            <button key={p.label} onClick={() => setPeriod(p)}
              className={cls('chip !py-1', period.label === p.label ? 'bg-primary/25 text-primary' : 'bg-white/5 text-white/50')}>{p.label}</button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Tile value={st.change != null ? `${st.change > 0 ? '+' : ''}${st.change.toFixed(1)} kg` : '–'} label="Änderung"
          tone={st.change != null ? (st.change > 0.05 ? 'bad' : st.change < -0.05 ? 'good' : undefined) : undefined} />
        <Tile value={st.perWeek != null ? `${st.perWeek > 0 ? '+' : ''}${st.perWeek.toFixed(1)} kg` : '0,0 kg'} label="Pro Woche" chip={perWeekLabel} />
        <Tile value={st.min != null ? `${st.min.toFixed(1)}–${st.max!.toFixed(1)}` : '–'} label="Tiefst – Höchst" />
        <Tile value={st.stdev != null ? `±${st.stdev.toFixed(1)} kg` : '–'} label="Schwankung" />
      </div>

      <div className="card">
        <p className="font-semibold">Gewichtsbereich</p>
        <p className="text-xs text-white/45 mb-4">Seit {firstDate}</p>
        <div className="relative h-2 rounded-full bg-white/10 mb-2">
          {avg != null && all.min != null && all.max != null && all.max > all.min && (
            <div className="absolute top-[-4px] w-0.5 h-4 bg-white/40" style={{ left: `${((avg - all.min) / (all.max - all.min)) * 100}%` }} />
          )}
          <div className="absolute top-[-4px] w-4 h-4 rounded-full bg-primary -translate-x-1/2" style={{ left: `${rangePos}%` }} />
        </div>
        <div className="flex justify-between text-sm">
          <div><p className="font-semibold text-success">{fmtKg(all.min)}</p><p className="text-[11px] text-white/45">Tiefstwert</p></div>
          <div className="text-center"><p className="font-semibold">{fmtKg(avg)}</p><p className="text-[11px] text-white/45">Durchschnitt</p></div>
          <div className="text-right"><p className="font-semibold text-danger">{fmtKg(all.max)}</p><p className="text-[11px] text-white/45">Höchstwert</p></div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Tile value={all.change != null ? `${all.change > 0 ? '+' : ''}${all.change.toFixed(1)} kg` : '–'} label="Gesamtänderung"
          tone={all.change != null ? (all.change > 0.05 ? 'bad' : all.change < -0.05 ? 'good' : undefined) : undefined} />
        <Tile value={points.length ? `${Math.round((Date.now() - points[0].t) / (365.25 * 86400000) * 10) / 10} Jahre` : '–'} label="Verlauf" chip={`${all.count} Einträge`} />
        <Tile value={curBmi != null ? curBmi.toFixed(1) : '–'} label="Aktueller BMI"
          tone={curBmi != null ? (curBmi > 24.9 || curBmi < 18.5 ? 'bad' : 'good') : undefined} />
        <Tile value={bmiRange ? `${bmiRange[0].toFixed(1)}–${bmiRange[1].toFixed(1)}` : '–'} label="BMI-Bereich" />
      </div>
    </div>
  )
}

function Tile({ value, label, chip, tone }: { value: string; label: string; chip?: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="card !py-4">
      <p className={cls('text-xl font-bold', tone === 'good' && 'text-success', tone === 'bad' && 'text-danger')}>{value}</p>
      <p className="text-xs text-white/45 mt-0.5">{label}</p>
      {chip && <span className="chip bg-white/10 text-white/55 mt-1.5 inline-block">{chip}</span>}
    </div>
  )
}

// ---------- BMI ----------
function BmiView({ points, settings }: { points: { t: number; w: number }[]; settings: Settings | null }) {
  const height = settings?.height_cm ? Number(settings.height_cm) : null
  const cur = points[points.length - 1]?.w ?? null
  if (!height || cur == null) return <div className="card text-white/50 text-sm">Größe fehlt – im Kalorien-Bereich unter „Ziel" einstellen.</div>
  const v = bmi(cur, height)
  const cat = bmiCategory(v)
  const [lo, hi] = normalWeightRange(height)
  const dev = cur - (v > 24.9 ? hi : v < 18.5 ? lo : cur)

  return (
    <div className="space-y-4">
      <div className="card">
        <BmiGauge value={v} />
        <div className="divide-y divide-white/5 text-sm mt-2">
          <Row k="Größe" v={`${height.toLocaleString('de-DE', { minimumFractionDigits: 1 })} cm`} />
          <Row k="Gewicht" v={fmtKg(cur)} />
          <Row k="Normalbereich" v={`${lo.toFixed(1)} kg – ${hi.toFixed(1)} kg`} />
          <Row k="Abweichung" v={`${dev > 0 ? '+' : ''}${dev.toFixed(1)} kg`} tone={Math.abs(dev) < 0.05 ? 'good' : 'bad'} />
        </div>
      </div>
      <div className="card">
        <p className="font-semibold text-sm mb-2">Kategorien</p>
        <div className="space-y-1">
          {BMI_CATEGORIES.map(c => (
            <div key={c.label} className={cls('flex items-center justify-between rounded-lg px-2.5 py-2 text-sm', c.label === cat.label && 'bg-white/10 font-semibold')}>
              <span className="flex items-center gap-2">
                <span className="w-1 h-4 rounded" style={{ background: c.color }} />{c.label}
              </span>
              <span className="text-white/55">
                {c.max === Infinity ? '≥ 40,0' : c.max === 15.9 ? '≤ 15,9' : `${(BMI_CATEGORIES[BMI_CATEGORIES.indexOf(c) - 1].max + 0.1).toFixed(1)} – ${c.max.toFixed(1)}`}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Row({ k, v, tone }: { k: string; v: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="text-white/55">{k}</span>
      <span className={cls('font-semibold', tone === 'bad' && 'text-danger', tone === 'good' && 'text-success')}>{v}</span>
    </div>
  )
}

// Halbkreis-Gauge 13.5–39.9
function BmiGauge({ value }: { value: number }) {
  const min = 13.5, max = 39.9
  const clamp = Math.min(max, Math.max(min, value))
  const angle = ((clamp - min) / (max - min)) * 180
  const arc = (from: number, to: number, color: string) => {
    const a0 = Math.PI * (1 - (from - min) / (max - min))
    const a1 = Math.PI * (1 - (to - min) / (max - min))
    const r = 80, cx = 100, cy = 95
    const x0 = cx + r * Math.cos(a0), y0 = cy - r * Math.sin(a0)
    const x1 = cx + r * Math.cos(a1), y1 = cy - r * Math.sin(a1)
    return <path d={`M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`} stroke={color} strokeWidth="10" fill="none" strokeLinecap="round" />
  }
  const na = Math.PI * (1 - angle / 180)
  const nx = 100 + 80 * Math.cos(na), ny = 95 - 80 * Math.sin(na)
  const cat = bmiCategory(value)
  return (
    <svg viewBox="0 0 200 110" className="w-full max-w-xs mx-auto">
      {arc(13.5, 18.4, '#38bdf8')}
      {arc(18.5, 24.9, '#22c55e')}
      {arc(25.0, 39.9, '#ef4444')}
      <circle cx={nx} cy={ny} r="6" fill={cat.color} stroke="#0b1020" strokeWidth="2" />
      <text x="100" y="72" textAnchor="middle" fill="#ffffff70" fontSize="10">BMI</text>
      <text x="100" y="98" textAnchor="middle" fill={cat.color} fontSize="26" fontWeight="700">{value.toFixed(1).replace('.', ',')}</text>
    </svg>
  )
}

// ---------- Verlauf ----------
function Verlauf({ logs, onEdit }: { logs: WeightLog[]; onEdit: (l: WeightLog) => void }) {
  const [mode, setMode] = useState<'Tage' | 'Monate' | 'Jahre'>('Tage')
  // logs kommen absteigend; Delta = Vergleich zum jeweils älteren Eintrag
  const withDelta = useMemo(() => logs.map((l, i) => ({
    ...l, delta: i < logs.length - 1 ? Number(l.weight) - Number(logs[i + 1].weight) : null
  })), [logs])

  const groups = useMemo(() => {
    if (mode === 'Tage') return null
    const key = (d: string) => mode === 'Monate'
      ? new Date(d).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })
      : String(new Date(d).getFullYear())
    const out: { label: string; items: typeof withDelta; delta: number | null }[] = []
    withDelta.forEach((l, i) => {
      const k = key(l.measured_at)
      if (!out.length || out[out.length - 1].label !== k) out.push({ label: k, items: [], delta: null })
      out[out.length - 1].items.push(l)
      // Gruppen-Delta: neuester Eintrag der Gruppe minus letzter Eintrag der Vorperiode
      const g = out[out.length - 1]
      const older = withDelta[i + 1]
      g.delta = older ? Number(g.items[0].weight) - Number(older.weight) : null
    })
    return out
  }, [withDelta, mode])

  const Entry = ({ l, big }: { l: typeof withDelta[number]; big?: boolean }) => (
    <button onClick={() => onEdit(l)} className="w-full flex items-center justify-between py-2.5 text-left">
      <div>
        <p className="text-sm text-white/55">{fmtTime(l.measured_at)}</p>
        {big && <p className="font-bold text-lg">{fmtKg(Number(l.weight))}</p>}
      </div>
      <div className="flex items-center gap-3">
        {!big && <span className="font-bold">{fmtKg(Number(l.weight))}</span>}
        <DeltaChip d={l.delta} />
      </div>
    </button>
  )

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        {(['Tage', 'Monate', 'Jahre'] as const).map(m => (
          <button key={m} onClick={() => setMode(m)}
            className={cls('btn flex-1 !py-1.5 text-sm', mode === m ? 'btn-primary' : 'btn-ghost')}>{m}</button>
        ))}
      </div>

      {mode === 'Tage' ? (
        <div className="card divide-y divide-white/5">
          {withDelta.slice(0, 100).map(l => <Entry key={l.id} l={l} />)}
        </div>
      ) : (
        groups!.map(g => {
          const avg = g.items.reduce((a, l) => a + Number(l.weight), 0) / g.items.length
          return (
            <div key={g.label}>
              <div className="flex items-center justify-between px-1 mb-1.5">
                <div>
                  <p className="font-bold">{g.label}</p>
                  <p className="text-xs text-white/45">{g.items.length} Einträge · Durchschnitt {fmtKg(avg)}</p>
                </div>
                <DeltaChip d={g.delta} />
              </div>
              <div className="card divide-y divide-white/5 mb-3">
                {g.items.map(l => <Entry key={l.id} l={l} big />)}
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}

function DeltaChip({ d }: { d: number | null }) {
  if (d == null || Math.abs(d) < 0.05) return <span className="chip bg-white/10 text-white/55">±0,0 kg</span>
  const up = d > 0
  return (
    <span className={cls('chip', up ? 'bg-danger/15 text-red-300' : 'bg-success/15 text-green-300')}>
      {up ? '+' : ''}{d.toFixed(1).replace('.', ',')} kg
    </span>
  )
}

// ---------- Eintrag-Modal ----------
function EntryModal({ title, initial, initialAt, onClose, onSave, onDelete }: {
  title: string; initial: number; initialAt?: string
  onClose: () => void; onSave: (w: number, at?: string) => void; onDelete?: () => void
}) {
  const [val, setVal] = useState(String(initial))
  const toLocal = (iso?: string) => {
    const d = iso ? new Date(iso) : new Date()
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
    return d.toISOString().slice(0, 16)
  }
  const [at, setAt] = useState(toLocal(initialAt))
  return (
    <Modal open onClose={onClose} title={title}>
      <div className="space-y-3">
        <div>
          <label className="label">Gewicht (kg)</label>
          <input className="input text-center text-2xl font-bold" type="text" inputMode="decimal"
            value={val} onChange={e => setVal(e.target.value)} autoFocus />
        </div>
        <div>
          <label className="label">Zeitpunkt</label>
          <input className="input" type="datetime-local" value={at} onChange={e => setAt(e.target.value)} />
        </div>
        <div className="flex gap-2">
          {onDelete && <button className="btn-danger" onClick={onDelete}>Löschen</button>}
          <button className="btn-primary flex-1" onClick={() => {
            const w = parseNum(val)
            if (w) onSave(w, new Date(at).toISOString())
          }}>Speichern</button>
        </div>
      </div>
    </Modal>
  )
}
