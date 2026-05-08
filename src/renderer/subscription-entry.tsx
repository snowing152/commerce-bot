import React, { useState, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import './styles.css'
import { SubscriptionPage, SubscriptionInfo } from './pages'
import { ErrorBoundary } from './ErrorBoundary'

function SubscriptionApp() {
  const [planStatus, setPlanStatus] = useState<'active' | 'expired' | string>('active')
  const [subInfo, setSubInfo] = useState<SubscriptionInfo | undefined>(undefined)
  const [loading, setLoading] = useState(true)

  const fetchStatus = async () => {
    try {
      const data = await window.api.getSubscriptionStatus()
      setPlanStatus(data.status === 'trial' ? 'active' : data.status)

      const expires = data.periodEnd
        ? new Date(data.periodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : '—'
      const daysLeft = data.daysLeft ?? 0

      setSubInfo({
        plan: 'Pro',
        price: data.price ?? '₩29,000 / mo',
        expires,
        daysLeft,
      })
    } catch { /* keep defaults */ }
    setLoading(false)
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
