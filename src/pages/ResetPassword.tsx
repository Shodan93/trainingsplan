import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'

// Ziel des Passwort-Reset-Links (…/reset). Der Link aus der E-Mail meldet den
// Nutzer über ein Recovery-Token automatisch an, hier wird nur neu gesetzt.
export default function ResetPassword() {
  const { session, updatePassword, loading } = useAuth()
  const nav = useNavigate()
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (pw.length < 8) { setErr('Mindestens 8 Zeichen.'); return }
    if (pw !== pw2) { setErr('Die Passwörter stimmen nicht überein.'); return }
    setBusy(true); setErr(null)
    const { error } = await updatePassword(pw)
    if (error) setErr(`Fehler: ${error}`)
    else { setDone(true); setTimeout(() => nav('/', { replace: true }), 1500) }
    setBusy(false)
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 bg-gradient-to-b from-bg to-[#0e1530]">
      <div className="w-full max-w-sm animate-slideup">
        <h1 className="text-2xl font-extrabold tracking-tight text-center mb-6">Neues Passwort setzen</h1>
        {loading ? null : !session ? (
          <div className="card text-sm text-white/70 space-y-3">
            <p>Dieser Link ist abgelaufen oder ungültig.</p>
            <button className="btn-primary w-full" onClick={() => nav('/login')}>Zur Anmeldung</button>
          </div>
        ) : done ? (
          <div className="card text-sm text-green-300 bg-success/10">✓ Passwort geändert – du wirst weitergeleitet…</div>
        ) : (
          <form onSubmit={submit} className="card space-y-4">
            <div>
              <label className="label">Neues Passwort</label>
              <input className="input" type="password" autoComplete="new-password" value={pw}
                onChange={e => setPw(e.target.value)} placeholder="mind. 8 Zeichen" required autoFocus />
            </div>
            <div>
              <label className="label">Wiederholen</label>
              <input className="input" type="password" autoComplete="new-password" value={pw2}
                onChange={e => setPw2(e.target.value)} required />
            </div>
            {err && <p className="text-danger text-sm">{err}</p>}
            <button className="btn-primary w-full" disabled={busy}>{busy ? 'Speichern…' : 'Passwort speichern'}</button>
          </form>
        )}
      </div>
    </div>
  )
}
