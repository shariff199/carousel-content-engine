// Group approvals: who may tap, first tap wins, taps from getUpdates and from the clock's webhook (TAP_INPUT).
//   node --test engine/test/
import test from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, cpSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../lib.mjs';
import { parseApprovers, isApprover, parseTap, formatTap, displayName, tapAnswer } from '../approvals.mjs';

const GROUP = '-1001234567890';
const APPROVER_A = '1111111111';
const APPROVER_B = '5550001111';
const STRANGER = '9990002222';
const DATE = '2099-01-02';

// ---------------------------------------------------------------- rules

test('approver rule: group chat + listed user; unset list falls back to the private-chat rule', () => {
  const approverIds = parseApprovers(`${APPROVER_A}, ${APPROVER_B}, junk`);
  assert.deepStrictEqual([...approverIds], [APPROVER_A, APPROVER_B]);
  const env = { envChatId: GROUP, approverIds };
  assert.ok(isApprover({ ...env, chatId: GROUP, fromId: APPROVER_A }));
  assert.ok(isApprover({ ...env, chatId: GROUP, fromId: Number(APPROVER_B) }));
  assert.ok(!isApprover({ ...env, chatId: GROUP, fromId: STRANGER }), 'a group member who is not listed');
  assert.ok(!isApprover({ ...env, chatId: '-100999', fromId: APPROVER_A }), 'the right person in another chat');
  assert.ok(isApprover({ envChatId: APPROVER_A, approverIds: '', chatId: APPROVER_A, fromId: APPROVER_A }), 'private chat, no list');
  assert.ok(!isApprover({ envChatId: GROUP, approverIds: '', chatId: GROUP, fromId: APPROVER_A }), 'group with no list: nobody');
  assert.ok(!isApprover({ envChatId: '', approverIds, chatId: '', fromId: APPROVER_A }), 'no chat configured');
});

test('tap input: strict format, round trip, names cleaned', () => {
  const s = formatTap({ action: 'publish', date: DATE, fromId: APPROVER_B, name: 'Sam: "A" <x>' });
  assert.strictEqual(s, `publish:${DATE}:${APPROVER_B}:Sam A x`);
  assert.deepStrictEqual(parseTap(s), { action: 'publish', date: DATE, fromId: APPROVER_B, name: 'Sam A x' });
  for (const bad of ['', 'publish', `post:${DATE}:1:x`, `publish:2099-13-40:1:x`, `publish:${DATE}:abc:x`, `publish:${DATE}:1:x;rm -rf`, `skip:${DATE}:1:${'a'.repeat(41)}`]) {
    assert.strictEqual(parseTap(bad), null, bad);
  }
  assert.strictEqual(displayName({ username: 'tauheed_s' }), '@tauheed_s');
  assert.strictEqual(displayName({ first_name: 'Sam', last_name: 'Rivera' }), 'Sam Rivera');
});

test('instant answers: before 14:00, 14-16, after 16, old preview, already decided', () => {
  const at = (h) => new Date(`${DATE}T${String(h).padStart(2, '0')}:10:00Z`);
  assert.deepStrictEqual(tapAnswer({ action: 'publish', date: DATE, now: at(11) }), { text: 'Queued for 19:30 IST.', dispatch: true });
  assert.deepStrictEqual(tapAnswer({ action: 'publish', date: DATE, now: at(14) }), { text: 'Publishing now.', dispatch: true });
  assert.deepStrictEqual(tapAnswer({ action: 'publish', date: DATE, now: at(16) }), { text: 'Too late for today.', dispatch: false });
  assert.deepStrictEqual(tapAnswer({ action: 'skip', date: DATE, now: at(12) }), { text: 'Skipped. Not posted.', dispatch: true });
  assert.strictEqual(tapAnswer({ action: 'publish', date: '2099-01-01', now: at(14) }).dispatch, false);
  const done = tapAnswer({ action: 'skip', date: DATE, now: at(14), decision: { action: 'publish', approved_by: { name: 'Sam' } } });
  assert.deepStrictEqual(done, { text: 'Already approved by Sam.', dispatch: false });
});

// ---------------------------------------------------------------- publish.mjs, mocked

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'bat-approvals-'));
  cpSync(join(ROOT, 'engine'), join(dir, 'engine'), { recursive: true });
  const run = join(dir, 'runs', DATE);
  mkdirSync(run, { recursive: true });
  const art = join(dir, 'out', 'artifact', '1', DATE, 'repair');
  mkdirSync(art, { recursive: true });
  for (let i = 1; i <= 3; i++) writeFileSync(join(art, `slide-0${i}.jpg`), Buffer.from([0xff, 0xd8, i]));
  writeFileSync(join(run, 'result.json'), JSON.stringify({ date: DATE, status: 'ready', run_id: '1', render_dir: '/x/repair', alt_text: 'Alt.' }));
  writeFileSync(join(run, 'caption.txt'), 'Caption.\n');
  writeFileSync(join(run, 'telegram.json'), JSON.stringify({ control_message_id: 7, control_text: 'Preview' }));
  writeFileSync(join(dir, 'channels.test.json'), JSON.stringify({
    instagram: { enabled: true, label: 'Instagram', via: 'postiz', integration: 'IG1', settings: { __type: 'instagram-standalone', post_type: 'post', collaborators: [] }, text: 'caption', images: 'all' },
  }));
  return { dir, run, log: join(dir, 'calls.jsonl') };
}

