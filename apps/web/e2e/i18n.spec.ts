import { expect, test, type Page } from '@playwright/test';
import { createTab, FIXTURE } from './helpers';

/**
 * In the pseudo language (?lang=pseudo) every catalog message is wrapped in ⟦ ⟧. Text on screen that is not
 * wrapped did not come from a catalog: a hard-coded string a translation would miss. Allowed without
 * brackets: numbers, times and symbols, note and string names, the user's own take names, whatever is
 * marked translate="no" (the brand, commands), data-i18n="as-is" (tab notation, 8va, the amp's name plate) or
 * data-i18n="user" (a file name), what alphaTab draws, and text the server wrote (data-i18n="server": analysis warnings, still in English).
 */
const SYMBOLS = /^[\s\d.,:;%()[\]+\-–−—·|/\\↓↑←→…×#]*$/;
const NOTE = /^([A-G][#b]?-?\d?|[a-g])$/; // A4, Eb, the string names in the lane
const KEYCAP = /^[A-Z0-9?]$/; // a single key in a <kbd>: L, N, T, Z, ?
const SIZE = /^[\d.,]+\s?(B|KB|MB|GB)$/; // file sizes

async function untranslated(page: Page): Promise<string[]> {
  const titles: string[] = await (await page.request.get('/api/v1/transcriptions')).json().then((l: { title: string }[]) => l.map((t) => t.title));
  return page.evaluate(
    ({ titles, symbols, note, keycap, size }) => {
      const ok = (s: string, el?: Element) => {
        const v = s.trim();
        return !v || v.includes('⟦') || v.includes('⟧') || // a sentence filled with markup is split into pieces
           new RegExp(symbols).test(v) || new RegExp(note).test(v) || new RegExp(size).test(v)
          || (!!el?.closest('kbd') && new RegExp(keycap).test(v))
          || titles.includes(v) || titles.some((t) => v.startsWith(t + '.'));
      };
      const skip = (el: Element | null) => !!el?.closest('[translate="no"], [data-i18n="as-is"], [data-i18n="user"], [data-i18n="server"], code, .at-surface, .tab-skeleton, [hidden], [aria-hidden="true"]:not(svg *)');
      const visible = (el: Element): boolean => {
        if (el.tagName === 'OPTION') return visible(el.closest('select')!); // options have no box of their own
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return (r.width > 0 && r.height > 0 && cs.visibility !== 'hidden') || el.closest('.sr-only, dialog[open]') !== null;
      };
      const bad = new Set<string>();
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement;
        if (!el || skip(el) || el.closest('script, style') || !visible(el)) continue;
        if (!ok(n.textContent ?? '', el)) bad.add(`text: ${n.textContent!.trim()}`);
      }
      for (const el of document.querySelectorAll('[aria-label], [title], [placeholder], img[alt]')) {
        if (skip(el)) continue;
        for (const a of ['aria-label', 'title', 'placeholder', 'alt']) {
          const v = el.getAttribute(a);
          if (v !== null && !ok(v)) bad.add(`${a}: ${v}`);
        }
      }
      return [...bad];
    },
    { titles, symbols: SYMBOLS.source, note: NOTE.source, keycap: KEYCAP.source, size: SIZE.source },
  );
}

test.describe('every string comes from a catalog', () => {
  test('home, the new-tab form and its options, a missing page', async ({ page }) => {
    await page.goto('/?lang=pseudo');
    await expect(page.getByTestId('submit')).toBeVisible();
    expect(await untranslated(page)).toEqual([]);

    await page.locator('#wet').setInputFiles(FIXTURE('box_techniques.wav'));
    await page.locator('.options summary').click();
    expect(await untranslated(page)).toEqual([]);

    await page.goto('/nowhere?lang=pseudo');
    await expect(page.locator('h1')).toContainText('⟦');
    expect(await untranslated(page)).toEqual([]);
    await page.goto('/t/00000000000000000000000000000000?lang=pseudo');
    await expect(page.locator('h1')).toContainText('⟦');
    expect(await untranslated(page)).toEqual([]);
  });

  test('an error from the server is said in the app language', async ({ page }) => {
    await page.goto('/?lang=pseudo');
    await page.locator('#wet').setInputFiles({ name: 'not-audio.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('definitely not audio') });
    await page.getByTestId('submit').click();
    await expect(page.getByRole('alert')).toContainText('⟦'); // the code "not_media", from the catalog
  });

  test('the editor: note details, tools, popovers and the shortcut sheet', async ({ page }) => {
    await createTab(page, 'box_techniques.wav', 'pseudo');
    await expect(page.getByTestId('save-state')).toContainText('⟦');
    expect(await untranslated(page)).toEqual([]);

    await page.keyboard.press('ArrowRight'); // a selected note
    await expect(page.getByTestId('position')).toBeVisible();
    expect(await untranslated(page)).toEqual([]);

    for (const tool of await page.locator('.pop > summary').all()) {
      await tool.click();
      expect(await untranslated(page)).toEqual([]);
      await tool.click();
    }

    await page.keyboard.press('Escape');
    await page.keyboard.press('?');
    await expect(page.locator('dialog[open]')).toBeVisible();
    expect(await untranslated(page)).toEqual([]);
  });

  test('a video take: the video panel and the neck calibration', async ({ page }) => {
    await createTab(page, 'box_techniques.mp4', 'pseudo');
    await expect(page.locator('video.take-video')).toBeVisible();
    expect(await untranslated(page)).toEqual([]);

    await page.getByTestId('use-video').click();
    await expect(page.getByTestId('cal-stage')).toHaveAttribute('data-loaded', 'true');
    expect(await untranslated(page)).toEqual([]);
  });
});
