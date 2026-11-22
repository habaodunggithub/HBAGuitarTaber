import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { en, pickLang } from '../../desktop/src/i18n';

/**
 * The desktop shell's own words (apps/desktop/src/i18n.ts): the language it picks, and the setup page drawn with
 * every string from the catalog. As in i18n.spec.ts, a pseudo catalog wraps each string in ⟦ ⟧, so text without
 * brackets on the page is text a translation would miss. The setup page runs without Electron here: a stand-in
 * for the preload bridge hands it the catalog and the states the main process would send.
 */
const DESKTOP = resolve(import.meta.dirname, '../../desktop');
const wrap = (s: string) => `⟦${s}⟧`;
const pseudo = Object.fromEntries(Object.entries(en.setup).map(([k, v]) => [k, wrap(v)]));

const STATES = [
  {
    screen: 'choose', installDir: '/home/me/.local/share/taber', recommended: 'cpu', current: 'lite',
    variants: [
      { id: 'cpu', title: wrap(en.variants.cpu), detail: wrap(en.variants.cpuDetail), size: '0.6 GB' },
      { id: 'lite', title: wrap(en.variants.lite), detail: wrap(en.variants.liteDetail), size: '0.3 GB', warning: wrap('a warning') },
    ],
  },
  {
    screen: 'installing', variant: 'cpu', phase: wrap(en.install.phases.download), message: wrap(en.install.engine),
    written: '120 MB of 600 MB', fraction: 0.2, rate: '5 MB/s', startedAt: Date.now(),
  },
  { screen: 'starting', message: wrap(en.setup.opening) },
  { screen: 'error', title: wrap(en.errors.notInstalled), message: wrap('why'), logTail: '', logPath: '/logs/runtime.log' },
];

/** Visible text and labels on the page that did not come from the catalog (paths, sizes and times are values). */
async function untranslated(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const value = /^[\s\d.,:;%()+\-–/…]*(MB|GB|kB|B|s)?[\s\d.,:;%()+\-–/…]*$/;
    const bad: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement!;
      const v = (n.textContent ?? '').trim();
      if (!v || el.closest('[hidden], code, pre, .brand, #version, #elapsed, #written, #rate') || el.getClientRects().length === 0) continue;
      if (!v.includes('⟦') && !v.includes('⟧') && !value.test(v)) bad.push(`text: ${v}`);
    }
    for (const el of document.querySelectorAll('[aria-label]')) {
      if (el.closest('[hidden]')) continue;
      const v = el.getAttribute('aria-label')!;
      if (!v.includes('⟦')) bad.push(`aria-label: ${v}`);
    }
    return bad;
  });
}

test('the shell speaks the saved language, else the computer one it has, else English', () => {
  expect(pickLang('en', ['fr-FR'])).toBe('en');
  expect(pickLang(undefined, ['fr-FR', 'en-GB'])).toBe('en');
  expect(pickLang('xx', ['de'])).toBe('en');
});

test('every screen of the setup page comes from the catalog', async ({ page }) => {
  execFileSync(process.execPath, [resolve(DESKTOP, 'scripts/copy-static.mjs')], { stdio: 'pipe' });
  await page.addInitScript((strings) => {
    const w = window as unknown as { taber: unknown; push?: (s: unknown) => void };
    w.taber = {
      lang: 'en',
      strings,
      onState: (cb: (s: unknown) => void) => { w.push = cb; },
      install() {}, retry() {}, change() {}, openLogs() {}, quit() {},
    };
  }, pseudo);
  await page.goto(pathToFileURL(resolve(DESKTOP, 'dist/static/setup.html')).href);
  expect(await untranslated(page)).toEqual([]); // the first screen, before any state

  for (const state of STATES) {
    await page.evaluate((s) => (window as unknown as { push: (s: unknown) => void }).push(s), state);
    await expect(page.locator(`#${state.screen}`)).toBeVisible();
    expect(await untranslated(page), state.screen).toEqual([]);
  }
});
