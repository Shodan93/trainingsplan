export type Profile = {
  id: string
  display_name: string
  avatar_emoji: string
  is_admin: boolean
}

export type Settings = {
  user_id: string
  default_rest_seconds: number
  sound_enabled: boolean
  vibration_enabled: boolean
  notifications_enabled: boolean
  theme: string
  units: string
}

export type UserStats = {
  user_id: string
  xp: number
  level: number
  current_streak: number
  longest_streak: number
  last_workout_date: string | null
  total_workouts: number
}

export type Plan = {
  id: string
  owner_id: string
  name: string
  progression_note: string | null
  medical_note: string | null
  color_legend: Record<string, string> | null
  deload_week: number
  is_active: boolean
}

export type PlanDay = {
  id: string
  plan_id: string
  weekday: string
  title: string
  effort: string | null
  sort_order: number
}

export type PlanExercise = {
  id: string
  plan_day_id: string
  exercise_id: string | null
  name: string
  muscle_group: string
  color: string
  sets: number
  rep_min: number
  rep_max: number
  per_side: boolean
  is_home: boolean
  is_warning: boolean
  target_weight: number | null
  unit: string
  cue: string | null
  technique: string | null
  sort_order: number
}

export type WorkoutSession = {
  id: string
  user_id: string
  plan_id: string | null
  plan_day_id: string | null
  day_title: string | null
  started_at: string
  completed_at: string | null
  duration_seconds: number | null
  is_deload: boolean
  total_volume: number
  xp_earned: number
  notes: string | null
  mood: number | null
}

export type SetLog = {
  id: string
  session_id: string
  plan_exercise_id: string | null
  exercise_name: string
  muscle_group: string | null
  set_number: number
  target_rep_min: number | null
  target_rep_max: number | null
  weight: number | null
  reps: number | null
  rir: number | null
  is_failure: boolean
  completed: boolean
  rest_seconds: number | null
}

export type Goal = {
  id: string
  user_id: string
  title: string
  target_value: number | null
  current_value: number | null
  unit: string | null
  due_date: string | null
  achieved: boolean
}

export type BodyMeasurement = {
  id: string
  user_id: string
  measured_at: string
  metric: string
  value: number
  unit: string
  note: string | null
}

export type DiaryEntry = {
  id: string
  user_id: string
  entry_date: string
  content: string
  mood: number | null
}

export type WeeklyTarget = {
  id: string
  user_id: string
  week_start: string
  target_workouts: number
  target_volume: number | null
  completed_workouts: number
  achieved: boolean
}

export type Badge = {
  code: string
  name: string
  description: string
  icon: string
  sort_order: number
}

export type UserBadge = { user_id: string; badge_code: string; earned_at: string }

export type MotivationTip = { id: string; category: string; text: string }

export const MUSCLE_LABELS: Record<string, string> = {
  push: 'Push',
  pull: 'Pull',
  arms: 'Arme',
  core: 'Core',
  legs: 'Beine',
  glutes: 'Glutes',
  posterior: 'Posterior',
  prehab: 'Prehab',
  home: 'Zuhause',
  other: 'Sonstige'
}

export const MUSCLE_HEX: Record<string, string> = {
  push: '#f59e0b',
  pull: '#22c55e',
  arms: '#a855f7',
  core: '#ec4899',
  legs: '#eab308',
  glutes: '#22c55e',
  posterior: '#94a3b8',
  prehab: '#ef4444',
  home: '#3b82f6',
  other: '#64748b'
}
