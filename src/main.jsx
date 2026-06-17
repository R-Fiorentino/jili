import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'

const BUILD_ID = typeof __APP_BUILD_ID__ === 'string' ? __APP_BUILD_ID__ : 'unknown'

if (import.meta.env.PROD) {
  window.__APP_BUILD_ID__ = BUILD_ID
  console.info('[J-ili] build id:', BUILD_ID)
}

async function checkForNewBuild() {
  if (!import.meta.env.PROD) return

  try {
    const response = await fetch(`/version.json?ts=${Date.now()}`, {
      cache: 'no-store',
    })
    if (!response.ok) return

    const payload = await response.json()
    const remoteBuildId =
      typeof payload?.buildId === 'string' ? payload.buildId : null

    if (remoteBuildId && remoteBuildId !== BUILD_ID) {
      window.location.reload()
    }
  } catch {
    // ignore transient version checks
  }
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    let refreshing = false

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return
      refreshing = true
      window.location.reload()
    })

    navigator.serviceWorker
      .register(`/sw.js?build=${encodeURIComponent(BUILD_ID)}`)
      .then((registration) => {
        if (registration.waiting) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' })
        }

        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing
          if (!newWorker) return

          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              newWorker.postMessage({ type: 'SKIP_WAITING' })
            }
          })
        })

        registration.update().catch(() => {})
      })
      .catch((error) => {
        console.error('Service worker registration failed:', error)
      })

    checkForNewBuild()
    window.addEventListener('focus', checkForNewBuild)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        checkForNewBuild()
      }
    })
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
