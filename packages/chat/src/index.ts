import { GoogleChatTransport } from './google.js';
import { StubTransport } from './stub.js';
import type { ChatTransport } from './types.js';

export * from './types.js';
export * from './cards.js';
export * from './parse.js';
export * from './verify.js';
export { GoogleChatTransport } from './google.js';
export { StubTransport } from './stub.js';

/** Real transport when credentials exist, stub otherwise. Never throws on missing config. */
export function createTransport(env: NodeJS.ProcessEnv = process.env): ChatTransport {
  const space = env['GCHAT_SPACE_ID'];
  const keyPath = env['GCHAT_SERVICE_ACCOUNT_JSON_PATH'];
  if (space && keyPath) return new GoogleChatTransport(space, keyPath);
  return new StubTransport();
}
