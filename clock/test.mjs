// node clock/test.mjs : the clock's dispatches and the Telegram tap webhook, with fetch stubbed
import assert from 'node:assert/strict';
import worker, { tick } from './worker.js';

const calls = [];
let DECISION = null; // what GitHub returns for runs/<date>/decision.json (null = 404)
globalThis.fetch = async (url, o = {}) => {
  calls.push({ url, method: o.method, body: o.body && JSON.parse(o.body) });
  if (url.includes('/contents/runs/') && url.includes('decision.json')) {
    return DECISION ? new Response(JSON.stringify({ content: btoa(JSON.stringify(DECISION)) }), { status: 200 }) : new Response('', { status: 404 });
  }
  if (url.includes('/contents/')) return new Response('', { status: globalThis.PREVIEW_STATUS });
  if (url.includes('/actions/workflows/publish.yml/runs')) return new Response(JSON.stringify({ workflow_runs: globalThis.RUNS || [] }), { status: 200 });
  if (url.includes('api.telegram.org')) return new Response('{"ok":true}', { status: 200 });
  return new Response(null, { status: globalThis.DISPATCH_STATUS ?? 204 });
};
const GROUP = '-1001234567890', APPROVER_A = '1111111111', APPROVER_B = '5550001111';
const env = { GH_DISPATCH_TOKEN: 't', TELEGRAM_BOT_TOKEN: 'b', TELEGRAM_CHAT_ID: GROUP, TELEGRAM_APPROVER_IDS: `${APPROVER_A},${APPROVER_B}`, TELEGRAM_WEBHOOK_SECRET: 's3cret' };
const tg = (c) => c.url.includes('api.telegram.org');
const disp = (c) => c.url.endsWith('/dispatches');
let pass = 0;
const ok = (name, fn) => fn().then(() => { pass++; }, (e) => { console.error('FAIL', name, e.message); process.exitCode = 1; });

// ---------------------------------------------------------------- clock
const run = async (cron, iso, preview = 200, dispatch = 204) => {
  calls.length = 0; globalThis.PREVIEW_STATUS = preview; globalThis.DISPATCH_STATUS = dispatch;
  await tick(cron, new Date(iso), env); return [...calls];
};
await ok('10:00 starts daily.yml', async () => {
  const c = await run('0 10 * * *', '2026-09-16T10:00:00Z');
  assert.equal(c.length, 1); assert.match(c[0].url, /daily\.yml\/dispatches$/); assert.deepEqual(c[0].body, { ref: 'main', inputs: {} });
});
await ok('14:05 starts publish.yml, not dry', async () => {
  globalThis.RUNS = [{ status: 'in_progress' }, { status: 'completed' }];
  const c = await run('5 11-16 * * *', '2026-09-16T14:05:00Z');
  const d = c.filter(disp);
  assert.equal(d.length, 1); assert.match(d[0].url, /publish\.yml\/dispatches$/); assert.equal(d[0].body.inputs.dry_run, 'false');
});
await ok('hourly start skipped while a publish run is queued (a tap must not be cancelled)', async () => {
  globalThis.RUNS = [{ status: 'queued' }];
  const c = await run('5 11-16 * * *', '2026-09-16T14:05:00Z');
  assert.equal(c.filter(disp).length, 0);
  globalThis.RUNS = [];
});
await ok('11:05 with a preview: no alert', async () => {
  const c = await run('5 11-16 * * *', '2026-09-16T11:05:00Z', 200);
  assert.equal(c.filter(disp).length, 1); assert.match(c[0].url, /contents\/runs\/2026-09-16\/telegram\.json/); assert.equal(c.filter(tg).length, 0);
});
await ok('11:05 without a preview: alert', async () => {
  const c = await run('5 11-16 * * *', '2026-09-16T11:05:00Z', 404);
  assert.equal(c.filter(tg).length, 1);
});
await ok('failed dispatch: alert', async () => {
  const c = await run('0 10 * * *', '2026-09-16T10:00:00Z', 200, 401);
  assert.equal(c.filter(tg).length, 1);
});
globalThis.DISPATCH_STATUS = 204;

