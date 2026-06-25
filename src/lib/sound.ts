// Tiny WebAudio beep – no asset files needed.
let ctx: AudioContext | null = null

function ac() {
  if (!ctx) {
    const C = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    ctx = new C()
  }
  return ctx
}

export function beep(freq = 880, duration = 0.15, type: OscillatorType = 'sine', gain = 0.2) {
  try {
    const c = ac()
    const osc = c.createOscillator()
    const g = c.createGain()
    osc.type = type
    osc.frequency.value = freq
    g.gain.value = gain
    osc.connect(g)
    g.connect(c.destination)
    osc.start()
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + duration)
    osc.stop(c.currentTime + duration)
  } catch { /* ignore */ }
}

export function timerDoneSound() {
  beep(660, 0.18, 'sine')
  setTimeout(() => beep(880, 0.18, 'sine'), 180)
  setTimeout(() => beep(1100, 0.3, 'sine'), 380)
}

export function successSound() {
  beep(523, 0.12)
  setTimeout(() => beep(659, 0.12), 120)
  setTimeout(() => beep(784, 0.2), 260)
}
