import { supabase } from './supabase'
import {
  Plan, PlanDay, PlanExercise, WorkoutSession, SetLog, Goal,
  BodyMeasurement, DiaryEntry, WeeklyTarget, UserStats, Badge, UserBadge,
  MotivationTip, Profile, Settings, WeightLog, CalorieLog, Meal
} from './types'

export type WorkoutBootstrap = {
  session: WorkoutSession
  settings: Settings | null
  current_logs: { plan_exercise_id: string | null; set_number: number; weight: number | null; reps: number | null; completed: boolean; is_failure: boolean }[]
  exercises: (PlanExercise & { last_sets: { set_number: number; weight: number | null; reps: number | null }[]; last_count: number; suggestion: { action: string; message: string; weight: number | null } })[]
}
export async function workoutBootstrap(sessionId: string): Promise<WorkoutBootstrap> {
  const { data, error } = await supabase.rpc('workout_bootstrap', { p_session_id: sessionId })
  if (error) throw error
  return data as WorkoutBootstrap
}
export async function tipOfTheDay(): Promise<MotivationTip | null> {
  const { data } = await supabase.rpc('tip_of_the_day')
  return (data ?? null) as MotivationTip | null
}

export async function getProfiles(): Promise<Profile[]> {
  const { data } = await supabase.from('profiles').select('*').order('display_name')
  return (data ?? []) as Profile[]
}

export async function getSettings(uid: string): Promise<Settings | null> {
  const { data } = await supabase.from('settings').select('*').eq('user_id', uid).single()
  return data as Settings | null
}

export async function updateSettings(uid: string, patch: Partial<Settings>) {
  await supabase.from('settings').update(patch).eq('user_id', uid)
}

export async function getStats(uid: string): Promise<UserStats | null> {
  const { data } = await supabase.from('user_stats').select('*').eq('user_id', uid).single()
  return data as UserStats | null
}
export async function recomputeStats(uid: string) {
  await supabase.rpc('recompute_user_stats', { p_uid: uid })
}
// Abgeschlossene Workouts in einer Woche (robust aus den Sessions, kein Counter)
export async function countCompletedSessionsInWeek(uid: string, weekStartISO: string): Promise<number> {
  // Wochengrenzen in LOKALER Zeit in Timestamps übersetzen (Mo 00:00 – Mo 00:00)
  const start = new Date(weekStartISO + 'T00:00:00')
  const end = new Date(start)
  end.setDate(end.getDate() + 7)
  const { count } = await supabase
    .from('workout_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', uid)
    .not('completed_at', 'is', null)
    .gte('completed_at', start.toISOString())
    .lt('completed_at', end.toISOString())
  return count ?? 0
}

export async function getActivePlan(uid: string): Promise<Plan | null> {
  const { data } = await supabase
    .from('plans').select('*')
    .eq('owner_id', uid).eq('is_active', true)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  return data as Plan | null
}

export async function getDays(planId: string): Promise<PlanDay[]> {
  const { data } = await supabase.from('plan_days').select('*').eq('plan_id', planId).order('sort_order')
  return (data ?? []) as PlanDay[]
}

export async function getExercises(dayId: string): Promise<PlanExercise[]> {
  const { data } = await supabase.from('plan_exercises').select('*').eq('plan_day_id', dayId).order('sort_order')
  return (data ?? []) as PlanExercise[]
}

export async function getDayExercises(dayIds: string[]): Promise<PlanExercise[]> {
  if (!dayIds.length) return []
  const { data } = await supabase.from('plan_exercises').select('*').in('plan_day_id', dayIds).order('sort_order')
  return (data ?? []) as PlanExercise[]
}

// ---- Plan editing ----
export async function updatePlan(id: string, patch: Partial<Plan>) {
  await supabase.from('plans').update(patch).eq('id', id)
}
export async function updateExercise(id: string, patch: Partial<PlanExercise>) {
  await supabase.from('plan_exercises').update(patch).eq('id', id)
}
export async function addExercise(ex: Partial<PlanExercise>) {
  const { data } = await supabase.from('plan_exercises').insert(ex).select().single()
  return data as PlanExercise
}
export async function deleteExercise(id: string) {
  await supabase.from('plan_exercises').delete().eq('id', id)
}
// Reihenfolge speichern: sort_order anhand der übergebenen ID-Reihenfolge setzen
export async function reorderExercises(ids: string[]) {
  await Promise.all(ids.map((id, i) =>
    supabase.from('plan_exercises').update({ sort_order: i + 1 }).eq('id', id)))
}
export async function addDay(day: Partial<PlanDay>) {
  const { data } = await supabase.from('plan_days').insert(day).select().single()
  return data as PlanDay
}
export async function updateDay(id: string, patch: Partial<PlanDay>) {
  await supabase.from('plan_days').update(patch).eq('id', id)
}
export async function deleteDay(id: string) {
  await supabase.from('plan_days').delete().eq('id', id)
}

