import { describe, expect, it } from 'vitest';
import { en } from './en';
import { initialLang, LANGUAGES } from './index';

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
  it('English is always offered, under its own name', () => {
    expect(LANGUAGES[0]).toEqual({ lang: 'en', name: en.language.name });
  });
});
