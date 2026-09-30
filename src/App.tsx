import { RouterProvider } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './store/query-client'
import { SettingsProvider } from './store/settings-context'
import { ThemeProvider } from './app/theme'
import { router } from './app/router'

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <SettingsProvider>
          <RouterProvider router={router} />
        </SettingsProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
