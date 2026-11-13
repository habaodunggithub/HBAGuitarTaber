import { expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';

export const FIXTURE = (name: string) => resolve(import.meta.dirname, '../../../ml/eval/synthetic', name);

/** Upload a take on the home page and wait until the editor shows the rendered tab. */
export async function createTab(page: Page, file = 'box_techniques.wav') {
  await page.goto('/');
  await page.getByLabel('Guitar recording').setInputFiles(FIXTURE(file));
  await page.getByTestId('submit').click();
  await expect(page).toHaveURL(/\/t\/[0-9a-f]{32}$/);
  await expect(page.locator('.at-surface svg').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('save-state')).toHaveText('Saved');
}
