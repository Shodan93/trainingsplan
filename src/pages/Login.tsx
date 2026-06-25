import { useState } from 'react'
import { useAuth } from '../lib/auth'

export default function Login() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setErr(null)
    const { error } = await signIn(email, password)
    if (error) setErr('Login fehlgeschlagen. E-Mail oder Passwort prüfen.')
    setBusy(false)
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 bg-gradient-to-b from-bg to-[#0e1530]">
      <div className="w-full max-w-sm animate-slideup">
        <div className="text-center mb-8">
          <div className="text-6xl mb-3">🏋️</div>
          <h1 className="text-3xl font-extrabold tracking-tight">Trainingsplan</h1>
          <p className="text-white/50 mt-1">David &amp; Svenja · stark werden, gemeinsam</p>
        </div>

        <form onSubmit={submit} className="card space-y-4">
          <div>
            <label className="label">E-Mail</label>
            <input className="input" type="email" autoComplete="username"
              value={email} onChange={(e) => setEmail(e.target.value)} placeholder="du@beispiel.de" required />
          </div>
          <div>
            <label className="label">Passwort</label>
            <input className="input" type="password" autoComplete="current-password"
              value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required />
          </div>
          {err && <p className="text-danger text-sm">{err}</p>}
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? 'Anmelden…' : 'Anmelden'}
          </button>
        </form>

        <p className="text-center text-xs text-white/30 mt-6">
          Nur für angemeldete Nutzer · PWA – „Zum Startbildschirm hinzufügen"
        </p>
      </div>
    </div>
  )
}
