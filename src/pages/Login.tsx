import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { cls } from '../lib/utils'

type Mode = 'login' | 'register' | 'forgot'

export default function Login() {
  const { signIn, signUp, resetPassword } = useAuth()
  const [mode, setMode] = useState<Mode>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setErr(null); setInfo(null)
    if (mode === 'login') {
      const { error } = await signIn(email, password)
      if (error) setErr('Login fehlgeschlagen. E-Mail oder Passwort prüfen.')
    } else if (mode === 'register') {
      if (password.length < 8) { setErr('Passwort bitte mit mindestens 8 Zeichen.'); setBusy(false); return }
      const { error, needsConfirm } = await signUp(email, password, name)
      if (error) setErr(error.includes('already registered') ? 'Diese E-Mail ist bereits registriert.' : `Registrierung fehlgeschlagen: ${error}`)
      else if (needsConfirm) setInfo('Fast geschafft! Wir haben dir eine Bestätigungs-Mail geschickt – bitte den Link darin öffnen, dann kannst du dich anmelden.')
      // ohne Bestätigungspflicht ist man direkt eingeloggt (Redirect passiert automatisch)
    } else {
      const { error } = await resetPassword(email)
      if (error) setErr('Das hat nicht geklappt – E-Mail-Adresse prüfen.')
      else setInfo('E-Mail verschickt! Öffne den Link darin, um ein neues Passwort zu setzen.')
    }
    setBusy(false)
  }

  const switchTo = (m: Mode) => { setMode(m); setErr(null); setInfo(null) }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 bg-gradient-to-b from-bg to-[#0e1530]">
      <div className="w-full max-w-sm animate-slideup">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-extrabold tracking-tight">Fitness</h1>
          <p className="text-white/50 mt-1">Training · Gewicht · Kalorien</p>
        </div>

        <div className="flex gap-1 mb-3">
          {([['login', 'Anmelden'], ['register', 'Registrieren']] as [Mode, string][]).map(([m, l]) => (
            <button key={m} onClick={() => switchTo(m)}
              className={cls('btn flex-1 !py-2 text-sm', mode === m ? 'btn-primary' : 'btn-ghost')}>{l}</button>
          ))}
        </div>

        <form onSubmit={submit} className="card space-y-4">
          {mode === 'register' && (
            <div>
              <label className="label">Dein Name</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Max" required />
            </div>
          )}
          <div>
            <label className="label">E-Mail</label>
            <input className="input" type="email" autoComplete="username"
              value={email} onChange={(e) => setEmail(e.target.value)} placeholder="du@beispiel.de" required />
          </div>
          {mode !== 'forgot' && (
            <div>
              <label className="label">Passwort</label>
              <input className="input" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required />
            </div>
          )}
          {err && <p className="text-danger text-sm">{err}</p>}
          {info && <p className="text-sm text-green-300 bg-success/10 rounded-xl p-3">{info}</p>}
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? 'Moment…' : mode === 'login' ? 'Anmelden' : mode === 'register' ? 'Konto erstellen' : 'Reset-Link senden'}
          </button>
          {mode === 'login' && (
            <button type="button" className="w-full text-xs text-white/45 underline underline-offset-2"
              onClick={() => switchTo('forgot')}>Passwort vergessen?</button>
          )}
          {mode === 'forgot' && (
            <button type="button" className="w-full text-xs text-white/45 underline underline-offset-2"
              onClick={() => switchTo('login')}>Zurück zur Anmeldung</button>
          )}
        </form>

        <p className="text-center text-xs text-white/30 mt-6">
          PWA – über „Zum Startbildschirm hinzufügen" installieren
        </p>
      </div>
    </div>
  )
}
