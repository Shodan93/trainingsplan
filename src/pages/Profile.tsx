import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import {
  getSettings, updateSettings, getStats, getBadges, getUserBadges,
  getGoals, upsertGoal, deleteGoal, getMeasurements, addMeasurement, deleteMeasurement,
  getDiary, addDiary, deleteDiary, getWeeklyTarget, setWeeklyTargetCount, ensureWeeklyTarget
} from '../lib/db'
import {
  Settings, UserStats, Badge, UserBadge, Goal, BodyMeasurement, DiaryEntry
} from '../lib/types'
import { Spinner, Modal, ProgressBar } from '../components/ui'
import { fmtDate, levelProgress, isoWeekStart, cls, todayISO } from '../lib/utils'
import { ensureNotifyPermission } from '../lib/notify'

const AVATARS = ['💪', '🏋️', '🔥', '🦾', '🏃', '🧗', '⚡', '🦁', '🐺', '🌟']
const TABS = ['Übersicht', 'Ziele', 'Maße', 'Tagebuch', 'Einstellungen'] as const
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

  if (loading || !profile) return <Spinner label="Lade Profil…" />
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
      {tab === 'Maße' && <MeasureTab uid={profile.id} />}
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

function MeasureTab({ uid }: { uid: string }) {
  const [items, setItems] = useState<BodyMeasurement[]>([])
  const [open, setOpen] = useState(false)
  const [f, setF] = useState<Partial<BodyMeasurement>>({ metric: 'Körpergewicht', unit: 'kg', measured_at: todayISO() })
  const load = () => getMeasurements(uid).then(setItems)
  useEffect(() => { load() }, [uid])
  return (
    <div className="space-y-2">
      {items.map(m => (
        <div key={m.id} className="card flex items-center justify-between !py-3">
          <div>
            <p className="font-semibold">{m.metric}: <span className="text-accent">{m.value} {m.unit}</span></p>
            <p className="text-xs text-white/45">{fmtDate(m.measured_at)}{m.note ? ` · ${m.note}` : ''}</p>
          </div>
          <button className="btn-ghost !px-2 !py-1 text-sm text-white/40" onClick={async () => { await deleteMeasurement(m.id); load() }}>🗑️</button>
        </div>
      ))}
      <button className="btn-ghost w-full" onClick={() => { setF({ metric: 'Körpergewicht', unit: 'kg', measured_at: todayISO() }); setOpen(true) }}>+ Messung hinzufügen</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Neue Messung">
        <div className="space-y-3">
          <div><label className="label">Was</label>
            <input className="input" list="metrics" value={f.metric ?? ''} onChange={e => setF({ ...f, metric: e.target.value })} />
            <datalist id="metrics">
              {['Körpergewicht', 'Bizeps', 'Oberarm', 'Unterarm', 'Wade', 'Brust', 'Hüfte', 'Schulter', 'Oberschenkel'].map(x => <option key={x} value={x} />)}
            </datalist>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div><label className="label">Wert</label><input className="input" type="number" step="0.1" onChange={e => setF({ ...f, value: +e.target.value })} /></div>
            <div><label className="label">Einheit</label><select className="input" value={f.unit} onChange={e => setF({ ...f, unit: e.target.value })}><option>cm</option><option>kg</option><option>%</option></select></div>
            <div><label className="label">Datum</label><input className="input" type="date" value={f.measured_at} onChange={e => setF({ ...f, measured_at: e.target.value })} /></div>
          </div>
          <div><label className="label">Notiz</label><input className="input" onChange={e => setF({ ...f, note: e.target.value })} /></div>
          <button className="btn-primary w-full" onClick={async () => { if (f.value != null) { await addMeasurement({ ...f, user_id: uid }); setOpen(false); load() } }}>Speichern</button>
        </div>
      </Modal>
    </div>
  )
}

function DiaryTab({ uid }: { uid: string }) {
  const [items, setItems] = useState<DiaryEntry[]>([])
  const [text, setText] = useState('')
  const load = () => getDiary(uid).then(setItems)
  useEffect(() => { load() }, [uid])
  return (
    <div className="space-y-3">
      <div className="card">
        <p className="text-xs text-white/50 mb-2">🔒 Privat – nur du siehst dein Tagebuch.</p>
        <textarea className="input min-h-[80px]" value={text} onChange={e => setText(e.target.value)} placeholder="Wie war dein Training? Gedanken, Fortschritte…" />
        <button className="btn-primary w-full mt-2" disabled={!text.trim()}
          onClick={async () => { await addDiary({ user_id: uid, content: text.trim(), entry_date: todayISO() }); setText(''); load() }}>Eintrag speichern</button>
      </div>
      {items.map(e => (
        <div key={e.id} className="card">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-white/45">{fmtDate(e.entry_date)}</span>
            <button className="text-white/30 text-sm" onClick={async () => { await deleteDiary(e.id); load() }}>🗑️</button>
          </div>
          <p className="text-sm text-white/80 whitespace-pre-wrap leading-relaxed">{e.content}</p>
        </div>
      ))}
    </div>
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
