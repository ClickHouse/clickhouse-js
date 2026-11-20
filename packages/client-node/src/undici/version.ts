import { createRequire } from "node:module";

/** The undici versions that the transport supports: `>= 8.12.3` and `< 9`.
 *  8.12.3 is the version that CI tests. A new major version can change the
 *  API that the transport uses. */
export const MinUndiciVersion = "8.12.3";
const SupportedMajor = 8;

/** undici is not a dependency of this package (also not a peer dependency:
 *  a peer dependency breaks `npm install` with `ERESOLVE` for every
 *  application that depends on another undici major version, also when it
 *  does not use this transport). So the version is checked here, when the
 *  application creates the transport. */
export function checkUndiciVersion(version: string | undefined): void {
  if (version === undefined) {
    // The version cannot be read (for example on Bun, which replaces the
    // undici module). The `Agent.request()` check in the transport reports it.
    return;
  }
  if (!isSupportedUndiciVersion(version)) {
    throw new Error(
      `The undici transport needs undici ${MinUndiciVersion} or a later ` +
        `${SupportedMajor}.x version, but undici ${version} is installed. ` +
        `Install a supported version (npm install undici@^${MinUndiciVersion}), ` +
        `or use the default transport.`,
    );
  }
}

/** @internal exported for the tests only. */
export function isSupportedUndiciVersion(version: string): boolean {
  const parsed = parseVersion(version);
  const min = parseVersion(MinUndiciVersion);
  if (parsed === undefined || min === undefined) {
    return false;
  }
  if (parsed.major !== SupportedMajor) {
    return false;
  }
  if (parsed.minor !== min.minor) {
    return parsed.minor > min.minor;
  }
  return parsed.patch >= min.patch;
}

/** Parses `major.minor.patch`, and ignores a pre-release or build suffix. */
function parseVersion(
  version: string,
): { major: number; minor: number; patch: number } | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (match === null) {
    return undefined;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

/** The version of the undici package that `require("undici")` loads. */
export function getInstalledUndiciVersion(): string | undefined {
  try {
    // undici has no `exports` field, so its package.json can be read.
    const { version } = createRequire(__filename)("undici/package.json") as {
      version?: unknown;
    };
    return typeof version === "string" ? version : undefined;
  } catch {
    return undefined;
  }
}
