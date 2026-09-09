import 'dotenv/config';
import { resolve } from 'node:path';

export const config = {
  port: Number(process.env.API_PORT ?? 4000),
  dataDir: resolve(process.env.JOBOPS_DATA_DIR ?? '../../data'),
  repoRoot: resolve(process.env.JOBOPS_REPO_ROOT ?? '../..'),
};
