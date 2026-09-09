import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config.js';
import { profileRoutes } from './routes/profile.js';
import { stateRoutes } from './routes/state.js';
import { controlRoutes } from './routes/control.js';

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

await app.register(cors, { origin: true });
await app.register(profileRoutes);
await app.register(stateRoutes);
await app.register(controlRoutes);

try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info(`data dir: ${config.dataDir}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
