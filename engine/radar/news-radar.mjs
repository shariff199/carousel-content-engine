#!/usr/bin/env node
// BAT news radar: free same-day AI and small-business news, worldwide, clustered and scored for BAT.
//
//   node news-radar.mjs [--hours 72] [--out ./out]
//
// Writes out/news-trends.json (read by the content engine) and out/news-digest.md (for a human).
// No dependencies. The scoring and clustering functions are plain JS so they can be pasted
// into an n8n Code node later; there the RSS fetch is done by n8n's own RSS node.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SOURCES = [
  // Worldwide audience. kind: official = the company announcing, media = reporting, business = small-business press
  { id: 'openai', url: 'https://openai.com/news/rss.xml', kind: 'official', weight: 3 },
  { id: 'google-ai', url: 'https://blog.google/technology/ai/rss/', kind: 'official', weight: 3 },
  { id: 'google-deepmind', url: 'https://deepmind.google/blog/rss.xml', kind: 'official', weight: 2 },
  { id: 'microsoft-ai', url: 'https://news.microsoft.com/source/topics/ai/feed/', kind: 'official', weight: 3 },
  { id: 'meta-developers', url: 'https://developers.facebook.com/blog/feed/', kind: 'official', weight: 3 },
  { id: 'nvidia', url: 'https://blogs.nvidia.com/feed/', kind: 'official', weight: 2 },
  { id: 'aws-ml', url: 'https://aws.amazon.com/blogs/machine-learning/feed/', kind: 'official', weight: 1 },
  { id: 'apple-newsroom', url: 'https://www.apple.com/newsroom/rss-feed.rss', kind: 'official', weight: 2 },
  { id: 'huggingface', url: 'https://huggingface.co/blog/feed.xml', kind: 'official', weight: 1 },
  { id: 'salesforce', url: 'https://www.salesforce.com/news/feed/', kind: 'official', weight: 1 },
  { id: 'hubspot', url: 'https://www.hubspot.com/company-news/rss.xml', kind: 'official', weight: 1 },
  { id: 'zapier', url: 'https://zapier.com/blog/feeds/latest/', kind: 'official', weight: 1 },
  { id: 'techcrunch-ai', url: 'https://techcrunch.com/category/artificial-intelligence/feed/', kind: 'media', weight: 2 },
  { id: 'verge-ai', url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', kind: 'media', weight: 2 },
  { id: 'wired-ai', url: 'https://www.wired.com/feed/tag/ai/latest/rss', kind: 'media', weight: 2 },
  { id: 'mit-tech-review-ai', url: 'https://www.technologyreview.com/topic/artificial-intelligence/feed', kind: 'media', weight: 2 },
  { id: 'ars-ai', url: 'https://arstechnica.com/ai/feed/', kind: 'media', weight: 1 },
  { id: 'guardian-ai', url: 'https://www.theguardian.com/technology/artificialintelligenceai/rss', kind: 'media', weight: 2 },
  { id: 'bbc-tech', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml', kind: 'media', weight: 1 },
  { id: 'techmeme', url: 'https://www.techmeme.com/feed.xml', kind: 'media', weight: 2 },
  { id: 'therundown', url: 'https://rss.beehiiv.com/feeds/2R3C6Bt5wj.xml', kind: 'media', weight: 2 },
  { id: 'hn-ai', url: 'https://hnrss.org/newest?q=AI+OR+LLM+OR+OpenAI+OR+Anthropic&points=100', kind: 'media', weight: 1 },
  { id: 'inc', url: 'https://www.inc.com/rss', kind: 'business', weight: 2 },
  { id: 'entrepreneur', url: 'https://www.entrepreneur.com/latest.rss', kind: 'business', weight: 1 },
];

// What makes a story useful to BAT's reader: owners and teams of small and mid-size businesses, worldwide.
const RELEVANCE = [
  { re: /\b(whatsapp|shopify|stripe|quickbooks|xero|hubspot|salesforce|zapier|make\.com|n8n|slack|notion|google workspace|microsoft 365|gmail|calendly|square|paypal)\b/i, pts: 5, tag: 'smb-tools' },
  { re: /\b(small business(?:es)?|smbs?|smes?|startups?|founders?|solopreneurs?|e-?commerce|local business(?:es)?|agencies)\b/i, pts: 5, tag: 'smb' },
  { re: /\b(agent|agents|agentic|automation|automate|workflow|chatbot|voice ai|customer support|copilot)\b/i, pts: 3, tag: 'automation' },
  { re: /\b(launch|launches|launched|releases?|released|introduc\w+|rolls? out|now available|unveil\w*|announc\w+)\b/i, pts: 3, tag: 'launch' },
  { re: /\b(price|pricing|free tier|cheaper|cost|subscription|per month)\b|\$\d/i, pts: 2, tag: 'pricing' },
  { re: /\b(openai|chatgpt|gpt-?\d|gemini|claude|anthropic|llama|deepseek|grok|mistral|perplexity|sora|veo|midjourney|nvidia)\b/i, pts: 2, tag: 'major-ai' },
  { re: /\b(website|seo|google search|ai overviews?|google business profile|ads|marketing)\b/i, pts: 2, tag: 'web' },
];
const NOISE = /\b(raises?|funding round|series [a-e]|valuation|ipo|go public|layoffs?|earnings|quarter(?:ly)? results|stocks?|shares? (?:rose|fell)|52-week|podcast|webinar|sponsored|opinion:|deal of the day|discount|coupon|cricket|football|soccer|nfl|nba|election|senator|parliament|celebrity|actor|actress|movie|trailer|fraud|prosecutors|charged|lawsuit|hangover|dating|horoscope|grants?|fellowships?|scholarships?|philanthrop\w*|nonprofits?|military|veterans|educators|awards?|named a leader|recogni[sz]ed|lawmakers|regulat\w*|congress|hearings?|legislat\w*|lobby\w*|super pac)\b/i;
// A story must hit at least one of these to be about BAT's world.
// 'smb' (founders, startups) only adds points: on its own it lets in fraud cases and yoga studios.
const CORE_TAGS = new Set(['smb-tools', 'automation', 'major-ai', 'web']);

const STOP = new Set('a an the and or of to in on for with from by at as is are was be it its this that new how why what your you our we can will just now into over after about more than their they has have not'.split(' '));

// ---------------------------------------------------------------------------- parsing
function decode(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&#8217;/g, "'")
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
function tag(block, name) {
  const m = block.match(new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>', 'i'));
  return m ? decode(m[1]) : '';
}
function parseFeed(xml, source) {
  const items = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks.slice(0, 60)) {
    let link = tag(b, 'link');
    if (!link) { const m = b.match(/<link[^>]*href="([^"]+)"/i); link = m ? m[1] : ''; }
    const date = new Date(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date'));
    const title = tag(b, 'title');
    if (!title || isNaN(date)) continue;
    items.push({ source: source.id, kind: source.kind, weight: source.weight, title, link, date: date.toISOString(),
      summary: (tag(b, 'description') || tag(b, 'summary') || tag(b, 'content')).slice(0, 400) });
  }
  return items;
}

// ---------------------------------------------------------------------------- scoring
export function tokens(title) {
  return new Set(title.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w)));
}
export function entities(text) {
  // Capitalised words and product-like tokens (GPT-6, Gemini, WhatsApp) - the thing a story is about.
  const m = text.match(/\b([A-Z][a-zA-Z0-9]+(?:[- ][A-Z0-9][a-zA-Z0-9.]*)?|[a-z]+-\d[\w.]*)\b/g) || [];
  return new Set(m.map(x => x.toLowerCase()).filter(x => !STOP.has(x) && x.length > 2));
}
function jaccard(a, b) {
  let i = 0; for (const x of a) if (b.has(x)) i++;
  return i / (a.size + b.size - i || 1);
}
export function relevance(item) {
  const text = item.title + ' ' + item.summary;
  let pts = 0; const tags = [];
  // A company's own feed naming its own product is not evidence that small businesses care (14 Sept: a Salesforce
  // fellowship press release ranked first). Strip the feed's own brand before the tool check.
  const own = new RegExp('\\b' + String(item.source || '').split('-')[0] + '\\w*', 'gi');
  const scored = item.kind === 'official' ? text.replace(own, ' ') : text;
  for (const r of RELEVANCE) if (r.re.test(scored)) { pts += r.pts; tags.push(r.tag); }
  if (NOISE.test(item.title)) { pts -= 4; tags.push('noise'); }
  return { pts, tags };
}
export function angleFor(tags, text) {
  // T1 business move · T2 saveable resource · T3 AI explained · T4 one belief
  if (tags.includes('smb-tools') && /\b(how to|guide|tips|template|feature|now lets|you can)\b/i.test(text)) return 'T2';
  if (tags.includes('smb') && !tags.includes('launch')) return 'T1';
  if (tags.includes('launch') || tags.includes('major-ai')) return 'T3';
  if (tags.includes('smb') || tags.includes('automation')) return 'T4';
  return 'T3';
}
export function cluster(items) {
  const clusters = [];
  for (const it of items) {
    it._tok = tokens(it.title); it._ent = entities(it.title);
    let best = null, bestScore = 0;
    for (const c of clusters) {
      const s = Math.max(jaccard(it._tok, c.tok), [...it._ent].filter(e => c.ent.has(e)).length >= 2 ? 0.5 : 0);
      if (s > bestScore) { best = c; bestScore = s; }
    }
    if (best && bestScore >= 0.4) { best.items.push(it); for (const t of it._tok) best.tok.add(t); for (const e of it._ent) best.ent.add(e); }
    else clusters.push({ items: [it], tok: new Set(it._tok), ent: new Set(it._ent) });
  }
  return clusters;
}
export function scoreCluster(c, now = Date.now()) {
  const lead = c.items.slice().sort((a, b) => b.weight - a.weight || new Date(a.date) - new Date(b.date))[0];
  const newest = Math.max(...c.items.map(i => new Date(i.date).getTime()));
  const hours = (now - newest) / 3.6e6;
  const sources = new Set(c.items.map(i => i.source));
  const rel = c.items.map(relevance).reduce((acc, r) => ({ pts: Math.max(acc.pts, r.pts), tags: [...new Set([...acc.tags, ...r.tags])] }), { pts: -99, tags: [] });
  const official = c.items.some(i => i.kind === 'official');
  // One company announcing something nobody else has picked up yet is a press release, not a trend.
  const lonePR = sources.size === 1 && official && !rel.tags.includes('major-ai') ? -3 : 0;
  const recency = Math.max(0, 24 - hours) / 4;           // 0..6, fades to 0 after a day
  const spread = (sources.size - 1) * 3;                  // same story in several outlets = trend
  const score = Math.round((rel.pts + recency + spread + (official ? 2 : 0) + lonePR + lead.weight) * 10) / 10;
  const text = c.items.map(i => i.title + ' ' + i.summary).join(' ');
  return {
    topic: lead.title,
    score,
    why_now: `${sources.size} source(s), newest ${hours.toFixed(0)}h ago${official ? ', official announcement' : ''}`,
    tags: rel.tags,
    suggested_template: angleFor(rel.tags, text),
    sources_count: sources.size,
    evidence: c.items.slice(0, 5).map(i => ({ source: i.source, title: i.title, url: i.link, date: i.date })),
    first_seen: new Date(Math.min(...c.items.map(i => new Date(i.date).getTime()))).toISOString(),
    expires: new Date(newest + 72 * 3.6e6).toISOString(),
    kind: 'news',
  };
}

// ---------------------------------------------------------------------------- main
async function fetchText(url) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'user-agent': 'Mozilla/5.0 (BAT trend radar)' }, redirect: 'follow' });
    return r.ok ? await r.text() : Promise.reject(new Error('HTTP ' + r.status));
  } finally { clearTimeout(t); }
}

