// Who may approve a post, and the tap format the Cloudflare clock passes to publish.yml.
// No Node imports: clock/worker.js bundles this file too, so the Worker and the publisher apply one rule.
//
// Approver rule:
// - the tap must come from TELEGRAM_CHAT_ID (the approvals group, or Tauheed's private chat)
// - TELEGRAM_APPROVER_IDS set (comma-separated Telegram user ids): the tapper must be one of them
// - not set: the old private-chat rule, the tapper's user id must equal the chat id

export const PUBLISH_HOUR_UTC = 14; // 19:30 IST
export const EXPIRE_HOUR_UTC = 16;

export function parseApprovers(raw) {
  return new Set(String(raw || '').split(',').map((s) => s.trim()).filter((s) => /^\d{1,15}$/.test(s)));
}

export function isApprover({ chatId, fromId, envChatId, approverIds }) {
  const chat = String(envChatId || '').trim();
  if (!chat || String(chatId ?? '') !== chat) return false;
  const from = String(fromId ?? '');
  if (!/^\d{1,15}$/.test(from)) return false;
  const approvers = approverIds instanceof Set ? approverIds : parseApprovers(approverIds);
  return approvers.size ? approvers.has(from) : from === chat;
}

// Keeps a Telegram display name safe to carry through a workflow input and a JSON record.
export function displayName(from = {}) {
  const raw = from.username ? '@' + from.username : [from.first_name, from.last_name].filter(Boolean).join(' ');
  return String(raw || 'unknown').replace(/[^A-Za-z0-9 _.@-]/g, '').trim().slice(0, 40) || 'unknown';
}

// Button data written by telegram-preview.mjs: pub:YYYY-MM-DD or skip:YYYY-MM-DD
export function parseButton(data) {
  const m = /^(pub|skip):(\d{4}-\d{2}-\d{2})$/.exec(String(data || ''));
  return m ? { action: m[1] === 'pub' ? 'publish' : 'skip', date: m[2] } : null;
}

// publish.yml input `tap`: <action>:<date>:<from_id>:<name>
const TAP_RE = /^(publish|skip):(\d{4}-\d{2}-\d{2}):(\d{1,15}):([A-Za-z0-9 _.@-]{0,40})$/;

export function formatTap({ action, date, fromId, name }) {
  const s = `${action}:${date}:${fromId}:${String(name || '').replace(/[^A-Za-z0-9 _.@-]/g, '').slice(0, 40)}`;
  if (!TAP_RE.test(s)) throw new Error('tap does not match the format: ' + s.slice(0, 80));
  return s;
}

export function parseTap(raw) {
  const m = TAP_RE.exec(String(raw || ''));
  if (!m) return null;
  const d = new Date(m[2] + 'T00:00:00Z');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== m[2]) return null;
  return { action: m[1], date: m[2], fromId: m[3], name: m[4] || 'unknown' };
}

// What the Worker tells the tapper straight away.
export function tapAnswer({ action, date, now, decision }) {
  const today = now.toISOString().slice(0, 10);
  if (decision && ['publish', 'skip'].includes(decision.action)) {
    return { text: `Already ${decision.action === 'publish' ? 'approved' : 'skipped'} by ${decision.approved_by?.name || 'someone'}.`, dispatch: false };
  }
  if (decision?.action === 'expired' || date < today) return { text: `Too late: ${date} has expired.`, dispatch: false };
  if (date > today) return { text: `That preview is for ${date}, not today.`, dispatch: false };
  if (action === 'skip') return { text: 'Skipped. Not posted.', dispatch: true };
  const h = now.getUTCHours();
  if (h >= EXPIRE_HOUR_UTC) return { text: 'Too late for today.', dispatch: false };
  if (h >= PUBLISH_HOUR_UTC) return { text: 'Publishing now.', dispatch: true };
  return { text: 'Queued for 19:30 IST.', dispatch: true };
}
