import { expect, test } from '@playwright/test';
import { createTab, FIXTURE } from './helpers';

test.describe('audio -> tab', () => {
  test('uploads a take, shows progress, then renders the tab', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Write The Solo/ })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: /workers? online/ })).toBeVisible();

    await page.getByLabel('Guitar recording').setInputFiles(FIXTURE('a_minor_lick.wav'));
    await expect(page.getByText('a_minor_lick.wav')).toBeVisible();
    await page.getByTestId('submit').click();

    await expect(page).toHaveURL(/\/t\/[0-9a-f]{32}$/);
    // either we catch the progress panel, or the cache/fast worker already finished: both end at the tab
    await expect(page.locator('.at-surface svg').first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('region', { name: 'Tab sheet' })).toBeVisible();
    await expect(page.getByText(/\d+ bars/)).toBeVisible();
    await expect(page.getByRole('region', { name: 'Playback' })).toBeVisible();
  });

  test('a non-audio file is rejected with a clear message', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Guitar recording').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not audio') });
    await page.getByTestId('submit').click();
    await expect(page.getByRole('alert')).toContainText('Could not read the file');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId('submit')).toBeEnabled();
  });

  test('the new transcription appears in the library', async ({ page }) => {
    await createTab(page);
    await page.goto('/');
    await expect(page.getByRole('link', { name: /box_techniques/ }).first()).toBeVisible();
  });

  test('opening a tab keeps the player in view (alphaTab must not scroll the page)', async ({ page }) => {
    await createTab(page);
    await page.waitForTimeout(800); // alphaTab scrolls after its render finishes
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await expect(page.getByTestId('play')).toBeInViewport();
  });

  test('the amp lamp switches the desk to night, and it is remembered', async ({ page }) => {
    await page.goto('/');
    const lamp = page.getByRole('button', { name: 'Switch to the night desk' });
    await lamp.click();
    await expect(page.locator('html')).toHaveClass(/night/);
    await expect(page.getByRole('button', { name: 'Switch to the day desk' })).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/night/);
    await page.getByRole('button', { name: 'Night mode' }).click(); // the rail switch works too
    await expect(page.locator('html')).not.toHaveClass(/night/);
  });

  test('unknown transcription shows a friendly error', async ({ page }) => {
    await page.goto('/t/00000000000000000000000000000000');
    await expect(page.getByRole('alert')).toContainText('does not exist');
  });
});

test.describe('editing', () => {
  test('keyboard: select, move to another string (locks), autosave, persist, undo', async ({ page }) => {
    await createTab(page);
    const position = page.getByTestId('position');

    await page.keyboard.press('ArrowRight'); // select the first note
    await expect(position).toBeVisible();
    const before = await position.textContent();

    await page.keyboard.press('ArrowUp');
    await expect(position).not.toHaveText(before!);
    const moved = await position.textContent();
    await expect(page.getByRole('button', { name: /Locked/ })).toBeVisible();
    await expect(page.getByTestId('save-state')).toHaveText('Unsaved');

    await expect(page.getByTestId('save-state')).toHaveText('Saved', { timeout: 10_000 }); // autosave

    await page.reload();
    await expect(page.locator('.at-surface svg').first()).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('position')).toHaveText(moved!); // survived the round trip

    await page.keyboard.press('ArrowDown'); // back to the original position
    await expect(page.getByTestId('position')).toHaveText(before!);
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('position')).toHaveText(moved!);
  });

  test('clicking a note in the tab selects it', async ({ page }) => {
    await createTab(page);
    // alphaTab draws note heads as SVG text; click the first fret number of the tab staff
    // the first number in the sheet is the bar number ("1"); the next ones are tab frets
    const fret = page.locator('.at-surface svg text').filter({ hasText: /^\d{1,2}$/ }).nth(1);
    await fret.click();
    await expect(page.getByTestId('position')).toBeVisible();
    await expect(page.locator('.tab-selection')).toBeVisible();
  });

  test('alternative positions list marks the current one and applies a choice', async ({ page }) => {
    await createTab(page);
    await page.keyboard.press('ArrowRight');
    const options = page.getByRole('listbox', { name: 'Other places to play it' }).getByRole('option');
    await expect(options.first()).toBeVisible();
    expect(await options.count()).toBeGreaterThan(1);
    await expect(page.locator('[role=option][aria-selected=true]')).toHaveCount(1);
    const target = page.locator('[role=option][aria-selected=false]').first();
    const label = (await target.textContent())!;
    await target.click();
    await expect(page.locator('[role=option][aria-selected=true]')).toContainText(label.replace(/\s+/g, ' ').trim().split(' ')[0]!);
    await expect(page.getByRole('button', { name: /Locked/ })).toBeVisible();
  });

  test('typing in a field does not trigger shortcuts', async ({ page }) => {
    await createTab(page);
    await page.keyboard.press('ArrowRight');
    await page.getByText('Settings').click();
    await page.getByRole('spinbutton', { name: 'Tempo' }).fill('120');
    await page.getByRole('spinbutton', { name: 'Tempo' }).press('l');
    await expect(page.getByRole('button', { name: 'Lock note (L)' })).toBeVisible(); // still unlocked
  });
});

