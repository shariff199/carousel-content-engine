#!/usr/bin/env node
// Reads Tauheed's Publish / Skip taps from Telegram and, from 14:00 UTC (19:30 IST), posts the day's
// approved carousel to every ready channel: Instagram, Facebook and X through Postiz, the LinkedIn
// company page through a Make webhook. No server: GitHub Actions runs this hourly.
//
//   node engine/publish.mjs [--date YYYY-MM-DD] [--run-id N] [--dry-run] [--now ISO]
//
// Rules it keeps:
// - only a tap from TELEGRAM_CHAT_ID by an approver counts (engine/approvals.mjs); first tap wins; no tap = never posted
// - taps arrive two ways: getUpdates (hourly), or the `tap` workflow input sent by the Cloudflare clock's Telegram
//   webhook (TAP_INPUT). With the webhook set, getUpdates answers 409 and that is treated as "no pending taps"
// - never posts twice per channel for a date: the channel's record is written before its first external call
//   (Instagram: runs/<date>/publish.json; others: runs/<date>/publish.<channel>.json)
// - channels are independent: one failing does not stop the others
// - a channel that is off, not connected, or whose text failed the rules is skipped with the reason in
//   runs/<date>/channels.json; it gets no record, so it can still post later that day once it is ready
// - after 16:00 UTC with no tap the day is marked expired
// - --dry-run stops before any Postiz or Make call (no upload, no post) and writes publish*.dryrun.json
// - TELEGRAM_OFF=1 (local tests only) replaces every Telegram call with a log line
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, telegram, sleep } from './lib.mjs';
import { loadChannels, skipReason } from './channels.mjs';
import { parseApprovers, isApprover, displayName, parseButton, parseTap, PUBLISH_HOUR_UTC, EXPIRE_HOUR_UTC } from './approvals.mjs';

const args = process.argv.slice(2);
const arg = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const NOW = new Date(arg('--now', new Date().toISOString()));
const DATE = arg('--date', NOW.toISOString().slice(0, 10));
const DRY = args.includes('--dry-run') || process.env.DRY_RUN === 'true';
const RETRY = args.includes('--retry') || process.env.RETRY === 'true';
const RUN_ID_ARG = arg('--run-id', process.env.SOURCE_RUN_ID || '');
const RUN = join(ROOT, 'runs', DATE);
const STATE = join(ROOT, 'runs', 'state.json');
const chat_id = String(process.env.TELEGRAM_CHAT_ID || '').trim();
const POSTIZ_ORIGIN = 'https://post.kineticxhub.com';
const POSTIZ = POSTIZ_ORIGIN + '/api/public/v1';
const POSTIZ_KEY = String(process.env.POSTIZ_API_KEY || '').trim();
const TG_OFF = process.env.TELEGRAM_OFF === '1';
const APPROVERS = parseApprovers(process.env.TELEGRAM_APPROVER_IDS);
const TAP_INPUT = String(process.env.TAP_INPUT || '').trim();
const CHANNEL_ORDER = ['instagram', 'facebook', 'x', 'linkedin_page'];

const log = (...a) => console.log('[publish]', ...a);
const readJson = (p, d = null) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return d; } };
const writeJson = (p, o) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, JSON.stringify(o, null, 2) + '\n'); };

async function tg(method, payload) {
  if (TG_OFF) { log('TELEGRAM_OFF', method, JSON.stringify(payload?.text ?? '').slice(0, 160)); return method === 'getUpdates' ? [] : { message_id: 0 }; }
  return telegram(method, payload);
}

// ------------------------------------------------------------------ taps

