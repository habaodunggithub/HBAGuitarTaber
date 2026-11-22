/**
 * "Remove all data" finishes after the app has quit: the window's browser profile is open while it runs (and on
 * macOS it sits inside the app's data folder), and Windows does not delete files in use. The app starts itself
 * again with --taber-remove: no window, a throwaway profile, it waits for the first process to end, deletes,
 * and quits. The fuse runAsNode is off (electron-builder.yml), so this is the app itself, not a Node script.
 */
import { app } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { remove } from './removal';

const FLAG = '--taber-remove=';

export interface CleanupRequest {
  pid: number;
  paths: string[];
}

/** The request in this process's arguments, when it was started to clean up. */
export function cleanupRequest(argv: string[]): CleanupRequest | null {
  const arg = argv.find((a) => a.startsWith(FLAG));
  if (!arg) return null;
  try {
    const r = JSON.parse(Buffer.from(arg.slice(FLAG.length), 'base64url').toString('utf8')) as CleanupRequest;
    return Number.isInteger(r.pid) && Array.isArray(r.paths) && r.paths.every((p) => typeof p === 'string') ? r : null;
  } catch {
    return null;
  }
}

/** Starts the cleanup process for `paths`; the caller quits right after. */
export function startCleanup(paths: string[]): void {
  const req = Buffer.from(JSON.stringify({ pid: process.pid, paths } satisfies CleanupRequest)).toString('base64url');
  const args = [...(app.isPackaged ? [] : [app.getAppPath()]), `${FLAG}${req}`];
  spawn(process.execPath, args, { detached: true, stdio: 'ignore' }).unref();
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The cleanup process: call before the app is ready, instead of everything else main.ts does. */
export function runCleanup(req: CleanupRequest): void {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'taber-cleanup-'));
  app.setPath('userData', profile); // its own browser profile, not the one being deleted
  const keep = [path.dirname(process.execPath), app.getAppPath()];
  const finish = () => {
    try {
      remove(req.paths, keep);
    } catch {
      // nothing deleted: a folder was not the app's own
    }
    fs.rmSync(profile, { recursive: true, force: true });
    app.exit(0);
  };
  const wait = (left: number) => (alive(req.pid) && left > 0 ? setTimeout(() => wait(left - 1), 250) : finish());
  void app.whenReady().then(() => wait(240)); // 60 s at most
}