test.describe('re-assembling without a worker', () => {
  test('changing the capo keeps every pitch and shows up instantly', async ({ page }) => {
    await createTab(page);
    await page.keyboard.press('ArrowRight');
    const heading = page.getByRole('region', { name: 'Note details' }).getByRole('heading', { level: 2 });
    const noteBefore = await heading.textContent();
    const posBefore = await page.getByTestId('position').textContent();

    await page.getByText('Settings').click();
    await page.getByRole('spinbutton', { name: 'Capo' }).fill('2');
    const t0 = Date.now();
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByTestId('position')).not.toHaveText(posBefore!, { timeout: 5_000 });
    expect(Date.now() - t0).toBeLessThan(4_000); // no GPU / worker round trip
    await expect(heading).toHaveText(noteBefore!);
  });

  test('locked notes survive re-assembly', async ({ page }) => {
    await createTab(page);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowUp'); // moves + locks
    const pos = await page.getByTestId('position').textContent();
    await page.getByText('Settings').click();
    await page.getByRole('combobox', { name: 'Timing', exact: true }).selectOption('free');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByTestId('save-state')).toHaveText('Saved');
    await expect(page.getByTestId('position')).toHaveText(pos!);
  });

  test('"re-finger this measure" runs and keeps the selection usable', async ({ page }) => {
    await createTab(page);
    await page.keyboard.press('ArrowRight');
    await page.getByRole('button', { name: 'Re-finger bar' }).click();
    await expect(page.getByRole('button', { name: 'Re-finger bar' })).toBeEnabled();
    await expect(page.locator('.at-surface svg').first()).toBeVisible();
  });
});

test.describe('export and playback', () => {
  test('exports a real Guitar Pro file', async ({ page }) => {
    await createTab(page);
    await page.getByText('Export').click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Guitar Pro (.gp5)' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.gp5$/);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    expect(Buffer.concat(chunks).toString('latin1')).toContain('FICHIER GUITAR PRO');
  });

  test('playing moves the time and the tab cursor', async ({ page }) => {
    await createTab(page);
    await page.getByTestId('play').click();
    await expect(page.getByTestId('time')).not.toHaveText('0:00', { timeout: 10_000 });
    await expect(page.locator('.tab-cursor')).toBeVisible();
    await page.keyboard.press('Space');
    await expect(page.getByTestId('play')).toHaveAccessibleName('Play');
  });

  test('slow-down changes the audio playback rate and keeps the pitch', async ({ page }) => {
    await createTab(page);
    await page.getByRole('button', { name: '50%' }).click();
    const rate = await page.evaluate(() => {
      const a = document.querySelector('audio')!;
      return { rate: a.playbackRate, keep: a.preservesPitch };
    });
    expect(rate).toEqual({ rate: 0.5, keep: true });
  });
});

