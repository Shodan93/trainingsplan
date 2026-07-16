import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { Profile } from './types'

type AuthCtx = {
  session: Session | null
  profile: Profile | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signUp: (email: string, password: string, name: string) => Promise<{ error: string | null; needsConfirm: boolean }>
  resetPassword: (email: string) => Promise<{ error: string | null }>
  updatePassword: (password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  // WICHTIG: Im onAuthStateChange-Callback NIEMALS Supabase-Queries awaiten –
  // der Client hält dabei einen internen Lock und die Query wartet ewig
  // darauf (Deadlock; genau das war der "Initial-Load hängt"-Bug).
  useEffect(() => {
    let mounted = true
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      setLoading(false)
    })
    return () => { mounted = false; sub.subscription.unsubscribe() }
  }, [])

  // Profil separat vom Auth-Callback laden. Kleiner Retry, weil der
  // handle_new_user-Trigger direkt nach der Registrierung noch schreiben kann.
  const uid = session?.user?.id ?? null
  useEffect(() => {
    if (!uid) { setProfile(null); return }
    let cancelled = false
    const load = async (attempt = 0) => {
      const { data } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle()
      if (cancelled) return
      if (data) setProfile(data as Profile)
      else if (attempt < 4) setTimeout(() => load(attempt + 1), 700)
    }
    load()
    return () => { cancelled = true }
  }, [uid])

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    return { error: error ? error.message : null }
  }

  const signUp = async (email: string, password: string, name: string) => {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(), password,
      options: { data: { display_name: name.trim() || email.trim().split('@')[0] } }
    })
    if (error) return { error: error.message, needsConfirm: false }
    // Ohne Session heißt: E-Mail-Bestätigung ist aktiv
    return { error: null, needsConfirm: !data.session }
  }

  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${location.origin}/reset`
    })
    return { error: error ? error.message : null }
  }

  const updatePassword = async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password })
    return { error: error ? error.message : null }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    setProfile(null)
  }

  const refreshProfile = async () => {
    if (!uid) return
    const { data } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle()
    if (data) setProfile(data as Profile)
  }

  return (
    <Ctx.Provider value={{ session, profile, loading, signIn, signUp, resetPassword, updatePassword, signOut, refreshProfile }}>
      {children}
    </Ctx.Provider>
  )
}

export const useAuth = () => useContext(Ctx)