async function readTaps() {
  let n = 0;
  if (TAP_INPUT) n += tapFromInput();
  const state = readJson(STATE, { offset: 0 });
  let updates;
  try {
    updates = await tg('getUpdates', { offset: state.offset || 0, timeout: 0, allowed_updates: ['callback_query'] });
  } catch (e) {
    // The clock's webhook owns the bot's updates; taps then come in through TAP_INPUT instead.
    if (/Conflict|webhook is active/i.test(String(e.message))) { log('webhook mode: getUpdates unavailable, no pending taps'); return n; }
    throw e;
  }
  // A dry run only proves getUpdates works. It never answers, records or confirms a tap: the offset is not
  // saved, so the next real run gets the same updates again.
  if (DRY) { log('DRY RUN: getUpdates ok,', updates.length, 'pending update(s), not acted on'); return n + updates.length; }
  for (const u of updates) {
    state.offset = u.update_id + 1;
    const cq = u.callback_query;
    if (!cq) continue;
    const b = parseButton(cq.data);
    let answer = '';
    if (!isApprover({ chatId: cq.message?.chat?.id, fromId: cq.from?.id, envChatId: chat_id, approverIds: APPROVERS })) {
      answer = 'Not allowed.';
      log('ignored tap from chat', cq.message?.chat?.id, 'user', cq.from?.id);
    } else if (!b) {
      answer = 'This button is from the old engine and does nothing.';
    } else {
      answer = recordDecision(b.date, b.action, { id: String(cq.from.id), name: displayName(cq.from) }, 'getUpdates');
    }
    // Answers expire after about 15 minutes; an hourly job is often late, so errors here are expected.
    try { await tg('answerCallbackQuery', { callback_query_id: cq.id, text: answer }); } catch (e) { log('answerCallbackQuery:', String(e.message).slice(0, 80)); }
  }
  writeJson(STATE, { ...state, checked_at: NOW.toISOString() });
  return n + updates.length;
}

// A tap forwarded by the clock's webhook. The Worker already checked the chat and the approver; the user id is
// checked again here because the input can also be typed by hand in the Actions UI.
function tapFromInput() {
  const t = parseTap(TAP_INPUT);
  if (!t) throw new Error('TAP_INPUT is not <publish|skip>:<YYYY-MM-DD>:<user id>:<name>');
  const approved = APPROVERS.size ? APPROVERS.has(t.fromId) : t.fromId === chat_id;
  if (!approved) { log('tap input from', t.fromId, 'is not an approver, ignored'); return 0; }
  if (DRY) { log('DRY RUN: tap input ok,', t.action, t.date, 'by', t.name, '- not recorded'); return 1; }
  log('tap input:', recordDecision(t.date, t.action, { id: t.fromId, name: t.name }, 'webhook'));
  return 1;
}

// First tap wins: once a date has a publish or skip decision, later taps (from either approver) change nothing.
function recordDecision(date, action, by, via) {
  const dir = join(ROOT, 'runs', date);
  if (!existsSync(join(dir, 'result.json'))) return 'No carousel on record for ' + date + '.';
  const prev = readJson(join(dir, 'decision.json'));
  if (prev?.action === 'expired') return 'Too late: ' + date + ' expired.';
  if (prev && !prev.test && ['publish', 'skip'].includes(prev.action)) {
    return `Already ${prev.action === 'publish' ? 'approved' : 'skipped'} by ${prev.approved_by?.name || 'someone'}.`;
  }
  if (existsSync(join(dir, 'publish.json'))) return 'Already handled for ' + date + '.';
  writeJson(join(dir, 'decision.json'), { date, action, seen_at: NOW.toISOString(), from_id: by.id, approved_by: by, via, test: false });
  log('decision', date, action, 'by', by.name, '(' + by.id + ')', 'via', via);
  if (action === 'skip') return 'Skipped. Not posted.';
  return NOW.getUTCHours() >= PUBLISH_HOUR_UTC ? 'Publishing now.' : 'Publish queued for 19:30 IST.';
}

async function editControl(date, status, keepButtons) {
  const t = readJson(join(ROOT, 'runs', date, 'telegram.json'));
  if (!t?.control_message_id || !t.control_text) return;
  const payload = { chat_id, message_id: t.control_message_id, text: (t.control_text + '\n\nStatus: ' + status).slice(0, 4000), disable_web_page_preview: true };
  if (keepButtons) payload.reply_markup = { inline_keyboard: [[{ text: 'Publish', callback_data: 'pub:' + date }, { text: 'Skip', callback_data: 'skip:' + date }]] };
  try { await tg('editMessageText', payload); } catch (e) { if (!/not modified/.test(e.message)) log('edit:', String(e.message).slice(0, 100)); }
}

