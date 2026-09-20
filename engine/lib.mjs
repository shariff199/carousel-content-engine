// Shared helpers for the daily carousel engine: rules lint, Gemini, article facts, Telegram.
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
export const RULES = require(join(ROOT, 'engine/rules/content-rules.js'));

export const HANDLE = '@blackarrowtech';
export const MODEL = 'gemini-3.6-flash';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ lint

// Keys in component data that are layout switches, not reader-facing copy.
const NON_COPY_KEYS = new Set(['icon', 'theme', 'state', 'kind', 'from', 'ticks', 'monogram', 'status', 'numbered',
  'ring', 'typing', 'height', 'width', 'caret', 'alt', 'x', 'y']);

function copyStrings(v, key, out) {
  if (v == null) return out;
  if (typeof v === 'string') {
    // clock times on a timeline (0:10, 9:38 PM) are labels, not statistics
    if (!NON_COPY_KEYS.has(key)) out.push(v.replace(/\b\d{1,2}:\d{2}\b(\s?[AP]M)?/g, 'TIME'));
    return out;
  }
  if (typeof v === 'number' || typeof v === 'boolean') return out;
  if (Array.isArray(v)) { v.forEach((x) => copyStrings(x, key, out)); return out; }
  for (const [k, x] of Object.entries(v)) copyStrings(x, k, out);
  return out;
}

// A rendered carousel as the rules module sees an Instagram piece:
// slides = the main line of each slide (cover text, body text, closing text),
// content = everything else a reader sees (titles, notes, component copy, sources).
export function pieceFromSpec(spec, caption, hashtags) {
  const slides = [];
  const extra = [];
  for (const s of spec.slides) {
    const main = s.role === 'cover' ? [s.text, s.dim].filter(Boolean).join(' ') : (s.text || s.title || '');
    slides.push(main);
    for (const k of ['title', 'note']) if (s[k] && s[k] !== main) extra.push(s[k]);
    copyStrings(s.data, '', extra);
  }
  return {
    platform: 'instagram', type: 'carousel', template: String(spec.template || '').toUpperCase(),
    slides, content: extra.join('\n'), caption: caption || '', hashtags: hashtags || [],
  };
}

export function lintSpec(spec, caption, hashtags, facts) {
  return RULES.lintPiece(pieceFromSpec(spec, caption, hashtags), facts);
}

// ------------------------------------------------------------------ article facts

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
export const humanDate = (iso) => { const d = new Date(iso); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };

const HOST_NAMES = {
  'openai.com': 'OpenAI', 'blog.google': 'Google', 'deepmind.google': 'Google DeepMind', 'news.microsoft.com': 'Microsoft',
  'developers.facebook.com': 'Meta', 'blogs.nvidia.com': 'NVIDIA', 'aws.amazon.com': 'AWS', 'apple.com': 'Apple',
  'huggingface.co': 'Hugging Face', 'salesforce.com': 'Salesforce', 'hubspot.com': 'HubSpot', 'zapier.com': 'Zapier',
  'techcrunch.com': 'TechCrunch', 'theverge.com': 'The Verge', 'wired.com': 'Wired', 'technologyreview.com': 'MIT Technology Review',
  'arstechnica.com': 'Ars Technica', 'theguardian.com': 'The Guardian', 'bbc.co.uk': 'BBC', 'bbc.com': 'BBC',
  'therundown.ai': 'The Rundown AI', 'inc.com': 'Inc.', 'entrepreneur.com': 'Entrepreneur', 'macrumors.com': 'MacRumors',
  'reuters.com': 'Reuters', 'bloomberg.com': 'Bloomberg', 'cnbc.com': 'CNBC', 'axios.com': 'Axios', '9to5mac.com': '9to5Mac',
  'anthropic.com': 'Anthropic', 'businessinsider.com': 'Business Insider', 'nytimes.com': 'The New York Times',
};
export function publicationOf(url) {
  let h = '';
  try { h = new URL(url).hostname.replace(/^www\./, ''); } catch { return 'the publisher'; }
  for (const [k, v] of Object.entries(HOST_NAMES)) if (h === k || h.endsWith('.' + k)) return v;
  const base = h.split('.').slice(-2, -1)[0] || h;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

export async function fetchArticle(url, { tries = 3, timeoutMs = 45000 } = {}) {
  let last;
  for (let k = 0; k < tries; k++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch('https://r.jina.ai/' + url, { signal: ctl.signal, headers: { 'X-Return-Format': 'text' } });
      const text = await r.text();
      if (r.ok && text.length > 600) return text.replace(/\r/g, '');
      last = new Error('reader HTTP ' + r.status + ', ' + text.length + ' chars');
    } catch (e) { last = e; } finally { clearTimeout(t); }
    await sleep(3000 * (k + 1));
  }
  throw last;
}

