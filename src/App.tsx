import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './lib/auth'
import { Spinner } from './components/ui'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import PlanPage from './pages/Plan'
import WorkoutPicker from './pages/Workout'
import WorkoutRun from './pages/WorkoutRun'
import History from './pages/History'
import Profile from './pages/Profile'
import { ReactNode, lazy, Suspense } from 'react'

const Stats = lazy(() => import('./pages/Stats'))

function Protected({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  const loc = useLocation()
  if (loading) return <div className="min-h-screen grid place-items-center"><Spinner label="Lade…" /></div>
  if (!session) return <Navigate to="/login" state={{ from: loc }} replace />
  return <Layout>{children}</Layout>
}

export default function App() {
  const { session, loading } = useAuth()
  return (
    <Routes>
      <Route path="/login" element={session && !loading ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/" element={<Protected><Dashboard /></Protected>} />
      <Route path="/plan" element={<Protected><PlanPage /></Protected>} />
      <Route path="/workout" element={<Protected><WorkoutPicker /></Protected>} />
      <Route path="/workout/run/:sessionId" element={<Protected><WorkoutRun /></Protected>} />
      <Route path="/verlauf" element={<Protected><History /></Protected>} />
      <Route path="/stats" element={<Protected><Suspense fallback={<Spinner label="Lade Statistik…" />}><Stats /></Suspense></Protected>} />
      <Route path="/profile" element={<Protected><Profile /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
