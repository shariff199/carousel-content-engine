// The content engine's clock and tap handler.
//
// Clock: GitHub's own `schedule` trigger never fired for this repo (15 Sept 2026: 0 scheduled runs across the
// 10:00 and 11:05 slots), so this Worker starts daily.yml at 10:00 UTC and publish.yml hourly 11:05-16:05 UTC.
//
// Taps: with the Telegram webhook pointed here, a Publish / Skip tap is answered at once and publish.yml is
// started with the tap as an input, so a tap after 14:00 UTC posts within about a minute instead of waiting
// for the hourly run (whose answer Telegram had already expired).
//
// Secrets: GH_DISPATCH_TOKEN (fine-grained, this repo only: Actions write, Contents read), TELEGRAM_BOT_TOKEN,
// TELEGRAM_CHAT_ID (the approvals group), TELEGRAM_APPROVER_IDS (comma-separated user ids),
// TELEGRAM_WEBHOOK_SECRET (Telegram sends it back in X-Telegram-Bot-Api-Secret-Token).
import { isApprover, parseApprovers, parseButton, displayName, formatTap, tapAnswer } from '../engine/approvals.mjs';

const REPO = 'shariff199/bat-content-engine';
const GH = 'https://api.github.com/repos/' + REPO;

async function gh(env, method, path, body) {
  return fetch(GH + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + env.GH_DISPATCH_TOKEN,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'bat-engine-clock',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function tg(env, method, payload) {
  return fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

async function alert(env, text) {
  await tg(env, 'sendMessage', { chat_id: env.TELEGRAM_CHAT_ID, text: 'Engine clock: ' + text });
}

async function dispatch(env, workflow, inputs) {
  const r = await gh(env, 'POST', `/actions/workflows/${workflow}/dispatches`, { ref: 'main', inputs });
  if (!r.ok) {
    const msg = `could not start ${workflow}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`;
    console.log(msg);
    await alert(env, msg);
    return false;
  }
  console.log('started', workflow, JSON.stringify(inputs));
  return true;
}

async function publishWaiting(env) {
  const r = await gh(env, 'GET', '/actions/workflows/publish.yml/runs?per_page=10');
  if (!r.ok) return false; // can't tell: start the check anyway
  const j = await r.json().catch(() => ({}));
  return (j.workflow_runs || []).some((w) => ['queued', 'pending', 'waiting', 'requested'].includes(w.status));
}

export async function tick(cron, when, env) {
  const date = when.toISOString().slice(0, 10);
  if (cron === '0 10 * * *') return dispatch(env, 'daily.yml', {});

  // An alarm that does not depend on GitHub's scheduler: by 11:05 the preview must exist.
  if (when.getUTCHours() === 11) {
    const r = await gh(env, 'GET', `/contents/runs/${date}/telegram.json?ref=main`);
    if (r.status === 404) await alert(env, `no preview on record for ${date} by 11:05 UTC. Check the "daily carousel preview" run in GitHub Actions.`);
    else if (!r.ok) await alert(env, `could not check today's preview: HTTP ${r.status}`);
  }
  // GitHub keeps one pending run per concurrency group and cancels the older pending one. A waiting run may be
  // a tap forwarded by the webhook, which exists nowhere else, so the hourly check never queues behind it.
  if (await publishWaiting(env)) { console.log('publish.yml already waiting, hourly start skipped'); return true; }
  // Scheduled publish checks are real (not dry); publish.mjs still posts only after an approver's tap.
  return dispatch(env, 'publish.yml', { dry_run: 'false' });
}

// The day's decision as committed by publish.mjs, so a second tap is answered "Already approved by ...".
async function readDecision(env, date) {
  const r = await gh(env, 'GET', `/contents/runs/${date}/decision.json?ref=main`);
  if (!r.ok) return null;
  try {
    const j = await r.json();
    const d = JSON.parse(atob(String(j.content || '').replace(/\n/g, '')));
    return d && !d.test ? d : null;
  } catch { return null; }
}

export async function handleTap(update, env, now, waitUntil) {
  const cq = update?.callback_query;
  if (!cq) return;
  const answer = (text) => tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text });
  if (!isApprover({ chatId: cq.message?.chat?.id, fromId: cq.from?.id, envChatId: env.TELEGRAM_CHAT_ID, approverIds: parseApprovers(env.TELEGRAM_APPROVER_IDS) })) {
    console.log('tap refused: chat', cq.message?.chat?.id, 'user', cq.from?.id);
    return answer('Not allowed.');
  }
  const b = parseButton(cq.data);
  if (!b) return answer('This button is from the old engine and does nothing.');
  const decision = await readDecision(env, b.date);
  const a = tapAnswer({ action: b.action, date: b.date, now, decision });
  await answer(a.text);
  if (!a.dispatch) return;
  const tap = formatTap({ action: b.action, date: b.date, fromId: String(cq.from.id), name: displayName(cq.from) });
  waitUntil(dispatch(env, 'publish.yml', { dry_run: 'false', tap, date: b.date }));
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(tick(event.cron, new Date(event.scheduledTime), env));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/telegram') return new Response('not found', { status: 404 });
    if (!env.TELEGRAM_WEBHOOK_SECRET || request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.TELEGRAM_WEBHOOK_SECRET) {
      return new Response('unauthorized', { status: 401 });
    }
    let update;
    try { update = await request.json(); } catch { return new Response('ok'); }
    // Telegram retries on anything but 200, so errors are logged, never returned.
    try { await handleTap(update, env, new Date(), (p) => ctx.waitUntil(p)); } catch (e) { console.log('tap error:', String(e?.message || e)); }
    return new Response('ok');
  },
};
