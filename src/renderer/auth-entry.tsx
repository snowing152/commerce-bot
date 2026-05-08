import React, { useState, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import './styles.css'
import { AuthPage } from './pages'
import { ErrorBoundary } from './ErrorBoundary'

function AuthApp() {
  const [status, setStatus] = useState<'idle' | 'waiting' | 'confirmed' | 'error'>('idle')
  const [token, setToken] = useState('')

  const handleLoginClick = async () => {
    setStatus('waiting')
    try {
      const tok = await window.api.startTelegramAuth()
      setToken(tok)
    } catch {
      setStatus('error')
    }
  }

  // Poll while waiting; clear interval on success AND on unmount
  useEffect(() => {
    if (status !== 'waiting' || !token) return
    const id = setInterval(async () => {
      try {
        const result = await window.api.checkAuthToken(token)
        if (result.success) {
          clearInterval(id)
          setStatus('confirmed')
          window.api.navigateTo('main')
        }
      } catch { /* retry next tick */ }
    }, 3000)
    return () => clearInterval(id)
  }, [status, token])

  return (
    <AuthPage
      status={status}
      onStatusChange={setStatus}
      onAuthenticated={() => window.api.navigateTo('main')}
      onLoginClick={handleLoginClick}
    />
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ErrorBoundary><AuthApp /></ErrorBoundary>
)