async function reply(text) {
  const t = readJson(join(RUN, 'telegram.json'));
  await tg('sendMessage', { chat_id, text, reply_to_message_id: t?.control_message_id, disable_web_page_preview: false }).catch((e) => log('telegram:', e.message));
}

// ------------------------------------------------------------------ slides

function findJpgs(dir) {
  const out = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/^slide-\d+\.jpg$/.test(f)) out.push(p); } };
  if (existsSync(dir)) walk(dir);
  return out;
}

function slidesFor(result) {
  const want = basename(result.render_dir || 'draft'); // draft or repair
  const runId = RUN_ID_ARG || result.run_id;
  if (runId) {
    const dest = join(ROOT, 'out', 'artifact', String(runId));
    if (!findJpgs(dest).length) {
      const r = spawnSync('gh', ['run', 'download', String(runId), '-n', 'carousel-' + runId, '-D', dest], { encoding: 'utf8', timeout: 120000 });
      if (r.status !== 0) log('artifact download failed:', (r.stderr || '').slice(0, 200));
    }
    const jpgs = findJpgs(dest).filter((p) => p.includes(DATE) && basename(join(p, '..')) === want).sort();
    if (jpgs.length) return { jpgs, from: 'artifact ' + runId };
  }
  // Fallback: re-render from the committed spec (needs the Python renderer deps).
  const dir = join(ROOT, 'out', DATE, 'republish');
  mkdirSync(dir, { recursive: true });
  const spec = join(RUN, 'spec.json');
  writeFileSync(join(dir, 'spec.json'), readFileSync(spec));
  const py = process.env.PYTHON || 'python3';
  const r = spawnSync(py, [join(ROOT, 'engine/render/render_v2.py'), join(dir, 'spec.json'), '--out', dir], { encoding: 'utf8', timeout: 300000 });
  if (r.status !== 0) throw new Error('re-render failed: ' + ((r.stdout || '') + (r.stderr || '')).slice(-300));
  const c = spawnSync(py, ['-c', 'import glob,sys\nfrom PIL import Image\nfor p in sorted(glob.glob(sys.argv[1]+"/slide-*.png")): Image.open(p).convert("RGB").save(p[:-4]+".jpg","JPEG",quality=92,optimize=True)', dir], { encoding: 'utf8' });
  if (c.status !== 0) throw new Error('JPEG conversion failed: ' + c.stderr);
  return { jpgs: findJpgs(dir).sort(), from: 're-render' };
}

let slidesCache = null;
const slides = (result) => (slidesCache ||= slidesFor(result));

// ------------------------------------------------------------------ Postiz

