#!/usr/bin/env node
// Daily carousel: plan -> topic -> Gemini writes a spec -> rules lint -> render -> checks -> one repair -> JPEGs.
//
//   node engine/generate.mjs [--date YYYY-MM-DD] [--radar out/radar/news-trends.json] [--out out]
//
// Writes runs/<date>/{plan.json, spec.json, caption.txt, channel-texts.json, lint.json, checks.json, result.json}
// and out/<date>/render/slide-NN.{png,jpg} + contact-sheet.png. Never publishes anything.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, gemini, lintSpec, loadFacts, newsFacts, fetchArticle, publicationOf, humanDate } from './lib.mjs';
import { candidatesFrom, pickTopic, AGGREGATOR_RE } from './picker.mjs';
import { loadChannels, lintChannelTexts, CHANNEL_TEXTS } from './channels.mjs';

const args = process.argv.slice(2);
const arg = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
const DATE = arg('--date', new Date().toISOString().slice(0, 10));
const RADAR = arg('--radar', join(ROOT, 'out/radar/news-trends.json'));
const OUT = join(arg('--out', join(ROOT, 'out')), DATE);
const RUN = join(ROOT, 'runs', DATE);
mkdirSync(RUN, { recursive: true });
mkdirSync(OUT, { recursive: true });
const PY = process.env.PYTHON || 'python3';

const log = (...a) => console.log('[generate]', ...a);
const save = (name, obj) => writeFileSync(join(RUN, name), typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));

// ------------------------------------------------------------------ plan

// getUTCDay: 0 Sun .. 6 Sat
const WEEK = {
  1: { kind: 'news', templates: ['t3'], theme: 'AI news explained for small-business owners' },
  2: { kind: 'resource', templates: ['t2'], theme: 'a saveable resource for small-business owners: ready-to-copy messages, email templates, checklists or AI prompts for a common job (enquiries, follow-ups, reviews, bookings, reminders)' },
  3: { kind: 'news', templates: ['t1', 't3'], theme: 'a business move or AI news' },
  4: { kind: 'belief', templates: ['t4'], theme: 'one belief about websites and web development for small businesses (what a site should do, speed, forms, contact pages, landing pages, when to rebuild)' },
  5: { kind: 'news', templates: ['t3'], theme: 'AI news explained for small-business owners' },
  6: { kind: 'resource', templates: ['t2'], theme: 'a saveable web-development resource for small-business owners: a checklist or copy for their website (contact page, landing page, enquiry form, page speed checks, Google Business Profile, what to ask a web developer)' },
  0: { kind: 'news', templates: ['t1', 't3'], theme: 'a business move or AI news' },
};

function recentRuns(days = 14) {
  const dir = join(ROOT, 'runs');
  if (!existsSync(dir)) return [];
  const cutoff = new Date(DATE).getTime() - days * 864e5;
  return readdirSync(dir).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d !== DATE && new Date(d).getTime() >= cutoff)
    .map((d) => { try { return JSON.parse(readFileSync(join(dir, d, 'result.json'), 'utf8')); } catch { return null; } })
    .filter(Boolean);
}

// The radar ranks by keywords; the picker (one Gemini call) ranks the top 8 by "would an owner save this?".
// Its choices are tried in order until one article is readable. No acceptable story = T2 fallback.
async function pickNews(plan, recent) {
  if (!existsSync(RADAR)) { log('no radar file at', RADAR); return null; }
  const radar = JSON.parse(readFileSync(RADAR, 'utf8'));
  const candidates = candidatesFrom(radar, recent);
  let picked;
  try { picked = await pickTopic(candidates, plan); } catch (e) {
    log('picker failed, no news today:', String(e.message || e));
    return { none: true, picker: { error: String(e.message || e).slice(0, 200) } };
  }
  log('picker', picked.model, 'ranking', JSON.stringify(picked.ranking.map((r) => [r.index, r.template, r.topic])));
  for (const r of picked.ranking) {
    const t = candidates[r.index];
    const ev = t.evidence.find((e) => !AGGREGATOR_RE.test(e.url));
    try {
      const article = await fetchArticle(ev.url);
      return { topic: t.topic, score: t.score, url: ev.url, dateIso: ev.date, publication: publicationOf(ev.url), template: r.template,
        reason: r.reason, angle: r.angle, picker: picked,
        article: article.slice(0, 14000), radar_sources: radar.sources?.filter((s) => s.ok).length, radar_total: radar.sources?.length };
    } catch (e) { log('article fetch failed for', ev.url, String(e.message || e)); }
  }
  return { none: true, picker: picked };
}

