import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/fraunces'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import './styles/index.css'
import App from './App'

// After an update, an open tab may ask for code chunks the new build no longer has
// ("Failed to fetch dynamically imported module"). Reload once to pick up the new build;
// the session flag stops a reload loop when the server itself is unreachable.
window.addEventListener('vite:preloadError', (event) => {
  try {
    if (sessionStorage.getItem('gid.chunkReload')) return
    sessionStorage.setItem('gid.chunkReload', '1')
  } catch {
    return
  }
  event.preventDefault()
  window.location.reload()
})
window.addEventListener('load', () => {
  try {
    setTimeout(() => sessionStorage.removeItem('gid.chunkReload'), 10_000)
  } catch {
    // storage unavailable
  }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