// Every number that literally appears in the article becomes a confirmed news fact, so the
// rules let the model use exactly those numbers and nothing else.
const NUM_RE = /(?:US\$|\$|€|£)?\d[\d,]*(?:\.\d+)?(?:\s?(?:%|percent|k|m|bn|million|billion|thousand|x)\b|%)?/gi;
export function newsFacts(articleText, { url, publication, dateIso }) {
  const forms = new Set();
  for (const m of articleText.matchAll(NUM_RE)) {
    const raw = m[0].trim().replace(/[,.]+$/, '');
    if (!/\d/.test(raw)) continue;
    forms.add(raw);
    const bare = raw.replace(/^(?:US\$|\$|€|£)/, '').replace(/\s?(?:%|percent|k|m|bn|million|billion|thousand|x)$/i, '').trim();
    if (bare) forms.add(bare);
    if (/percent$/i.test(raw)) forms.add(bare + '%');
  }
  return {
    id: 'news.article', claim: 'Figures reported in ' + publication, forms: [...forms].slice(0, 400),
    status: 'confirmed', public: true, usage: 'news', source: publication + ' ' + url,
    source_date: String(dateIso).slice(0, 10), review_by: '2099-12-31',
  };
}

export function loadFacts(extra = []) {
  const base = JSON.parse(readFileSync(join(ROOT, 'engine/rules/facts.base.json'), 'utf8'));
  base.facts = [...base.facts, ...extra];
  return base;
}

// ------------------------------------------------------------------ Gemini

// Pinned model ids, never a -latest alias (the 14-24 Aug outage). The fallback only runs when the
// first model is overloaded (429/503) after its retries.
export const MODELS = (process.env.GEMINI_MODELS || 'gemini-3.6-flash,gemini-3.5-flash').split(',').map((m) => m.trim()).filter(Boolean);
// Last resort when both flash models stay overloaded for several minutes (seen 14 Sept at 15:40 UTC).
export const LAST_RESORT = process.env.GEMINI_LAST_RESORT || 'gemini-3.5-flash-lite';

const overloaded = (e) => /HTTP (429|5\d\d)|no text|fetch failed|aborted|ECONNRESET/i.test(String(e.message));

export async function gemini(prompt, opts = {}) {
  let last;
  const exhausted = new Set();
  for (let round = 0; round < 3; round++) {
    for (const model of MODELS) {
      if (exhausted.has(model)) continue;
      try { return await geminiOne(prompt, { ...opts, model, tries: 2 }); } catch (e) {
        last = e;
        if (/daily quota/.test(String(e.message))) exhausted.add(model);
        if (!overloaded(e)) throw e;
        console.log('[gemini] round', round + 1, model, 'unavailable:', String(e.message).slice(0, 80));
      }
    }
    await sleep(30000 * (round + 1));
  }
  console.log('[gemini] falling back to', LAST_RESORT);
  try { return await geminiOne(prompt, { ...opts, model: LAST_RESORT, tries: 3 }); } catch (e) { throw overloaded(e) ? last : e; }
}

async function geminiOne(prompt, { key = (process.env.GEMINI_API_KEY || '').trim(), temperature = 0.7, model = MODEL, tries = 4 } = {}) {
  if (!key) throw new Error('GEMINI_API_KEY missing');
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', temperature },
  };
  let last;
  for (let k = 0; k < tries; k++) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      // A daily quota 429 will not clear by waiting: skip this model at once (free tier is 20 requests/day per model).
      if (r.status === 429 && /quota/i.test(j.error?.message || '')) throw new Error('Gemini HTTP 429 daily quota used up for ' + model);
      if (r.status === 429 || r.status >= 500) { last = new Error('Gemini HTTP ' + r.status + ' ' + (j.error?.message || '')); await sleep(10000 * (k + 1)); continue; }
      if (!r.ok) throw new Error('Gemini HTTP ' + r.status + ' ' + (j.error?.message || ''));
      const parts = j.candidates?.[0]?.content?.parts || [];
      const text = parts.filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('');
      if (!text) { last = new Error('Gemini returned no text, finish ' + j.candidates?.[0]?.finishReason); await sleep(5000); continue; }
      return { json: parseJsonLoose(text), model: j.modelVersion, usage: j.usageMetadata };
    } catch (e) {
      last = e;
      if (/HTTP 4\d\d/.test(String(e.message)) && !/429/.test(String(e.message))) throw e;
      if (/daily quota/.test(String(e.message))) throw e;
      await sleep(5000 * (k + 1));
    }
  }
  throw last;
}

function parseJsonLoose(text) {
  try { return JSON.parse(text); } catch {}
  const m = text.match(/\{[\s\S]*\}/);
  if (m) return JSON.parse(m[0]);
  throw new Error('Gemini output is not JSON: ' + text.slice(0, 200));
}

// ------------------------------------------------------------------ Telegram

export async function telegram(method, payload, { token = (process.env.TELEGRAM_BOT_TOKEN || '').trim() } = {}) {
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN missing');
  const isForm = payload instanceof FormData;
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', body: isForm ? payload : JSON.stringify(payload),
    headers: isForm ? undefined : { 'Content-Type': 'application/json' },
  });
  const j = await r.json().catch(() => ({ ok: false, description: 'non-JSON reply HTTP ' + r.status }));
  if (!j.ok) throw new Error(`Telegram ${method} failed: ${j.description}`);
  return j.result;
}

export const fileExists = existsSync;
