import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './lib/auth'
import { Spinner, PageSkeleton } from './components/ui'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import WorkoutPicker from './pages/Workout'
import WorkoutRun from './pages/WorkoutRun'
import History from './pages/History'
import Profile from './pages/Profile'
import { ReactNode, lazy, Suspense } from 'react'

const Stats = lazy(() => import('./pages/Stats'))
const PlanPage = lazy(() => import('./pages/Plan'))
const Weight = lazy(() => import('./pages/Weight'))
const Calories = lazy(() => import('./pages/Calories'))

function Protected({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  const loc = useLocation()
  if (loading) return <div className="min-h-screen grid place-items-center"><Spinner label="Lade…" /></div>
  if (!session) return <Navigate to="/login" state={{ from: loc }} replace />
  return <Layout>{children}</Layout>
}

const lazyPage = (el: ReactNode) => <Suspense fallback={<PageSkeleton rows={4} />}>{el}</Suspense>

export default function App() {
  const { session, loading } = useAuth()
  return (
    <Routes>
      <Route path="/login" element={session && !loading ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/" element={<Protected><Dashboard /></Protected>} />
      <Route path="/plan" element={<Protected>{lazyPage(<PlanPage />)}</Protected>} />
      <Route path="/workout" element={<Protected><WorkoutPicker /></Protected>} />
      <Route path="/workout/run/:sessionId" element={<Protected><WorkoutRun /></Protected>} />
      <Route path="/verlauf" element={<Protected><History /></Protected>} />
      <Route path="/stats" element={<Protected>{lazyPage(<Stats />)}</Protected>} />
      <Route path="/gewicht" element={<Protected>{lazyPage(<Weight />)}</Protected>} />
      <Route path="/kalorien" element={<Protected>{lazyPage(<Calories />)}</Protected>} />
      <Route path="/profile" element={<Protected><Profile /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
