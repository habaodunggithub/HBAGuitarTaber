// Copy the setup page next to the compiled main, with the app's own fonts (OFL, from @fontsource in apps/web):
// their latin and Vietnamese files, and a fonts.css made from @fontsource's own rules, so the ranges match the app.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const out = path.join(root, 'dist', 'static');
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(root, 'static'), out, { recursive: true });

const fontsrc = path.resolve(root, '..', 'web', 'node_modules', '@fontsource');
// [package, stylesheet, descriptors to set]. Sriracha writes the Vietnamese hand (Caveat has no Vietnamese):
// drawn at 80% to match Caveat's size, and one weight serving every weight so it is never faux-bolded.
const sheets = [
  ['big-shoulders-display', '300.css'],
  ['caveat', '700.css'],
  ['sriracha', '400.css', { 'font-weight': '100 900', 'size-adjust': '80%' }],
  ['ibm-plex-mono', '400.css'],
  ['ibm-plex-mono', '500.css'],
];
const SUBSET = /-(latin|vietnamese)-\d+-normal\.woff2$/;

fs.mkdirSync(path.join(out, 'fonts'), { recursive: true });
const rules = [];
for (const [pkg, sheet, set = {}] of sheets) {
  const css = path.join(fontsrc, pkg, sheet);
  if (!fs.existsSync(css)) {
    console.warn(`font not found (setup page falls back to system fonts): ${css}`);
    continue;
  }
  for (const [, body] of fs.readFileSync(css, 'utf8').matchAll(/@font-face\s*{([^}]*)}/g)) {
    const file = body.match(/url\(\.\/files\/([^)]+\.woff2)\)/)?.[1];
    if (!file || !SUBSET.test(file)) continue;
    fs.copyFileSync(path.join(fontsrc, pkg, 'files', file), path.join(out, 'fonts', file));
    const descriptors = Object.fromEntries(
      body.split(';').map((d) => d.trim()).filter(Boolean).map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()]),
    );
    Object.assign(descriptors, set, { src: `url('fonts/${file}') format('woff2')` });
    rules.push(`@font-face { ${Object.entries(descriptors).map(([k, v]) => `${k}: ${v};`).join(' ')} }`);
  }
}
fs.writeFileSync(path.join(out, 'fonts.css'), `/* made by scripts/copy-static.mjs from @fontsource */\n${rules.join('\n')}\n`);
console.log(`static -> ${path.relative(root, out)} (${rules.length} font faces)`);
