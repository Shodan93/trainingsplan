import { supabase } from './supabase'
import {
  Plan, PlanDay, PlanExercise, WorkoutSession, SetLog, Goal,
  BodyMeasurement, DiaryEntry, WeeklyTarget, UserStats, Badge, UserBadge,
  MotivationTip, Profile, Settings
} from './types'

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

export async function getTips(): Promise<MotivationTip[]> {
  const { data } = await supabase.from('motivation_tips').select('*')
  return (data ?? []) as MotivationTip[]
}
