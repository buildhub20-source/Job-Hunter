import { createTransport } from '@jobops/chat';

/** One transport for the process: Google Chat when configured, stub otherwise. */
export const transport = createTransport();
