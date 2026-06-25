// Dependency-free confetti burst using the Web Animations API.
const COLORS = ['#0ea5e9', '#f59e0b', '#22c55e', '#ec4899', '#a855f7', '#eab308']

export function confetti(count = 120) {
  const root = document.createElement('div')
  root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999;overflow:hidden'
  document.body.appendChild(root)

  const W = window.innerWidth
  const H = window.innerHeight
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div')
    const size = 6 + Math.random() * 8
    const color = COLORS[i % COLORS.length]
    const round = Math.random() > 0.5
    p.style.cssText = `position:absolute;width:${size}px;height:${size * (round ? 1 : 0.5)}px;` +
      `background:${color};border-radius:${round ? '50%' : '2px'};` +
      `left:${W / 2}px;top:${H * 0.35}px;will-change:transform,opacity`
    root.appendChild(p)

    const angle = (Math.PI * 2 * i) / count + Math.random()
    const velocity = 140 + Math.random() * 320
    const dx = Math.cos(angle) * velocity
    const dy = Math.sin(angle) * velocity - (120 + Math.random() * 120)
    const rot = (Math.random() - 0.5) * 1080
    const dur = 1100 + Math.random() * 900

    p.animate(
      [
        { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) rotate(${rot / 2}deg)`, opacity: 1, offset: 0.35 },
        { transform: `translate(${dx * 1.2}px, ${dy + H * 0.7}px) rotate(${rot}deg)`, opacity: 0 }
      ],
      { duration: dur, easing: 'cubic-bezier(.2,.6,.3,1)', fill: 'forwards' }
    )
  }
  setTimeout(() => root.remove(), 2200)
}
