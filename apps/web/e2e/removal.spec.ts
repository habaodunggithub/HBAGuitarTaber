import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Layout } from '../../desktop/src/layout';
import { isOurs, remove, sizeOf, targets } from '../../desktop/src/removal';

/** "Remove the engine" / "Remove all data" (apps/desktop/src/removal.ts): what goes, and what never does. */
function layout(home: string, cache: string, logs: string): Layout {
  return {
    data: path.join(home, 'data'), runtime: path.join(home, 'runtime'), venv: path.join(home, 'runtime', 'venv'),
    python: '', cache, logs, settingsFile: path.join(home, 'settings.json'),
    res: { root: '', web: '', python: '', launch: '', uv: '', ffmpegBin: '' },
  };
}

test('the engine is the runtime and the caches; everything is all the app folders, on each system', () => {
  const linux = layout('/h/.local/share/hba-guitar-taber', '/h/.cache/hba-guitar-taber', '/h/.local/state/hba-guitar-taber/logs');
  expect(targets(linux, 'engine')).toEqual(['/h/.local/share/hba-guitar-taber/runtime', '/h/.cache/hba-guitar-taber']);
  expect(targets(linux, 'everything').sort()).toEqual(['/h/.cache/hba-guitar-taber', '/h/.local/share/hba-guitar-taber', '/h/.local/state/hba-guitar-taber']);
  const mac = layout('/U/Library/Application Support/HBA Guitar Taber', '/U/Library/Caches/HBA Guitar Taber', '/U/Library/Logs/HBA Guitar Taber');
  expect(targets(mac, 'everything').sort()).toEqual(['/U/Library/Application Support/HBA Guitar Taber', '/U/Library/Caches/HBA Guitar Taber', '/U/Library/Logs/HBA Guitar Taber']);
  const win = layout('/L/HBA Guitar Taber', '/L/HBA Guitar Taber/cache', '/L/HBA Guitar Taber/logs'); // one folder holds it all
  expect(targets(win, 'everything')).toEqual(['/L/HBA Guitar Taber']);
});

test('only the app own folders are ever deleted', () => {
  expect(isOurs('/home/me/.cache/hba-guitar-taber')).toBe(true);
  expect(isOurs(os.homedir())).toBe(false);
  expect(isOurs('/')).toBe(false);
  expect(isOurs('/home/me/Music')).toBe(false);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keep-'));
  expect(() => remove([dir])).toThrow(/refusing/);
  expect(fs.existsSync(dir)).toBe(true);
});

test('a removal frees what it said and leaves its neighbours', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hba-guitar-taber-test-'));
  const runtime = path.join(root, 'runtime', 'venv');
  fs.mkdirSync(runtime, { recursive: true });
  fs.writeFileSync(path.join(runtime, 'torch.so'), Buffer.alloc(3000));
  fs.mkdirSync(path.join(root, 'data'));
  fs.writeFileSync(path.join(root, 'data', 'taber.sqlite'), Buffer.alloc(500));
  const l = layout(root, path.join(root, 'cache'), path.join(root, 'logs'));
  expect(sizeOf(path.join(root, 'runtime'))).toBe(3000);
  remove(targets(l, 'engine'));
  expect(fs.existsSync(path.join(root, 'runtime'))).toBe(false);
  expect(fs.readFileSync(path.join(root, 'data', 'taber.sqlite')).length).toBe(500); // the tabs stay
  remove(targets(l, 'everything'));
  expect(fs.existsSync(root)).toBe(false);
});
