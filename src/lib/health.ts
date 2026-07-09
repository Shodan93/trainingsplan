// Gewichts-Mathematik & Kalorien-Logik (wissenschaftlich fundiert, nachvollziehbar)
import { WeightLog, Settings } from './types'

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
  lose: 'Abnehmen', cut: 'Cut (definieren)', maintain: 'Halten', lean_bulk: 'Lean Bulk'
}
const GOAL_ADJUST: Record<GoalType, number> = { lose: -400, cut: -500, maintain: 0, lean_bulk: 200 }

export type CalorieBreakdown = {
  bmr: number
  activityFactor: number
  workoutsPerWeek: number
  tdee: number
  adjust: number
  target: number
  proteinG: [number, number]
  parts: { label: string; value: string; note: string }[]
}

// Mifflin-St Jeor + Aktivitätsfaktor aus echtem Trainingsvolumen + Ziel-Anpassung
export function calorieTarget(opts: {
  weightKg: number; heightCm: number; birthYear: number; sex: string
  goal: GoalType; workoutsPerWeek: number; trainingLink: boolean
}): CalorieBreakdown {
  const age = new Date().getFullYear() - opts.birthYear
  const bmr = Math.round(10 * opts.weightKg + 6.25 * opts.heightCm - 5 * age + (opts.sex === 'f' ? -161 : 5))
  const w = opts.trainingLink ? Math.min(opts.workoutsPerWeek, 6) : 0
  // 0 Trainings ≈ sitzend (1.2); je Einheit/Woche ~ +0.045 bis max ~1.47 (moderat aktiv)
  const activityFactor = Math.round((1.2 + w * 0.045) * 1000) / 1000
  const tdee = Math.round(bmr * activityFactor)
  const adjust = GOAL_ADJUST[opts.goal]
  const target = Math.max(1200, tdee + adjust)
  const proteinG: [number, number] = [Math.round(opts.weightKg * 1.6), Math.round(opts.weightKg * 2.2)]
  return {
    bmr, activityFactor, workoutsPerWeek: opts.workoutsPerWeek, tdee, adjust, target, proteinG,
    parts: [
      { label: 'Grundumsatz (BMR)', value: `${bmr} kcal`, note: `Mifflin-St-Jeor: 10×${opts.weightKg} kg + 6,25×${opts.heightCm} cm − 5×${age} J ${opts.sex === 'f' ? '− 161' : '+ 5'}` },
      { label: 'Aktivität', value: `× ${activityFactor}`, note: opts.trainingLink ? `${opts.workoutsPerWeek}× Training/Woche (aus deinem Verlauf) + Alltag` : 'Training-Verknüpfung aus – nur Alltagsaktivität (1,2)' },
      { label: 'Gesamtumsatz (TDEE)', value: `${tdee} kcal`, note: 'BMR × Aktivitätsfaktor' },
      { label: `Ziel: ${GOAL_LABEL[opts.goal]}`, value: `${adjust >= 0 ? '+' : ''}${adjust} kcal`, note: adjust < 0 ? 'Moderates Defizit – nachhaltig, muskelschonend (~0,3–0,5 kg/Woche)' : adjust > 0 ? 'Leichter Überschuss – Muskelaufbau ohne unnötiges Fett' : 'Erhaltungskalorien' },
      { label: 'Protein-Empfehlung', value: `${proteinG[0]}–${proteinG[1]} g/Tag`, note: '1,6–2,2 g/kg Körpergewicht (Morton 2018)' }
    ]
  }
}

// ---------- Open Food Facts ----------
export type OffProduct = {
  name: string; brand: string | null
  kcal100: number | null; protein100: number | null; carbs100: number | null; fat100: number | null
}
export async function lookupBarcode(code: string): Promise<OffProduct | null> {
  const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json`)
  if (!res.ok) return null
  const j = await res.json()
  if (j.status !== 1 || !j.product) return null
  const n = j.product.nutriments ?? {}
  const kcal = n['energy-kcal_100g'] ?? (n['energy_100g'] ? n['energy_100g'] / 4.184 : null)
  return {
    name: j.product.product_name || j.product.generic_name || 'Unbekanntes Produkt',
    brand: j.product.brands || null,
    kcal100: kcal != null ? Math.round(kcal) : null,
    protein100: n.proteins_100g ?? null,
    carbs100: n.carbohydrates_100g ?? null,
    fat100: n.fat_100g ?? null
  }
}
