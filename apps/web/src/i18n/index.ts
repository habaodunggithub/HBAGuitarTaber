import { Fragment, createElement, type ReactNode } from 'react';
import { create } from 'zustand';
import { en, type Messages } from './en';
import { vi } from './vi';

/**
 * The app's languages. Every string the UI shows comes from a catalog: `en` is the source, and each other
 * language must have the same keys (TypeScript checks it). A message with values in it is a function.
 *
 * The language is, in order: `?lang=` in the URL (tests), the one the user picked (remembered), the first of the
 * computer's languages the app has, English. `pseudo` wraps every message in ⟦ ⟧ so a test can find text that
 * does not come from a catalog; it is only reachable through the URL.
 */
export type Lang = 'en' | 'vi';
type AnyLang = Lang | 'pseudo';

const CATALOGS: Record<Lang, Messages | null> = { en, vi };

/** The languages a user can pick, with their own names. A language appears once its catalog exists. */
export const LANGUAGES = (Object.keys(CATALOGS) as Lang[])
  .filter((l) => CATALOGS[l])
  .map((l) => ({ lang: l, name: CATALOGS[l]!.language.name }));

const KEY = 'taber.lang';

function pseudo<T>(m: T): T {
  if (typeof m === 'string') return `⟦${m}⟧` as T;
  if (typeof m === 'function') return ((...a: unknown[]) => `⟦${(m as (...x: unknown[]) => string)(...a)}⟧`) as T;
  if (Array.isArray(m)) return m.map(pseudo) as T;
  if (m && typeof m === 'object') return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, pseudo(v)])) as T;
  return m;
}

function isLang(l: unknown): l is Lang {
  return typeof l === 'string' && l in CATALOGS && CATALOGS[l as Lang] !== null;
}

function savedLang(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** The language to start in (see above). Exported for tests. */
export function initialLang(url: string, saved: string | null, system: readonly string[]): AnyLang {
  const asked = new URL(url).searchParams.get('lang');
  if (asked === 'pseudo' || isLang(asked)) return asked;
  if (isLang(saved)) return saved;
  for (const tag of system) {
    const base = tag.toLowerCase().split('-')[0];
    if (isLang(base)) return base;
  }
  return 'en';
}

function catalog(l: AnyLang): Messages {
  if (l !== 'pseudo') return CATALOGS[l] ?? en;
  // locale codes are read by Intl, not shown: they stay as they are
  const p = pseudo(en);
  return { ...p, language: { ...p.language, locale: en.language.locale, dayMonthLocale: en.language.dayMonthLocale } };
}

interface LangState {
  lang: AnyLang;
  t: Messages;
  setLang: (l: Lang) => void;
}

const startLang = typeof window === 'undefined' ? 'en' : initialLang(location.href, savedLang(), navigator.languages ?? [navigator.language]);

export const useLang = create<LangState>((set) => ({
  lang: startLang,
  t: catalog(startLang),
  setLang: (l) => {
    try {
      localStorage.setItem(KEY, l);
    } catch {
      // private window: the choice lasts until the app closes
    }
    set({ lang: l, t: catalog(l) });
  },
}));

/** <html lang> follows the language: screen readers, and the Vietnamese fonts (styles.css :lang(vi)). */
function setHtmlLang(l: AnyLang) {
  if (typeof document !== 'undefined') document.documentElement.lang = l === 'pseudo' ? 'en' : l;
}
setHtmlLang(startLang);
useLang.subscribe((s) => setHtmlLang(s.lang));

/** The current language's messages, re-rendering when the language changes. */
export function useT(): Messages {
  return useLang((s) => s.t);
}

/** The current messages outside React (callbacks, toasts, plain functions). */
export function getT(): Messages {
  return useLang.getState().t;
}

/** A label from a catalog map keyed by a value the server sends (a stage, a technique): the raw value if unknown. */
export function lookup(map: Record<string, string>, key: string): string {
  return Object.hasOwn(map, key) ? map[key]! : key;
}

/** A sentence with `{name}` placeholders, filled with page markup (a <code>, a <b>) wherever the translation puts them. */
export function fill(text: string, parts: Record<string, ReactNode>): ReactNode {
  return text.split(/\{(\w+)\}/).map((piece, i) => createElement(Fragment, { key: i }, i % 2 ? parts[piece] ?? `{${piece}}` : piece));
}

export type { Messages };
