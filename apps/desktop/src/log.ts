/** One log file per child process, the previous run kept as name.1.log. */
import fs from 'node:fs';
import path from 'node:path';

export class LogFile {
  readonly path: string;
  private stream: fs.WriteStream;
  private tailLines: string[] = [];
  private partial = '';

  constructor(dir: string, name: string) {
    fs.mkdirSync(dir, { recursive: true });
    this.path = path.join(dir, `${name}.log`);
    try {
      fs.renameSync(this.path, path.join(dir, `${name}.1.log`));
    } catch {
      /* first run */
    }
    this.stream = fs.createWriteStream(this.path, { flags: 'a' });
  }

  write(chunk: string | Buffer): void {
    const text = chunk.toString();
    this.stream.write(text);
    const lines = (this.partial + text).split(/\r?\n/);
    this.partial = lines.pop() ?? '';
    for (const l of lines) if (l.trim()) this.tailLines.push(l);
    if (this.tailLines.length > 60) this.tailLines.splice(0, this.tailLines.length - 60);
  }

  line(text: string): void {
    this.write(`[${new Date().toISOString()}] ${text}\n`);
  }

  /** the last lines written, for error messages */
  tail(n = 15): string {
    return [...this.tailLines, this.partial].filter(Boolean).slice(-n).join('\n');
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.stream.end(resolve));
  }
}