test.describe('metronome', () => {
  const angle = (page: import('@playwright/test').Page) =>
    page.evaluate(() => Number(/rotate\(([-\d.]+)deg\)/.exec((document.querySelector('.mt-pend') as SVGElement).style.transform)?.[1] ?? 0));
  /** Sample the pendulum for `ms` and count how often it changes direction (= beats). */
  const swings = async (page: import('@playwright/test').Page, ms: number) => {
    const xs: number[] = [];
    for (let t = 0; t < ms; t += 40) { xs.push(await angle(page)); await page.waitForTimeout(40); }
    let turns = 0;
    for (let i = 2; i < xs.length; i++) if (Math.sign(xs[i]! - xs[i - 1]!) !== Math.sign(xs[i - 1]! - xs[i - 2]!) && Math.abs(xs[i]! - xs[i - 1]!) > 0.05) turns++;
    return { turns, min: Math.min(...xs), max: Math.max(...xs) };
  };

  test('swings on the beat while playing, slower at half speed, and comes to rest on pause', async ({ page }) => {
    await createTab(page);
    expect(Math.abs(await angle(page))).toBeLessThan(0.5);
    await page.getByTestId('play').click();
    await page.waitForTimeout(600); // swing builds up
    const full = await swings(page, 1600);
    expect(full.min).toBeLessThan(-8); // reaches both ends
    expect(full.max).toBeGreaterThan(8);
    await page.getByRole('button', { name: '50%' }).click();
    await page.waitForTimeout(300);
    const half = await swings(page, 1600);
    expect(half.turns).toBeLessThan(full.turns); // the take's beats come slower, so does the pendulum
    await page.getByTestId('play').click();
    await expect.poll(async () => Math.abs(await angle(page)), { timeout: 6_000 }).toBeLessThan(1);
  });

  test('stays still with reduced motion', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await createTab(page);
    await page.getByTestId('play').click();
    await expect(page.getByTestId('time')).not.toHaveText('0:00', { timeout: 10_000 });
    expect(Math.abs(await angle(page))).toBeLessThan(0.5);
    await ctx.close();
  });
});

test.describe('play-along lane', () => {
  const audioTime = (page: import('@playwright/test').Page) => page.evaluate(() => document.querySelector('audio')!.currentTime);

  test('lights the sounding note and dims what has been played', async ({ page }) => {
    await createTab(page);
    const lane = page.getByTestId('lane');
    await expect(lane.locator('.lane-note')).not.toHaveCount(0);
    await page.getByTestId('play').click();
    await expect(lane.locator('.lane-note.is-now').first()).toBeAttached({ timeout: 10_000 });
    await expect(lane.locator('.lane-note.is-past').first()).toBeAttached({ timeout: 10_000 });
    await page.getByTestId('play').click();
  });

  test('clicking a note in the lane selects it and moves the playhead to it', async ({ page }) => {
    await createTab(page);
    await page.getByTestId('lane').locator('[data-i="2"] .lane-fret').click();
    await expect(page.getByTestId('position')).toBeVisible();
    await expect(page.getByTestId('lane').locator('[data-i="2"]')).toHaveClass(/is-selected/);
    await expect.poll(() => audioTime(page)).toBeGreaterThan(0.3);
  });

  test('clicking empty lane space seeks the audio', async ({ page }) => {
    await createTab(page);
    const box = (await page.getByTestId('lane').boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.85, box.y + box.height - 8); // right of the playhead, below the strings
    await expect.poll(() => audioTime(page)).toBeGreaterThan(1);
    await expect(page.getByTestId('position')).toHaveCount(0); // seeking does not select anything
  });

  test('zoom changes the lane scale', async ({ page }) => {
    await createTab(page);
    const fret = page.getByTestId('lane').locator('[data-i="3"]');
    const before = await fret.getAttribute('transform');
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await expect(fret).not.toHaveAttribute('transform', before!);
  });
});

test.describe('backing track separation', () => {
  test('the separation choice is sent with the take and shown in the options summary', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Guitar recording').setInputFiles(FIXTURE('fast_run.mix.wav'));
    await page.getByText('Options:').click();
    await page.getByRole('combobox', { name: 'Backing track' }).selectOption('off');
    await expect(page.getByText(/no separation/)).toBeVisible();
    const req = page.waitForRequest((r) => r.url().includes('/transcriptions') && r.method() === 'POST');
    await page.getByTestId('submit').click();
    expect((await req).postDataJSON().analysis_options.separate_source).toBe('off');
    await expect(page.locator('.at-surface svg').first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('separated')).toHaveCount(0);
  });

  test('a mix with a band runs through the separation step', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Guitar recording').setInputFiles(FIXTURE('a_minor_lick.mix.wav'));
    await page.getByTestId('submit').click();
    await expect(page.locator('.at-surface svg').first()).toBeVisible({ timeout: 90_000 });
    const id = page.url().split('/t/')[1]!;
    const t = await (await page.request.get(`/api/v1/transcriptions/${id}`)).json();
    // the synthetic guitar is not recognised by Demucs, so the documented fallback applies (with a warning)
    expect(t.quality.separation).toBeTruthy();
    expect(['guitar', 'original']).toContain(t.quality.separation.stem);
  });
});

