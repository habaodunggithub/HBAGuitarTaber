import { describe, expect, it } from 'vitest';
import { TUNING_PRESETS } from '../lib/tuning';
import { en } from './en';
import { initialLang, LANGUAGES, useLang } from './index';

const URL_ = 'http://127.0.0.1:8000/';

describe('initialLang', () => {
  it('takes ?lang= first, including the pseudo language for tests', () => {
    expect(initialLang(`${URL_}?lang=pseudo`, 'en', ['vi-VN'])).toBe('pseudo');
    expect(initialLang(`${URL_}?lang=en`, null, ['fr-FR'])).toBe('en');
  });

  it('then the remembered choice, then the computer languages, then English', () => {
    expect(initialLang(URL_, 'en', ['fr-FR'])).toBe('en');
    expect(initialLang(URL_, null, ['fr-FR', 'en-GB'])).toBe('en');
    expect(initialLang(URL_, null, ['fr-FR', 'de'])).toBe('en');
  });

  it('ignores a language whose catalog does not exist yet', () => {
    const offered = new Set(LANGUAGES.map((l) => l.lang));
    const vi = initialLang(URL_, 'vi', ['vi-VN']);
    expect(vi).toBe(offered.has('vi') ? 'vi' : 'en');
    expect(initialLang(`${URL_}?lang=xx`, 'xx', ['xx'])).toBe('en');
  });
});

describe('catalogs', () => {
  it('names every tuning preset (the presets are keyed by the name the server stores)', () => {
    for (const k of Object.keys(TUNING_PRESETS)) expect(en.tunings).toHaveProperty([k]);
  });

  it('English is always offered, under its own name', () => {
    expect(LANGUAGES[0]).toEqual({ lang: 'en', name: en.language.name });
  });
});

describe('the language choice', () => {
  it('is remembered for the next start', () => {
    const saved = new Map<string, string>();
    globalThis.localStorage = { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => void saved.set(k, v) } as Storage;
    useLang.getState().setLang('en');
    expect(saved.get('taber.lang')).toBe('en');
    expect(initialLang(URL_, saved.get('taber.lang')!, ['fr-FR'])).toBe('en');
  });
});
