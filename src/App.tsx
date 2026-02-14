import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './store/query-client'
import { SettingsProvider } from './store/settings-context'
import { AppShell } from './components/layout/AppShell'
import { ErrorBoundary } from './components/shared/ErrorBoundary'
import { lazy, Suspense } from 'react'

const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const ComparisonPage = lazy(() => import('./pages/ComparisonPage'))
const SignalsPage = lazy(() => import('./pages/SignalsPage'))
const SimulatorPage = lazy(() => import('./pages/SimulatorPage'))
const LiquidityPage = lazy(() => import('./pages/LiquidityPage'))

function Loading() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-2 border-gold-400 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function PageWrapper({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<Loading />}>
        {children}
      </Suspense>
    </ErrorBoundary>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<PageWrapper><DashboardPage /></PageWrapper>} />
              <Route path="comparison" element={<PageWrapper><ComparisonPage /></PageWrapper>} />
              <Route path="signals" element={<PageWrapper><SignalsPage /></PageWrapper>} />
              <Route path="signals/:symbol" element={<PageWrapper><SignalsPage /></PageWrapper>} />
              <Route path="simulator" element={<PageWrapper><SimulatorPage /></PageWrapper>} />
              <Route path="liquidity" element={<PageWrapper><LiquidityPage /></PageWrapper>} />
              <Route
                path="*"
                element={
                  <div className="flex flex-col items-center justify-center h-64 space-y-4">
                    <p className="text-2xl font-bold text-white">404</p>
                    <p className="text-gray-400">Page not found</p>
                  </div>
                }
              />
            </Route>
          </Routes>
        </BrowserRouter>
      </SettingsProvider>
    </QueryClientProvider>
  )
}
