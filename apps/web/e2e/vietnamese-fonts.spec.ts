import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

// Every Vietnamese letter with its marks, lower and upper case, plus words the app will show.
const VIETNAMESE =
  'Ủng hộ · Bản ghi · Đường · ữ ặ ' +
  'àáảãạ ăằắẳẵặ âầấẩẫậ đ èéẻẽẹ êềếểễệ ìíỉĩị òóỏõọ ôồốổỗộ ơờớởỡợ ùúủũụ ưừứửữự ỳýỷỹỵ ' +
  'ÀÁẢÃẠ ĂẰẮẲẴẶ ÂẦẤẨẪẬ Đ ÈÉẺẼẸ ÊỀẾỂỄỆ ÌÍỈĨỊ ÒÓỎÕỌ ÔỒỐỔỖỘ ƠỜỚỞỠỢ ÙÚỦŨỤ ƯỪỨỬỮỰ ỲÝỶỸỴ';

const SITE = pathToFileURL(resolve(import.meta.dirname, '../../../site/index.html')).href;
const DESKTOP = resolve(import.meta.dirname, '../../desktop');

type Miss = { variable: string; stack: string; reason: string };

/**
 * For each font variable, keep the families the page ships (its @font-face rules) and draw the text in
 * that stack twice, once falling back to monospace and once to serif. If every glyph comes from a shipped
 * font, both runs have the same width; a glyph that falls back to a system font makes them differ.
 */
async function vietnameseMisses(page: Page, lang: 'en' | 'vi', variables: string[]): Promise<Miss[]> {
  await page.evaluate((l) => {
    document.documentElement.lang = l;
  }, lang);
  return page.evaluate(
    async ({ text, variables }) => {
      const unquote = (s: string) => s.trim().replace(/^["']|["']$/g, '');
      const shipped = new Set([...document.fonts].map((f) => unquote(f.family)));
      const misses: Miss[] = [];
      for (const variable of variables) {
        const value = getComputedStyle(document.documentElement).getPropertyValue(variable);
        const families = value.split(',').map(unquote).filter((f) => shipped.has(f));
        const stack = families.map((f) => `"${f}"`).join(', ');
        if (!families.length) {
          misses.push({ variable, stack: value, reason: 'no shipped font in the stack' });
          continue;
        }
        await Promise.all(families.map((f) => document.fonts.load(`40px "${f}"`, text)));
        const width = (fallback: string) => {
          const span = document.createElement('span');
          span.style.cssText = `position:absolute;white-space:nowrap;font-size:40px;font-family:${stack}, ${fallback}`;
          span.textContent = text;
          document.body.append(span);
          const w = span.getBoundingClientRect().width;
          span.remove();
          return w;
        };
        const [mono, serif] = [width('monospace'), width('serif')];
        if (Math.abs(mono - serif) > 0.5) {
          misses.push({ variable, stack, reason: `glyphs fall back to a system font (${mono.toFixed(1)} vs ${serif.toFixed(1)} px)` });
        }
      }
      return misses;
    },
    { text: VIETNAMESE, variables },
  );
}

/**
 * A picture of the text in each font, attached to the report so a person can look at the marks too, plus the
 * page's own title markup when given: a width check cannot see marks that a filter or a clamp cuts off.
 */
async function attachSample(page: Page, name: string, variables: string[], titles = '') {
  const sample = await page.evaluate(
    ({ text, variables, titles }) => {
      const box = document.createElement('div');
      box.id = 'vi-sample';
      box.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#fff;color:#000;padding:16px;overflow:hidden';
      for (const v of variables) {
        const line = document.createElement('p');
        line.style.cssText = `margin:0 0 12px;font-size:30px;font-family:var(${v})`;
        line.textContent = `${v}: ${text}`;
        box.append(line);
      }
      box.insertAdjacentHTML('beforeend', titles);
      document.body.append(box);
      return box.id;
    },
    { text: VIETNAMESE, variables, titles },
  );
  await test.info().attach(name, { body: await page.locator(`#${sample}`).screenshot(), contentType: 'image/png' });
  await page.evaluate((id) => document.getElementById(id)?.remove(), sample);
}

const APP_FONTS = ['--display', '--hand', '--mono'];

// A take name as the editor (two-line clamp) and a dialog heading draw it, both with the rough ink filter.
const APP_TITLES = `
  <h2 class="display-sm" style="margin:16px 0">Ủng hộ Taber · Viết lại</h2>
  <div class="now" style="width:420px"><div class="now-title"><h1 class="display track" style="animation:none">Đường xa ướt mưa — bản ghi 3</h1></div></div>`;

for (const lang of ['vi', 'en'] as const) {
  // English UI too: take names are typed by the user and can be Vietnamese whatever the app's language.
  test(`the app draws Vietnamese in its own fonts (${lang})`, async ({ page }) => {
    await page.goto('/');
    expect(await vietnameseMisses(page, lang, APP_FONTS)).toEqual([]);
    await attachSample(page, `app-${lang}.png`, APP_FONTS, APP_TITLES);
  });
}

test('the download page draws Vietnamese in its own fonts', async ({ page }) => {
  await page.goto(SITE);
  expect(await vietnameseMisses(page, 'vi', APP_FONTS)).toEqual([]);
  await attachSample(page, 'site-vi.png', APP_FONTS);
});

test('the desktop setup page draws Vietnamese in its own fonts', async ({ page }) => {
  // The page gets its fonts from the copy step of the desktop build.
  execFileSync(process.execPath, [resolve(DESKTOP, 'scripts/copy-static.mjs')], { stdio: 'pipe' });
  await page.goto(pathToFileURL(resolve(DESKTOP, 'dist/static/setup.html')).href);
  expect(await vietnameseMisses(page, 'vi', APP_FONTS)).toEqual([]);
  await attachSample(page, 'setup-vi.png', APP_FONTS);
});
