// Schlichte Stroke-Icons (24px Grid), einfarbig über currentColor
type P = { className?: string }
const base = 'w-[22px] h-[22px]'

export function IconHome({ className }: P) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className ?? base}>
      <path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M9.5 21v-6h5v6" />
    </svg>
  )
}
export function IconPlan({ className }: P) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className ?? base}>
      <rect x="4" y="3.5" width="16" height="17" rx="2.5" /><path d="M8 8h8M8 12h8M8 16h5" />
    </svg>
  )
}
export function IconTrain({ className }: P) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className ?? base}>
      <path d="M7.5 9v6M4.5 10v4M19.5 10v4M16.5 9v6M7.5 12h9" />
    </svg>
  )
}
export function IconHistory({ className }: P) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className ?? base}>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v18H6.5A2.5 2.5 0 0 1 4 18.5v-13Z" /><path d="M8 3v18" />
    </svg>
  )
}
export function IconStats({ className }: P) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className ?? base}>
      <path d="M4 20h16" /><path d="M7 20v-7M12 20V6M17 20v-10" />
    </svg>
  )
}
export function IconUser({ className }: P) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className ?? base}>
      <circle cx="12" cy="8" r="3.5" /><path d="M5 20c1.2-3.2 3.8-4.8 7-4.8s5.8 1.6 7 4.8" />
    </svg>
  )
}
export function IconScale({ className }: P) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className ?? base}>
      <rect x="4" y="4" width="16" height="16" rx="4" /><path d="M8.5 9.5a5 5 0 0 1 7 0" /><path d="M12 12l2-2.5" />
    </svg>
  )
}
export function IconFood({ className }: P) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className ?? base}>
      <path d="M12 8c0-2.5 1.5-4 3.5-4" />
      <path d="M12 7.5c-1.2-1.6-3.4-2-5-.8C4.6 8.4 4 11.6 5.6 14.9c1.4 3 3.4 5.1 5 5.1.6 0 1-.3 1.4-.3s.8.3 1.4.3c1.6 0 3.6-2.1 5-5.1 1.6-3.3 1-6.5-1.4-8.2-1.6-1.2-3.8-.8-5 .8Z" />
    </svg>
  )
}
export function IconFlame({ className }: P) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className ?? base}>
      <path d="M12 3c1 3-3 4.5-3 8a3 3 0 0 0 6 0c0-1.2-.5-2-1-3 2.5 1 4 3.4 4 6a6 6 0 0 1-12 0c0-4.5 4-6.5 6-11Z" />
    </svg>
  )
}
