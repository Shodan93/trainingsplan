import { ReactNode, useEffect } from 'react'
import { cls } from '../lib/utils'

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-white/50">
      <div className="w-8 h-8 border-2 border-white/20 border-t-primary rounded-full animate-spin" />
      {label && <span className="text-sm">{label}</span>}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cls('animate-pulse rounded-xl bg-white/5', className)} />
}

// Schlichter, inhaltsförmiger Ladezustand (statt Vollbild-Spinner)
export function PageSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-4 py-2" aria-busy="true">
      <Skeleton className="h-7 w-40 mt-2" />
      {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
    </div>
  )
}

export function Chip({ children, color, className }: { children: ReactNode; color?: string; className?: string }) {
  return (
    <span
      className={cls('chip', className)}
      style={color ? { backgroundColor: `${color}22`, color } : { backgroundColor: 'rgba(255,255,255,.08)', color: '#cdd6e6' }}
    >
      {children}
    </span>
  )
}

export function ProgressBar({ pct, color = '#0ea5e9', className }: { pct: number; color?: string; className?: string }) {
  return (
    <div className={cls('w-full h-2.5 rounded-full bg-white/10 overflow-hidden', className)}>
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(100, Math.max(0, pct))}%`, backgroundColor: color }} />
    </div>
  )
}

export function Stat({ icon, value, label, color }: { icon: string; value: ReactNode; label: string; color?: string }) {
  return (
    <div className="card flex-1 min-w-0 flex flex-col items-center gap-1 py-3">
      <span className="text-2xl" style={color ? { color } : undefined}>{icon}</span>
      <span className="text-xl font-extrabold leading-none">{value}</span>
      <span className="text-[11px] text-white/50 text-center leading-tight">{label}</span>
    </div>
  )
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (open) {
      const prev = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = prev }
    }
  }, [open])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-surface w-full sm:max-w-md sm:rounded-2xl rounded-t-3xl border-t sm:border border-white/10 p-5 max-h-[90vh] overflow-y-auto animate-slideup pb-safe"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">{title}</h3>
          <button className="btn-ghost !px-2 !py-1 text-white/60" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function EmptyState({ icon, title, hint }: { icon: string; title: string; hint?: string }) {
  return (
    <div className="text-center py-12 text-white/50">
      <div className="text-5xl mb-3">{icon}</div>
      <p className="font-semibold text-white/70">{title}</p>
      {hint && <p className="text-sm mt-1">{hint}</p>}
    </div>
  )
}
