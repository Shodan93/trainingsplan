export type Profile = {
  id: string
  display_name: string
  avatar_emoji: string
  is_admin: boolean
  friend_code: string | null
}

export type Settings = {
  user_id: string
  default_rest_seconds: number
  sound_enabled: boolean
  vibration_enabled: boolean
  notifications_enabled: boolean
  theme: string
  units: string
  birth_year: number | null
  height_cm: number | null
  sex: string | null
  goal_type: string | null
  goal_weight: number | null
  calorie_training_link: boolean
  calorie_override: number | null
  planned_workouts: number | null
}

export type WeightLog = {
  id: string
  user_id: string
  measured_at: string
  weight: number
}

export type CalorieLog = {
  id: string
  user_id: string
  logged_at: string
  day: string
  kcal: number
  label: string | null
  source: string
  barcode: string | null
  product_name: string | null
  amount_g: number | null
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
  image_url: string | null
}

export type MealItem = {
  name: string
  amount_g: number | null
  kcal: number
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
}

export type Meal = {
  id: string
  user_id: string
  name: string
  kcal: number
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
  items: MealItem[]
  image_url: string | null
  created_at: string
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
  effort_code: string
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

export type CardioSession = {
  id: string
  user_id: string
  machine: string
  performed_at: string
  duration_seconds: number
  calories: number | null
  distance_km: number | null
  floors: number | null
  level: number | null
  avg_watts: number | null
  avg_hr: number | null
  max_hr: number | null
  cadence: number | null
  speed_kmh: number | null
  incline_pct: number | null
  rpe: number | null
  notes: string | null
  source: 'manual' | 'ocr'
  created_at: string
}

// Messwerte eines Cardio-Eintrags (ohne Pflichtfeld Dauer)
export type CardioMetricKey =
  | 'calories' | 'distance_km' | 'floors' | 'level' | 'avg_watts'
  | 'avg_hr' | 'max_hr' | 'cadence' | 'speed_kmh' | 'incline_pct'

export const CARDIO_METRICS: Record<CardioMetricKey, { label: string; unit: string }> = {
  floors: { label: 'Etagen', unit: 'floors' },
  level: { label: 'Level', unit: '' },
  avg_watts: { label: 'Leistung', unit: 'W' },
  distance_km: { label: 'Distanz', unit: 'km' },
  speed_kmh: { label: 'Tempo', unit: 'km/h' },
  incline_pct: { label: 'Steigung', unit: '%' },
  cadence: { label: 'Kadenz', unit: 'spm' },
  calories: { label: 'Kalorien', unit: 'kcal' },
  avg_hr: { label: 'Ø Puls', unit: 'bpm' },
  max_hr: { label: 'Max. Puls', unit: 'bpm' }
}

// Geräte-Vorlagen: welche Felder sind pro Gerät sinnvoll, was ist die
// Leit-Metrik für die Progression (nach Dauer)
export const CARDIO_MACHINES: { name: string; icon: string; fields: CardioMetricKey[]; primary: CardioMetricKey }[] = [
  { name: 'Treppensteiger', icon: '🪜', fields: ['floors', 'level', 'cadence', 'avg_watts', 'calories', 'avg_hr'], primary: 'floors' },
  { name: 'Laufband', icon: '🏃', fields: ['distance_km', 'speed_kmh', 'incline_pct', 'calories', 'avg_hr'], primary: 'distance_km' },
  { name: 'Ergometer', icon: '🚴', fields: ['avg_watts', 'level', 'distance_km', 'cadence', 'calories', 'avg_hr'], primary: 'avg_watts' },
  { name: 'Rudergerät', icon: '🚣', fields: ['distance_km', 'avg_watts', 'cadence', 'calories', 'avg_hr'], primary: 'distance_km' },
  { name: 'Crosstrainer', icon: '⛷️', fields: ['level', 'avg_watts', 'distance_km', 'calories', 'avg_hr'], primary: 'avg_watts' }
]
export const cardioMachineInfo = (machine: string) =>
  CARDIO_MACHINES.find(m => m.name.toLowerCase() === machine.trim().toLowerCase()) ?? null

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

// Bewusst unterscheidbare Farben pro Muskelgruppe (Pull ≠ Glutes!)
export const MUSCLE_HEX: Record<string, string> = {
  push: '#f97316',
  pull: '#22c55e',
  arms: '#a855f7',
  core: '#ec4899',
  legs: '#eab308',
  glutes: '#14b8a6',
  posterior: '#94a3b8',
  prehab: '#ef4444',
  home: '#3b82f6',
  other: '#64748b'
}
