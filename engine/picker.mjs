#!/usr/bin/env node
// Topic picker: one Gemini call ranks the radar's top topics for BAT's Instagram followers
// (small-business owners and teams worldwide). The radar scores by keywords; this step asks
// "would an owner save or share this?". Added 14 Sept after the radar's #1 pick was a
// GeForce RTX / 24GB VRAM story that matters to few small businesses.
//
//   node engine/picker.mjs --trends runs/2026-09-14/news-trends.json [--date 2026-09-14]   (one live Gemini call)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gemini } from './lib.mjs';

// Politics and personal feuds get the lowest engagement in the page study (0.72x) and are off-brand.
export const POLITICS_RE = /\b(trump|biden|white house|president|senat\w*|congress\w*|democrat\w*|republican\w*|election|lawmakers?|regulat\w*|lawsuit|sues|slams?|feud)\b/i;
export const AGGREGATOR_RE = /techmeme\.com|news\.ycombinator\.com|hnrss\.org|news\.google\.com/i;
const MAX_CANDIDATES = 8;

export function overlap(a, b) {
  const A = new Set(String(a).toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  const B = new Set(String(b).toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  let i = 0; for (const x of A) if (B.has(x)) i++;
  return i / Math.max(1, Math.min(A.size, B.size));
}

// The radar's top topics that are allowed at all: readable source, not politics, not posted in 14 days.
export function candidatesFrom(radar, recent = []) {
  const usedUrls = new Set(recent.map((r) => r.url).filter(Boolean));
  const usedTopics = recent.map((r) => String(r.topic || ''));
  return (radar.trends || [])
    .filter((t) => t.score >= 7 && t.evidence?.length)
    .filter((t) => !POLITICS_RE.test(t.topic))
    .filter((t) => t.evidence.some((e) => !AGGREGATOR_RE.test(e.url)))
    .filter((t) => !t.evidence.some((e) => usedUrls.has(e.url)))
    .filter((t) => !usedTopics.some((u) => u && overlap(u, t.topic) >= 0.5))
    .slice(0, MAX_CANDIDATES);
}

export function pickerPrompt(candidates, plan) {
  const allowed = plan.templates.map((t) => t.toUpperCase()).join(' or ');
  const list = candidates.map((t, i) => {
    const ev = t.evidence.filter((e) => !AGGREGATOR_RE.test(e.url));
    return `${i}. ${t.topic}\n   sources: ${ev.map((e) => e.source).join(', ')} | radar score ${t.score} | tags ${(t.tags || []).join(', ')}`;
  }).join('\n');
  return [
    'You are the editor of @blackarrowtech, an Instagram page for small-business owners and their teams worldwide',
    '(shops, clinics, agencies, restaurants, trades, consultants, online sellers). The page explains AI and tech news in plain words',
    'and says what an owner can do this week without buying anything. Posts are carousels people save and send to their team.',
    '',
    'Pick today\'s story from these headlines. The test: would a busy small-business owner save this or send it to a colleague?',
    'Good: a tool they already use (WhatsApp, Gmail, Google, Microsoft 365, Shopify, Canva, Zapier, ChatGPT) gains something useful;',
    'AI that answers customers, books, follows up, writes, or saves admin time; a company move an owner can copy; a clear risk they should act on.',
    'Reject: hardware or GPU specs, developer-only or research news, funding and acquisitions, stock market news, policy, politics, lawsuits,',
    'safety debates, event promotions, listicles of tools, anything that needs a new device or a big budget to matter.',
    '',
    'Headlines:',
    list,
    '',
    `Allowed templates today: ${allowed}. T1 = a real company did something with AI and what an owner can copy. T3 = an AI launch or change explained, with what to do this week.`,
    '',
    'Return JSON only:',
    '{"ranking": [{"index": 0, "template": "T3", "reason": "why an owner would save it, one sentence", "angle": "the one practical takeaway the carousel should build to"}],',
    ' "rejected": [{"index": 1, "reason": "few words"}]}',
    'ranking holds at most 3 acceptable stories, best first. If none would make an owner save the post, return an empty ranking.',
  ].join('\n');
}

export async function pickTopic(candidates, plan) {
  if (!candidates.length) return { ranking: [], rejected: [], note: 'no candidates' };
  const g = await gemini(pickerPrompt(candidates, plan), { temperature: 0.2 });
  const allowed = plan.templates.map((t) => t.toLowerCase());
  const ranking = (Array.isArray(g.json.ranking) ? g.json.ranking : [])
    .filter((r) => Number.isInteger(r.index) && candidates[r.index])
    .slice(0, 3)
    .map((r) => {
      const t = String(r.template || '').toLowerCase();
      return { index: r.index, topic: candidates[r.index].topic, template: allowed.includes(t) ? t : allowed[allowed.length - 1],
        reason: String(r.reason || ''), angle: String(r.angle || '') };
    });
  const rejected = (Array.isArray(g.json.rejected) ? g.json.rejected : [])
    .filter((r) => candidates[r.index]).map((r) => ({ topic: candidates[r.index].topic, reason: String(r.reason || '') }));
  return { ranking, rejected, model: g.model };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const arg = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
  const radar = JSON.parse(readFileSync(arg('--trends'), 'utf8'));
  const date = arg('--date', new Date().toISOString().slice(0, 10));
  const day = new Date(date + 'T12:00:00Z').getUTCDay();
  const templates = { 1: ['t3'], 3: ['t1', 't3'], 5: ['t3'], 0: ['t1', 't3'] }[day] || ['t1', 't3'];
  const cands = candidatesFrom(radar);
  console.log('candidates:'); cands.forEach((c, i) => console.log(' ', i, c.score, c.topic));
  pickTopic(cands, { templates }).then((r) => console.log(JSON.stringify(r, null, 2))).catch((e) => { console.error(e); process.exitCode = 1; });
}
