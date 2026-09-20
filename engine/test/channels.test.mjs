// Channel texts and multi-channel publishing, with no network: publish.mjs runs in a temp copy of the engine
// with fetch replaced (engine/test/fetch-mock.mjs) and Telegram switched off.
//   node --test engine/test/
import test from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, cpSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, loadFacts } from '../lib.mjs';
import { lintChannelTexts, loadChannels, skipReason } from '../channels.mjs';

const EX = JSON.parse(readFileSync(join(ROOT, 'examples/channel-texts.json'), 'utf8'));
const FACTS = loadFacts();
const DATE = '2099-01-02';
const RUN_ID = '424242';

// ---------------------------------------------------------------- texts

test('example x_text and linkedin_text pass the rules', () => {
  const r = lintChannelTexts(EX, FACTS);
  assert.deepStrictEqual(r.x_text.errors, []);
  assert.deepStrictEqual(r.linkedin_text.errors, []);
  assert.ok(r.x_text.ok && r.linkedin_text.ok);
});

test('x_text: a link, 2 hashtags and 300+ characters are each rejected', () => {
  const bad = (x) => lintChannelTexts({ ...EX, x_text: x }, FACTS).x_text;
  assert.match(bad(EX.x_text + ' Read more at example.com').errors.join(), /R15/);
  assert.match(bad(EX.x_text.slice(0, 150) + ' #smallbusiness #whatsapp').errors.join(), /R16/);
  assert.match(bad(EX.x_text + ' ' + EX.x_text).errors.join(), /R18/);
});

test('linkedin_text: under 900 chars, a hashtag, and an invented statistic are each rejected', () => {
  const bad = (t) => lintChannelTexts({ ...EX, linkedin_text: t }, FACTS).linkedin_text;
  assert.match(bad(EX.linkedin_text.slice(0, 700)).errors.join(), /R18/);
  assert.match(bad(EX.linkedin_text + '\n\n#smallbusiness').errors.join(), /R16/);
  assert.match(bad(EX.linkedin_text.replace('A WhatsApp enquiry is easy to lose', '73% of WhatsApp enquiries are lost')).errors.join(), /R1/);
});

test('a missing text fails only that text', () => {
  const r = lintChannelTexts({ x_text: EX.x_text }, FACTS);
  assert.ok(r.x_text.ok);
  assert.ok(!r.linkedin_text.ok);
});

test('committed channels.json: Instagram on, the rest skipped with a reason', () => {
  const ch = loadChannels(join(ROOT, 'engine/channels.json'));
  const ok = lintChannelTexts(EX, FACTS);
  assert.strictEqual(skipReason(ch.instagram, ok), null);
  for (const k of ['facebook', 'x', 'linkedin_page']) assert.match(skipReason(ch[k], ok), /^off: /);
});

// ---------------------------------------------------------------- publish, mocked

function sandbox({ texts = EX, channels } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'bat-publish-'));
  cpSync(join(ROOT, 'engine'), join(dir, 'engine'), { recursive: true });
  const run = join(dir, 'runs', DATE);
  mkdirSync(run, { recursive: true });
  const art = join(dir, 'out', 'artifact', RUN_ID, DATE, 'repair');
  mkdirSync(art, { recursive: true });
  for (let i = 1; i <= 7; i++) writeFileSync(join(art, `slide-0${i}.jpg`), Buffer.from([0xff, 0xd8, 0xff, i]));
  writeFileSync(join(run, 'result.json'), JSON.stringify({ date: DATE, status: 'ready', run_id: RUN_ID, render_dir: '/x/repair', alt_text: 'Alt text for the carousel.' }));
  writeFileSync(join(run, 'caption.txt'), 'Caption first line.\n\nSave this.\n');
  writeFileSync(join(run, 'decision.json'), JSON.stringify({ date: DATE, action: 'publish', test: false }));
  writeFileSync(join(run, 'channel-texts.json'), JSON.stringify(lintChannelTexts(texts, FACTS)));
  const all = {
    instagram: { enabled: true, label: 'Instagram', via: 'postiz', integration: 'IG1', settings: { __type: 'instagram-standalone', post_type: 'post', collaborators: [] }, text: 'caption', images: 'all' },
    facebook: { enabled: true, label: 'Facebook page', via: 'postiz', integration: 'FB1', settings: { __type: 'facebook', post_type: 'post' }, text: 'caption', images: 'all' },
    x: { enabled: true, label: 'X', via: 'postiz', integration: 'X1', settings: { __type: 'x', who_can_reply_post: 'everyone' }, text: 'x_text', images: 'cover' },
    linkedin_page: { enabled: true, label: 'LinkedIn page', via: 'make', webhook_env: 'MAKE_LINKEDIN_WEBHOOK_URL', text: 'linkedin_text', images: 'cover' },
    ...channels,
  };
  writeFileSync(join(dir, 'channels.test.json'), JSON.stringify(all));
  return { dir, run, log: join(dir, 'calls.jsonl') };
}