// ---------------------------------------------------------------- webhook
const cb = (fromId, chatId, data, first_name = 'Sam') => ({ update_id: 1, callback_query: { id: 'q1', data, from: { id: Number(fromId), first_name }, message: { chat: { id: Number(chatId) } } } });
async function hook(update, { secret = 's3cret', method = 'POST', path = '/telegram', now } = {}) {
  calls.length = 0;
  const waits = [];
  const RealDate = Date;
  if (now) globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return new RealDate(now).getTime(); } };
  try {
    const req = new Request('https://bat-engine-clock.example.workers.dev' + path, { method, headers: secret ? { 'X-Telegram-Bot-Api-Secret-Token': secret } : {}, body: method === 'POST' ? JSON.stringify(update) : undefined });
    const res = await worker.fetch(req, env, { waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
    return { status: res.status, calls: [...calls], answer: calls.filter((c) => c.url.endsWith('/answerCallbackQuery')).map((c) => c.body.text) };
  } finally { globalThis.Date = RealDate; }
}
const D = '2026-09-16';

await ok('bad or missing secret: 401, nothing called', async () => {
  for (const secret of ['wrong', '']) {
    const r = await hook(cb(APPROVER_B, GROUP, `pub:${D}`), { secret, now: `${D}T14:30:00Z` });
    assert.equal(r.status, 401); assert.equal(r.calls.length, 0);
  }
  assert.equal((await hook({}, { method: 'GET' })).status, 404);
});
await ok('non-approver in the group: Not allowed, no dispatch', async () => {
  const r = await hook(cb('9990002222', GROUP, `pub:${D}`), { now: `${D}T14:30:00Z` });
  assert.equal(r.status, 200); assert.deepEqual(r.answer, ['Not allowed.']); assert.equal(r.calls.filter(disp).length, 0);
});
await ok('approver in a different chat: Not allowed', async () => {
  const r = await hook(cb(APPROVER_A, APPROVER_A, `pub:${D}`), { now: `${D}T14:30:00Z` });
  assert.deepEqual(r.answer, ['Not allowed.']); assert.equal(r.calls.filter(disp).length, 0);
});
await ok('approver before 14:00: queued, dispatch with the tap', async () => {
  DECISION = null;
  const r = await hook(cb(APPROVER_B, GROUP, `pub:${D}`), { now: `${D}T11:20:00Z` });
  assert.deepEqual(r.answer, ['Queued for 19:30 IST.']);
  const d = r.calls.filter(disp);
  assert.equal(d.length, 1); assert.match(d[0].url, /publish\.yml\/dispatches$/);
  assert.deepEqual(d[0].body, { ref: 'main', inputs: { dry_run: 'false', tap: `publish:${D}:${APPROVER_B}:Sam`, date: D } });
  const answerAt = r.calls.findIndex((c) => c.url.endsWith('/answerCallbackQuery'));
  assert.ok(answerAt < r.calls.findIndex(disp), 'answered before the dispatch');
});
await ok('approver after 14:00: Publishing now', async () => {
  const r = await hook(cb(APPROVER_A, GROUP, `pub:${D}`, 'Alex'), { now: `${D}T14:40:00Z` });
  assert.deepEqual(r.answer, ['Publishing now.']); assert.equal(r.calls.filter(disp).length, 1);
});
await ok('after 16:00: Too late, no dispatch', async () => {
  const r = await hook(cb(APPROVER_A, GROUP, `pub:${D}`), { now: `${D}T16:02:00Z` });
  assert.deepEqual(r.answer, ['Too late for today.']); assert.equal(r.calls.filter(disp).length, 0);
});
await ok('skip: answered and dispatched as skip', async () => {
  const r = await hook(cb(APPROVER_B, GROUP, `skip:${D}`), { now: `${D}T12:00:00Z` });
  assert.deepEqual(r.answer, ['Skipped. Not posted.']);
  assert.equal(r.calls.filter(disp)[0].body.inputs.tap, `skip:${D}:${APPROVER_B}:Sam`);
});
await ok('second tap after a decision: Already approved by, no dispatch', async () => {
  DECISION = { action: 'publish', approved_by: { id: APPROVER_B, name: 'Sam' } };
  const r = await hook(cb(APPROVER_A, GROUP, `skip:${D}`, 'Alex'), { now: `${D}T13:00:00Z` });
  assert.deepEqual(r.answer, ['Already approved by Sam.']); assert.equal(r.calls.filter(disp).length, 0);
  DECISION = null;
});
await ok('old n8n button: explained, no dispatch', async () => {
  const r = await hook(cb(APPROVER_A, GROUP, 'pub|x'), { now: `${D}T14:30:00Z` });
  assert.deepEqual(r.answer, ['This button is from the old engine and does nothing.']); assert.equal(r.calls.filter(disp).length, 0);
});
await ok('a message (not a tap) is ignored with 200', async () => {
  const r = await hook({ update_id: 2, message: { text: 'hi' } }, { now: `${D}T14:30:00Z` });
  assert.equal(r.status, 200); assert.equal(r.calls.length, 0);
});

console.log(`clock tests: ${pass} pass${process.exitCode ? ', FAILURES above' : ''}`);
