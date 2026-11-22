/** Is release tag `a` newer than version `b`? Major, minor and patch only: 1.0.0-rc.1 counts as 1.0.0. */
export function newer(a: string, b: string): boolean {
  const pa = a.replace(/^v/, '').split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.replace(/^v/, '').split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
}

/** The newer version to tell the user about, or null: none, or the one they already dismissed. */
export function notice(latest: string | null, current: string, dismissed: string | undefined): string | null {
  if (!latest || !newer(latest, current)) return null;
  const v = latest.replace(/^v/, '');
  return v === dismissed ? null : v;
}
