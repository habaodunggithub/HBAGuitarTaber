import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type Layout, topFolders } from '../../desktop/src/layout';
import { check, isOurs, remove, sizeOf, targets } from '../../desktop/src/removal';

/** "Remove the engine" / "Remove all data" (apps/desktop/src/removal.ts): what goes, and what never does. */
function layout(home: string, cache: string, logs: string): Layout {
  return {
    data: path.join(home, 'data'), runtime: path.join(home, 'runtime'), venv: path.join(home, 'runtime', 'venv'),
    python: '', cache, logs, settingsFile: path.join(home, 'settings.json'),
    roots: topFolders([home, cache, path.basename(logs) === 'logs' ? path.dirname(logs) : logs]), // as resolveLayout
    res: { root: '', web: '', python: '', launch: '', uv: '', ffmpegBin: '' },
  };
}

test('the engine is the runtime and the caches; everything is all the app folders and its browser profile', () => {
  const linux = layout('/h/.local/share/hba-guitar-taber', '/h/.cache/hba-guitar-taber', '/h/.local/state/hba-guitar-taber/logs');
  expect(targets(linux, 'engine')).toEqual(['/h/.local/share/hba-guitar-taber/runtime', '/h/.cache/hba-guitar-taber']);
  expect(targets(linux, 'everything', ['/h/.config/HBA Guitar Taber']).sort()).toEqual(
    ['/h/.cache/hba-guitar-taber', '/h/.config/HBA Guitar Taber', '/h/.local/share/hba-guitar-taber', '/h/.local/state/hba-guitar-taber']);
  // macOS: the browser profile is the data folder itself
  const mac = layout('/U/Library/Application Support/HBA Guitar Taber', '/U/Library/Caches/HBA Guitar Taber', '/U/Library/Logs/HBA Guitar Taber');
  expect(targets(mac, 'everything', ['/U/Library/Application Support/HBA Guitar Taber']).sort()).toEqual(
    ['/U/Library/Application Support/HBA Guitar Taber', '/U/Library/Caches/HBA Guitar Taber', '/U/Library/Logs/HBA Guitar Taber']);
  const win = layout('/L/HBA Guitar Taber', '/L/HBA Guitar Taber/cache', '/L/HBA Guitar Taber/logs'); // one folder holds it all
  expect(targets(win, 'everything', ['/R/HBA Guitar Taber'])).toEqual(['/L/HBA Guitar Taber', '/R/HBA Guitar Taber']);
  for (const l of [linux, mac, win]) for (const p of targets(l, 'everything')) expect(isOurs(p), p).toBe(true);
});

test('only folders named after the app are ever deleted, never the app itself', () => {
  expect(isOurs('/home/me/.cache/hba-guitar-taber')).toBe(true);
  expect(isOurs('/home/me/.local/share/hba-guitar-taber/runtime')).toBe(true);
  expect(isOurs(os.homedir())).toBe(false);
  expect(isOurs('/')).toBe(false);
  expect(isOurs('/home/me/Music')).toBe(false);
  expect(isOurs('/home/me/hba-guitar-taber-music')).toBe(false); // only mentions the name
  expect(isOurs('/home/me/HBA Guitar Taber projects/song')).toBe(false);
  expect(() => check(['/L/HBA Guitar Taber'], ['/L/HBA Guitar Taber/app'])).toThrow(/refusing/); // installed inside it
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keep-'));
  expect(() => remove([dir])).toThrow(/refusing/);
  expect(fs.existsSync(dir)).toBe(true);
});

test('a removal frees what it said and leaves its neighbours', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'removal-'));
  const root = path.join(parent, 'hba-guitar-taber');
  fs.mkdirSync(path.join(root, 'runtime', 'venv'), { recursive: true });
  fs.writeFileSync(path.join(root, 'runtime', 'venv', 'torch.so'), Buffer.alloc(3000));
  fs.mkdirSync(path.join(root, 'data'));
  fs.writeFileSync(path.join(root, 'data', 'taber.sqlite'), Buffer.alloc(500));
  fs.writeFileSync(path.join(parent, 'neighbour.txt'), 'mine');
  const l = layout(root, path.join(root, 'cache'), path.join(root, 'logs'));
  expect(await sizeOf(path.join(root, 'runtime'))).toBe(3000);
  remove(targets(l, 'engine'));
  expect(fs.existsSync(path.join(root, 'runtime'))).toBe(false);
  expect(fs.readFileSync(path.join(root, 'data', 'taber.sqlite')).length).toBe(500); // the tabs stay
  remove(targets(l, 'everything'));
  expect(fs.existsSync(root)).toBe(false);
  expect(fs.readFileSync(path.join(parent, 'neighbour.txt'), 'utf8')).toBe('mine');
});
