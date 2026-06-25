import { ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { cls } from '../lib/utils'

const NAV = [
  { to: '/', label: 'Start', icon: '🏠' },
  { to: '/plan', label: 'Plan', icon: '📋' },
  { to: '/workout', label: 'Training', icon: '🔥' },
  { to: '/stats', label: 'Statistik', icon: '📈' },
  { to: '/profile', label: 'Profil', icon: '👤' }
]

export default function Layout({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const loc = useLocation()
  // Workout-Modus läuft fokussiert ohne Navigation drumherum
  const fullscreen = loc.pathname.startsWith('/workout/run')

  if (fullscreen) return <>{children}</>

  return (
    <div className="min-h-full flex md:justify-center">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-60 shrink-0 border-r border-white/5 p-4 gap-2 sticky top-0 h-screen">
        <div className="flex items-center gap-2 px-2 py-3 mb-2">
          <span className="text-2xl">🏋️</span>
          <span className="font-extrabold text-lg">Trainingsplan</span>
        </div>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'}
            className={({ isActive }) => cls(
              'flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium transition',
              isActive ? 'bg-primary/15 text-primary' : 'text-white/60 hover:bg-white/5'
            )}>
            <span className="text-xl">{n.icon}</span> {n.label}
          </NavLink>
        ))}
        <div className="mt-auto px-3 py-2 text-sm text-white/40">
          {profile?.avatar_emoji} {profile?.display_name}
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 max-w-2xl w-full pb-24 md:pb-8">
        <main className="px-4 pt-safe md:pt-6">{children}</main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-surface/95 backdrop-blur border-t border-white/10 pb-safe">
        <div className="flex">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'}
              className={({ isActive }) => cls(
                'flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition',
                isActive ? 'text-primary' : 'text-white/45'
              )}>
              <span className="text-xl leading-none">{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
