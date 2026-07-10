// Gewichts-Mathematik & Kalorien-Logik (wissenschaftlich fundiert, nachvollziehbar)
import { WeightLog, Settings } from './types'
import { supabase } from './supabase'

// ---------- Gewicht ----------
export type WeightPoint = { t: number; w: number }

export function toPoints(logs: WeightLog[]): WeightPoint[] {
  return logs
    .map(l => ({ t: new Date(l.measured_at).getTime(), w: Number(l.weight) }))
    .sort((a, b) => a.t - b.t)
}

// Geglätteter Trend (EMA über Einträge) – dämpft Tages-Schwankungen
export function trendSeries(points: WeightPoint[], alpha = 0.25): WeightPoint[] {
  let ema: number | null = null
  return points.map(p => {
    ema = ema === null ? p.w : alpha * p.w + (1 - alpha) * ema
    return { t: p.t, w: Math.round(ema * 100) / 100 }
  })
}

export function currentTrend(points: WeightPoint[]): number | null {
  const s = trendSeries(points)
  return s.length ? s[s.length - 1].w : null
}

// Lineare Regression (kg/Tag) über die letzten n Tage
export function slopePerDay(points: WeightPoint[], days = 45): number | null {
  const since = Date.now() - days * 86400000
  const pts = points.filter(p => p.t >= since)
  if (pts.length < 3) return null
  const xs = pts.map(p => p.t / 86400000)
  const ys = pts.map(p => p.w)
  const n = xs.length
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let num = 0, den = 0
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2 }
  if (den === 0) return null
  return num / den
}

// Prognose-Datum für Zielgewicht (linearer Trend); null wenn nicht erreichbar
export function goalPrognosis(points: WeightPoint[], goal: number): Date | null {
  const trend = currentTrend(points)
  const slope = slopePerDay(points)
  if (trend == null || slope == null) return null
  const diff = goal - trend
  if (Math.abs(diff) < 0.05) return new Date()
  if (Math.abs(slope) < 0.002) return null                  // stagniert
  if (Math.sign(diff) !== Math.sign(slope)) return null     // Trend zeigt in falsche Richtung
  const daysNeeded = diff / slope
  if (daysNeeded > 365 * 5) return null
  return new Date(Date.now() + daysNeeded * 86400000)
}

export type PeriodStats = {
  change: number | null; perWeek: number | null
  min: number | null; max: number | null; stdev: number | null; count: number
}

export function periodStats(points: WeightPoint[], days: number | null): PeriodStats {
  const pts = days ? points.filter(p => p.t >= Date.now() - days * 86400000) : points
  if (!pts.length) return { change: null, perWeek: null, min: null, max: null, stdev: null, count: 0 }
  const ws = pts.map(p => p.w)
  const min = Math.min(...ws), max = Math.max(...ws)
  const change = ws[ws.length - 1] - ws[0]
  const spanDays = (pts[pts.length - 1].t - pts[0].t) / 86400000
  const perWeek = spanDays >= 7 ? (change / spanDays) * 7 : null
  const mean = ws.reduce((a, b) => a + b, 0) / ws.length
  const stdev = Math.sqrt(ws.reduce((a, b) => a + (b - mean) ** 2, 0) / ws.length)
  return { change, perWeek, min, max, stdev, count: pts.length }
}

// ---------- BMI ----------
export const BMI_CATEGORIES = [
  { label: 'Starkes Untergewicht', max: 15.9, color: '#2563eb' },
  { label: 'Mäßiges Untergewicht', max: 16.9, color: '#3b82f6' },
  { label: 'Leichtes Untergewicht', max: 18.4, color: '#06b6d4' },
  { label: 'Normales Gewicht', max: 24.9, color: '#22c55e' },
  { label: 'Übergewicht', max: 29.9, color: '#eab308' },
  { label: 'Adipositas Grad I', max: 34.9, color: '#f97316' },
  { label: 'Adipositas Grad II', max: 39.9, color: '#ef4444' },
  { label: 'Adipositas Grad III', max: Infinity, color: '#dc2626' }
]

export function bmi(weightKg: number, heightCm: number): number {
  const m = heightCm / 100
  return weightKg / (m * m)
}
export function bmiCategory(v: number) {
  return BMI_CATEGORIES.find(c => v <= c.max) ?? BMI_CATEGORIES[BMI_CATEGORIES.length - 1]
}
export function normalWeightRange(heightCm: number): [number, number] {
  const m = heightCm / 100
  return [18.5 * m * m, 24.9 * m * m]
}

// Zielgewichts-Empfehlung für Kraftsportler (mehr Muskelmasse als Durchschnitt):
// Männer ~BMI 24.5, Frauen ~BMI 22.5 – innerhalb/oben im Normalbereich
export function recommendedGoalWeight(heightCm: number, sex: string): number {
  const m = heightCm / 100
  const targetBmi = sex === 'f' ? 22.5 : 24.5
  return Math.round(targetBmi * m * m)
}