async function postiz(method, path, body, isForm = false) {
  const r = await fetch(POSTIZ + path, { method, headers: isForm ? { Authorization: POSTIZ_KEY } : { Authorization: POSTIZ_KEY, 'Content-Type': 'application/json' }, body: isForm ? body : body && JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Postiz ${method} ${path} HTTP ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}

// Slides are uploaded to Postiz once per day and reused by every channel (runs/<date>/uploads.json).
async function uploads(jpgs) {
  const p = join(RUN, 'uploads.json');
  const names = jpgs.map((j) => basename(j));
  const prev = readJson(p);
  if (prev && JSON.stringify(prev.slides) === JSON.stringify(names)) return prev.images;
  const images = [];
  for (const j of jpgs) {
    const form = new FormData();
    form.append('file', new Blob([readFileSync(j)], { type: 'image/jpeg' }), basename(j));
    const up = await postiz('POST', '/upload', form, true);
    images.push({ id: up.id, path: up.path });
  }
  writeJson(p, { date: DATE, slides: names, images, at: new Date().toISOString() });
  return images;
}

const publicUrl = (path) => (/^https?:\/\//.test(String(path)) ? String(path) : new URL(String(path), POSTIZ_ORIGIN).toString());

// ------------------------------------------------------------------ channels

const recordPath = (ch) => join(RUN, ch.name === 'instagram' ? 'publish.json' : `publish.${ch.name}.json`);
const dryPath = (ch) => join(RUN, ch.name === 'instagram' ? 'publish.dryrun.json' : `publish.${ch.name}.dryrun.json`);

// What a channel posts: its text and which slides.
function inputsFor(ch, result, texts) {
  const caption = readFileSync(join(RUN, 'caption.txt'), 'utf8').trim();
  const text = ch.text === 'caption' ? caption : String(texts?.[ch.text]?.text || '');
  const { jpgs, from } = slides(result);
  const chosen = ch.images === 'cover' ? jpgs.slice(0, 1) : jpgs;
  return { text, jpgs: chosen, all: jpgs, from };
}

async function runChannel(ch, result, texts) {
  const pubPath = recordPath(ch);
  const { text, jpgs, all, from } = inputsFor(ch, result, texts);
  if (ch.images === 'all' && (jpgs.length < 2 || jpgs.length > 10)) throw new Error(`need 2-10 slides, found ${jpgs.length} (${from})`);
  if (!jpgs.length) throw new Error('no slides found (' + from + ')');
  const plan = { date: DATE, channel: ch.name, slides: jpgs.map((p) => basename(p)), slides_from: from, text_from: ch.text,
    caption_chars: text.length, ...(ch.via === 'postiz' ? { integration: ch.integration } : { via: 'make' }) };

  if (DRY) {
    const payload = ch.via === 'postiz'
      ? { integration: ch.integration, settings: ch.settings, content_chars: text.length, images: plan.slides }
      : { webhook_set: !!ch.webhook, body_keys: ['text', 'image_url', 'alt_text'], image: plan.slides[0], text_chars: text.length, alt_text: result.alt_text || '' };
    writeJson(dryPath(ch), { ...plan, dry_run: true, text_start: text.slice(0, 120), payload, stopped_before: ch.via === 'postiz' ? 'Postiz upload' : 'Make webhook', at: NOW.toISOString() });
    log('DRY RUN', ch.name + ':', 'would send', plan.slides.length, 'slide(s) from', from, 'and', text.length, 'chars from', ch.text, 'via', ch.via + '. Stopped before any external call.');
    return { channel: ch.name, state: 'dry_run' };
  }
  if (ch.via === 'postiz' && !POSTIZ_KEY) throw new Error('POSTIZ_API_KEY missing');

  // Written before the first external call: if anything below crashes, this channel is never posted again automatically.
  writeJson(pubPath, { ...plan, state: 'creating', started_at: new Date().toISOString() });
  commitNow(`publish start ${DATE} ${ch.name}`);
  try {
    return ch.via === 'make' ? await viaMake(ch, plan, text, jpgs, all, result, pubPath) : await viaPostiz(ch, plan, text, jpgs, all, pubPath);
  } catch (e) {
    const prev = readJson(pubPath, {});
    const created = prev.postiz_post_id || prev.request_sent;
    writeJson(pubPath, { ...prev, state: created ? 'unknown' : 'failed', error: String(e.message || e).slice(0, 300), failed_at: new Date().toISOString() });
    const where = ch.name === 'instagram' ? '' : ch.label + ' ';
    const retry = prev.postiz_post_id ? 'Postiz has the post already: check post.kineticxhub.com, do not retry.'
      : prev.request_sent ? 'The request may have reached Make: check the LinkedIn page, do not retry.'
      : `Nothing reached ${ch.label}. To retry, run the publish workflow with retry = true.`;
    await reply(`${where}Not posted (${DATE}): ${String(e.message || e).slice(0, 300)}\n${retry}`);
    throw e;
  }
}

async function viaPostiz(ch, plan, text, jpgs, all, pubPath) {
  const uploaded = await uploads(all);
  const images = uploaded.filter((_, i) => jpgs.includes(all[i]));
  const created = await postiz('POST', '/posts', {
    type: 'now', date: new Date().toISOString(), shortLink: false, tags: [],
    posts: [{ integration: { id: ch.integration }, value: [{ content: text, image: images }], settings: ch.settings }],
  });
  const postId = created?.[0]?.postId;
  writeJson(pubPath, { ...plan, state: 'queued', postiz_post_id: postId, queued_at: new Date().toISOString() });
  log(ch.name, 'queued in Postiz', postId);

  let post = null;
  const day = NOW.toISOString().slice(0, 10);
  for (let k = 0; k < 20; k++) { // about 5 minutes
    await sleep(Number(process.env.POLL_MS || 15000));
    const list = await postiz('GET', `/posts?startDate=${day}T00:00:00.000Z&endDate=${day}T23:59:59.000Z`);
    post = (list.posts || []).find((p) => p.id === postId);
    if (post && (post.releaseURL || post.state === 'ERROR' || post.error)) break;
  }
  const final = { ...plan, state: post?.state || 'unknown', postiz_post_id: postId, release_url: post?.releaseURL || null,
    release_id: post?.releaseId || null, error: post?.error || null, finished_at: new Date().toISOString() };
  writeJson(pubPath, final);
  const where = ch.name === 'instagram' ? '' : ch.label + ' ';
  await reply(final.release_url ? `${where}Posted: ${final.release_url}`
    : `${where}Not confirmed. Postiz state ${final.state}${final.error ? ', error: ' + final.error : ''}. Check post.kineticxhub.com before retrying.`);
  log(ch.name, 'final', final.state, final.release_url || final.error || '');
  return { channel: ch.name, state: final.state, status: final.release_url ? 'Posted ' + final.release_url : 'Publish attempted, state ' + final.state };
}

// Make answers a webhook with plain "Accepted" and no post id or link, so this is never reported as posted.
async function viaMake(ch, plan, text, jpgs, all, result, pubPath) {
  const uploaded = await uploads(all);
  const cover = uploaded[all.indexOf(jpgs[0])];
  if (!cover?.path) throw new Error('no uploaded cover image to send to Make');
  const body = { text, image_url: publicUrl(cover.path), alt_text: result.alt_text || '' };
  writeJson(pubPath, { ...plan, state: 'sending', image_url: body.image_url, request_sent: true, sent_at: new Date().toISOString() });
  const r = await fetch(ch.webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const answer = (await r.text()).trim();
  if (!r.ok) {
    // Make refused the request, so nothing was queued: this one may be retried.
    writeJson(pubPath, { ...plan, state: 'failed', image_url: body.image_url, request_sent: false, http: r.status, answer: answer.slice(0, 200), failed_at: new Date().toISOString() });
    throw new Error(`Make webhook HTTP ${r.status} ${answer.slice(0, 120)}`);
  }
  const state = /^accepted$/i.test(answer) ? 'sent_unconfirmed' : 'unknown';
  writeJson(pubPath, { ...plan, state, image_url: body.image_url, request_sent: true, http: r.status, answer: answer.slice(0, 200), finished_at: new Date().toISOString() });
  await reply(`${ch.label}: sent to Make (${answer.slice(0, 40) || 'empty reply'}), not confirmed. Make returns no post link; check the page.`);
  log(ch.name, state, answer.slice(0, 60));
  return { channel: ch.name, state, status: 'sent to Make, not confirmed' };
}

function commitNow(msg) {
  if (!process.env.GITHUB_ACTIONS) return;
  const sh = (c) => spawnSync('bash', ['-c', c], { cwd: ROOT, encoding: 'utf8' });
  sh(`git add runs/ && (git diff --cached --quiet || git commit -m "${msg}") && git pull --rebase --autostash origin main && git push origin HEAD:main`);
}

// ------------------------------------------------------------------ main

async function main() {
  if (!chat_id && !TG_OFF) throw new Error('TELEGRAM_CHAT_ID missing');
  const n = await readTaps();
  log('updates read', n);

  const result = readJson(join(RUN, 'result.json'));
  if (!result || result.status !== 'ready') { log('no ready carousel for', DATE); return; }
  const CHANNELS = loadChannels();
  const texts = readJson(join(RUN, 'channel-texts.json'), {});
  const retryable = (rec) => RETRY && rec.state === 'failed' && !rec.postiz_post_id && !rec.request_sent;
  const pending = CHANNEL_ORDER.map((k) => CHANNELS[k]).filter(Boolean).filter((ch) => {
    const rec = readJson(recordPath(ch));
    return !rec || retryable(rec);
  });
  // Instagram's publish.json also records a Skip, which closes the day for every channel.
  const ig = readJson(join(RUN, 'publish.json'));
  if (ig?.state === 'skipped' || !pending.length) { log('already handled', DATE, ig?.state || ''); return; }

  const decision = readJson(join(RUN, 'decision.json'));
  const hour = NOW.getUTCHours();
  if (!decision) {
    if (hour >= EXPIRE_HOUR_UTC) {
      writeJson(join(RUN, 'decision.json'), { date: DATE, action: 'expired', at: NOW.toISOString() });
      await editControl(DATE, 'Not posted: no tap by 19:30 IST.', false);
      log('expired', DATE);
    } else log('waiting for a tap on', DATE);
    return;
  }
  const by = decision.approved_by?.name ? ' by ' + decision.approved_by.name : '';
  if (decision.action === 'skip') { await editControl(DATE, 'Skipped' + by + '. Not posted.', false); writeJson(join(RUN, 'publish.json'), { date: DATE, state: 'skipped', at: NOW.toISOString() }); return; }
  if (decision.action !== 'publish') { log('decision', decision.action); return; }
  if (decision.test && !DRY) throw new Error('decision.json is a TEST decision; refusing to publish for real');
  if (hour < PUBLISH_HOUR_UTC && !DRY) { await editControl(DATE, 'Approved' + by + '. Publish queued for 19:30 IST.', true); log('publish queued, waiting for', PUBLISH_HOUR_UTC + ':00 UTC'); return; }

  const outcome = {};
  const skipped = {};
  let failed = 0;
  for (const ch of pending) {
    const why = skipReason(ch, texts);
    if (why) { skipped[ch.name] = why; log('skip', ch.name + ':', why); continue; }
    try { outcome[ch.name] = await runChannel(ch, result, texts); } catch (e) {
      failed++;
      outcome[ch.name] = { channel: ch.name, state: 'error', status: 'failed: ' + String(e.message || e).slice(0, 120) };
      console.error('[publish]', ch.name, 'failed:', String(e.message || e));
    }
  }
  // Rewritten only when something changed, so the hourly runs after a post don't commit the same skip list again.
  const summaryPath = join(RUN, DRY ? 'channels.dryrun.json' : 'channels.json');
  const prev = readJson(summaryPath, {});
  if (Object.keys(outcome).length || JSON.stringify(prev.skipped) !== JSON.stringify(skipped)) {
    writeJson(summaryPath, { date: DATE, at: NOW.toISOString(), dry_run: DRY, acted: { ...(prev.acted || {}), ...outcome }, skipped });
  }

  if (Object.values(outcome).some((o) => o.state !== 'dry_run')) {
    const done = Object.fromEntries(CHANNEL_ORDER.map((k) => [k, readJson(recordPath({ name: k }))]).filter(([, r]) => r));
    const lines = CHANNEL_ORDER.filter((k) => CHANNELS[k]).map((k) => `${CHANNELS[k].label}: ` + (outcome[k]?.status
      || (done[k] ? (done[k].release_url ? 'Posted ' + done[k].release_url : 'state ' + done[k].state) : 'not sent (' + (skipped[k] || 'not attempted') + ')')));
    await editControl(DATE, '\n' + lines.join('\n'), false);
  }
  if (failed) process.exitCode = 1;
}

main().catch((e) => { console.error('[publish] failed:', String(e.message || e)); process.exitCode = 1; });
