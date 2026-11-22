/**
 * The diagnostics bundle (GLOSSARY: Diagnostics bundle / Gói chẩn đoán): one zip the user saves and attaches to a
 * report themselves. It holds the app's and the engine's logs and facts about the computer and the installation,
 * never a take or a tab. The user's home folder becomes ~ and their account name <user>, in every file.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

/** Each log keeps its end: the start of a long run says little about what went wrong. */
const LOG_LIMIT = 2 * 1024 * 1024;

export interface Entry {
  name: string;
  data: Buffer;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A user's home folder anywhere in a path: Windows (also 8.3 short names, any case, as JSON escapes it), Linux, macOS. */
const HOMES = /(?:[A-Za-z]:(?:\\{1,2}|\/)Users(?:\\{1,2}|\/)|\/home\/|\/Users\/)[^\\/"'\s]+/gi;

/**
 * Out of a text (logs, settings, error messages): the home folder and every user home folder become ~, the account
 * name <user> where it stands as a word of its own, the computer's name <computer>.
 */
export function redact(text: string, home = os.homedir(), user = os.userInfo().username, host = os.hostname()): string {
  let out = text;
  for (const h of new Set([home, home.replace(/\\/g, '/'), home.replace(/\\/g, '\\\\')])) {
    if (h.length > 1) out = out.replace(new RegExp(`${esc(h)}(?=[\\\\/"'\\s]|$)`, /^[A-Za-z]:/.test(h) ? 'gim' : 'gm'), '~');
  }
  out = out.replace(HOMES, '~');
  const word = (w: string) => new RegExp(`(?<=^|[\\s"'=:@(\\[<>,;])${esc(w)}(?=$|[\\s"',;:.)\\]>])`, 'gim');
  for (const h of new Set([host, host.split('.')[0] ?? ''])) if (h.length >= 3) out = out.replace(new RegExp(esc(h), 'gi'), '<computer>');
  if (user.length >= 2) out = out.replace(word(user), '<user>');
  return out;
}

/** What the computer is: system, processor, memory, free disk where the data lives. */
export function systemFacts(dataDir: string): Record<string, unknown> {
  let freeDisk: number | null = null;
  try {
    const s = fs.statfsSync(dataDir);
    freeDisk = s.bavail * s.bsize;
  } catch {
    /* not there yet */
  }
  const cpus = os.cpus();
  return {
    os: `${os.type()} ${os.release()}`,
    osVersion: typeof os.version === 'function' ? os.version() : null,
    arch: os.arch(),
    cpu: cpus[0]?.model ?? null,
    cpuCount: cpus.length,
    memoryGB: +(os.totalmem() / 1024 ** 3).toFixed(1),
    freeMemoryGB: +(os.freemem() / 1024 ** 3).toFixed(1),
    freeDiskGB: freeDisk === null ? null : +(freeDisk / 1024 ** 3).toFixed(1),
  };
}

const README = `HBA Guitar Taber diagnostics bundle

about.json   app, engine and pipeline versions, the engine type, the computer (system, processor,
             graphics card, memory, free disk) and the app's settings
logs/        the app's and the engine's logs (the end of each, at most 2 MB)

There are no recordings and no tabs in here. Your home folder is written as ~ and your account name
as <user>, your computer's name as <computer>. Attach this file to your report yourself; the app sends nothing.
`;

/** The files of the bundle: about.json from `about`, the logs found in `logsDir`, a README. */
export function bundleEntries(logsDir: string, about: Record<string, unknown>, home?: string, user?: string, host?: string): Entry[] {
  const r = (t: string) => redact(t, home, user, host);
  const entries: Entry[] = [
    { name: 'README.txt', data: Buffer.from(README) },
    { name: 'about.json', data: Buffer.from(r(JSON.stringify(about, null, 2))) },
  ];
  let logs: string[] = [];
  try {
    logs = fs.readdirSync(logsDir).filter((f) => f.endsWith('.log')).sort();
  } catch {
    /* no logs yet */
  }
  for (const f of logs) {
    const p = path.join(logsDir, f);
    const size = fs.statSync(p).size;
    const fd = fs.openSync(p, 'r');
    try {
      const n = Math.min(size, LOG_LIMIT);
      const buf = Buffer.alloc(n);
      fs.readSync(fd, buf, 0, n, size - n);
      // a cut log starts at its next full line (not inside a line, nor inside a character)
      const text = buf.toString('utf8');
      const kept = n < size ? text.slice(text.indexOf('\n') + 1) : text;
      entries.push({ name: `logs/${f}`, data: Buffer.from(r(kept)) });
    } finally {
      fs.closeSync(fd);
    }
  }
  return entries;
}

/** A zip of the entries (deflated; no dependency: zlib does the work). */
export function zip(entries: Entry[], when = new Date()): Buffer {
  const dosTime = (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1);
  const dosDate = ((when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate();
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const body = zlib.deflateRawSync(e.data);
    const crc = zlib.crc32(e.data) >>> 0;
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4); // version needed
    head.writeUInt16LE(0x0800, 6); // UTF-8 names
    head.writeUInt16LE(8, 8); // deflate
    head.writeUInt16LE(dosTime, 10);
    head.writeUInt16LE(dosDate, 12);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(body.length, 18);
    head.writeUInt32LE(e.data.length, 22);
    head.writeUInt16LE(name.length, 26);
    local.push(head, name, body);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt16LE(dosTime, 12);
    dir.writeUInt16LE(dosDate, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(e.data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += head.length + name.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}
