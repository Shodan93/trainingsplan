import { ReactNode } from 'react'
import { NavLink, Link, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { cls } from '../lib/utils'
import { IconTrain, IconScale, IconFood, IconUser } from './icons'

// 4 Daumen-Tabs: Gym · Gewicht · Kalorien · Profil
const GYM_PATHS = ['/', '/plan', '/workout', '/ausdauer', '/verlauf', '/stats']
const TABS = [
  { to: '/', label: 'Gym', Icon: IconTrain, isActive: (p: string) => GYM_PATHS.includes(p) || p.startsWith('/workout') },
  { to: '/gewicht', label: 'Gewicht', Icon: IconScale, isActive: (p: string) => p.startsWith('/gewicht') },
  { to: '/kalorien', label: 'Kalorien', Icon: IconFood, isActive: (p: string) => p.startsWith('/kalorien') },
  { to: '/profile', label: 'Profil', Icon: IconUser, isActive: (p: string) => p.startsWith('/profile') }
]

// Segmente innerhalb des Gym-Bereichs: Plan/Start = Kraft, Ausdauer = Cardio
const GYM_SEGMENTS = [
  { to: '/', label: 'Start' },
  { to: '/plan', label: 'Plan' },
  { to: '/ausdauer', label: 'Ausdauer' },
  { to: '/verlauf', label: 'Verlauf' },
  { to: '/stats', label: 'Statistik' }
]

// Daumen-Zone: fixe Leiste direkt über der Haupt-Navigation.
// Seiten legen hier ihre Segmente und Haupt-Aktionen ab.
export function BottomBar({ children }: { children: ReactNode }) {
  return (
    <div className="md:hidden fixed z-30 inset-x-0 px-3 pb-2"
      style={{ bottom: 'calc(4rem + env(safe-area-inset-bottom))' }}>
      <div className="max-w-2xl mx-auto space-y-2">{children}</div>
    </div>
  )
}

// Segment-Zeile im BottomBar-Stil (durchscheinender Hintergrund)
export function SegmentRow({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-1 bg-surface/95 backdrop-blur rounded-2xl border border-white/10 p-1">
      {children}
    </div>
  )
}

export default function Layout({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const loc = useLocation()
  // Workout-Modus & Live-Puls laufen fokussiert ohne Navigation drumherum
  const fullscreen = loc.pathname.startsWith('/workout/run') || loc.pathname === '/ausdauer/live'

  if (fullscreen) return <>{children}</>

  const showGymSegments = GYM_PATHS.includes(loc.pathname) && loc.pathname !== '/workout'

  return (
    <div className="min-h-full flex md:justify-center">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-60 shrink-0 border-r border-white/5 p-4 gap-1 sticky top-0 h-screen">
        <div className="px-3 py-3 mb-2">
          <span className="font-bold text-lg tracking-tight">Fitness</span>
        </div>
        {TABS.map(({ to, label, Icon, isActive }) => (
          <NavLink key={to} to={to}
            className={cls(
              'flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium transition',
              isActive(loc.pathname) ? 'bg-primary/15 text-primary' : 'text-white/55 hover:bg-white/5'
            )}>
            <Icon /> {label}
          </NavLink>
        ))}
        {GYM_PATHS.includes(loc.pathname) && (
          <div className="mt-2 ml-4 flex flex-col gap-0.5">
            {GYM_SEGMENTS.map(s => (
              <Link key={s.to} to={s.to}
                className={cls('px-3 py-1.5 rounded-lg text-sm', loc.pathname === s.to ? 'text-primary' : 'text-white/45 hover:text-white/70')}>
                {s.label}
              </Link>
            ))}
          </div>
        )}
        <div className="mt-auto px-3 py-2 text-sm text-white/40">{profile?.display_name}</div>
      </aside>

      {/* Main */}
      <div className="flex-1 max-w-2xl w-full pb-44 md:pb-8">
        <main className="px-4 pt-safe md:pt-6">{children}</main>
      </div>

      {/* Gym-Segmente: unten, direkt über der Haupt-Navigation */}
      {showGymSegments && (
        <BottomBar>
          <SegmentRow>
            {/* 5 Segmente: enger Padding, sonst ragt „Statistik" aus dem Bildschirm */}
            {GYM_SEGMENTS.map(s => (
              <Link key={s.to} to={s.to}
                className={cls('flex-1 min-w-0 !px-1 !py-2 text-xs whitespace-nowrap',
                  loc.pathname === s.to ? 'btn-primary' : 'btn-ghost')}>{s.label}</Link>
            ))}
          </SegmentRow>
        </BottomBar>
      )}

      {/* Mobile bottom nav – 4 Daumen-Tabs */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-surface/95 backdrop-blur border-t border-white/10 pb-safe">
        <div className="flex">
          {TABS.map(({ to, label, Icon, isActive }) => (
            <NavLink key={to} to={to}
              className={cls(
                'flex-1 flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition',
                isActive(loc.pathname) ? 'text-primary' : 'text-white/40'
              )}>
              <Icon />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