test.describe('what to hear', () => {
  test('without separated stems only the original can be played', async ({ page }) => {
    await createTab(page);
    await expect(page.getByTestId('listen-original')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('listen-guitar')).toBeDisabled();
    await expect(page.getByTestId('listen-backing')).toBeDisabled();
  });

  test('guitar / backing play the stem in step with the muted original', async ({ page }) => {
    // the synthetic guitar is not recognised by Demucs, so pretend the analysis published stems,
    // served from the take itself
    await page.route(/\/api\/v1\/transcriptions\/[0-9a-f]{32}$/, async (route) => {
      const res = await route.fetch();
      const t = await res.json();
      if (t.quality) t.quality.separation = { used: true, stem: 'guitar', reason: 'test', playback: ['guitar', 'backing'] };
      await route.fulfill({ response: res, json: t });
    });
    const served: string[] = [];
    await page.route(/\/stems\/(guitar|backing)\?/, async (route) => {
      served.push(route.request().url());
      const t = await (await page.request.get(page.url().replace('/t/', '/api/v1/transcriptions/'))).json();
      await route.fulfill({ response: await page.request.get(`/api/v1/assets/${t.inputs[0].asset_id}/content`) });
    });
    await createTab(page);
    const state = () => page.evaluate(() => {
      const [a, f] = [...document.querySelectorAll('audio')] as HTMLAudioElement[];
      return { muted: a!.muted, stemPaused: f!.paused, drift: Math.abs(f!.currentTime - a!.currentTime), rate: f!.playbackRate };
    });

    await page.getByTestId('listen-guitar').click();
    await expect(page.getByTestId('listen-guitar')).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: '75%' }).click();
    await page.getByTestId('play').click();
    await expect(page.getByTestId('time')).not.toHaveText('0:00', { timeout: 10_000 });
    let s = await state();
    expect(s).toMatchObject({ muted: true, stemPaused: false, rate: 0.75 });
    expect(s.drift).toBeLessThan(0.25);
    expect(served.some((u) => u.includes('/stems/guitar?'))).toBe(true);

    await page.getByTestId('listen-backing').click(); // switch while playing
    await expect.poll(() => served.some((u) => u.includes('/stems/backing?'))).toBe(true);
    await expect.poll(async () => (await state()).stemPaused).toBe(false);

    await page.getByTestId('listen-original').click();
    s = await state();
    expect(s).toMatchObject({ muted: false, stemPaused: true });

    await page.getByTestId('play').click(); // pause
    await page.getByTestId('listen-guitar').click();
    expect((await state()).stemPaused).toBe(true); // choosing a stem while paused does not start it
  });
});

