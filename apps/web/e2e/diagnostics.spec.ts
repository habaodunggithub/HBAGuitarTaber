import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bundleEntries, redact, zip } from '../../desktop/src/diagnostics';

/** The desktop app's diagnostics bundle (apps/desktop/src/diagnostics.ts): what goes in, and what never does. */
const HOME = '/home/thienbao';
const USER = 'thienbao';

test('the bundle holds the logs and the facts, with the home folder and the account name taken out', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taber-diag-'));
  const logs = path.join(dir, 'logs');
  fs.mkdirSync(logs);
  fs.writeFileSync(path.join(logs, 'desktop.log'), `[t] HBA Guitar Taber 1.0.0, resources ${HOME}/apps/taber\n[t] user ${USER} started\n`);
  fs.writeFileSync(path.join(logs, 'worker.log'), `analysing ${HOME}/.local/share/hba-guitar-taber/assets/ab12.wav\n`);
  fs.writeFileSync(path.join(logs, 'api.log'), 'x'.repeat(3 * 1024 * 1024) + '\nlast line\n'); // over the 2 MB cap
  fs.writeFileSync(path.join(dir, 'take.wav'), 'RIFF not a log'); // a take next to the logs: never taken

  const about = { app: { version: '1.0.0' }, settings: { language: 'vi' }, paths: { data: `${HOME}/.local/share/hba-guitar-taber` } };
  const file = path.join(dir, 'bundle.zip');
  fs.writeFileSync(file, zip(bundleEntries(logs, about, HOME, USER)));

  // read it back with a zip reader that is not ours
  const read = JSON.parse(execFileSync('python3', ['-I', '-c', [
    'import json, sys, zipfile',
    'z = zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None',
    'print(json.dumps({n: z.read(n).decode() for n in z.namelist()}))',
  ].join('\n'), file], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })) as Record<string, string>;

  expect(Object.keys(read).sort()).toEqual(['README.txt', 'about.json', 'logs/api.log', 'logs/desktop.log', 'logs/worker.log']);
  const all = Object.values(read).join('\n');
  expect(all).not.toContain(HOME);
  expect(all).not.toMatch(new RegExp(USER, 'i'));
  expect(read['logs/worker.log']).toContain('~/.local/share/hba-guitar-taber/assets/ab12.wav'); // the path, not the take
  expect(read['logs/desktop.log']).toContain('user <user> started');
  expect(JSON.parse(read['about.json']!).paths.data).toBe('~/.local/share/hba-guitar-taber');
  expect(read['logs/api.log']!.length).toBeLessThanOrEqual(2 * 1024 * 1024);
  expect(read['logs/api.log']).toContain('last line'); // the end of a long log is kept
});

test('Windows paths are redacted too, also as JSON writes them', () => {
  const home = 'C:\\Users\\Bao Ha';
  expect(redact('log at C:\\Users\\Bao Ha\\AppData\\Local\\x', home, 'Bao Ha')).toBe('log at ~\\AppData\\Local\\x');
  expect(redact(JSON.stringify({ p: `${home}\\x` }), home, 'Bao Ha')).toBe('{"p":"~\\\\x"}');
  expect(redact('C:/Users/Bao Ha/x', home, 'Bao Ha')).toBe('~/x');
});
