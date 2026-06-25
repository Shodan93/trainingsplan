import { awardBadge, getUserBadges } from './db'
import { UserStats } from './types'

type SessionInfo = {
  totalVolume: number
  isDeload: boolean
  startedHour: number
  didIncrease: boolean
  weeklyAchieved: boolean
}

// Returns the list of newly-earned badge codes (and persists them).
export async function evaluateBadges(uid: string, stats: UserStats, info: SessionInfo): Promise<string[]> {
  const existing = new Set((await getUserBadges(uid)).map(b => b.badge_code))
  const toAward: string[] = []
  const want = (code: string, cond: boolean) => { if (cond && !existing.has(code)) toAward.push(code) }

  want('first_workout', stats.total_workouts >= 1)
  want('workouts_10', stats.total_workouts >= 10)
  want('workouts_50', stats.total_workouts >= 50)
  want('workouts_100', stats.total_workouts >= 100)
  want('streak_7', stats.current_streak >= 7)
  want('streak_30', stats.current_streak >= 30)
  want('level_5', stats.level >= 5)
  want('volume_10k', info.totalVolume >= 10000)
  want('deload_done', info.isDeload)
  want('ddp_progress', info.didIncrease)
  want('weekly_hit', info.weeklyAchieved)
  want('early_bird', info.startedHour < 8)

  for (const code of toAward) await awardBadge(uid, code)
  return toAward
}
