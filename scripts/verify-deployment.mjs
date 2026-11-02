import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

// Verify the actual compiled server/bundle without credentials or external requests.
// Production intentionally ignores the root .env file.
const root = fileURLToPath(new URL('../', import.meta.url));
const portProbe = createServer(); portProbe.listen(0, '127.0.0.1'); await once(portProbe, 'listening');
const port = portProbe.address().port;
await new Promise(resolve => portProbe.close(resolve));
const publicOrigin = 'https://streamsense-deployment.example.workers.dev';
const child = spawn(process.execPath, ['backend/dist/server.js'], {
  cwd: root, env: { ...process.env, NODE_ENV: 'production', PORT: String(port), RENDER_EXTERNAL_URL: 'https://streamsense-deployment.onrender.com', FRONTEND_URL: publicOrigin, TWITCH_REDIRECT_URI: '', TWITCH_CLIENT_ID: '', TWITCH_CLIENT_SECRET: '' }, stdio: ['ignore', 'pipe', 'pipe'],
});
const ended = new Promise(resolve => { child.once('exit', resolve); child.once('error', resolve); });
child.stdout.resume(); child.stderr.resume();
const base = `http://127.0.0.1:${port}`;
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) throw new Error('Compiled server exited before becoming healthy. Check production configuration/build.');
    try { ready = (await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(500) })).ok; } catch { /* Startup may still be in progress. */ }
    if (ready) break;
    await delay(100);
  }
  assert.ok(ready, 'Compiled production server did not become healthy. Run npm run build first.');
  const page = await fetch(base); assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  const html = await page.text(); assert.match(html, /StreamSense/);
  const script = html.match(/src="([^"]+\.js)"/); assert.ok(script, 'Built JavaScript asset missing from dashboard HTML');
  const asset = await fetch(new URL(script[1], base)); assert.equal(asset.status, 200); assert.match(asset.headers.get('content-type'), /javascript/);
  for (const path of ['/.env', '/package.json', '/api/missing', '/assets/missing.js']) assert.equal((await fetch(base + path)).status, 404);
  const initial = await fetch(`${base}/api/twitch/status`);
  const cookie = initial.headers.get('set-cookie'); assert.match(cookie, /Secure/); assert.match(cookie, /HttpOnly/);
  const status = await initial.json(); assert.equal(status.configured, false); assert.equal(status.demoMode, true);
  const control = async action => {
    const response = await fetch(`${base}/api/summaries/control`, { method: 'POST', headers: { Cookie: cookie.split(';')[0], Origin: publicOrigin, 'X-StreamSense-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
    assert.equal(response.status, 200); return response.json();
  };
  await control('pause'); const loaded = await control('demo_batch'); assert.equal(loaded.totalMessages, 28);
  const summary = await control('generate'); assert.deepEqual(summary.summary.latest.metrics, { messages: 28, questions: 12, repeatedMessages: 12, repeatedGroups: 6 });
  console.log('PASS: compiled production server serves the built dashboard/JavaScript, API and accurate 28-message summaries from one service.');
  console.log('PASS: public-origin controls, Secure/HttpOnly cookie flags, security headers and private/missing-file 404s.');
  console.log('LIMIT: local HTTP simulates a TLS reverse proxy. No public deployment, live Twitch, browser rendering or audio is claimed.');
} catch (error) { console.error(error instanceof Error ? error.message : 'Deployment verification failed.'); process.exitCode = 1; }
finally {
  if (child.exitCode === null) child.kill('SIGTERM');
  await Promise.race([ended, delay(3000)]);
  if (child.exitCode === null) { child.kill('SIGKILL'); await ended; }
}
