import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './store/query-client'
import { SettingsProvider } from './store/settings-context'
import { AppShell } from './components/layout/AppShell'
import { lazy, Suspense } from 'react'

const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const ComparisonPage = lazy(() => import('./pages/ComparisonPage'))
const SignalsPage = lazy(() => import('./pages/SignalsPage'))
const SimulatorPage = lazy(() => import('./pages/SimulatorPage'))

function Loading() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-2 border-gold-400 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<AppShell />}>
              <Route
                index
                element={
                  <Suspense fallback={<Loading />}>
                    <DashboardPage />
                  </Suspense>
                }
              />
              <Route
                path="comparison"
                element={
                  <Suspense fallback={<Loading />}>
                    <ComparisonPage />
                  </Suspense>
                }
              />
              <Route
                path="signals"
                element={
                  <Suspense fallback={<Loading />}>
                    <SignalsPage />
                  </Suspense>
                }
              />
              <Route
                path="signals/:symbol"
                element={
                  <Suspense fallback={<Loading />}>
                    <SignalsPage />
                  </Suspense>
                }
              />
              <Route
                path="simulator"
                element={
                  <Suspense fallback={<Loading />}>
                    <SimulatorPage />
                  </Suspense>
                }
              />
            </Route>
          </Routes>
        </BrowserRouter>
      </SettingsProvider>
    </QueryClientProvider>
  )
}
