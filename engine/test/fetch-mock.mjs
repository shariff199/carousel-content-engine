// Test only: replaces fetch for a child `node --import engine/test/fetch-mock.mjs engine/publish.mjs` run.
// Nothing leaves the machine. Every call is appended to MOCK_LOG as one JSON line.
// MOCK_TELEGRAM / MOCK_UPDATES: see the Telegram branch below.
// MOCK_FAIL: comma list of failures to simulate: "postiz-posts-instagram", "make-500", "make-odd".
import { appendFileSync } from 'node:fs';

const LOG = process.env.MOCK_LOG;
const FAIL = new Set(String(process.env.MOCK_FAIL || '').split(',').filter(Boolean));
let n = 0;
const created = new Map(); // postId -> integration id
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || 'GET';
  let body = null;
  if (opts.body instanceof FormData) body = { form: [...opts.body.keys()], file: opts.body.get('file')?.name };
  else if (typeof opts.body === 'string') body = JSON.parse(opts.body);
  appendFileSync(LOG, JSON.stringify({ method, url: u.replace(/hook\.eu1\.make\.com\/\w+/, 'hook.eu1.make.com/HOOK'), body, auth: opts.headers?.Authorization ? 'set' : null }) + '\n');

  if (u.includes('api.telegram.org')) {
    // MOCK_TELEGRAM unset: Telegram must not be called. "updates": getUpdates returns MOCK_UPDATES (JSON array).
    // "webhook": getUpdates answers 409 the way Telegram does while a webhook is set.
    const mode = process.env.MOCK_TELEGRAM;
    if (!mode) throw new Error('mock: Telegram must not be called in tests');
    if (u.endsWith('/getUpdates')) {
      if (mode === 'webhook') return json({ ok: false, error_code: 409, description: "Conflict: can't use getUpdates method while webhook is active; use deleteWebhook to delete the webhook first" }, 409);
      return json({ ok: true, result: JSON.parse(process.env.MOCK_UPDATES || '[]') });
    }
    return json({ ok: true, result: u.endsWith('/answerCallbackQuery') ? true : { message_id: 1 } });
  }
  if (u.endsWith('/api/public/v1/upload') && method === 'POST') { n++; return json({ id: 'up' + n, path: `https://post.kineticxhub.com/uploads/2099/01/02/mock${n}.jpg` }); }
  if (u.endsWith('/api/public/v1/posts') && method === 'POST') {
    const integ = body.posts[0].integration.id;
    if (FAIL.has('postiz-posts-' + body.posts[0].settings.__type)) return json({ message: 'mock refusal' }, 400);
    const id = 'post' + (created.size + 1);
    created.set(id, integ);
    return json([{ postId: id, integration: integ }]);
  }
  if (u.includes('/api/public/v1/posts?') && method === 'GET') {
    return json({ posts: [...created.keys()].map((id) => ({ id, state: 'PUBLISHED', releaseURL: 'https://example.test/' + id, releaseId: 'r-' + id })) });
  }
  if (u.startsWith('https://hook.eu1.make.com/')) {
    if (FAIL.has('make-500')) return new Response('Scenario failed to initialize', { status: 500 });
    if (FAIL.has('make-odd')) return new Response('{"ok":true}', { status: 200 });
    return new Response('Accepted', { status: 200 });
  }
  throw new Error('mock: unexpected fetch ' + method + ' ' + u);
};