async function main() {
  const args = process.argv.slice(2);
  const hours = Number(args[args.indexOf('--hours') + 1]) || 72;
  const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : new URL('./out', import.meta.url).pathname;
  const cutoff = Date.now() - hours * 3.6e6;

  const health = [];
  const all = [];
  await Promise.all(SOURCES.map(async s => {
    try {
      const items = parseFeed(await fetchText(s.url), s).filter(i => new Date(i.date).getTime() >= cutoff);
      all.push(...items); health.push({ source: s.id, ok: true, items: items.length });
    } catch (e) { health.push({ source: s.id, ok: false, error: String(e.message || e) }); }
  }));

  const trends = cluster(all).map(c => scoreCluster(c)).filter(t => t.score >= 6 && !t.tags.includes('noise') && t.tags.some(x => CORE_TAGS.has(x)))
    .sort((a, b) => b.score - a.score).slice(0, 20);

  mkdirSync(out, { recursive: true });
  const payload = { generated_at: new Date().toISOString(), window_hours: hours, sources: health, items_seen: all.length, trends };
  writeFileSync(join(out, 'news-trends.json'), JSON.stringify(payload, null, 2));
  const md = ['# BAT news radar ' + payload.generated_at.slice(0, 16).replace('T', ' ') + ' UTC', '',
    `${all.length} items from ${health.filter(h => h.ok).length}/${SOURCES.length} sources, last ${hours}h. Failed: ${health.filter(h => !h.ok).map(h => h.source).join(', ') || 'none'}.`, '',
    '| # | Score | Template | Sources | Topic |', '|---|---|---|---|---|',
    ...trends.map((t, i) => `| ${i + 1} | ${t.score} | ${t.suggested_template} | ${t.sources_count} | [${t.topic.replace(/\|/g, '/')}](${t.evidence[0].url}) |`)];
  writeFileSync(join(out, 'news-digest.md'), md.join(String.fromCharCode(10)) + String.fromCharCode(10));
  console.log(md.slice(2).join(String.fromCharCode(10)));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e); process.exit(1); });