// ---------- Kalorien ----------
export type GoalType = 'lose' | 'cut' | 'maintain' | 'lean_bulk'
export const GOAL_LABEL: Record<GoalType, string> = {
  cut: 'Cut (muskelschonend)', lose: 'Abnehmen (zügig)', maintain: 'Halten', lean_bulk: 'Lean Bulk'
}
// Defizit/Überschuss relativ zum Körpergewicht (1 kg Fett ≈ 7700 kcal):
// Cut: −0,5 % KG/Woche = optimale Rate, um Muskeln zu halten (Helms 2014, Garthe 2011)
// Abnehmen: −0,75 % KG/Woche = zügiger, dafür etwas höheres Muskelverlust-Risiko
// Lean Bulk: +0,2 % KG/Woche = Aufbau ohne unnötiges Fett
const GOAL_RATE_PCT_PER_WEEK: Record<GoalType, number> = { cut: -0.5, lose: -0.75, maintain: 0, lean_bulk: 0.2 }
const GOAL_NOTE: Record<GoalType, string> = {
  cut: '−0,5 % Körpergewicht/Woche – die optimale Abnehmrate, um Muskelmasse zu halten',
  lose: '−0,75 % Körpergewicht/Woche – zügiger, aber etwas höheres Risiko für Muskelverlust',
  maintain: 'Erhaltungskalorien – Gewicht bleibt stabil',
  lean_bulk: '+0,2 % Körpergewicht/Woche – Muskelaufbau ohne unnötiges Fett'
}

export type CalorieBreakdown = {
  bmr: number
  tdee: number
  adjust: number
  target: number
  workoutsPerWeek: number
  kcalPerSession: number
  proteinG: [number, number]
  parts: { label: string; value: string; note: string }[]
}

// Mifflin-St-Jeor-Grundumsatz + Alltagsaktivität + Training aus ECHTEN Daten
// (Ø Dauer und Ø bewegtes Gesamtvolumen deiner Einheiten × geplante Frequenz)
// + Ziel-Anpassung relativ zum Körpergewicht
export function calorieTarget(opts: {
  weightKg: number; heightCm: number; birthYear: number; sex: string
  goal: GoalType; trainingLink: boolean
  workoutsPerWeek: number          // geplante Einheiten/Woche (Plan oder manuell)
  avgSessionMin: number | null     // Ø Dauer aus dem Verlauf
  avgTonnageKg: number | null      // Ø Volumen (kg bewegt) aus dem Verlauf
}): CalorieBreakdown {
  const age = new Date().getFullYear() - opts.birthYear
  const bmr = Math.round(10 * opts.weightKg + 6.25 * opts.heightCm - 5 * age + (opts.sex === 'f' ? -161 : 5))

  // Alltag (NEAT): Gehen, Stehen, Haushalt – leicht aktiver Alltag ≈ ×1,35
  const neat = Math.round(bmr * 0.35)

  // Training pro Einheit: Zeit-Komponente (MET ~3,5 für Krafttraining inkl.
  // Satzpausen) + Volumen-Komponente (mechanische Arbeit des bewegten Gewichts)
  // + 7 % Nachbrenneffekt (EPOC)
  const wpw = opts.trainingLink ? Math.min(opts.workoutsPerWeek, 7) : 0
  const dur = opts.avgSessionMin ?? 60
  const ton = opts.avgTonnageKg ?? 0
  const kcalPerSession = wpw > 0
    ? Math.round((dur * 0.0613 * opts.weightKg + ton * 0.008) * 1.07)
    : 0
  const trainingDaily = Math.round(kcalPerSession * wpw / 7)

  const tdee = bmr + neat + trainingDaily
  const adjust = Math.round(opts.weightKg * GOAL_RATE_PCT_PER_WEEK[opts.goal] / 100 * 7700 / 7)
  // Sicherheitsgrenze: nie unter den Grundumsatz
  const target = Math.max(bmr, tdee + adjust)
  const floored = tdee + adjust < bmr

  // Im Defizit mehr Protein zum Muskelschutz (Helms 2014), sonst Morton 2018
  const deficit = adjust < 0
  const proteinG: [number, number] = deficit
    ? [Math.round(opts.weightKg * 2.0), Math.round(opts.weightKg * 2.4)]
    : [Math.round(opts.weightKg * 1.6), Math.round(opts.weightKg * 2.2)]

  const parts: CalorieBreakdown['parts'] = [
    { label: 'Grundumsatz (BMR)', value: `${bmr} kcal`, note: `Mifflin-St-Jeor: 10×${Math.round(opts.weightKg)} kg + 6,25×${opts.heightCm} cm − 5×${age} J ${opts.sex === 'f' ? '− 161' : '+ 5'}` },
    { label: 'Alltag (NEAT)', value: `+${neat} kcal`, note: 'Gehen, Stehen, Haushalt – leicht aktiver Alltag (+35 %)' },
    {
      label: 'Krafttraining', value: `+${trainingDaily} kcal`,
      note: wpw > 0
        ? `${wpw}× pro Woche · Ø ${Math.round(dur)} min${ton > 0 ? ` · Ø ${ton.toLocaleString('de-DE')} kg Volumen` : ''} ≈ ${kcalPerSession} kcal/Einheit (inkl. Nachbrenneffekt), auf 7 Tage verteilt`
        : 'Training-Verknüpfung ist aus'
    },
    { label: 'Gesamtumsatz (TDEE)', value: `${tdee} kcal`, note: 'Grundumsatz + Alltag + Training' },
    { label: `Ziel: ${GOAL_LABEL[opts.goal]}`, value: `${adjust >= 0 ? '+' : ''}${adjust} kcal`, note: GOAL_NOTE[opts.goal] + (floored ? ' · auf Grundumsatz begrenzt (Sicherheitsgrenze)' : '') },
    { label: 'Protein-Empfehlung', value: `${proteinG[0]}–${proteinG[1]} g/Tag`, note: deficit ? '2,0–2,4 g/kg – im Defizit schützt hohes Protein die Muskulatur' : '1,6–2,2 g/kg Körpergewicht (Morton 2018)' }
  ]
  return { bmr, tdee, adjust, target, workoutsPerWeek: wpw, kcalPerSession, proteinG, parts }
}

