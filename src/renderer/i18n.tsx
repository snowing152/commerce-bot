import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Language, LANGUAGES, translate } from './translations';

const STORAGE_KEY = 'coupang-bot.lang';

function detectInitialLanguage(): Language {
  if (typeof window === 'undefined') return 'en';
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'ru') return saved;
  } catch {
    /* localStorage unavailable */
  }
  const nav = (typeof navigator !== 'undefined' && navigator.language) || '';
  return nav.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

interface LanguageContextValue {
  lang: Language;
  setLang: (lang: Language) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Language>(() => detectInitialLanguage());

  const setLang = useCallback((next: Language) => {
    setLangState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const value = useMemo<LanguageContextValue>(
    () => ({
      lang,
      setLang,
      t: (key, params) => translate(lang, key, params),
    }),
    [lang, setLang],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useT() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useT must be used inside <LanguageProvider>');
  return ctx;
}

export function LanguageSwitcher({ className = '' }: { className?: string }) {
  const { lang, setLang } = useT();
  return (
    <div
      role="group"
      aria-label="Language"
      className={`inline-flex items-center rounded-md border border-zinc-800 bg-zinc-900/40 p-0.5 ${className}`}
    >
      {LANGUAGES.map(({ code, label }) => {
        const active = lang === code;
        return (
          <button
            key={code}
            type="button"
            onClick={() => setLang(code)}
            aria-pressed={active}
            className={`h-6 px-2 text-[10.5px] font-semibold tracking-[0.06em] rounded-[5px] transition-colors ${
              active ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