const cb = (id, fromId, chatId, data = `pub:${DATE}`, first_name = 'Name' + fromId.slice(-2)) =>
  ({ update_id: id, callback_query: { id: 'cq' + id, data, from: { id: Number(fromId), first_name }, message: { chat: { id: Number(chatId) } } } });

function publish(sb, { hour = 11, env = {} } = {}) {
  if (!existsSync(sb.log)) writeFileSync(sb.log, '');
  const before = readFileSync(sb.log, 'utf8').split('\n').filter(Boolean).length;
  const r = spawnSync(process.execPath, ['--import', join(sb.dir, 'engine/test/fetch-mock.mjs'), join(sb.dir, 'engine/publish.mjs'), '--date', DATE, '--now', `${DATE}T${String(hour).padStart(2, '0')}:05:00Z`], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: GROUP, TELEGRAM_APPROVER_IDS: `${APPROVER_A},${APPROVER_B}`,
      MOCK_TELEGRAM: 'updates', POSTIZ_API_KEY: 'k', POLL_MS: '1', CHANNELS_FILE: join(sb.dir, 'channels.test.json'), MOCK_LOG: sb.log, ...env },
  });
  const calls = readFileSync(sb.log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).slice(before);
  return { ...r, calls, out: r.stdout + r.stderr };
}
const decision = (sb) => { const p = join(sb.run, 'decision.json'); return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null; };
const answers = (r) => r.calls.filter((c) => c.url.endsWith('/answerCallbackQuery')).map((c) => c.body.text);

test('group taps: a stranger is refused, Sam wins, Alex second gets "Already approved by"', () => {
  const sb = sandbox();
  const r = publish(sb, { env: { MOCK_UPDATES: JSON.stringify([cb(1, STRANGER, GROUP), cb(2, APPROVER_B, GROUP, `pub:${DATE}`, 'Sam'), cb(3, APPROVER_A, GROUP, `skip:${DATE}`, 'Alex')]) } });
  assert.strictEqual(r.status, 0, r.out);
  assert.deepStrictEqual(answers(r), ['Not allowed.', 'Publish queued for 19:30 IST.', 'Already approved by Sam.']);
  const d = decision(sb);
  assert.strictEqual(d.action, 'publish');
  assert.deepStrictEqual(d.approved_by, { id: APPROVER_B, name: 'Sam' });
  assert.strictEqual(d.via, 'getUpdates');
  assert.strictEqual(r.calls.filter((c) => c.url.includes('post.kineticxhub.com')).length, 0, 'nothing posts before 14:00');
  assert.strictEqual(JSON.parse(readFileSync(join(sb.dir, 'runs/state.json'), 'utf8')).offset, 4);
  rmSync(sb.dir, { recursive: true, force: true });
});

test('a right person tapping in the wrong chat is refused', () => {
  const sb = sandbox();
  const r = publish(sb, { env: { MOCK_UPDATES: JSON.stringify([cb(1, APPROVER_A, APPROVER_A)]) } });
  assert.deepStrictEqual(answers(r), ['Not allowed.']);
  assert.strictEqual(decision(sb), null);
  rmSync(sb.dir, { recursive: true, force: true });
});

test('webhook mode: getUpdates 409 is not an error, TAP_INPUT records the decision and posts after 14:00', () => {
  const sb = sandbox();
  const r = publish(sb, { hour: 14, env: { MOCK_TELEGRAM: 'webhook', TAP_INPUT: `publish:${DATE}:${APPROVER_A}:@tauheed` } });
  assert.strictEqual(r.status, 0, r.out);
  assert.match(r.out, /webhook mode/);
  const d = decision(sb);
  assert.strictEqual(d.via, 'webhook');
  assert.deepStrictEqual(d.approved_by, { id: APPROVER_A, name: '@tauheed' });
  assert.strictEqual(r.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/posts')).length, 1, 'Instagram posted');

  const again = publish(sb, { hour: 14, env: { MOCK_TELEGRAM: 'webhook', TAP_INPUT: `skip:${DATE}:${APPROVER_B}:Sam` } });
  assert.strictEqual(again.status, 0, again.out);
  assert.match(again.out, /Already approved by @tauheed/);
  assert.strictEqual(decision(sb).action, 'publish', 'first tap wins');
  assert.strictEqual(again.calls.filter((c) => c.url.includes('post.kineticxhub.com') && c.method === 'POST').length, 0, 'never twice');
  rmSync(sb.dir, { recursive: true, force: true });
});

test('TAP_INPUT from a non-approver is ignored; a malformed one fails the run', () => {
  const sb = sandbox();
  const r = publish(sb, { env: { MOCK_TELEGRAM: 'webhook', TAP_INPUT: `publish:${DATE}:${STRANGER}:x` } });
  assert.strictEqual(r.status, 0, r.out);
  assert.strictEqual(decision(sb), null);
  const bad = publish(sb, { env: { MOCK_TELEGRAM: 'webhook', TAP_INPUT: `publish:${DATE}:${APPROVER_A}:x$(id)` } });
  assert.strictEqual(bad.status, 1, bad.out);
  assert.strictEqual(decision(sb), null);
  rmSync(sb.dir, { recursive: true, force: true });
});