// ------------------------------------------------------------------ prompt

const RULES_MD = readFileSync(join(ROOT, 'engine/prompt/playbook-rules.md'), 'utf8');
const TEMPLATES_MD = readFileSync(join(ROOT, 'engine/prompt/templates.md'), 'utf8');
const CHANNEL_EXAMPLE = readFileSync(join(ROOT, 'examples/channel-texts.json'), 'utf8');
const EXAMPLE = { t1: 't1-kier-prompt-a-thon.json', t2: 't2-whatsapp-replies.json', t3: 't3-salesforce-agentforce.json', t4: 't4-hiring-admin.json' };

function buildPrompt(plan, pick, recent) {
  const template = pick?.template || plan.templates[0];
  const example = readFileSync(join(ROOT, 'examples', EXAMPLE[template]), 'utf8');
  const recentList = recent.map((r) => '- ' + r.topic).join('\n') || '- none';
  const parts = [
    'You write one Instagram carousel for Black Arrow Technologies (@blackarrowtech). Return JSON only.',
    '',
    '# House rules (these are enforced by code; a piece that breaks them is rejected)',
    RULES_MD,
    '',
    'Extra hard rules:',
    '- No em dashes or en dashes anywhere. Use commas, full stops or colons.',
    '- Banned words: delve, tapestry, testament, underscore, pivotal, crucial, meticulous, vibrant, showcase, foster, realm, intricate, seamless, robust, comprehensive, nuanced, boast, garner, enduring, groundbreaking, renowned, landscape, leverage, unlock, harness, utilize, streamline, elevate, empower, holistic, game-changer, revolution, cutting-edge, supercharge, effortless, digital transformation.',
    '- No "here is how", "here\'s why", "the secret", "not only X but also Y", "it\'s not X, it\'s Y", "studies show", "experts say", "fully automated", "no human needed".',
    '- Money: US dollars only, and only when the article states the amount. Never a BAT price.',
    '- Years: only the current year, and only when the article states it.',
    '- Every number you write must appear in the article text below (news days), or be a count that is obvious from the slides themselves. Do not round, convert or combine numbers.',
    '- No hashtags or emoji on slides. No links or domain names anywhere.',
    '- The caption: first line max 110 characters and makes sense alone; then 2 to 4 short paragraphs (total 300 to 800 characters); last line is exactly one ask ("Save this for ..." or "Follow @blackarrowtech for ..."), not both. 0 to 3 hashtags go in the hashtags array, not the caption.',
    '',
    '# Texts for the other channels (same topic, same facts, written for that platform, in the same JSON)',
    '- x_text: one idea for X, 40 to 260 characters. No links, no thread, 0 or 1 hashtag, no emoji. It must make sense without the images.',
    '- linkedin_text: a post for the Black Arrow Technologies LinkedIn company page, 950 to 1250 characters counted with spaces. First line under 120 characters and makes sense alone. Short paragraphs, a numbered list is fine. No hashtags, no links, no emoji, no markdown. Same truth rules: only numbers from the article, framed examples only, no clients.',
    '- Neither text may mention swiping or slides. The last line of each is at most one ask.',
    'An approved example (it goes with the t2 WhatsApp example; copy the shape, not the topic):',
    CHANNEL_EXAMPLE,
    '',
    // Hook and close. Every rule below is from our own scrape of the pages that beat us:
    // research/2026-09-13-top-carousels-scrape.md and research/2026-09-14-ai-news-pages-and-trend-radar.md.
    '# The hook (slide 1) and the close (last slide). These decide whether anything else is read.',
    '- The cover is a HOOK, not a headline. A headline reports what happened; a hook gives an owner a reason to stop. Do not simply restate the news.',
    '- Write the cover to one of these shapes: the consequence for the reader ("Your CRM can now buy ads for you"), a contrast ("[Old way] is over. [New way] is here."), a specific claim of usefulness, or a flat arguable line. Max 60 characters, no question mark, no "here is how".',
    '- Mark 2 to 4 words of the cover in "highlight". Those words carry the meaning on their own.',
    '- Slide 2 must work as a SECOND COVER, not a continuation. Instagram re-shows slide 2 to people who did not swipe, so it has to make sense cold, without slide 1. Never open it with "and", "so", "this means" or a pronoun pointing back.',
    '- The angle beats the news. A story reframed as how an owner uses it outperforms being first to report it; tool and use-case angles do best, and "who is fighting whom" does worst. Choose the useful angle.',
    '- The LAST slide carries the payoff, in "text": the one thing the reader does next, max 80 characters. It is the biggest line on that slide. Do not write a follow or save request there, the template adds those.',
    '',
    '# The company in the story',
    '- Set "brand" at the top level of the JSON to the ONE company the story is about, as its plain name: "WhatsApp", "Gmail", "HubSpot", "OpenAI", "Google Gemini", "Shopify".',
    '- It is drawn as that company\'s real logo in that company\'s own colour. Name the product an owner would recognise (WhatsApp, not Meta Platforms Inc).',
    '- If the story is about no single company, leave "brand" out.',
    '',
    '# Templates and components',
    TEMPLATES_MD,
    '',
    `# Today: template ${template}`,
    `Theme: ${plan.theme}.`,
    'Topics already posted in the last 14 days (do not repeat):',
    recentList,
    '',
    'An approved example of this template (copy its structure and quality, not its topic):',
    example,
    '',
  ];
  if (pick) {
    parts.push(
      '# The news story',
      `Headline: ${pick.topic}`,
      `Publication: ${pick.publication}`,
      `Date: ${humanDate(pick.dateIso)} (write sources as "Source: ${pick.publication}, ${humanDate(pick.dateIso)}")`,
      '',
      'Article text (the only source of facts and numbers):',
      '"""', pick.article, '"""',
      '',
      'Explain what happened in plain words for an owner of a small business, then what they can do this week without buying anything. Quote the article only word for word.',
      ...(pick.angle ? ['', `Editor's angle (build the carousel to this takeaway): ${pick.angle}`] : []),
    );
  } else {
    parts.push('No news today. Pick a specific, practical topic inside the theme that a small-business owner would save and send to their team. Framed examples are fine ("Picture a clinic that..."). No statistics.');
  }
  parts.push(
    '',
    '# Output JSON shape',
    '{"topic": "short topic name", "spec": {"template": "' + template + '", "slides": [ ... 6 to 8 slides ... ]}, "caption": "...", "hashtags": ["#Tag"], "alt_text": "one sentence describing the carousel", "x_text": "...", "linkedin_text": "..."}',
  );
  return { prompt: parts.join('\n'), template };
}