test.describe('video', () => {
  test('a video take plays in the editor and can be calibrated for a video re-analysis', async ({ page }) => {
    await createTab(page, 'box_techniques.mp4');
    const video = page.locator('video.take-video');
    await expect(video).toBeVisible();
    await page.getByTestId('play').click();
    await expect(page.getByTestId('time')).not.toHaveText('0:00', { timeout: 10_000 });
    await page.getByTestId('play').click();

    await page.getByTestId('use-video').click();
    const dialog = page.getByRole('dialog', { name: 'Show the app where the neck is' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('img')).toBeVisible();
    await expect(page.getByTestId('cal-step')).toContainText('1/4');
    const stage = page.getByTestId('cal-stage');
    await expect(stage).toHaveAttribute('data-loaded', 'true'); // clicks only count on a loaded frame
    const box = (await stage.boundingBox())!;
    for (const [x, y] of [[0.85, 0.62], [0.85, 0.42], [0.25, 0.38], [0.25, 0.66]] as const) {
      await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
    }
    await expect(page.getByTestId('cal-step')).toContainText('Check');
    await expect(dialog.locator('.cal-fret')).not.toHaveCount(0);
    await expect(dialog.locator('.cal-fret.key')).toHaveCount(2);

    await dialog.getByRole('button', { name: 'Re-analyze with video' }).click();
    // the page follows the re-analysis, then comes back to the editor with the video's verdict
    await expect(page.locator('.at-surface svg').first()).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole('region', { name: 'Video' })).toContainText(/The video did not help|Using the video/, { timeout: 30_000 });
  });

  test('calibration needs four valid points and can be redone', async ({ page }) => {
    await createTab(page, 'box_techniques.mp4');
    await page.getByTestId('use-video').click();
    const dialog = page.getByRole('dialog');
    const run = dialog.getByRole('button', { name: 'Re-analyze with video' });
    await expect(run).toBeDisabled();
    await expect(dialog.getByRole('img')).toBeVisible(); // wait for the frame before measuring the stage
    await expect(page.getByTestId('cal-stage')).toHaveAttribute('data-loaded', 'true');
    await expect.poll(async () => (await page.getByTestId('cal-stage').boundingBox())?.height ?? 0).toBeGreaterThan(100);
    const box = (await page.getByTestId('cal-stage').boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await expect(page.getByTestId('cal-step')).toContainText('2/4');
    await dialog.getByRole('button', { name: 'Start over' }).click();
    await expect(page.getByTestId('cal-step')).toContainText('1/4');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
});

test.describe('correcting notes and the test set', () => {
  type Sc = { measures: { slots: { start_s: number; notes: { note_id: string | null; pitch_midi: number; tie_from_prev: boolean }[] }[] }[]; deleted_note_ids: string[] };
  const server = async (page: import('@playwright/test').Page): Promise<Sc> => {
    const id = page.url().split('/t/')[1];
    return (await (await page.request.get(`/api/v1/transcriptions/${id}`)).json()).score as Sc;
  };
  const struck = (s: Sc) => s.measures.flatMap((m) => m.slots.flatMap((sl) => sl.notes.filter((n) => !n.tie_from_prev)));

  test('change a pitch, delete a note, add a missed one; re-assembly keeps all three', async ({ page }) => {
    await createTab(page);
    const before = await server(page);
    const heading = page.getByRole('region', { name: 'Note details' }).getByRole('heading', { level: 2 });

    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight'); // second note
    const name = await heading.textContent();
    await page.keyboard.press('Shift+ArrowUp');
    await expect(heading).not.toHaveText(name!);
    const raised = await heading.textContent();

    await page.keyboard.press('ArrowLeft'); // first note: not a real note, delete it
    await page.getByTestId('delete-note').click();

    // a rest on the grid: the playhead goes there and N adds a note
    // after the raised note: a rest, or else the middle of a long held note (a missed re-pick)
    const slots = before.measures.flatMap((m) => m.slots);
    const second = slots.indexOf(slots.filter((sl) => sl.notes.some((n) => !n.tie_from_prev))[1]!);
    let at = -1;
    for (let j = second + 1; j + 1 < slots.length && at < 0; j++) {
      const len = slots[j + 1]!.start_s - slots[j]!.start_s;
      if (!slots[j]!.notes.length) at = slots[j]!.start_s + 0.01;
      else if (len >= 0.25) at = slots[j]!.start_s + 0.5 * len;
    }
    expect(at).toBeGreaterThan(0);
    await page.evaluate((t) => { document.querySelector('audio')!.currentTime = t; }, at);
    await page.keyboard.press('Escape');
    await page.keyboard.press('n');
    await expect(page.getByTestId('position')).toBeVisible();
    await expect(page.getByTestId('save-state')).toHaveText('Saved', { timeout: 10_000 });

    const saved = await server(page);
    expect(struck(saved).length).toBe(struck(before).length); // -1 deleted, +1 added
    expect(saved.deleted_note_ids).toHaveLength(1);
    expect(struck(saved).some((n) => n.note_id?.startsWith('u'))).toBe(true);

    await page.getByText('Settings').click();
    await page.getByRole('spinbutton', { name: 'Capo' }).fill('1');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect.poll(async () => (await server(page)).deleted_note_ids.length).toBe(1);
    const after = await server(page);
    expect(struck(after).length).toBe(struck(saved).length);
    expect(struck(after).some((n) => n.note_id?.startsWith('u'))).toBe(true);
    await page.keyboard.press('Escape');
    await page.keyboard.press('ArrowRight'); // first remaining note = the raised one
    await expect(heading).toHaveText(raised!);
  });

  test('a checked tab goes into the test set and can be removed', async ({ page }) => {
    await createTab(page);
    await page.getByTestId('truth-tool').click();
    await page.getByTestId('truth-save').click();
    await expect(page.getByTestId('truth-state')).toContainText(/Version \d+ is in your test set: \d+ notes/);
    await expect(page.getByTestId('truth-tool')).toContainText('In test set');
    await page.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByTestId('truth-tool')).toContainText('Test set');
    await expect(page.getByTestId('truth-save')).toHaveText(/Add to my test set/);
  });
});
