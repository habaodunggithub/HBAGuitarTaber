// Copy the setup page and the app's own fonts (OFL, from @fontsource in apps/web) next to the compiled main.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const out = path.join(root, 'dist', 'static');
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(root, 'static'), out, { recursive: true });

const fontsrc = path.resolve(root, '..', 'web', 'node_modules', '@fontsource');
const fonts = [
  ['big-shoulders-display', 'big-shoulders-display-latin-300-normal.woff2'],
  ['big-shoulders-display', 'big-shoulders-display-vietnamese-300-normal.woff2'],
  ['caveat', 'caveat-latin-700-normal.woff2'],
  ['ibm-plex-mono', 'ibm-plex-mono-latin-400-normal.woff2'],
  ['ibm-plex-mono', 'ibm-plex-mono-latin-500-normal.woff2'],
  ['ibm-plex-mono', 'ibm-plex-mono-vietnamese-400-normal.woff2'],
  ['ibm-plex-mono', 'ibm-plex-mono-vietnamese-500-normal.woff2'],
  ['sriracha', 'sriracha-latin-400-normal.woff2'],
  ['sriracha', 'sriracha-vietnamese-400-normal.woff2'],
];
fs.mkdirSync(path.join(out, 'fonts'), { recursive: true });
for (const [pkg, file] of fonts) {
  const src = path.join(fontsrc, pkg, 'files', file);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(out, 'fonts', file));
  else console.warn(`font not found (setup page falls back to system fonts): ${src}`);
}
console.log(`static -> ${path.relative(root, out)}`);
