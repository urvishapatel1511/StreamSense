import assert from 'node:assert/strict';

const base = 'http://localhost:5173';
let cookie = '';
async function request(path, action) {
  const response = await fetch(`${base}${path}`, {
    method: action ? 'POST' : 'GET',
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(action ? { Origin: base, 'Content-Type': 'application/json', 'X-StreamSense-Request': '1' } : {}) },
    ...(action ? { body: JSON.stringify(action) } : {}), signal: AbortSignal.timeout(7000),
  });
  const nextCookie = response.headers.get('set-cookie');
  if (nextCookie) cookie = nextCookie.split(';')[0];
  assert.equal(response.status, 200, `HTTP check failed for ${path}; start both apps using npm.cmd run dev.`);
  return response.json();
}
const control = action => request('/api/summaries/control', action);
try {
  const initial = await request('/api/twitch/status');
  assert.equal(initial.demoMode, true); assert.equal(initial.summary.source, 'demo'); assert.equal(initial.summary.pendingMessages, 0);
  console.log(`PASS: fresh, isolated Demo Mode session; configured interval ${initial.summary.intervalSeconds} seconds.`);
  await control({ action: 'pause' });
  const loaded = await control({ action: 'demo_batch' });
  assert.equal(loaded.summary.paused, true); assert.equal(loaded.summary.pendingMessages, 28);
  assert.equal(loaded.summary.activity.level, 'Busy');
  assert.ok(loaded.messages.every(message => message.source === 'demo')); assert.equal(loaded.realChatReceived, false);
  const generated = await control({ action: 'generate' });
  assert.equal(generated.summary.latest.source, 'demo'); assert.deepEqual(generated.summary.latest.metrics, { messages: 28, questions: 12, repeatedMessages: 12, repeatedGroups: 6 });
  assert.match(generated.summary.latest.text, /which game is being played/); assert.match(generated.summary.latest.text, /explain that dodge/);
  console.log('PASS: queued 28 demo messages, detected Busy activity and generated accurate question/repetition highlights while paused.');
  const cleared = await control({ action: 'clear_history' }); assert.equal(cleared.summary.latest, null); assert.equal(cleared.summary.history.length, 0);
  await control({ action: 'demo_batch' });
  const pendingCleared = await control({ action: 'clear_pending' }); assert.equal(pendingCleared.summary.pendingMessages, 0); assert.equal(pendingCleared.messages.length, 56);
  console.log('PASS: history and pending messages clear independently; chat feed is retained.');
  await control({ action: 'interval', seconds: 5 }); await control({ action: 'demo_batch' });
  const resumed = await control({ action: 'resume' }); assert.equal(resumed.summary.paused, false);
  const deadline = Date.now() + 9000;
  let automatic;
  while (Date.now() < deadline) {
    automatic = await request('/api/twitch/status');
    if (automatic.summary.latest) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(automatic?.summary.latest, 'Automatic batch did not finish within the five-second interval plus tolerance.');
  assert.equal(automatic.summary.latest.metrics.messages, 28); assert.equal(automatic.summary.pendingMessages, 0);
  assert.equal(automatic.summary.latest.source, 'demo');
  console.log('PASS: a real five-second server timer generated the next batch after Resume.');
  const health = await request('/api/health'); assert.equal(health.status, 'ok'); assert.equal(health.twitchConnected, false);
  console.log('PASS: backend/proxy healthy. No Twitch login, message delivery, or audio is claimed by this check.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Demo verification failed.'); process.exitCode = 1;
} finally {
  if (cookie) {
    try { await request('/api/twitch/disconnect', { action: 'cleanup_demo_session' }); console.log('Verification session cleaned up.'); }
    catch { console.error('Unable to clean up verification session; it will expire with the development session store.'); process.exitCode = 1; }
  }
}
