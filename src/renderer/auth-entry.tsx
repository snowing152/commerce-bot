import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import { AuthPage } from './pages';
import { ErrorBoundary } from './ErrorBoundary';
import { LanguageProvider } from './i18n';

function AuthApp() {
  const [status, setStatus] = useState<'idle' | 'waiting' | 'confirmed' | 'error'>('idle');
  const [token, setToken] = useState('');

  const handleLoginClick = async () => {
    setStatus('waiting');
    try {
      const tok = await window.api.startTelegramAuth();
      setToken(tok);
    } catch {
      setStatus('error');
    }
  };

  // Poll while waiting; stop on success, error, or token expiry (5 min = server TTL)
  useEffect(() => {
    if (status !== 'waiting' || !token) return;
    const startedAt = Date.now();
    const TOKEN_TTL_MS = 5 * 60_000;

    const id = setInterval(async () => {
      if (Date.now() - startedAt >= TOKEN_TTL_MS) {
        clearInterval(id);
        setStatus('error');
        return;
      }
      try {
        const result = await window.api.checkAuthToken(token);
        if (result.success) {
          clearInterval(id);
          setStatus('confirmed');
          window.api.navigateTo('main');
        }
      } catch {
        /* retry next tick */
      }
    }, 3000);
    return () => clearInterval(id);
  }, [status, token]);

  return (
    <AuthPage
      status={status}
      onStatusChange={setStatus}
      onAuthenticated={() => window.api.navigateTo('main')}
      onLoginClick={handleLoginClick}
    />
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <LanguageProvider>
      <AuthApp />
    </LanguageProvider>
  </ErrorBoundary>,
);
