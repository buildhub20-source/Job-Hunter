import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';

// npm workspace scripts run with cwd set to this package's directory, not the repo
// root, so both the default dotenv lookup (process.cwd()/.env) and a relative default
// path would resolve against the wrong directory. Anchor everything to the repo root,
// found from this file's own location instead of cwd.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
loadEnv({ path: join(repoRoot, '.env') });

export const config = {
  port: Number(process.env.API_PORT ?? 4000),
  dataDir: resolve(repoRoot, process.env.JOBOPS_DATA_DIR ?? 'data'),
  repoRoot: resolve(repoRoot, process.env.JOBOPS_REPO_ROOT ?? '.'),
};
