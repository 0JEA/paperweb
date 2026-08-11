import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/** Where screenshots land. Repo-relative by default, override with PAPERWEB_SHOTS. */
export const SHOTS = process.env.PAPERWEB_SHOTS
  || join(fileURLToPath(new URL('..', import.meta.url)), 'screenshots');
mkdirSync(SHOTS, { recursive: true });