// ---------- Open Food Facts ----------
export type OffProduct = {
  code: string
  name: string; brand: string | null
  kcal100: number | null; protein100: number | null; carbs100: number | null; fat100: number | null
  image: string | null
}

function mapOffProduct(p: Record<string, unknown>): OffProduct {
  const n = (p.nutriments ?? {}) as Record<string, number | undefined>
  const kcal = n['energy-kcal_100g'] ?? (n['energy_100g'] ? n['energy_100g']! / 4.184 : null)
  return {
    code: String(p.code ?? ''),
    name: (p.product_name as string) || (p.generic_name as string) || 'Unbekanntes Produkt',
    brand: (p.brands as string) || null,
    kcal100: kcal != null ? Math.round(kcal) : null,
    protein100: n.proteins_100g ?? null,
    carbs100: n.carbohydrates_100g ?? null,
    fat100: n.fat_100g ?? null,
    image: (p.image_front_small_url as string) || (p.image_small_url as string) || (p.image_front_url as string) || null
  }
}

export async function lookupBarcode(code: string): Promise<OffProduct | null> {
  const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json`)
  if (!res.ok) return null
  const j = await res.json()
  if (j.status !== 1 || !j.product) return null
  return mapOffProduct({ ...j.product, code })
}

// Freitext-Suche: primär über die Edge Function (stabil, kein Browser-CORS/Rate-Limit),
// Fallback direkt gegen Open Food Facts
export async function searchProducts(query: string): Promise<OffProduct[]> {
  try {
    const { data, error } = await supabase.functions.invoke('food-search', { body: { query } })
    if (!error && data?.products?.length) return data.products as OffProduct[]
  } catch { /* Fallback unten */ }
  const url = 'https://world.openfoodfacts.org/cgi/search.pl'
    + `?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=20`
    + '&fields=code,product_name,generic_name,brands,image_front_small_url,image_small_url,nutriments'
    + '&sort_by=unique_scans_n&lc=de&cc=de'
  const res = await fetch(url)
  if (!res.ok) return []
  const j = await res.json()
  return ((j.products ?? []) as Record<string, unknown>[])
    .map(mapOffProduct)
    .filter(p => p.kcal100 != null)
}

// ---------- KI-Kalorienschätzung (Edge Function → Claude) ----------
export type AiEstimate = {
  items: { name: string; kcal: number; protein_g: number; carbs_g: number; fat_g: number }[]
  note: string
}

// ---------- Makro-Ziele ----------
// Protein nach Körpergewicht (im Defizit höher, Muskelschutz), Fett ~28 % der
// Kalorien (hormonell sinnvolles Minimum), Kohlenhydrate füllen den Rest auf
export type MacroTargets = { protein: number; carbs: number; fat: number }
export function macroTargets(targetKcal: number, weightKg: number, deficit: boolean): MacroTargets {
  const protein = Math.round(weightKg * (deficit ? 2.2 : 1.9))
  const fat = Math.round(targetKcal * 0.28 / 9.3)
  const carbs = Math.max(0, Math.round((targetKcal - protein * 4.1 - fat * 9.3) / 4.1))
  return { protein, carbs, fat }
}
