import * as path from 'path';

export const SHIP_LIBRARY_ENV = 'AUTOWSGR_SHIP_LIBRARY';

/** Resolve the canonical read-only ship library bundled with the GUI. */
export function shipLibraryRoot(resourceRoot: string): string {
  return path.join(resourceRoot, 'resource', 'ship-library');
}

/** Add GUI-owned resource paths to a child process environment. */
export function buildResourceEnvironment(
  baseEnv: NodeJS.ProcessEnv,
  resourceRoot: string,
): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    [SHIP_LIBRARY_ENV]: shipLibraryRoot(resourceRoot),
  };
}
