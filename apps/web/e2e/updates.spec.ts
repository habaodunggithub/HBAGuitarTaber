import { expect, test } from '@playwright/test';
import { newer, notice } from '../../desktop/src/updates';

test('a newer release is told once, until the user closes its notice', () => {
  expect(newer('v1.0.1', '1.0.0')).toBe(true);
  expect(newer('v1.0.0', '1.0.0')).toBe(false);
  expect(newer('v0.9.3', '1.0.0')).toBe(false);
  expect(newer('v1.0.0', '0.9.3')).toBe(true); // a beta tester hears about 1.0
  expect(notice('v1.1.0', '1.0.0', undefined)).toBe('1.1.0');
  expect(notice('v1.1.0', '1.0.0', '1.1.0')).toBeNull(); // closed
  expect(notice('v1.2.0', '1.0.0', '1.1.0')).toBe('1.2.0'); // a newer one shows again
  expect(notice(null, '1.0.0', undefined)).toBeNull();
});

test('in the desktop app a new version shows as a small note in the top bar, and the check can be turned off', async ({ page }) => {
  await page.addInitScript(() => {
    const sent: unknown[] = [];
    const info = {
      version: '1.0.0', platform: 'linux', variant: 'cpu', python: '3.12', torch: '2.9', gpu: null, gpuNote: null,
      api: 'running', worker: 'running', workerEnabled: true, update: '1.1.0', checkUpdates: true,
      paths: { data: '/d', runtime: '/r', cache: '/c', logs: '/l' },
    };
    const w = window as unknown as { taberDesktop: unknown; sent: unknown[] };
    w.sent = sent;
    w.taberDesktop = {
      lang: null,
      info: async () => info,
      onState: () => () => undefined,
      action: (name: string) => sent.push(name),
      setWorker: () => undefined,
      setAutoUpdates: (on: boolean) => sent.push(`auto-updates:${on}`),
      setLanguage: () => undefined,
    };
  });
  await page.goto('/');
  const note = page.getByTestId('update');
  await expect(note).toContainText('Taber 1.1.0 is out');
  await note.getByRole('button', { name: 'Download' }).click();
  await note.getByRole('button', { name: 'Hide until the next version' }).click();
  await page.locator('.lamp-btn').click();
  await page.getByTestId('auto-updates').click(); // the box follows the desktop's state: here only the call matters
  expect(await page.evaluate(() => (window as unknown as { sent: unknown[] }).sent)).toEqual(['download-page', 'update-dismiss', 'auto-updates:false']);
});
