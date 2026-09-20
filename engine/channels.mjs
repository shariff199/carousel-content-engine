// Channel config and the per-channel text rules. Shared by generate.mjs, telegram-preview.mjs and publish.mjs.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, RULES } from './lib.mjs';

export function loadChannels(file = process.env.CHANNELS_FILE || join(ROOT, 'engine/channels.json')) {
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const out = {};
  for (const [name, c] of Object.entries(raw)) {
    if (name.startsWith('_')) continue;
    const integration = String((c.integration_env && process.env[c.integration_env]) || c.integration || '').trim() || null;
    const webhook = c.webhook_env ? String(process.env[c.webhook_env] || '').trim() || null : null;
    out[name] = { name, ...c, integration, webhook };
  }
  return out;
}

// Texts the writer produces for channels other than Instagram, and the rules shape each is linted as.
export const CHANNEL_TEXTS = {
  x_text: { platform: 'x', type: 'tweet' },
  linkedin_text: { platform: 'linkedin-page', type: 'image' },
};

// Lints x_text and linkedin_text with the same rules module as the carousel (truth, numbers, banned
// words, links, per-platform length and hashtag limits). Curly quotes are straightened, as for captions.
export function lintChannelTexts(texts, facts) {
  const out = {};
  for (const [key, shape] of Object.entries(CHANNEL_TEXTS)) {
    let text = String(texts?.[key] || '').trim();
    if (!text) { out[key] = { text: '', ok: false, errors: [key + ' missing'], warnings: [] }; continue; }
    let res = RULES.lintPiece({ ...shape, template: null, content: text }, facts);
    if (res.fixed?.content !== undefined) { text = res.fixed.content.trim(); res = RULES.lintPiece({ ...shape, template: null, content: text }, facts); }
    out[key] = {
      text, ok: res.ok, metrics: res.metrics,
      errors: res.errors.map((e) => `${e.rule} ${key}: ${e.message}${e.excerpt ? ' | "' + e.excerpt + '"' : ''}`),
      warnings: res.warnings.map((e) => `${e.rule}: ${e.message}`),
    };
  }
  return out;
}

// Why a channel will not get today's post, or null when it will.
export function skipReason(ch, texts) {
  if (!ch.enabled) return 'off: ' + (ch.off_because || 'disabled in engine/channels.json');
  if (ch.via === 'postiz' && !ch.integration) return 'not connected: no Postiz integration id';
  if (ch.via === 'make' && !ch.webhook) return 'not connected: ' + ch.webhook_env + ' is not set';
  if (ch.text !== 'caption') {
    const t = texts?.[ch.text];
    if (!t) return 'no ' + ch.text + ' on record for this day';
    if (!t.ok) return ch.text + ' failed the rules: ' + (t.errors || []).slice(0, 2).join('; ');
  }
  return null;
}
