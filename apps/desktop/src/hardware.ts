/** What this computer can run: decides which runtime variant to recommend. */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Variant } from './runtime';

export interface Gpu {
  name: string;
  driver: string;
  memoryMiB: number;
  /** compute capability ("8.9"), when this nvidia-smi can tell */
  computeCap?: string;
}

export interface Hardware {
  platform: NodeJS.Platform;
  arch: string;
  /** key into runtime.config.json "variants" */
  key: string;
  nvidia: Gpu | null;
  /** CUDA 13 wheels (torch 2.15) need driver R580 or newer */
  driverTooOld: boolean;
  /** CUDA 13 dropped Maxwell, Pascal and Volta: a GTX 10xx cannot run the GPU build at all */
  gpuTooOld: boolean;
}

/** Minimum NVIDIA driver major for the CUDA 13 torch wheels the lock pins. */
export const MIN_DRIVER_MAJOR = 580;
/** Oldest compute capability the CUDA 13 torch wheels have kernels for (Turing: RTX 20xx, GTX 16xx). */
export const MIN_COMPUTE_CAP = 7.5;

function nvidiaSmiCandidates(): string[] {
  if (process.platform !== 'win32') return ['nvidia-smi'];
  const sys = process.env.SystemRoot || 'C:\\Windows';
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  return [
    'nvidia-smi',
    path.join(sys, 'System32', 'nvidia-smi.exe'),
    path.join(pf, 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe'),
  ].filter((p, i) => i === 0 || fs.existsSync(p));
}

function run(cmd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 6000, windowsHide: true }, (err, stdout) => resolve(err ? null : String(stdout)));
  });
}

export async function detectNvidia(): Promise<Gpu | null> {
  if (process.platform === 'darwin') return null;
  for (const cmd of nvidiaSmiCandidates()) {
    // compute_cap is a newer field: an nvidia-smi that does not know it rejects the whole query, so ask again without
    for (const fields of ['name,driver_version,memory.total,compute_cap', 'name,driver_version,memory.total']) {
      const out = await run(cmd, [`--query-gpu=${fields}`, '--format=csv,noheader,nounits']);
      const first = out?.split(/\r?\n/).find((l) => l.trim());
      if (!first) continue;
      const [name, driver, mem, cap] = first.split(',').map((s) => s.trim());
      if (name) return { name, driver: driver ?? '', memoryMiB: Number(mem) || 0, computeCap: /^\d+\.\d+$/.test(cap ?? '') ? cap : undefined };
    }
  }
  return null;
}

export async function detectHardware(): Promise<Hardware> {
  const nvidia = await detectNvidia();
  const major = nvidia ? Number.parseInt(nvidia.driver, 10) : NaN;
  return {
    platform: process.platform,
    arch: process.arch,
    key: `${process.platform}-${process.arch}`,
    nvidia,
    driverTooOld: Number.isFinite(major) && major < MIN_DRIVER_MAJOR,
    gpuTooOld: nvidia?.computeCap !== undefined && Number(nvidia.computeCap) < MIN_COMPUTE_CAP,
  };
}

export function recommend(hw: Hardware, available: Variant[]): Variant {
  if (hw.nvidia && !hw.driverTooOld && !hw.gpuTooOld && available.includes('gpu')) return 'gpu';
  if (available.includes('cpu')) return 'cpu';
  return 'lite';
}
