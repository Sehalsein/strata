const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

export function parseVersion(version: string): SemVer | null {
  const m = SEMVER.exec(version.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), prerelease: m[4] ? m[4].split(".") : [] };
}

export function isValidVersion(version: string): boolean {
  return parseVersion(version) !== null;
}

/** Semver precedence: <0 when a < b, 0 when equal, >0 when a > b. Throws on invalid input. */
export function compareVersions(a: string, b: string): number {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (!va || !vb) throw new Error(`Invalid version: ${!va ? a : b}`);
  for (const k of ["major", "minor", "patch"] as const) {
    if (va[k] !== vb[k]) return va[k] - vb[k];
  }
  // A release outranks any of its prereleases.
  if (va.prerelease.length === 0 || vb.prerelease.length === 0) return vb.prerelease.length - va.prerelease.length;
  for (let i = 0; i < Math.max(va.prerelease.length, vb.prerelease.length); i++) {
    const x = va.prerelease[i];
    const y = vb.prerelease[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) return Number(x) - Number(y);
    if (nx) return -1; // numeric identifiers sort before alphanumeric ones
    if (ny) return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

export function isPrerelease(version: string): boolean {
  return (parseVersion(version)?.prerelease.length ?? 0) > 0;
}
