import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { createApp } from './app.js';

// Resolve from the server file, so root .env works from either workspace.
const envPath = fileURLToPath(new URL('../../.env', import.meta.url));
if (process.env.NODE_ENV !== 'production' && existsSync(envPath)) process.loadEnvFile(envPath);

const port = Number(process.env.PORT || 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.');

const { app, close } = createApp();
const host = process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1';
const server = app.listen(port, host, (error?: Error) => {
  // Express also invokes this callback on startup failure.
  if (!error) console.log(`StreamSense API listening on port ${port}${process.env.NODE_ENV === 'production' ? ' (production)' : `: http://127.0.0.1:${port}/api/health`}`);
});
server.on('error', (error) => { close(); console.error('Unable to start StreamSense API:', error.message); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => { close(); server.close(() => process.exit(0)); });
}
