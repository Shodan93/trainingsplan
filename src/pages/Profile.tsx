import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import {
  getSettings, updateSettings, getStats, getBadges, getUserBadges,
  getGoals, upsertGoal, deleteGoal,
  getWeeklyTarget, setWeeklyTargetCount, ensureWeeklyTarget,
  getSessions, updateSession
} from '../lib/db'
import {
  Settings, UserStats, Badge, UserBadge, Goal, WorkoutSession
} from '../lib/types'
import { Spinner, PageSkeleton, Modal, ProgressBar } from '../components/ui'
import { fmtDate, levelProgress, isoWeekStart, cls, todayISO, MOODS, moodEmoji } from '../lib/utils'
import { ensureNotifyPermission } from '../lib/notify'

const AVATARS = ['💪', '🏋️', '🔥', '🦾', '🏃', '🧗', '⚡', '🦁', '🐺', '🌟']
const TABS = ['Übersicht', 'Ziele', 'Tagebuch', 'Einstellungen'] as const
type Tab = typeof TABS[number]

export default function Profile() {
  const { profile, signOut, refreshProfile } = useAuth()
  const [tab, setTab] = useState<Tab>('Übersicht')
  const [stats, setStats] = useState<UserStats | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [badges, setBadges] = useState<Badge[]>([])
  const [earned, setEarned] = useState<UserBadge[]>([])
  const [loading, setLoading] = useState(true)
  const [weekTarget, setWeekTarget] = useState(4)

  async function load() {
    if (!profile) return
    const ws = isoWeekStart()
    await ensureWeeklyTarget(profile.id, ws)
    const [st, se, b, ub, wt] = await Promise.all([
      getStats(profile.id), getSettings(profile.id), getBadges(), getUserBadges(profile.id), getWeeklyTarget(profile.id, ws)
    ])
    setStats(st); setSettings(se); setBadges(b); setEarned(ub)
    if (wt) setWeekTarget(wt.target_workouts)
    setLoading(false)
  }
  useEffect(() => { load() }, [profile])

  if (loading || !profile) return <PageSkeleton rows={4} />
  const earnedSet = new Set(earned.map(e => e.badge_code))
  const lp = stats ? levelProgress(stats.xp, stats.level) : { pct: 0, next: 0 }

  return (
    <div className="space-y-4 py-2">
      <div className="flex items-center justify-between pt-2">
        <h1 className="text-2xl font-extrabold">👤 Profil</h1>
        <button className="btn-ghost text-sm" onClick={signOut}>Abmelden</button>
      </div>

      {/* identity */}
      <div className="card flex items-center gap-4">
        <button className="text-5xl" onClick={async () => {
          const i = (AVATARS.indexOf(profile.avatar_emoji) + 1) % AVATARS.length
          await supabase.from('profiles').update({ avatar_emoji: AVATARS[i] }).eq('id', profile.id)
          refreshProfile()
        }}>{profile.avatar_emoji}</button>
        <div className="flex-1">
          <p className="text-xl font-extrabold">{profile.display_name}</p>
          <p className="text-xs text-white/50">Level {stats?.level} · {stats?.xp} XP · 🔥 {stats?.current_streak} Streak</p>
          <ProgressBar pct={lp.pct} color="#f59e0b" className="mt-2" />
        </div>
      </div>

      {/* tabs */}
      <div className="flex gap-1 overflow-x-auto -mx-1 px-1 pb-1">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={cls('btn shrink-0 !py-1.5 text-sm', tab === t ? 'btn-primary' : 'btn-ghost')}>{t}</button>
        ))}
      </div>

      {tab === 'Übersicht' && (
        <div className="card">
          <p className="font-bold mb-3">Abzeichen 🏅 ({earnedSet.size}/{badges.length})</p>
          <div className="grid grid-cols-3 gap-3">
            {badges.map(b => {
              const has = earnedSet.has(b.code)
              return (
                <div key={b.code} className={cls('rounded-xl p-3 text-center border', has ? 'bg-accent/10 border-accent/30' : 'bg-surface2 border-white/5 opacity-40')}>
                  <div className="text-3xl mb-1">{has ? b.icon : '🔒'}</div>
                  <p className="text-xs font-semibold leading-tight">{b.name}</p>
                  <p className="text-[10px] text-white/40 mt-0.5 leading-tight">{b.description}</p>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {tab === 'Ziele' && <GoalsTab uid={profile.id} />}
      {tab === 'Tagebuch' && <DiaryTab uid={profile.id} />}
      {tab === 'Einstellungen' && settings && (
        <SettingsTab uid={profile.id} settings={settings} weekTarget={weekTarget}
          onWeek={async (n) => { await setWeeklyTargetCount(profile.id, isoWeekStart(), n); setWeekTarget(n) }}
          onChange={(s) => setSettings(s)} displayName={profile.display_name}
          onName={async (name) => { await supabase.from('profiles').update({ display_name: name }).eq('id', profile.id); refreshProfile() }} />
      )}
    </div>
  )
}

function GoalsTab({ uid }: { uid: string }) {
  const [goals, setGoals] = useState<Goal[]>([])
  const [open, setOpen] = useState(false)
  const [f, setF] = useState<Partial<Goal>>({ title: '', unit: 'kg' })
  const load = () => getGoals(uid).then(setGoals)
  useEffect(() => { load() }, [uid])
  return (
    <div className="space-y-2">
      {goals.map(g => (
        <div key={g.id} className="card flex items-center justify-between">
          <div className="flex-1">
            <p className="font-semibold flex items-center gap-2">{g.achieved && '✅'} {g.title}</p>
            <p className="text-xs text-white/50">
              {g.current_value ?? '?'}{g.unit} / {g.target_value}{g.unit}
            </p>
            {g.target_value != null && g.current_value != null &&
              <ProgressBar className="mt-1.5" pct={(g.current_value / g.target_value) * 100} color="#22c55e" />}
          </div>
          <div className="flex flex-col gap-1 ml-2">
            <button className="btn-ghost !px-2 !py-1 text-xs" onClick={async () => { await upsertGoal({ ...g, achieved: !g.achieved }); load() }}>{g.achieved ? '↩︎' : '✓'}</button>
            <button className="btn-ghost !px-2 !py-1 text-xs" onClick={async () => { await deleteGoal(g.id); load() }}>🗑️</button>
          </div>
        </div>
      ))}
      <button className="btn-ghost w-full" onClick={() => { setF({ title: '', unit: 'kg' }); setOpen(true) }}>+ Ziel hinzufügen</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Neues Ziel">
        <div className="space-y-3">
          <div><label className="label">Titel</label><input className="input" value={f.title ?? ''} onChange={e => setF({ ...f, title: e.target.value })} placeholder="z. B. Bench 110 kg" /></div>
          <div className="grid grid-cols-3 gap-2">
            <div><label className="label">Aktuell</label><input className="input" type="number" onChange={e => setF({ ...f, current_value: +e.target.value })} /></div>
            <div><label className="label">Ziel</label><input className="input" type="number" onChange={e => setF({ ...f, target_value: +e.target.value })} /></div>
            <div><label className="label">Einheit</label><input className="input" value={f.unit ?? ''} onChange={e => setF({ ...f, unit: e.target.value })} /></div>
          </div>
          <button className="btn-primary w-full" onClick={async () => { await upsertGoal({ ...f, user_id: uid }); setOpen(false); load() }}>Speichern</button>
        </div>
      </Modal>
    </div>
  )
}

function MoodPicker({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  return (
    <div className="flex justify-between gap-1">
      {MOODS.map(m => (
        <button key={m.v} onClick={() => onChange(value === m.v ? null : m.v)}
          className={cls('flex-1 flex flex-col items-center gap-0.5 py-2 rounded-xl transition active:scale-90',
            value === m.v ? 'bg-primary/20 ring-2 ring-primary' : 'bg-white/5')}>
          <span className="text-2xl">{m.e}</span>
          <span className="text-[10px] text-white/50">{m.l}</span>
        </button>
      ))}
    </div>
  )
}

function DiaryTab({ uid }: { uid: string }) {
  const [sessions, setSessions] = useState<WorkoutSession[]>([])
  const [editS, setEditS] = useState<WorkoutSession | null>(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    const ss = await getSessions(uid, 300)
    setSessions(ss.filter(s => (s.notes && s.notes.trim()) || s.mood))
    setLoading(false)
  }
  useEffect(() => { load() }, [uid])

  if (loading) return <Spinner />

  return (
    <div className="space-y-3">
      <p className="text-xs text-white/50 px-1">🔒 Privat. Jeder Eintrag gehört zu einem Training (Bewertung + Notiz). Notizen erfasst du beim Workout-Abschluss oder im Verlauf.</p>
      {!sessions.length && (
        <div className="card text-center text-white/50 py-8">
          <div className="text-4xl mb-2">📔</div>
          <p className="text-sm">Noch keine Trainings-Einträge. Bewerte dein nächstes Workout am Ende.</p>
        </div>
      )}
      {sessions.map(s => (
        <button key={s.id} onClick={() => setEditS(s)} className="card w-full text-left active:scale-[0.99] flex gap-3 items-start">
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-primary truncate">🏋️ {s.day_title}</span>
              <span className="text-xs text-white/45 shrink-0">{fmtDate(s.completed_at ?? s.started_at)}</span>
            </div>
            {s.notes && <p className="text-sm text-white/80 whitespace-pre-wrap leading-relaxed mt-1">{s.notes}</p>}
            <p className="text-[10px] text-white/30 mt-1">tippen zum Bearbeiten</p>
          </div>
          {s.mood && <span className="text-2xl leading-none shrink-0">{moodEmoji(s.mood)}</span>}
        </button>
      ))}
      {editS && <TrainingEntryEditor session={editS} onClose={() => setEditS(null)} onSaved={() => { setEditS(null); load() }} />}
    </div>
  )
}

function TrainingEntryEditor({ session, onClose, onSaved }: { session: WorkoutSession; onClose: () => void; onSaved: () => void }) {
  const [notes, setNotes] = useState(session.notes ?? '')
  const [mood, setMood] = useState<number | null>(session.mood ?? null)
  return (
    <Modal open onClose={onClose} title="Trainings-Eintrag">
      <div className="space-y-3">
        <p className="text-xs text-white/45">🏋️ {session.day_title} · {fmtDate(session.completed_at ?? session.started_at)}</p>
        <div><label className="label">Bewertung</label><MoodPicker value={mood} onChange={setMood} /></div>
        <div><label className="label">Notiz / Kommentar</label>
          <textarea className="input min-h-[80px]" value={notes} onChange={e => setNotes(e.target.value)} /></div>
        <button className="btn-primary w-full" onClick={async () => { await updateSession(session.id, { notes: notes.trim() || null, mood }); onSaved() }}>Speichern</button>
        <p className="text-[11px] text-white/35 text-center">Dieser Eintrag gehört zum Training – Änderungen erscheinen auch im Verlauf.</p>
      </div>
    </Modal>
  )
}

function SettingsTab({ uid, settings, onChange, weekTarget, onWeek, displayName, onName }: {
  uid: string; settings: Settings; onChange: (s: Settings) => void
  weekTarget: number; onWeek: (n: number) => void
  displayName: string; onName: (n: string) => void
}) {
  const [name, setName] = useState(displayName)
  const save = async (patch: Partial<Settings>) => { const s = { ...settings, ...patch }; onChange(s); await updateSettings(uid, patch) }
  return (
    <div className="space-y-3">
      <div className="card space-y-3">
        <div>
          <label className="label">Anzeigename</label>
          <div className="flex gap-2">
            <input className="input" value={name} onChange={e => setName(e.target.value)} />
            <button className="btn-primary" onClick={() => onName(name)}>OK</button>
          </div>
        </div>
        <div>
          <label className="label">Standard-Pausenzeit: {settings.default_rest_seconds}s</label>
          <input type="range" min={30} max={240} step={5} className="w-full accent-primary"
            value={settings.default_rest_seconds} onChange={e => save({ default_rest_seconds: +e.target.value })} />
        </div>
        <div>
          <label className="label">Wochenziel: {weekTarget} Workouts</label>
          <input type="range" min={1} max={7} step={1} className="w-full accent-success"
            value={weekTarget} onChange={e => onWeek(+e.target.value)} />
        </div>
      </div>
      <div className="card space-y-1">
        <Toggle label="🔊 Ton (Timer & Sätze)" on={settings.sound_enabled} set={v => save({ sound_enabled: v })} />
        <Toggle label="📳 Vibration" on={settings.vibration_enabled} set={v => save({ vibration_enabled: v })} />
        <Toggle label="🔔 Benachrichtigung (Timer-Ende)" on={settings.notifications_enabled} set={async v => {
          if (v) { const ok = await ensureNotifyPermission(); if (!ok) { alert('Bitte Benachrichtigungen im Browser/iOS erlauben. Auf dem iPhone muss die App über „Zum Home-Bildschirm" installiert sein.'); return } }
          save({ notifications_enabled: v })
        }} />
      </div>
      <div>
        <label className="label px-1">Einheit</label>
        <div className="flex gap-2">
          {['kg', 'lbs'].map(u => (
            <button key={u} onClick={() => save({ units: u })}
              className={cls('btn flex-1', settings.units === u ? 'btn-primary' : 'btn-ghost')}>{u}</button>
          ))}
        </div>
      </div>
    </div>
  )
}

function Toggle({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between py-2 cursor-pointer">
      <span className="text-sm">{label}</span>
      <button onClick={() => set(!on)} className={cls('w-12 h-7 rounded-full transition relative', on ? 'bg-primary' : 'bg-white/15')}>
        <span className={cls('absolute top-1 w-5 h-5 rounded-full bg-white transition-all', on ? 'left-6' : 'left-1')} />
      </button>
    </label>
  )
}