// ---- Workout sessions ----
export async function startSession(s: Partial<WorkoutSession>): Promise<WorkoutSession> {
  const { data, error } = await supabase.from('workout_sessions').insert(s).select().single()
  if (error) throw error
  return data as WorkoutSession
}
export async function saveSetLog(log: Partial<SetLog>): Promise<SetLog> {
  const { data, error } = await supabase
    .from('set_logs')
    .upsert(log, { onConflict: 'session_id,plan_exercise_id,set_number' })
    .select().single()
  if (error) throw error
  return data as SetLog
}
export async function getSessionLogs(sessionId: string): Promise<SetLog[]> {
  const { data } = await supabase.from('set_logs').select('*').eq('session_id', sessionId).order('set_number')
  return (data ?? []) as SetLog[]
}
export async function finalizeSession(sessionId: string) {
  const { data, error } = await supabase.rpc('finalize_session', { p_session_id: sessionId })
  if (error) throw error
  return data as { xp_earned: number; total_volume: number; sets: number; streak: number; level: number }
}
export async function deleteSession(sessionId: string) {
  await supabase.from('workout_sessions').delete().eq('id', sessionId)
}
export async function updateSession(sessionId: string, patch: Partial<WorkoutSession>) {
  await supabase.from('workout_sessions').update(patch).eq('id', sessionId)
}
export async function updateSetLogById(id: string, patch: Partial<SetLog>) {
  await supabase.from('set_logs').update(patch).eq('id', id)
}
export async function deleteSetLog(id: string) {
  await supabase.from('set_logs').delete().eq('id', id)
}
// Recompute a session's total_volume from its completed set logs and persist it.
export async function recomputeSessionVolume(sessionId: string): Promise<number> {
  const logs = await getSessionLogs(sessionId)
  const vol = logs.filter(l => l.completed)
    .reduce((a, l) => a + (Number(l.weight) || 0) * (Number(l.reps) || 0), 0)
  await supabase.from('workout_sessions').update({ total_volume: vol }).eq('id', sessionId)
  return vol
}
// DDP: neues Arbeitsgewicht – wirkt via RPC auf ALLE Tage mit derselben Übung (Carry-over)
export async function setExerciseTargetWeight(planExerciseId: string, weight: number) {
  const { error } = await supabase.rpc('set_exercise_weight', { p_plan_exercise_id: planExerciseId, p_weight: weight })
  if (error) throw error
}
// Deload-Autoregulation: letztes Deload-Datum bzw. Programmstart
export async function getDeloadInfo(uid: string): Promise<{ lastDeload: string | null; firstSession: string | null }> {
  const [{ data: d }, { data: f }] = await Promise.all([
    supabase.from('workout_sessions').select('completed_at').eq('user_id', uid).eq('is_deload', true)
      .not('completed_at', 'is', null).order('completed_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('workout_sessions').select('completed_at').eq('user_id', uid)
      .not('completed_at', 'is', null).order('completed_at', { ascending: true }).limit(1).maybeSingle()
  ])
  return { lastDeload: d?.completed_at ?? null, firstSession: f?.completed_at ?? null }
}
// Set während des Trainings entfernen (nach Satznummer)
export async function deleteSetLogByNumber(sessionId: string, planExerciseId: string, setNumber: number) {
  await supabase.from('set_logs').delete()
    .eq('session_id', sessionId).eq('plan_exercise_id', planExerciseId).eq('set_number', setNumber)
}
// Alle Logs einer Übung in der Session löschen (für Resync nach Satz-Löschung)
export async function deleteAllSetLogsForExercise(sessionId: string, planExerciseId: string) {
  await supabase.from('set_logs').delete()
    .eq('session_id', sessionId).eq('plan_exercise_id', planExerciseId)
}
// Übungsnamen in den Logs der laufenden Session mit umbenennen
export async function renameSessionExercise(sessionId: string, planExerciseId: string, name: string) {
  await supabase.from('set_logs').update({ exercise_name: name })
    .eq('session_id', sessionId).eq('plan_exercise_id', planExerciseId)
}
// Open (not yet finished) session, for resume
export async function getOpenSession(uid: string): Promise<WorkoutSession | null> {
  const { data } = await supabase
    .from('workout_sessions').select('*')
    .eq('user_id', uid).is('completed_at', null)
    .order('started_at', { ascending: false }).limit(1).maybeSingle()
  return data as WorkoutSession | null
}

export async function getSessions(uid: string, limit = 50): Promise<WorkoutSession[]> {
  const { data } = await supabase
    .from('workout_sessions').select('*')
    .eq('user_id', uid).not('completed_at', 'is', null)
    .order('completed_at', { ascending: false }).limit(limit)
  return (data ?? []) as WorkoutSession[]
}

export async function ddpSuggestion(planExerciseId: string) {
  const { data } = await supabase.rpc('ddp_suggestion', { p_plan_exercise_id: planExerciseId })
  return data as { action: string; weight: number | null; message: string; min_reps?: number }
}

// Last logged set for an exercise (by plan_exercise_id) for prefilling
export async function lastSetsForExercise(planExerciseId: string): Promise<SetLog[]> {
  const { data: lastSession } = await supabase
    .from('set_logs')
    .select('session_id, workout_sessions!inner(completed_at)')
    .eq('plan_exercise_id', planExerciseId)
    .not('workout_sessions.completed_at', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1).maybeSingle()
  const sid = (lastSession as { session_id?: string } | null)?.session_id
  if (!sid) return []
  const { data } = await supabase
    .from('set_logs').select('*')
    .eq('session_id', sid).eq('plan_exercise_id', planExerciseId)
    .order('set_number')
  return (data ?? []) as SetLog[]
}

// ---- Stats helpers ----
export async function setLogsForSessions(sessionIds: string[]): Promise<SetLog[]> {
  if (!sessionIds.length) return []
  const { data } = await supabase.from('set_logs').select('*').in('session_id', sessionIds).eq('completed', true)
  return (data ?? []) as SetLog[]
}

// ---- Goals / Measurements / Diary ----
export async function getGoals(uid: string): Promise<Goal[]> {
  const { data } = await supabase.from('goals').select('*').eq('user_id', uid).order('created_at')
  return (data ?? []) as Goal[]
}
export async function upsertGoal(g: Partial<Goal>) {
  const { data } = await supabase.from('goals').upsert(g).select().single()
  return data as Goal
}
export async function deleteGoal(id: string) { await supabase.from('goals').delete().eq('id', id) }

export async function getMeasurements(uid: string): Promise<BodyMeasurement[]> {
  const { data } = await supabase.from('body_measurements').select('*').eq('user_id', uid).order('measured_at', { ascending: false })
  return (data ?? []) as BodyMeasurement[]
}
export async function addMeasurement(m: Partial<BodyMeasurement>) {
  const { data } = await supabase.from('body_measurements').insert(m).select().single()
  return data as BodyMeasurement
}
export async function deleteMeasurement(id: string) { await supabase.from('body_measurements').delete().eq('id', id) }

export async function getDiary(uid: string): Promise<DiaryEntry[]> {
  const { data } = await supabase.from('diary_entries').select('*').eq('user_id', uid).order('entry_date', { ascending: false })
  return (data ?? []) as DiaryEntry[]
}
export async function addDiary(e: Partial<DiaryEntry>) {
  const { data } = await supabase.from('diary_entries').insert(e).select().single()
  return data as DiaryEntry
}
export async function deleteDiary(id: string) { await supabase.from('diary_entries').delete().eq('id', id) }

// ---- Weekly target / Badges / Tips ----
export async function getWeeklyTarget(uid: string, weekStart: string): Promise<WeeklyTarget | null> {
  const { data } = await supabase.from('weekly_targets').select('*').eq('user_id', uid).eq('week_start', weekStart).maybeSingle()
  return data as WeeklyTarget | null
}
export async function ensureWeeklyTarget(uid: string, weekStart: string, target = 4) {
  const existing = await getWeeklyTarget(uid, weekStart)
  if (existing) return existing
  const { data } = await supabase.from('weekly_targets').insert({ user_id: uid, week_start: weekStart, target_workouts: target }).select().single()
  return data as WeeklyTarget
}
export async function setWeeklyTargetCount(uid: string, weekStart: string, target: number) {
  await supabase.from('weekly_targets').update({ target_workouts: target }).eq('user_id', uid).eq('week_start', weekStart)
}

export async function getBadges(): Promise<Badge[]> {
  const { data } = await supabase.from('badges').select('*').order('sort_order')
  return (data ?? []) as Badge[]
}
export async function getUserBadges(uid: string): Promise<UserBadge[]> {
  const { data } = await supabase.from('user_badges').select('*').eq('user_id', uid)
  return (data ?? []) as UserBadge[]
}
export async function awardBadge(uid: string, code: string) {
  await supabase.from('user_badges').upsert({ user_id: uid, badge_code: code }).select()
}

// ---- Gewicht ----
export async function getWeightLogs(uid: string, limit = 1000): Promise<WeightLog[]> {
  const { data } = await supabase.from('weight_logs').select('*')
    .eq('user_id', uid).order('measured_at', { ascending: false }).limit(limit)
  return (data ?? []) as WeightLog[]
}
export async function addWeightLog(uid: string, weight: number, measuredAt?: string): Promise<WeightLog> {
  const { data, error } = await supabase.from('weight_logs')
    .insert({ user_id: uid, weight, ...(measuredAt ? { measured_at: measuredAt } : {}) }).select().single()
  if (error) throw error
  return data as WeightLog
}
export async function updateWeightLog(id: string, patch: { weight?: number; measured_at?: string }) {
  await supabase.from('weight_logs').update(patch).eq('id', id)
}
export async function deleteWeightLog(id: string) {
  await supabase.from('weight_logs').delete().eq('id', id)
}

// ---- Kalorien ----
export async function getCalorieLogs(uid: string, sinceDay: string): Promise<CalorieLog[]> {
  const { data } = await supabase.from('calorie_logs').select('*')
    .eq('user_id', uid).gte('day', sinceDay).order('logged_at', { ascending: false })
  return (data ?? []) as CalorieLog[]
}
export async function addCalorieLog(log: Partial<CalorieLog>): Promise<CalorieLog> {
  const { data, error } = await supabase.from('calorie_logs').insert(log).select().single()
  if (error) throw error
  return data as CalorieLog
}
export async function deleteCalorieLog(id: string) {
  await supabase.from('calorie_logs').delete().eq('id', id)
}
export async function updateCalorieLog(id: string, patch: Partial<CalorieLog>) {
  await supabase.from('calorie_logs').update(patch).eq('id', id)
}

// ---- Mahlzeiten ----
export async function getMeals(uid: string): Promise<Meal[]> {
  const { data } = await supabase.from('meals').select('*')
    .eq('user_id', uid).order('created_at', { ascending: false })
  return (data ?? []) as Meal[]
}
export async function addMeal(meal: Partial<Meal>): Promise<Meal> {
  const { data, error } = await supabase.from('meals').insert(meal).select().single()
  if (error) throw error
  return data as Meal
}
export async function deleteMeal(id: string) {
  await supabase.from('meals').delete().eq('id', id)
}
// Auch Partner-Mahlzeiten lesbar (RLS erlaubt select für beide) – für geteilte Links
export async function getMealById(id: string): Promise<Meal | null> {
  const { data } = await supabase.from('meals').select('*').eq('id', id).maybeSingle()
  return (data as Meal) ?? null
}

// Echte Trainingslast für die Kalorienrechnung: Ø Dauer & Ø Volumen aus den
// letzten 28 Tagen plus geplante Frequenz aus dem aktiven Plan (Anzahl Plan-Tage)
export type TrainingLoad = {
  avgSessionMin: number | null
  avgTonnageKg: number | null
  observedPerWeek: number
  plannedPerWeek: number | null
}
export async function trainingLoad(uid: string): Promise<TrainingLoad> {
  const since = new Date(Date.now() - 28 * 86400000).toISOString()
  const [{ data: sessions }, plan] = await Promise.all([
    supabase.from('workout_sessions')
      .select('duration_seconds,total_volume')
      .eq('user_id', uid).not('completed_at', 'is', null).gte('completed_at', since),
    getActivePlan(uid)
  ])
  const ss = (sessions ?? []).filter(s => (s.duration_seconds ?? 0) > 0 || Number(s.total_volume) > 0)
  const avg = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
  // Plausibilität: offen liegen gelassene Sessions (z. B. 25 h) nicht mitzählen
  const durs = ss.map(s => (s.duration_seconds ?? 0) / 60).filter(v => v >= 15 && v <= 240)
  const tons = ss.map(s => Number(s.total_volume) || 0).filter(v => v > 0)
  let plannedPerWeek: number | null = null
  if (plan) {
    const { count } = await supabase.from('plan_days')
      .select('id', { count: 'exact', head: true }).eq('plan_id', plan.id)
    plannedPerWeek = count ?? null
  }
  return {
    avgSessionMin: avg(durs) ? Math.round(avg(durs)!) : null,
    avgTonnageKg: avg(tons) ? Math.round(avg(tons)!) : null,
    observedPerWeek: Math.round(((sessions?.length ?? 0) / 4) * 10) / 10,
    plannedPerWeek
  }
}

export async function getTips(): Promise<MotivationTip[]> {
  const { data } = await supabase.from('motivation_tips').select('*')
  return (data ?? []) as MotivationTip[]
}
