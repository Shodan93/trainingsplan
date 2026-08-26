import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from './lib/auth'
import { getSettings } from './lib/db'
import { Spinner, PageSkeleton } from './components/ui'
import Layout from './components/Layout'
import Onboarding from './components/Onboarding'
import Login from './pages/Login'
import ResetPassword from './pages/ResetPassword'
import Dashboard from './pages/Dashboard'
import WorkoutPicker from './pages/Workout'
import WorkoutRun from './pages/WorkoutRun'
import History from './pages/History'
import Profile from './pages/Profile'
import { ReactNode, lazy, Suspense } from 'react'

const Stats = lazy(() => import('./pages/Stats'))
const Cardio = lazy(() => import('./pages/Cardio'))
const LiveHr = lazy(() => import('./pages/LiveHr'))
const PlanPage = lazy(() => import('./pages/Plan'))
const Weight = lazy(() => import('./pages/Weight'))
const Calories = lazy(() => import('./pages/Calories'))

// Neue Nutzer: erst persönliche Daten abfragen (Basis für Kalorien/BMI),
// dann in die App lassen
function OnboardingGate({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const { data: settings, isLoading } = useQuery({
    queryKey: ['onboarding-settings', profile?.id],
    enabled: !!profile,
    queryFn: () => getSettings(profile!.id)
  })
  if (!profile || isLoading) {
    return <div className="min-h-screen grid place-items-center"><Spinner label="Lade…" /></div>
  }
  const needsOnboarding = !settings || settings.birth_year == null || settings.height_cm == null || settings.sex == null
  if (needsOnboarding) return <Onboarding settings={settings ?? null} />
  return <Layout>{children}</Layout>
}

function Protected({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  const loc = useLocation()
  if (loading) return <div className="min-h-screen grid place-items-center"><Spinner label="Lade…" /></div>
  if (!session) return <Navigate to="/login" state={{ from: loc }} replace />
  return <OnboardingGate>{children}</OnboardingGate>
}

const lazyPage = (el: ReactNode) => <Suspense fallback={<PageSkeleton rows={4} />}>{el}</Suspense>

export default function App() {
  const { session, loading } = useAuth()
  return (
    <Routes>
      <Route path="/login" element={session && !loading ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/reset" element={<ResetPassword />} />
      <Route path="/" element={<Protected><Dashboard /></Protected>} />
      <Route path="/plan" element={<Protected>{lazyPage(<PlanPage />)}</Protected>} />
      <Route path="/workout" element={<Protected><WorkoutPicker /></Protected>} />
      <Route path="/workout/run/:sessionId" element={<Protected><WorkoutRun /></Protected>} />
      <Route path="/ausdauer" element={<Protected>{lazyPage(<Cardio />)}</Protected>} />
      <Route path="/ausdauer/live" element={<Protected>{lazyPage(<LiveHr />)}</Protected>} />
      <Route path="/verlauf" element={<Protected><History /></Protected>} />
      <Route path="/stats" element={<Protected>{lazyPage(<Stats />)}</Protected>} />
      <Route path="/gewicht" element={<Protected>{lazyPage(<Weight />)}</Protected>} />
      <Route path="/kalorien" element={<Protected>{lazyPage(<Calories />)}</Protected>} />
      <Route path="/profile" element={<Protected><Profile /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
