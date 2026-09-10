import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config.js';
import { profileRoutes } from './routes/profile.js';
import { stateRoutes } from './routes/state.js';
import { controlRoutes } from './routes/control.js';
import { approvalRoutes } from './routes/approvals.js';
import { chatRoutes } from './routes/chat.js';
import { discoveryRoutes } from './routes/discovery.js';
import { evaluateRoutes } from './routes/evaluate.js';
import { transport } from './transport.js';

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

await app.register(cors, { origin: true });
await app.register(profileRoutes);
await app.register(stateRoutes);
await app.register(controlRoutes);
await app.register(approvalRoutes);
await app.register(chatRoutes);
await app.register(discoveryRoutes);
await app.register(evaluateRoutes);

try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info(`data dir: ${config.dataDir}`);
  app.log.info(`chat transport: ${transport.name}${transport.name === 'stub' ? ' (no Google Chat credentials — cards print to this console)' : ''}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
