import { fileURLToPath } from "node:url";
import Path from "node:path";

// Absolute path to the repository root, derived from this file's location.
// Test resources (common fixtures, TLS certificates) are resolved through this
// so they do not depend on the process working directory: the node package test
// scripts run vitest via `npm --prefix packages/client-node`, which sets cwd to
// the package dir, so cwd-relative paths would not resolve.
const projectRootPath = fileURLToPath(new URL("../../../..", import.meta.url));

// Joins repo-root-relative segments into an absolute path.
export function projectPath(...segments: string[]): string {
  return Path.join(projectRootPath, ...segments);
}