function publish(sb, { env = {}, extra = [] } = {}) {
  if (!existsSync(sb.log)) writeFileSync(sb.log, '');
  const before = readFileSync(sb.log, 'utf8').split('\n').filter(Boolean).length;
  const r = spawnSync(process.execPath, ['--import', join(sb.dir, 'engine/test/fetch-mock.mjs'), join(sb.dir, 'engine/publish.mjs'), '--date', DATE, '--now', DATE + 'T14:05:00Z', ...extra], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, TELEGRAM_OFF: '1', TELEGRAM_CHAT_ID: '1', POSTIZ_API_KEY: 'k', POLL_MS: '1',
      MAKE_LINKEDIN_WEBHOOK_URL: 'https://hook.eu1.make.com/abc123', CHANNELS_FILE: join(sb.dir, 'channels.test.json'), MOCK_LOG: sb.log, ...env },
  });
  const calls = readFileSync(sb.log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).slice(before);
  return { ...r, calls, out: r.stdout + r.stderr };
}
const rec = (sb, name) => { const p = join(sb.run, name); return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null; };

test('all four channels: right text, right images, right settings, uploads once', () => {
  const sb = sandbox();
  const r = publish(sb);
  assert.strictEqual(r.status, 0, r.out);
  const uploads = r.calls.filter((c) => c.url.endsWith('/upload'));
  const posts = r.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/posts')).map((c) => c.body.posts[0]);
  const make = r.calls.filter((c) => c.url.includes('hook.eu1.make.com'));
  assert.strictEqual(uploads.length, 7, 'slides uploaded once and reused');
  assert.deepStrictEqual(posts.map((p) => p.settings.__type), ['instagram-standalone', 'facebook', 'x']);
  assert.deepStrictEqual(posts.map((p) => p.value[0].image.length), [7, 7, 1]);
  assert.deepStrictEqual(posts.map((p) => p.integration.id), ['IG1', 'FB1', 'X1']);
  assert.strictEqual(posts[0].value[0].content, 'Caption first line.\n\nSave this.');
  assert.strictEqual(posts[1].value[0].content, 'Caption first line.\n\nSave this.');
  assert.strictEqual(posts[2].value[0].content, EX.x_text);
  assert.strictEqual(posts[2].value[0].image[0].id, 'up1', 'X gets the cover');
  assert.strictEqual(posts[2].settings.who_can_reply_post, 'everyone');
  assert.strictEqual(make.length, 1);
  assert.deepStrictEqual(Object.keys(make[0].body), ['text', 'image_url', 'alt_text']);
  assert.strictEqual(make[0].body.text, EX.linkedin_text);
  assert.strictEqual(make[0].body.image_url, 'https://post.kineticxhub.com/uploads/2099/01/02/mock1.jpg');
  assert.strictEqual(rec(sb, 'publish.json').release_url, 'https://example.test/post1');
  assert.strictEqual(rec(sb, 'publish.facebook.json').state, 'PUBLISHED');
  assert.strictEqual(rec(sb, 'publish.x.json').release_url, 'https://example.test/post3');
  assert.strictEqual(rec(sb, 'publish.linkedin_page.json').state, 'sent_unconfirmed');
  assert.ok(!/LinkedIn page: Posted/.test(r.out), 'LinkedIn is never reported as posted');

  const again = publish(sb);
  assert.strictEqual(again.status, 0, again.out);
  assert.deepStrictEqual(again.calls, [], 'second run makes no external call: never twice');
  assert.match(again.out, /already handled/);
  rmSync(sb.dir, { recursive: true, force: true });
});

test('committed defaults: Instagram posts, the other three skipped with reasons, no call to them', () => {
  const sb = sandbox();
  const r = publish(sb, { env: { CHANNELS_FILE: join(sb.dir, 'engine/channels.json'), POSTIZ_INSTAGRAM_ID: 'IG1', MAKE_LINKEDIN_WEBHOOK_URL: '' } });
  assert.strictEqual(r.status, 0, r.out);
  const posts = r.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/posts'));
  assert.strictEqual(posts.length, 1);
  assert.strictEqual(posts[0].body.posts[0].integration.id, 'IG1');
  assert.strictEqual(r.calls.filter((c) => c.url.includes('make.com')).length, 0);
  const s = rec(sb, 'channels.json');
  assert.deepStrictEqual(Object.keys(s.skipped).sort(), ['facebook', 'linkedin_page', 'x']);
  for (const k of ['publish.facebook.json', 'publish.x.json', 'publish.linkedin_page.json']) assert.strictEqual(rec(sb, k), null, k + ' must not exist');
  rmSync(sb.dir, { recursive: true, force: true });
});