// ------------------------------------------------------------------ validate

function normalise(out, template, pick) {
  const spec = out.spec || {};
  spec.template = template;
  spec.name = `${template.toUpperCase()} ${out.topic || ''}`.trim();
  spec.slides = (spec.slides || []).filter((s) => s && typeof s === 'object');
  if (spec.slides.length && spec.slides[spec.slides.length - 1].role !== 'closing') {
    spec.slides.push({ role: 'closing', text: out.topic || 'Save this for later.' });
  }
  for (const s of spec.slides) {
    for (const k of ['handle', 'brand_handle', 'bg_image']) delete s[k];
    if (s.highlight && !Array.isArray(s.highlight)) s.highlight = [String(s.highlight)];
  }
  // The company the story is about, drawn as its own mark in its own colour. An unknown name is
  // not an error: the renderer holds a fixed set and falls back to type when it has no mark.
  const brand = String(out.brand || spec.brand || '').trim();
  if (brand) spec.brand = brand.slice(0, 40); else delete spec.brand;
  if (template === 't1' && pick) spec.source = `Source: ${pick.publication}, ${humanDate(pick.dateIso)}`;
  const hashtags = (Array.isArray(out.hashtags) ? out.hashtags : []).slice(0, 3).map((h) => '#' + String(h).replace(/^#/, '').replace(/[^\p{L}\p{N}_]/gu, ''));
  return { spec, caption: String(out.caption || '').trim(), hashtags, topic: out.topic || '', alt_text: out.alt_text || '',
    texts: Object.fromEntries(Object.keys(CHANNEL_TEXTS).map((k) => [k, String(out[k] || '').trim()])) };
}

// The one wording for a slide that does not fit, and the test that finds it again downstream.
const TOO_TALL_TEXT = 'too tall for its box';
const TOO_TALL = new RegExp(TOO_TALL_TEXT);

function render(spec, dir) {
  mkdirSync(dir, { recursive: true });
  const specPath = join(dir, 'spec.json');
  writeFileSync(specPath, JSON.stringify(spec, null, 2));
  const r = spawnSync(PY, [join(ROOT, 'engine/render/render_v2.py'), specPath, '--out', dir, '--sheet'], { encoding: 'utf8', timeout: 300000 });
  const stdout = (r.stdout || '') + (r.stderr || '');
  if (r.status !== 0) return { ok: false, problems: ['renderer crashed: ' + stdout.slice(-800)], stdout };
  const checks = JSON.parse(readFileSync(join(dir, 'checks.json'), 'utf8'));
  const sm = checks.summary;
  const problems = [];
  for (const line of stdout.split('\n')) if (line.includes('lint:')) problems.push('render lint: ' + line.split('lint:')[1].trim());
  const tall = new Map(); // slide -> px the text runs past its box; the worst element on the slide wins
  for (const o of sm.overflow || []) {
    if (o.kind === 'collision') problems.push(`slide ${o.slide}: the ${o.slide === 1 ? 'cover headline' : 'text'} "${o.text}" runs under the ${o.box} by ${o.overlap_px}px. Cut it to 6 or 7 words.`);
    // A block that is taller than the whole box has to lose its full excess, not just the bottom breach.
    else tall.set(o.slide, Math.max(tall.get(o.slide) || 0, Math.max(1, o.tall_px || 0, o.over_px ?? Math.round((o.bottom || 0) - (o.boxBottom || 0)))));
  }
  // Raw pixels told the writer nothing, so 13px over dropped a whole day (16 Sept). A body line is
  // about 44px; say how many words that is.
  for (const [slide, px] of [...tall].sort((x, y) => x[0] - y[0])) {
    problems.push(`slide ${slide}: the text is ${px}px ${TOO_TALL_TEXT}. Cut about ${Math.ceil(px / 44) * 8} words from slide ${slide}, or drop one line.`);
  }
  for (const c of sm.contrast_below_4_5 || []) problems.push(`slide ${c.slide}: low contrast text "${c.text}"`);
  if ((sm.fonts_missing || []).length) problems.push('fonts missing: ' + sm.fonts_missing.join(', '));
  if (sm.clear_of_feed_ui_px != null && sm.clear_of_feed_ui_px < 0) problems.push('text sits inside Instagram\'s bottom bar; shorten the lowest slide');
  return { ok: problems.length === 0, problems, summary: sm, stdout };
}

// Checks the rules module can't do because they need the article: quotes must be word for word,
// and "Official announcement" only fits when the company itself published the story.
const squash = (t) => String(t).toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[^a-z0-9%$' ]+/g, ' ').replace(/\s+/g, ' ').trim();
export function newsChecks(spec, pick) {
  const out = [];
  const article = pick ? squash(pick.article) : '';
  const media = pick && !/OpenAI|Google|Microsoft|Meta|NVIDIA|AWS|Apple|Hugging Face|Salesforce|HubSpot|Zapier|Anthropic/.test(pick.publication);
  (spec.slides || []).forEach((s, i) => {
    const d = s.data || {};
    if (s.component === 'news-card') {
      if (!pick) out.push(`slide ${i + 1}: news-card used on a day with no article`);
      else if (d.quote && !article.includes(squash(d.quote))) out.push(`slide ${i + 1}: the news-card quote is not word for word from the article. Copy a sentence or phrase exactly, or use a different component.`);
      if (media && (d.chips || []).some((c) => /official/i.test(c))) out.push(`slide ${i + 1}: chip says "Official announcement" but the source is ${pick.publication}, a publication, not the company`);
    }
  });
  return out;
}

async function attempt(prompt, template, pick, facts, label) {
  const g = await gemini(prompt);
  save(label + '.raw.json', g.json);
  const piece = normalise(g.json, template, pick);
  const lint = lintSpec(piece.spec, piece.caption, piece.hashtags, facts);
  const errors = lint.errors.map((e) => `${e.rule} ${e.where}: ${e.message}${e.excerpt ? ' | "' + e.excerpt + '"' : ''}`);
  errors.push(...newsChecks(piece.spec, pick));
  let rend = { ok: false, problems: [], summary: null };
  if (piece.spec.slides.length) rend = render(piece.spec, join(OUT, label));
  else errors.push('no slides returned');
  const texts = lintChannelTexts(piece.texts, facts);
  log(label, 'model', g.model, 'lint', lint.ok ? 'ok' : errors.length + ' errors', 'render', rend.ok ? 'ok' : rend.problems.length + ' problems',
    'channel texts', Object.entries(texts).map(([k, v]) => k + ' ' + (v.ok ? 'ok' : v.errors.length + ' errors')).join(', '));
  return { piece, lint, errors, rend, texts, raw: g.json, model: g.model };
}

// ------------------------------------------------------------------ main

async function main() {
  const day = new Date(DATE + 'T12:00:00Z').getUTCDay();
  const plan = { date: DATE, weekday: day, ...WEEK[day] };
  const recent = recentRuns();
  let pick = null;
  if (plan.kind === 'news') {
    const found = await pickNews(plan, recent);
    if (found && !found.none) pick = found;
    else {
      log('no news story an owner would save, falling back to a T2 resource');
      Object.assign(plan, WEEK[2], { fallback: 'picker found no story an owner would save, or no readable article', picker: found?.picker || null });
    }
  }
  if (pick) writeFileSync(join(OUT, 'article.txt'), pick.article); // out/ is not committed
  const facts = loadFacts(pick ? [newsFacts(pick.article, pick)] : []);
  save('plan.json', { ...plan, pick: pick && { ...pick, article: pick.article.length + ' chars' } });

  const { prompt, template } = buildPrompt(plan, pick, recent);
  const draft = await attempt(prompt, template, pick, facts, 'draft');
  let a = draft;
  let repaired = false;   // false | 'repair' | 'trim' — also names the render directory
  const textErrors = (x) => Object.values(x.texts).flatMap((t) => t.errors);
  if (a.errors.length || !a.rend.ok) {
    const fix = [prompt, '', '# Your previous answer', JSON.stringify(a.raw), '',
      '# It was rejected for these reasons. Fix every one and return the full corrected JSON:',
      ...a.errors, ...a.rend.problems, ...textErrors(a)].join('\n');
    a = await attempt(fix, template, pick, facts, 'repair');
    repaired = 'repair';
  }
  // A carousel that only runs a few pixels too tall used to lose the whole day. When the writing is
  // right and the fit is the only thing left, one more round that asks for nothing but shorter text.
  // TOO_TALL must stay the one place this sentence is written; matching it by hand once let the
  // trim round quietly never fire (16 Sept).
  const onlyTooTall = (x) => x.errors.length === 0 && !x.rend.ok && x.rend.problems.length > 0
    && x.rend.problems.every((p) => TOO_TALL.test(p));
  if (onlyTooTall(a)) {
    const trim = [prompt, '', '# Your previous answer', JSON.stringify(a.raw), '',
      '# Every rule passed. It is only too long to fit. Shorten the slides named below, keep every fact,',
      '# number and source, change nothing else, and return the full JSON:',
      ...a.rend.problems].join('\n');
    const b = await attempt(trim, template, pick, facts, 'trim');
    if (b.errors.length === 0 && b.rend.ok) { a = b; repaired = 'trim'; }  // a trim that breaks a rule is thrown away
  }
  // Channel texts are judged on their own: a failed x_text or linkedin_text drops only that channel for the day.
  // A text that passed in the draft is kept if the repair broke it.
  const texts = { ...a.texts };
  for (const k of Object.keys(texts)) if (!texts[k].ok && draft.texts[k]?.ok) texts[k] = draft.texts[k];
  // The carousel passed but a text an ENABLED channel needs did not: one small text-only repair.
  // With every other channel switched off this never runs, so it costs no Gemini request.
  const needed = Object.values(loadChannels()).filter((c) => c.enabled && c.text !== 'caption').map((c) => c.text);
  const badNeeded = needed.filter((k) => texts[k] && !texts[k].ok);
  let textRepair = null;
  if (a.errors.length === 0 && a.rend.ok && badNeeded.length) {
    try {
      const fix = [prompt, '', '# Your previous answer', JSON.stringify(a.raw), '',
        '# The carousel and caption passed. These channel texts were rejected. Return JSON with only ' + badNeeded.map((k) => '"' + k + '"').join(' and ') + ', fixed:',
        ...badNeeded.flatMap((k) => texts[k].errors)].join('\n');
      const g = await gemini(fix);
      save('texts-repair.raw.json', g.json);
      const again = lintChannelTexts({ ...Object.fromEntries(Object.entries(texts).map(([k, v]) => [k, v.text])), ...g.json }, facts);
      for (const k of badNeeded) if (again[k]?.ok) texts[k] = again[k];
      textRepair = { model: g.model, fixed: badNeeded.filter((k) => texts[k].ok) };
      log('text repair', JSON.stringify(textRepair));
    } catch (e) { textRepair = { error: String(e.message || e).slice(0, 200) }; log('text repair failed:', textRepair.error); }
  }

  const ok = a.errors.length === 0 && a.rend.ok;
  save('spec.json', a.piece.spec);
  save('caption.txt', a.piece.caption + (a.piece.hashtags.length ? '\n\n' + a.piece.hashtags.join(' ') : '') + '\n');
  save('channel-texts.json', { ...texts, text_repair: textRepair });
  save('lint.json', { ok: a.lint.ok, errors: a.lint.errors, warnings: a.lint.warnings, metrics: a.lint.metrics });
  save('checks.json', { ok: a.rend.ok, problems: a.rend.problems, summary: a.rend.summary });

  const renderDir = join(OUT, repaired || 'draft');
  const jpgs = [];
  if (ok) {
    const conv = spawnSync(PY, ['-c', `
import glob, os, sys
from PIL import Image
d = sys.argv[1]
for p in sorted(glob.glob(os.path.join(d, 'slide-*.png'))):
    Image.open(p).convert('RGB').save(p[:-4] + '.jpg', 'JPEG', quality=92, optimize=True)
`, renderDir], { encoding: 'utf8' });
    if (conv.status !== 0) throw new Error('JPEG conversion failed: ' + conv.stderr);
    for (const f of readdirSync(renderDir).filter((f) => /^slide-\d+\.jpg$/.test(f)).sort()) jpgs.push(join(renderDir, f));
    copyFileSync(join(renderDir, 'contact-sheet.png'), join(OUT, 'contact-sheet.png'));
  }
  const result = {
    date: DATE, status: ok ? 'ready' : 'dropped', template, topic: a.piece.topic || pick?.topic || '',
    url: pick?.url || null, publication: pick?.publication || null, source_date: pick ? humanDate(pick.dateIso) : null,
    radar_feeds_ok: pick?.radar_sources ?? null, radar_feeds_total: pick?.radar_total ?? null,
    repaired, model: a.model, slides: a.piece.spec.slides.length, alt_text: a.piece.alt_text,
    channel_texts: Object.fromEntries(Object.entries(texts).map(([k, v]) => [k, v.ok ? 'ok' : 'failed'])),
    reasons: ok ? [] : [...a.errors, ...a.rend.problems].slice(0, 12),
    run_id: process.env.GITHUB_RUN_ID || null,
    render_dir: renderDir, jpgs, contact_sheet: ok ? join(OUT, 'contact-sheet.png') : null,
  };
  save('result.json', result);
  log('result', result.status, template, JSON.stringify(result.topic), result.reasons.length ? result.reasons : '');
}

main().catch((e) => {
  console.error('[generate] failed:', e);
  save('result.json', { date: DATE, status: 'dropped', reasons: ['engine error: ' + String(e.message || e).slice(0, 300)] });
  process.exitCode = 0; // the preview step still reports the drop on Telegram
});
