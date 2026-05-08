import React, { useState, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import './styles.css'
import { SubscriptionPage, SubscriptionInfo } from './pages'
import { ErrorBoundary } from './ErrorBoundary'

function SubscriptionApp() {
  const [planStatus, setPlanStatus] = useState<'active' | 'expired' | string>('active')
  const [subInfo, setSubInfo] = useState<SubscriptionInfo | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const fetchStatus = async () => {
    setLoading(true)
    setFetchError(null)
    try {
      const data = await window.api.getSubscriptionStatus()
      setPlanStatus(data.status === 'trial' ? 'active' : data.status)
      const expires = data.periodEnd
        ? new Date(data.periodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : '—'
      setSubInfo({ plan: 'Pro', price: data.price ?? '₩10,000 / mo', expires, daysLeft: data.daysLeft ?? 0 })
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Could not load subscription data.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchStatus()
    const unsub = window.api.onSubscriptionUpdated(fetchStatus)
    return unsub
  }, [])

  if (loading) {
    return (
      <div className="h-full w-full grid place-items-center bg-zinc-950">
        <div className="flex items-center gap-2 text-zinc-500 text-[13px]">
          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.18" strokeWidth="2.5" />
            <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
          Loading subscription…
        </div>
      </div>
    )
  }

  if (fetchError) {
    return (
      <div className="h-full w-full grid place-items-center bg-zinc-950 p-8">
        <div className="w-full max-w-[380px] flex flex-col items-center text-center gap-4">
          <div className="w-10 h-10 rounded-full bg-red-500/10 border border-red-500/20 grid place-items-center">
            <svg className="w-5 h-5 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="9" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <div>
            <p className="text-[14px] font-semibold text-zinc-100 mb-1">Could not load subscription</p>
            <p className="text-[12px] text-zinc-500 leading-relaxed max-w-[300px]">{fetchError}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={fetchStatus}
              className="h-9 px-4 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[13px] font-medium transition-colors"
            >
              Retry
            </button>
            <button
              onClick={() => window.api.navigateTo('main')}
              className="h-9 px-4 rounded-md text-zinc-500 hover:text-zinc-300 text-[13px] transition-colors"
            >
              Back to dashboard
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <SubscriptionPage
      planStatus={planStatus}
      onBack={() => window.api.navigateTo('main')}
      onRenew={() => window.api.openPaymentBot()}
      subscriptionInfo={subInfo}
    />
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ErrorBoundary><SubscriptionApp /></ErrorBoundary>
)