test('a failed x_text drops only X; a missing webhook skips LinkedIn', () => {
  const sb = sandbox({ texts: { ...EX, x_text: EX.x_text + ' See example.com' } });
  const r = publish(sb, { env: { MAKE_LINKEDIN_WEBHOOK_URL: '' } });
  assert.strictEqual(r.status, 0, r.out);
  const types = r.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/posts')).map((c) => c.body.posts[0].settings.__type);
  assert.deepStrictEqual(types, ['instagram-standalone', 'facebook']);
  const s = rec(sb, 'channels.json');
  assert.match(s.skipped.x, /x_text failed the rules/);
  assert.match(s.skipped.linkedin_page, /MAKE_LINKEDIN_WEBHOOK_URL is not set/);
  rmSync(sb.dir, { recursive: true, force: true });
});

test('Instagram refused by Postiz: the others still post, exit code 1, Instagram retryable', () => {
  const sb = sandbox();
  const r = publish(sb, { env: { MOCK_FAIL: 'postiz-posts-instagram-standalone' } });
  assert.strictEqual(r.status, 1, r.out);
  assert.strictEqual(rec(sb, 'publish.json').state, 'failed');
  assert.strictEqual(rec(sb, 'publish.facebook.json').state, 'PUBLISHED');
  assert.strictEqual(rec(sb, 'publish.linkedin_page.json').state, 'sent_unconfirmed');
  const noRetry = publish(sb);
  assert.strictEqual(noRetry.calls.filter((c) => c.method === 'POST').length, 0, 'no retry without the flag');
  const retry = publish(sb, { env: { RETRY: 'true' } });
  assert.strictEqual(retry.status, 0, retry.out);
  const posts = retry.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/posts'));
  assert.strictEqual(posts.length, 1, 'retry re-posts Instagram only');
  assert.strictEqual(retry.calls.filter((c) => c.url.endsWith('/upload')).length, 0, 'uploads reused');
  rmSync(sb.dir, { recursive: true, force: true });
});

test('Make: HTTP 500 is failed and retryable; a 200 that is not "Accepted" is unknown and not retryable', () => {
  const only = { instagram: { enabled: false }, facebook: { enabled: false }, x: { enabled: false } };
  const a = sandbox({ channels: only });
  const r = publish(a, { env: { MOCK_FAIL: 'make-500' } });
  assert.strictEqual(r.status, 1, r.out);
  assert.strictEqual(rec(a, 'publish.linkedin_page.json').state, 'failed');
  const retry = publish(a, { env: { RETRY: 'true' } });
  assert.strictEqual(rec(a, 'publish.linkedin_page.json').state, 'sent_unconfirmed', retry.out);
  rmSync(a.dir, { recursive: true, force: true });

  const b = sandbox({ channels: only });
  publish(b, { env: { MOCK_FAIL: 'make-odd' } });
  assert.strictEqual(rec(b, 'publish.linkedin_page.json').state, 'unknown');
  const retry2 = publish(b, { env: { RETRY: 'true' } });
  assert.strictEqual(retry2.calls.filter((c) => c.url.includes('make.com')).length, 0, 'unknown is never retried');
  rmSync(b.dir, { recursive: true, force: true });
});

test('dry run: no external call at all, a dry record per channel', () => {
  const sb = sandbox();
  const r = publish(sb, { env: { DRY_RUN: 'true' } });
  assert.strictEqual(r.status, 0, r.out);
  assert.deepStrictEqual(r.calls, []);
  assert.strictEqual(rec(sb, 'publish.x.dryrun.json').slides.length, 1);
  assert.strictEqual(rec(sb, 'publish.facebook.dryrun.json').slides.length, 7);
  assert.strictEqual(rec(sb, 'publish.linkedin_page.dryrun.json').payload.webhook_set, true);
  assert.strictEqual(rec(sb, 'publish.json'), null);
  rmSync(sb.dir, { recursive: true, force: true });
});

test('a Skip tap closes the day for every channel', () => {
  const sb = sandbox();
  writeFileSync(join(sb.run, 'decision.json'), JSON.stringify({ date: DATE, action: 'skip' }));
  const r = publish(sb);
  assert.deepStrictEqual(r.calls, []);
  assert.strictEqual(rec(sb, 'publish.json').state, 'skipped');
  const again = publish(sb);
  assert.deepStrictEqual(again.calls, []);
  assert.strictEqual(rec(sb, 'publish.x.json'), null);
  rmSync(sb.dir, { recursive: true, force: true });
});
