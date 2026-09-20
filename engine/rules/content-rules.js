// content-rules.js
// BAT content rulebook v1.2 as code: section F (R1-R29) of
// research/2026-09-13-content-rulebook-v1.md plus the v1.2 and v1.1 boxes at the top of that file.
// v1.2 (14 Sept 2026): worldwide audience. USD is the house currency, global tools are fine,
// western digit grouping is correct. R6 (US tools) is gone.
// Runs in an n8n Code node (task runner, plain JS, no imports) and under node --test.
// n8n rules for this file: no backslash escapes for line breaks (use NL), no double closing
// brace anywhere, pure functions above the guarded block at the bottom.

const RULES_VERSION = '1.2.0';
const NL = String.fromCharCode(10);

// ---------------------------------------------------------------- limits (v1.1 box wins over section C)
const LIMITS = {
  x: { maxWeighted: 270, min: 40, hashtags: 1, emoji: 1 },
  linkedin: { min: 600, max: 1800, hookMax: 140, hashtags: 3, emoji: 2 },
  linkedin_page: { min: 900, max: 1300, hookMax: 140, hashtags: 0, emoji: 2 },
  li_carousel_text: { min: 150, max: 1200 },
  li_slides: [6, 10],
  ig_caption: { max: 2200, softMax: 900, hookMax: 125, hashtags: 3, emoji: 3 },
  ig_slides: { min: 5, softMax: 8, max: 10 },
  slide: { coverMax: 60, coverWords: 10, bodyMax: 90, bodyMaxT2: 180, recapMax: 140 },
  ig_image_text: 70,
};

// platform -> type -> internal shape
const SHAPES = {
  instagram: { carousel: 'ig_carousel', image: 'ig_image', post: 'ig_image' },
  x: { tweet: 'x_tweet', post: 'x_tweet' },
  linkedin: { post: 'li_text', image: 'li_text', carousel: 'li_carousel' },
  'linkedin-page': { post: 'li_text', image: 'li_text', carousel: 'li_carousel' },
};
const TEMPLATES = ['T1', 'T2', 'T3', 'T4'];

// ---------------------------------------------------------------- word and phrase lists (F2)
const HARD_WORD_STEMS = [
  'delv', 'tapestr', 'testament', 'underscor', 'pivotal', 'crucial', 'meticulous',
  'vibrant', 'showcas', 'foster', 'realm', 'intricate', 'seamless', 'robust',
  'comprehensive', 'nuanced', 'boast', 'garner', 'enduring', 'groundbreaking',
  'renowned', 'nestled', 'landscape', 'leverag', 'unlock', 'harness', 'utili[sz]',
  'streamlin', 'elevat', 'empower', 'holistic', 'multifaceted', 'synerg', 'paradigm',
  'game-chang', 'revolution', 'cutting-edge', 'world-class', 'next-gen',
  'state-of-the-art', 'supercharg', 'skyrocket', 'turbocharg', 'effortless',
  'hassle-free', 'digital transformation',
];
const HARD_WORD_RE = new RegExp('\\b(?:' + HARD_WORD_STEMS.join('|') + ')[a-z]*\\b', 'i');

// Case-insensitive letters without the i flag, so a keyword can still be required in capitals.
function ci(word) {
  return word.split('').map((c) => (/[a-z]/.test(c) ? '[' + c + c.toUpperCase() + ']' : c)).join('');
}
const KEYWORD_VERBS = ['comment', 'dm us', 'dm me', 'dm', 'message us', 'send us a dm with', 'text us', 'reply'];
const KEYWORD_CTA_RE = new RegExp(
  '\\b(?:' + KEYWORD_VERBS.map(ci).join('|') + ')\\s+(?:' + ci('with') + '\\s+)?["\']?[A-Z]{3,}\\b' +
  '|\\b' + ci('type') + '\\s+["\']?[A-Z]{3,}["\']?\\s+' + ci('below'));
const KEYWORD_CTA_NO_REPLY_RE = new RegExp(
  '\\b(?:' + KEYWORD_VERBS.filter((v) => v !== 'reply').map(ci).join('|') + ')\\s+(?:' + ci('with') + '\\s+)?["\']?[A-Z]{3,}\\b');

// [name, rule, regex]. R9 unless stated.
const HARD_PHRASES = [
  ['heart_of', 'R9', /\bin the heart of\b/i],
  ['copula_dodge', 'R9', /\b(?:serves|stands|functions) as (?:a|an|the)\b|\brepresents an? \b/i],
  ['not_only', 'R9', /\bnot only\b[^.]{0,80}\bbut also\b/i],
  ['neg_parallel', 'R9', /\b(?:it'?s not|it is not|this is not|that'?s not|isn'?t|aren'?t|is not|are not) (?:just |only |about )?[^,.;\u000A]{1,50}[,.;] ?(?:it'?s|it is|they'?re|this is|that'?s)\b|(?:^|[.!?]\s+)not [^,.\u000A]{1,40}, but\b/im],
  ['reveal_bridge', 'R9', /\bhere'?s (?:what|how|why|the thing)\b|\bhere is (?:how|why|the thing)\b|\bthe (?:result|catch|kicker|truth|secret|twist)\?|\bplot twist\b/i],
  ['stop_start', 'R9', /\bstop \w+[^.\u000A]{0,40}[.,] ?start\b|(?:^|[.!?]\s+)stop (?:[a-z]+ly )?[a-z]+ing\b/im],
  ['staccato', 'R9', /\bno [\w ]{1,25}[.,]\s+no [\w ]{1,25}[.,]\s+(?:just|only)\b|(?:^|[.!?]\s+)no(?: [\w-]+){1,3}\.\s+no(?: [\w-]+){1,3}\./im],
  ['all_none', 'R9', /\ball (?:of )?the \w+\. none of the \w+/i],
  ['filler', 'R9', /\b(?:it'?s (?:important|worth) (?:to note|noting)|in conclusion|in summary|to summari[sz]e|at the end of the day|when it comes to|in today'?s|fast-paced|in the age of ai|move the needle|deep dive|let that sink in|unlock your potential|next level|level up)\b/i],
  ['sincerity', 'R9', /\b(?:let me be (?:honest|real|clear)|to be honest|real talk|not gonna lie|unpopular opinion)\b|(?:^|[.!?]\s+)(?:honestly\?|ngl\b)/im],
  ['dead_closer', 'R9', /what do you think\?|\bthoughts\?|\bagree\?|\bagree or disagree\b|\blet me know in the comments\b/i],
  ['fake_authority', 'R4', /\b(?:studies (?:show|suggest|prove)|research (?:shows|suggests|says|proves)|experts (?:say|agree|argue|recommend)|according to (?:a|one|recent|the latest) (?:study|report|survey)|some (?:critics|experts))\b/i],
  ['bait', 'R13', /\bdouble[- ]tap\b|\btag (?:someone|a friend|\d+ friends|two friends|three friends)\b|\b(?:rt|retweet) if\b/i],
  ['absolutism', 'R14', /\b(?:fully automated|zero (?:extra )?(?:manual|human|staff|admin|effort|work)|no human (?:needed|required|intervention)|without (?:any )?human|runs (?:by )?itself|set (?:it )?and forget|nobody watching)\b/i],
];

const CLAIM_RE = /\b(?:we|our team)\s+(?:helped|saved|cut|reduced|increased|grew|doubled|tripled|rebuilt|delivered|generated|boosted|got|drove|built \w+ that)\b|\b(?:one of our clients|a client (?:told|asked|said)|our clients (?:saw|got))\b/i;
const WORD_STAT_RE = /\b(?:over |nearly |almost |more than )?half\b(?! an hour| a day|-day| day)|\bdouble[sd]?\b(?![- ](?:check|tick|click|entry|entries|booking|tap))|\btwice as\b|\btriple[sd]?\b|\b(?:ten|hundred)fold\b|\b\d+\s?x (?:faster|more|better|cheaper)\b|\b\d+ out of \d+\b|\bmajority of\b|\bnearly (?:all|every)\b|\bmost of (?:them|your) (?:leads|customers)\b/i;
const PREVALENCE_RE = /\bmost (?:small )?(?:business )?(?:businesses|owners|founders|smbs|customers|buyers|leads|clinics|shops|companies|websites|teams)\b/i;
// R5: money is USD. Rupee, pound and euro are allowed only inside a news fact from facts.json.
const NON_USD_RE = /\u20B9|\bRs\.?\s?\d|\bINR\b|\blakhs?\b|\bcrores?\b|\u00A3|\u20AC/i;
const INDIAN_GROUPING_RE = /(?<![\d,.])\d{1,2}(?:,\d{2})+,\d{3}(?![\d,])/;
const YEAR_RE = /(?<![\u20B9$\u00A3\u20AC\d,.])\b(?:19|20)\d{2}\b(?![\d,%]|\s?(?:k|m|bn|l|cr|lakh|rs)\b)/gi;
const EM_DASH_RE = /\u2014/;
const EN_DASH_WORDS_RE = /[A-Za-z]\s?\u2013\s?[A-Za-z]/;
const DOUBLE_DASH_RE = /\s--\s|\w--\w|\s--$/m;
const URL_RE = /\bhttps?:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|in|co|io|ai|net|org|app|dev|me|link|site|ly)\b/i;
const HASHTAG_RE = /(^|\s)#[\p{L}\p{N}_]+/gu;
const EMOJI_SEQ_RE = /\p{Regional_Indicator}{2}|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*/gu;
const EMOJI_BULLET_RE = /^\s*\p{Extended_Pictographic}/mu;
const LEAK_RE = /\*\*|__|^#{1,6}\s|(?:^|\s)S\d{1,2}:|\{\{|\bXX\b|\[img:/im;
const PLACEHOLDER_RE = /\[(?:your|insert|name|company|link|client|brand)[^\]]*\]/i;
const SLIDE_LABEL_RE = /\bslide \d+\b|\bstep \d+ of \d+\b/i;
// City hashtags on a post not about that city (R16). 'ncr' was dropped: it sits inside #increase.
const CITIES = ['london', 'manchester', 'birmingham', 'dubai', 'singapore', 'sydney', 'melbourne', 'toronto',
  'newyork', 'nyc', 'sanfrancisco', 'losangeles', 'chicago', 'berlin', 'lagos', 'nairobi',
  'bangalore', 'bengaluru', 'mumbai', 'bombay', 'delhi', 'gurgaon', 'gurugram', 'noida', 'chennai', 'hyderabad', 'pune', 'kolkata', 'ahmedabad', 'jaipur', 'kochi', 'mysore', 'mysuru', 'lucknow', 'indore', 'coimbatore', 'surat', 'chandigarh'];
const TAGLINE_ALLOW = ['built. automated. tracked.'];
const HOLLOW = ['faster', 'cheaper', 'better', 'simple', 'simpler', 'easy', 'easier', 'effective', 'smart', 'smarter',
  'powerful', 'scalable', 'growth', 'efficiency', 'clarity', 'speed', 'results', 'success', 'value', 'impact', 'productivity'];
const ASK_VERBS_RE = /(?:^|[.!?]\s+)(save|send|share|follow|dm|reply|comment|book|call|visit|click|subscribe|message|tag)\b/gim;
const SELL_RE = /\bblack arrow\b|\bwe (?:build|set up|can build|can set up)\b/i;
const SELL_BAT_RE = /\bBAT\b/;

// density markers (R10)
const DENSITY = [
  /\b(?:significant(?:ly)?|notably|particularly|essentially|fundamentally|ultimately)\b/gi,
  /\b(?:insights?|navigat\w*|facilitat\w*|ecosystem|journey|solutions|optimi[sz]\w*|innovative|powerful)\b/gi,
  /\b(?:quietly|compound(?:s|ing)?|the work|a signal|rather than)\b/gi,
  /\bthe \w+(?:tion|sion|ment|ance|ence) of\b/gi,
  /\b(?:alignment|efficiency|scalability|transformation|optimization)\b[^.]{0,40}\b(?:alignment|efficiency|scalability|transformation|optimization)\b/gi,
];
const ING_OPENER_RE = /^\s*([A-Z][a-z]+ing)\b[^.\u000A]{0,60},/gm;
const ING_NOT_CLAUSE = ['During', 'Nothing', 'Something', 'Everything', 'Anything', 'Morning', 'Evening', 'Bring', 'Thing', 'Spring', 'King'];

// ---------------------------------------------------------------- numbers (R1)
const MONTHS = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const LIST_NOUN = '(?:steps?|things?|jobs?|tasks?|questions?|mistakes?|myths?|ways?|rules?|signs?|checks?|lines?|messages?|reminders?|fields?|pages?|slides?|items?|parts?|points?|scripts?|templates?|replies|reply|habits?|reasons?|tools?)';
const NUM_TOKEN_RE = /(?:\bus\$\s?|\$\s?|\busd\s?|\u20B9\s?|\brs\.?\s?|\binr\s?|\u00A3\s?|\u20AC\s?)?\d[\d,]*(?:\.\d+)?(?:\s?(?:to|-)\s?\d[\d,]*(?:\.\d+)?)?\+?(?:\s?(?:%|lakhs?\b|crores?\b|thousand\b|million\b|billion\b|minutes?\b|mins?\b|hours?\b|hrs?\b|seconds?\b|secs?\b|days?\b|weeks?\b|months?\b|years?\b|l\b|cr\b|k\b|mn\b|m\b|bn\b|x\b|s\b|h\b))?/gi;
const HYPOTHETICAL_START = /^(?:say|suppose|picture|imagine|if|for example|example:|let'?s say)\b/i;
const UNIT_MAP = {
  lakh: 'l', lakhs: 'l', l: 'l', crore: 'cr', crores: 'cr', cr: 'cr',
  minute: 'min', minutes: 'min', mins: 'min', min: 'min',
  hour: 'hr', hours: 'hr', hrs: 'hr', hr: 'hr', h: 'hr',
  second: 'sec', seconds: 'sec', secs: 'sec', sec: 'sec', s: 'sec',
  day: 'day', days: 'day', week: 'wk', weeks: 'wk', month: 'mo', months: 'mo', year: 'yr', years: 'yr',
};

// Regexes whose matches are blanked (same length) before number tokens are read.
function exemptSpans(year) {
  return [
    /^\s*\d{1,2}[.)](?=\s)/gm,
    /\b(?:microsoft|office|dynamics)\s?365\b/gi,
    // Product and model version names are names, not claims: GPT-6, Gemini 2.5, Claude 4, iOS 26, o3, v2.1.
    /\b(?:gpt|gemini|claude|llama|grok|mistral|deepseek|qwen|phi|sora|veo|dall-e|midjourney|flux|stable diffusion|ios|ipados|macos|android|windows|iphone|ipad|pixel|galaxy [a-z]|copilot|agentforce|chrome|python|node|html)(?:\s(?:opus|sonnet|haiku|pro|ultra|flash|mini|nano|max|plus|lite))?\s?-?\d+(?:\.\d+)*(?:\s?(?:pro|max|mini|nano|flash|ultra|turbo|sonnet|opus|haiku|plus|lite))?\b/gi,
    /\b(?:o[1-9](?:-mini|-pro)?|v\d+(?:\.\d+)*|version\s\d+(?:\.\d+)*)\b/gi,
    /\b(?:step|day|week|stage|level|part|phase)\s?\d{1,2}\b/gi,
    /\b\d{1,2}(?::[0-5]\d)?\s?(?:am|pm)\b/gi,
    /\b(?:[01]?\d|2[0-3]):[0-5]\d\b/g,
    new RegExp('\\b\\d{1,2}(?:st|nd|rd|th)?\\s' + MONTHS + '\\b', 'gi'),
    new RegExp('\\b' + MONTHS + '\\s\\d{1,2}(?:st|nd|rd|th)?\\b', 'gi'),
    /\b(?:[1-9]|10)(?:st|nd|rd|th)\b/gi,
    new RegExp('\\b(?:[1-9]|10)(?:\\s[a-z-]+){0,2}\\s' + LIST_NOUN + '\\b', 'gi'),
    new RegExp('\\b(?:[1-9]|10)-' + LIST_NOUN + '\\b', 'gi'),
    new RegExp('(?<![\\d,.$\\u00A3\\u20AC\\u20B9])\\b' + year + '\\b(?![\\d,%])', 'g'),
  ];
}

function blank(s) { return ' '.repeat(s.length); }

const CURRENCY_MAP = { '$': '$', 'us$': '$', usd: '$', dollar: '$', dollars: '$', '\u20B9': '\u20B9', rs: '\u20B9', 'rs.': '\u20B9', inr: '\u20B9', '\u00A3': '\u00A3', '\u20AC': '\u20AC' };
const MULTIPLIERS = { k: 1000, thousand: 1000, m: 1000000, mn: 1000000, million: 1000000, bn: 1000000000, billion: 1000000000 };
const PER_MAP = { month: 'mo', months: 'mo', mo: 'mo', year: 'yr', years: 'yr', yr: 'yr', annum: 'yr', week: 'wk', weeks: 'wk',
  day: 'day', days: 'day', hour: 'hr', hours: 'hr', hr: 'hr', user: 'user', users: 'user', seat: 'user', seats: 'user' };

// Canonical key for a number as written: currency first ($, US$, USD all become $), K/M/bn multiplied out,
// commas dropped, units shortened, "/month", "per month" and "a month" all become "/mo".
function normNum(s) {
  let t = String(s).toLowerCase();
  let cur = '';
  t = t.replace(/us\$|\$|\u20B9|\u00A3|\u20AC|\b(?:usd|dollars?|inr)\b|\brs\b\.?/g, (m) => {
    if (!cur) cur = CURRENCY_MAP[m] || '';
    return ' ';
  });
  t = t.replace(/(\d)\s?-\s?(\d)/g, '$1 to $2');
  t = t.replace(/(\d[\d,]*(?:\.\d+)?)\s?(k|thousand|mn|m|million|bn|billion)\b/g, (m, n, suf) =>
    String(Number((Number(n.replace(/,/g, '')) * MULTIPLIERS[suf]).toFixed(6))));
  t = t.replace(/\s*(?:\/|\bper\s|\ban?\s|\beach\s)\s*([a-z]+)\b/g, (m, w) => (PER_MAP[w] ? ' /' + PER_MAP[w] : m));
  t = t.replace(/(\d)([a-z%+])/g, '$1 $2');
  return cur + t.split(/\s+/).filter(Boolean).map((w) => (UNIT_MAP[w] ? UNIT_MAP[w] : w)).join('').replace(/,/g, '');
}

function todayIso() { return new Date().toISOString().slice(0, 10); }

// usage "news": a third-party figure (any currency) that may only appear as reported news.
// A news fact needs a source and a source_date, or it never whitelists.
function usableFacts(facts) {
  const today = todayIso();
  return ((facts && facts.facts) || []).filter((f) => f && f.status === 'confirmed' && f.public === true &&
    (!f.review_by || String(f.review_by) >= today) &&
    (f.usage !== 'news' || (!!f.source && /^\d{4}-\d{2}-\d{2}$/.test(String(f.source_date || '')))));
}

function buildAllowed(facts) {
  const allowed = new Map();
  usableFacts(facts).forEach((f) => (f.forms || []).forEach((form) => {
    const k = normNum(form);
    if (!allowed.has(k)) allowed.set(k, []);
    allowed.get(k).push(f);
  }));
  return allowed;
}

function sentenceAt(text, index) {
  let start = 0;
  const re = /[.!?]\s+|\u000A/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const end = m.index + m[0].length;
    if (end > index) break;
    start = end;
  }
  const rest = text.slice(start);
  const stop = rest.search(/[.!?](\s|$)|\u000A/);
  return (stop === -1 ? rest : rest.slice(0, stop + 1)).trim();
}

// Returns the spans of money tokens that matched a news fact, so R5 can skip them.
function checkNumbers(text, ctx, where, E) {
  const newsSpans = [];
  const year = new Date().getFullYear();
  let masked = text;
  exemptSpans(year).forEach((re) => { masked = masked.replace(re, blank); });
  masked = masked.replace(/\b(\d{1,2})\s?\/\s?(\d{1,2})\b/g, (m, a, b) =>
    (Number(a) >= 1 && Number(a) <= Number(b) && Number(b) <= 10 ? blank(m) : m));

  for (const m of masked.matchAll(NUM_TOKEN_RE)) {
    const raw = m[0].replace(/[,\s]+$/, '');
    if (!/\d/.test(raw)) continue;
    ctx.metrics.numbers_checked++;
    if (/^(?:19|20)\d{2}$/.test(raw)) continue; // years belong to R7
    const after = text.slice(m.index + m[0].length).match(/^(?:\s*\/\s*|\s+(?:per|a|an|each)\s+|\s*)([A-Za-z][A-Za-z-]*)/i);
    const keys = [normNum(raw)];
    if (after) keys.push(normNum(raw + ' ' + after[0].trim()));
    const found = [].concat(...keys.map((k) => ctx.allowed.get(k) || []));
    const hits = found.length ? found : null;
    const sentence = sentenceAt(text, m.index);
    if (hits) {
      if (hits.some((f) => f.usage === 'news')) newsSpans.push([m.index, m.index + raw.length]);
      if (hits.every((f) => f.usage === 'quote_only') && ctx.piece.pillar !== 'P5') {
        E.push(mk('R1', where, '"' + raw + '" is a quote-only fact, allowed only in P5 build-log pieces', sentence));
      }
      continue;
    }
    const isMoneyOrRate = /[%\u20B9+$\u00A3\u20AC]|^(?:rs|inr|usd)|x$|k$|m$|mn$|bn$|thousand|million|billion|lakh|crore|\bl$|\bcr$/i.test(raw);
    const bare = sentence.replace(/^\d{1,2}[.)]\s*/, '');
    if (!isMoneyOrRate && HYPOTHETICAL_START.test(bare) && ctx.hypothetical < 2) {
      ctx.hypothetical++;
      continue;
    }
    E.push(mk('R1', where, 'number not in facts.json: "' + raw + '"', sentence));
  }
  return newsSpans;
}

// ---------------------------------------------------------------- helpers
function mk(rule, where, message, excerpt) {
  return { rule, where, message, excerpt: String(excerpt == null ? '' : excerpt).slice(0, 140) };
}
function around(text, index, len) {
  const s = Math.max(0, index - 30);
  return text.slice(s, index + (len || 0) + 40).split(NL).join(' ').trim();
}
function firstMatch(text, re) {
  const m = text.match(re);
  return m ? { text: m[0].trim(), excerpt: around(text, m.index || 0, m[0].length) } : null;
}
function straighten(s) {
  return String(s == null ? '' : s).replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
}
function paragraphs(t) {
  const out = [];
  let cur = [];
  String(t || '').split(NL).forEach((l) => {
    if (l.trim() === '') {
      if (cur.length) out.push(cur.join(NL));
      cur = [];
    } else {
      cur.push(l);
    }
  });
  if (cur.length) out.push(cur.join(NL));
  return out;
}
function firstLine(t) { return (String(t || '').split(NL).find((l) => l.trim()) || '').trim(); }
function words(t) { return String(t || '').toLowerCase().match(/[a-z\u0900-\u097F]+/g) || []; }
function overlap(a, b) {
  const A = new Set(words(a).filter((w) => w.length > 3));
  const B = new Set(words(b).filter((w) => w.length > 3));
  if (!A.size || !B.size) return 0;
  let n = 0;
  A.forEach((w) => { if (B.has(w)) n++; });
  return n / Math.min(A.size, B.size);
}
function countEmoji(t) { return (String(t || '').match(EMOJI_SEQ_RE) || []).length; }
function inlineTags(t) { return (String(t || '').match(HASHTAG_RE) || []).map((x) => x.trim()); }
function tagsAtEnd(t) {
  const ls = String(t || '').trim().split(NL);
  const idx = ls.map((l, i) => (/(^|\s)#[\p{L}\p{N}_]+/u.test(l) ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return true;
  const firstTagLine = idx[0];
  return ls.slice(firstTagLine).every((l) => l.trim() === '' || /^(\s*#[\p{L}\p{N}_]+)+\s*$/u.test(l)) || idx.every((i) => i === ls.length - 1);
}
function escapeRe(s) { return String(s).replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/[{]/g, '\\{'); }

// X weighted length, twitter-text v3 config: code points in the light ranges weigh 1, the rest 2.
// An emoji sequence (ZWJ, skin tone, flag) weighs 2 in total. $ weighs 1.
function xWeightedLength(text) {
  const light = [[0, 4351], [8192, 8205], [8208, 8223], [8242, 8247]];
  let n = 0;
  const rest = String(text || '').normalize('NFC').replace(EMOJI_SEQ_RE, () => { n += 2; return ''; });
  for (const ch of rest) {
    const cp = ch.codePointAt(0);
    n += light.some((r) => cp >= r[0] && cp <= r[1]) ? 1 : 2;
  }
  return n;
}

// numbered items: "1." / "1)" / "Step 1" at the start of each unit (line or slide)
function numberedItems(units) {
  return units.map((u) => {
    const m = String(u).match(/^\s*(\d{1,2})[.)]\s/) || String(u).match(/^\s*step\s?(\d{1,2})\b/i);
    return m ? Number(m[1]) : null;
  }).filter((n) => n !== null);
}
// A list may restart at 1; otherwise every number must be the previous plus one.
function numberingProblem(nums) {
  if (!nums.length) return null;
  if (nums[0] !== 1) return 'numbering starts at ' + nums[0];
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] !== nums[i - 1] + 1 && nums[i] !== 1) return 'numbering ' + nums.join(', ');
  }
  return null;
}
function firstListLength(nums) {
  let n = 0;
  for (let i = 0; i < nums.length; i++) {
    if (i > 0 && nums[i] === 1) break;
    n++;
  }
  return n;
}
function promisedCount(line) {
  const m = String(line || '').match(/^\s*(?:the\s+)?(\d{1,2})\s+[A-Za-z]/i);
  return m ? Number(m[1]) : null;
}

// ---------------------------------------------------------------- per-text checks
function checkText(rawText, where, ctx, opts) {
  const E = [];
  const W = [];
  const t = String(rawText || '');
  const o = opts || {};
  if (!t.trim()) return { E, W };

  const hw = firstMatch(t, HARD_WORD_RE);
  if (hw) E.push(mk('R8', where, 'banned word: ' + hw.text, hw.excerpt));

  for (const p of HARD_PHRASES) {
    const hit = firstMatch(t, p[2]);
    if (hit) E.push(mk(p[1], where, p[0] + ': ' + hit.text, hit.excerpt));
  }
  const kw = firstMatch(t, o.allowReplyKeyword ? KEYWORD_CTA_NO_REPLY_RE : KEYWORD_CTA_RE);
  if (kw) E.push(mk('R13', where, 'comment/DM keyword CTA: ' + kw.text, kw.excerpt));

  const claim = firstMatch(t, CLAIM_RE);
  if (claim && !ctx.claimBacked) E.push(mk('R3', where, 'first-person result claim with no fact id: ' + claim.text, claim.excerpt));

  const ws = firstMatch(t, WORD_STAT_RE);
  if (ws) E.push(mk('R2', where, 'word-form statistic with no fact: ' + ws.text, ws.excerpt));

  const prev = firstMatch(t, PREVALENCE_RE);
  if (prev) W.push(mk('R27', where, 'prevalence claim with no source: ' + prev.text, prev.excerpt));

  const year = new Date().getFullYear();
  for (const y of t.matchAll(YEAR_RE)) {
    if (Number(y[0]) !== year) E.push(mk('R7', where, 'year other than ' + year + ': ' + y[0], around(t, y.index, 4)));
  }

  const dash = firstMatch(t, EM_DASH_RE) || firstMatch(t, EN_DASH_WORDS_RE) || firstMatch(t, DOUBLE_DASH_RE);
  if (dash) E.push(mk('R11', where, 'dash: use a comma, colon or a rewrite', dash.excerpt));

  const url = firstMatch(t, URL_RE);
  if (url) E.push(mk('R15', where, 'link or domain: ' + url.text, url.excerpt));

  const leak = firstMatch(t, LEAK_RE);
  if (leak) E.push(mk('R20', where, 'formatting leak: ' + leak.text, leak.excerpt));
  if (!o.allowPlaceholders) {
    const ph = firstMatch(t, PLACEHOLDER_RE);
    if (ph) E.push(mk('R20', where, 'unfilled placeholder: ' + ph.text, ph.excerpt));
  }
  if (o.isSlide) {
    const sl = firstMatch(t, SLIDE_LABEL_RE);
    if (sl) E.push(mk('R20', where, 'slide label in slide text (the renderer draws counters): ' + sl.text, sl.excerpt));
  }
  if ((ctx.platform === 'x' || ctx.platform === 'linkedin' || ctx.platform === 'linkedin-page') && t.includes('|')) {
    E.push(mk('R20', where, 'pipe character', around(t, t.indexOf('|'), 1)));
  }

  const grouping = firstMatch(t, INDIAN_GROUPING_RE);
  if (grouping) W.push(mk('R29', where, 'Indian digit grouping: ' + grouping.text + ', use western grouping (150,000 or 150K)', grouping.excerpt));

  // R10 density, per paragraph (a slide is one paragraph)
  for (const para of paragraphs(t)) {
    let n = DENSITY.reduce((sum, re) => sum + (para.match(re) || []).length, 0);
    for (const m of para.matchAll(ING_OPENER_RE)) if (!ING_NOT_CLAUSE.includes(m[1])) n++;
    if (n >= 3) E.push(mk('R10', where, n + ' AI-tell markers in one paragraph', para));
    else if (n === 2) W.push(mk('R10', where, '2 AI-tell markers in one paragraph', para));
  }

  // R22 names
  for (const name of ctx.names) {
    const re = new RegExp('\\b' + escapeRe(name) + '\\b', 'i');
    const hit = firstMatch(t, re);
    if (hit) E.push(mk('R22', where, 'client or restricted name: ' + name, hit.excerpt));
  }

  // R25 triads
  const triads = [...t.matchAll(/\b(\w+), (\w+),? and (\w+)\b/gi)];
  triads.forEach((m) => {
    if ([m[1], m[2], m[3]].every((w) => HOLLOW.includes(w.toLowerCase()))) E.push(mk('R25', where, 'hollow triad: ' + m[0], m[0]));
  });
  if (triads.length >= 2) W.push(mk('R25', where, triads.length + ' lists of three in one text', triads.map((m) => m[0]).join(' / ')));

  // R26 fragments
  const lower = t.toLowerCase();
  const fragments = t.split(/(?<=[.!?])\s+|\u000A+/)
    .map((s) => s.trim().replace(/^\d{1,2}[.)]\s*/, ''))
    .filter((s) => s && !/^#/.test(s) && s.split(/\s+/).length < 4)
    .filter((s) => !TAGLINE_ALLOW.some((a) => lower.includes(a) && a.includes(s.toLowerCase())));
  if (fragments.length > 2) W.push(mk('R26', where, fragments.length + ' fragments under 4 words', fragments.join(' / ')));

  // R5: a non-USD currency is allowed only on a money token that matched a news fact
  let curText = t;
  checkNumbers(t, ctx, where, E).forEach((sp) => { curText = curText.slice(0, sp[0]) + blank(curText.slice(sp[0], sp[1])) + curText.slice(sp[1]); });
  const cur = firstMatch(curText, NON_USD_RE);
  if (cur) E.push(mk('R5', where, 'non-USD currency in BAT\'s own words (allowed only inside a news fact): ' + cur.text, around(t, curText.search(NON_USD_RE), cur.text.length)));
  return { E, W };
}

// ---------------------------------------------------------------- per-piece
function lintPiece(pieceIn, factsIn) {
  const errors = [];
  const warnings = [];
  const piece = pieceIn && typeof pieceIn === 'object' ? pieceIn : {};
  const factsOk = !!(factsIn && Array.isArray(factsIn.facts));
  const facts = factsOk ? factsIn : { facts: [], names: {}, tools: {} };
  const metrics = { rules_version: RULES_VERSION, facts_version: factsOk ? facts.version : null, numbers_checked: 0 };
  if (!factsOk) errors.push(mk('FACTS', 'piece', 'facts missing or malformed: every number will fail until the Facts node is fixed', ''));
  if (factsOk && piece.facts_version != null && piece.facts_version !== facts.version) {
    errors.push(mk('FACTS', 'piece', 'prompt used facts v' + piece.facts_version + ', Rulecheck has v' + facts.version, ''));
  }

  // R12 autofix first, so later checks see straight quotes
  const fixed = {};
  const content = straighten(piece.content);
  const caption = straighten(piece.caption);
  const slides = Array.isArray(piece.slides) ? piece.slides.map(straighten) : [];
  const curly = /[\u201C\u201D\u2018\u2019]/;
  if (curly.test(String(piece.content || '')) || curly.test(String(piece.caption || '')) ||
      (piece.slides || []).some((s) => curly.test(String(s)))) {
    fixed.content = content;
    fixed.caption = caption;
    fixed.slides = slides;
    warnings.push(mk('R12', 'piece', 'curly quotes replaced with straight quotes (use result.fixed)', ''));
  }

  const platform = piece.platform;
  const type = piece.type;
  const template = piece.template == null ? null : piece.template;
  const shape = SHAPES[platform] ? SHAPES[platform][type] : undefined;
  metrics.shape = shape || null;
  if (type === 'article') errors.push(mk('FORMAT', 'piece', 'articles are paused (rulebook C): low reach, and long unattended drafts are where invented facts hide', ''));
  else if (!shape) errors.push(mk('FORMAT', 'piece', 'unknown platform/type: ' + platform + '/' + type, ''));
  if (template !== null && !TEMPLATES.includes(template)) errors.push(mk('FORMAT', 'piece', 'template must be T1-T4 or null, got ' + template, ''));

  const claimBacked = (piece.claims || []).some((c) => c && c.fact_id && usableFacts(facts).some((f) => f.id === c.fact_id));
  const names = [].concat((facts.names && facts.names.never_name) || [], (facts.names && facts.names.ask_first) || []);
  const ctx = {
    piece, platform, metrics, claimBacked, names, hypothetical: 0,
    allowed: buildAllowed(facts),
  };
  const add = (r) => { errors.push(...r.E); warnings.push(...r.W); };

  const tagList = (Array.isArray(piece.hashtags) ? piece.hashtags : []).map((h) => (String(h).startsWith('#') ? String(h) : '#' + h));
  const isT2 = template === 'T2';

  // ---- text body: X, LinkedIn
  if (shape === 'x_tweet' || shape === 'li_text' || shape === 'li_carousel') {
    add(checkText(content, 'content', ctx));
    const hook = firstLine(content);
    metrics.chars = content.length;
    metrics.hook_chars = hook.length;
    if (/\?\s*$/.test(hook)) errors.push(mk('R19', 'content', 'question as the hook line', hook));
    if (EMOJI_BULLET_RE.test(content)) errors.push(mk('R17', 'content', 'emoji used as a bullet', ''));
    const tags = inlineTags(content).length + tagList.length;
    metrics.hashtags = tags;
    metrics.emoji = countEmoji(content);

    const nums = numberedItems(content.split(NL));
    const np = numberingProblem(nums);
    if (np) errors.push(mk('R21', 'content', np, ''));
    const promised = promisedCount(hook);
    if (promised !== null && nums.length && firstListLength(nums) !== promised) {
      errors.push(mk('R21', 'content', 'hook promises ' + promised + ', list has ' + firstListLength(nums), hook));
    }

    if (shape === 'x_tweet') {
      const w = xWeightedLength(content);
      metrics.x_weighted = w;
      if (w > LIMITS.x.maxWeighted || w < LIMITS.x.min) errors.push(mk('R18', 'content', 'X weighted length ' + w + ' (allowed ' + LIMITS.x.min + '-' + LIMITS.x.maxWeighted + ')', ''));
      if (tags > LIMITS.x.hashtags) errors.push(mk('R16', 'content', tags + ' hashtags on X (max 1)', ''));
      if (metrics.emoji > LIMITS.x.emoji) errors.push(mk('R17', 'content', metrics.emoji + ' emoji on X (max 1)', ''));
    } else {
      const page = platform === 'linkedin-page';
      const L = page ? LIMITS.linkedin_page : LIMITS.linkedin;
      const min = page ? L.min : (shape === 'li_carousel' ? LIMITS.li_carousel_text.min : L.min);
      const max = page ? L.max : (shape === 'li_carousel' ? LIMITS.li_carousel_text.max : L.max);
      if (content.length < min || content.length > max) errors.push(mk('R18', 'content', 'LinkedIn text is ' + content.length + ' chars (allowed ' + min + '-' + max + ')', ''));
      if (hook.length > L.hookMax) errors.push(mk('R18', 'content', 'hook line ' + hook.length + ' chars (max ' + L.hookMax + ')', hook));
      if (tags > L.hashtags) errors.push(mk('R16', 'content', tags + ' hashtags (max ' + L.hashtags + (page ? ', company page takes none' : '') + ')', ''));
      else if (tags && !tagsAtEnd(content)) errors.push(mk('R16', 'content', 'hashtags must sit at the end', ''));
      if (metrics.emoji > L.emoji) errors.push(mk('R17', 'content', metrics.emoji + ' emoji (max ' + L.emoji + ')', ''));
      if (countEmoji(hook) > 0) errors.push(mk('R17', 'content', 'emoji in the hook line', hook));
    }
  }

  // ---- slides: IG carousel, LinkedIn document
  if (shape === 'ig_carousel' || shape === 'li_carousel') {
    const S = slides;
    const C = LIMITS.slide;
    metrics.slides = S.length;
    if (shape === 'ig_carousel') {
      if (S.length < LIMITS.ig_slides.min || S.length > LIMITS.ig_slides.max) {
        errors.push(mk('R21', 'slides', S.length + ' slides (Instagram: 5-8, hard max 10)', ''));
      } else if (S.length > LIMITS.ig_slides.softMax) {
        warnings.push(mk('R21', 'slides', S.length + ' slides, above the 5-8 default', ''));
      }
    } else if (S.length < LIMITS.li_slides[0] || S.length > LIMITS.li_slides[1]) {
      errors.push(mk('R21', 'slides', S.length + ' pages (LinkedIn document: 6-10)', ''));
    }
    S.forEach((s, i) => {
      const where = 'slide ' + (i + 1);
      const last = i === S.length - 1 && i > 0;
      const body = i > 0 && !last;
      add(checkText(s, where, ctx, { isSlide: true, allowPlaceholders: isT2 && body, allowReplyKeyword: isT2 && body }));
      const max = i === 0 ? C.coverMax : last ? C.recapMax : (isT2 ? C.bodyMaxT2 : C.bodyMax);
      if (s.length > max) errors.push(mk('R18', where, where + ' is ' + s.length + ' chars (max ' + max + ')', s));
      if (countEmoji(s) > 0) errors.push(mk('R17', where, 'emoji on a slide', s));
      if (inlineTags(s).length > 0) errors.push(mk('R16', where, 'hashtag on a slide', s));
      if (body && !isT2 && (s.match(/[.!?](\s|$)/g) || []).length > 2) errors.push(mk('R21', where, 'more than one idea (over 2 sentences)', s));
    });
    if (S[0] !== undefined) {
      if (/\?\s*$/.test(S[0])) errors.push(mk('R19', 'slide 1', 'question as the cover', S[0]));
      if (S[0].trim().split(/\s+/).length > C.coverWords) errors.push(mk('R18', 'slide 1', 'cover is over ' + C.coverWords + ' words', S[0]));
    }
    if (S.length > 1 && overlap(S[0], S[1]) >= 0.6) errors.push(mk('R21', 'slide 2', 'slide 2 repeats slide 1 (overlap 60% or more)', S[1]));
    if (new Set(S.map((s) => s.trim().toLowerCase())).size !== S.length) errors.push(mk('R21', 'slides', 'duplicate slides', ''));
    const nums = numberedItems(S);
    const np = numberingProblem(nums);
    if (np) errors.push(mk('R21', 'slides', np, nums.join(', ')));
    const promised = promisedCount(S[0]);
    if (promised !== null) {
      const ok = nums.length ? firstListLength(nums) === promised : (promised === S.length - 2 || promised === S.length - 3);
      if (!ok) errors.push(mk('R21', 'slide 1', 'cover promises ' + promised + ', body has ' + (nums.length ? firstListLength(nums) : S.length - 2), S[0]));
    }
    if (S.length > 1) {
      const closing = String(piece.cta || '') + (piece.cta ? '. ' : '') + S[S.length - 1];
      const asks = [...new Set([...closing.matchAll(ASK_VERBS_RE)].map((m) => m[1].toLowerCase()))];
      if (asks.length > 1) errors.push(mk('R23', 'slide ' + S.length, 'more than one ask: ' + asks.join(', '), S[S.length - 1]));
    }
  }

  // ---- Instagram caption and image text
  if (shape === 'ig_carousel' || shape === 'ig_image') {
    if (shape === 'ig_carousel' && content.trim()) add(checkText(content, 'content', ctx));
    if (shape === 'ig_image') {
      add(checkText(content, 'image text', ctx));
      metrics.chars = content.length;
      if (content.length > LIMITS.ig_image_text) errors.push(mk('R18', 'image text', 'image text ' + content.length + ' chars (max 70)', content));
      if (!content.trim()) errors.push(mk('R18', 'image text', 'image text is empty', ''));
      if (countEmoji(content) > 0) errors.push(mk('R17', 'image text', 'emoji on the image', content));
      if (inlineTags(content).length) errors.push(mk('R16', 'image text', 'hashtag on the image', content));
      if (/\?\s*$/.test(firstLine(content))) errors.push(mk('R19', 'image text', 'question as the image line', content));
    }
    add(checkText(caption, 'caption', ctx));
    const L = LIMITS.ig_caption;
    const tags = inlineTags(caption).length + tagList.length;
    metrics.caption_chars = caption.length;
    metrics.hashtags = tags;
    metrics.emoji = countEmoji(caption);
    if (caption.length > L.max) errors.push(mk('R18', 'caption', 'caption ' + caption.length + ' chars (max ' + L.max + ')', ''));
    else if (caption.length > L.softMax) warnings.push(mk('R18', 'caption', 'caption ' + caption.length + ' chars, above the 600-900 target', ''));
    if (firstLine(caption).length > L.hookMax) errors.push(mk('R18', 'caption', 'caption first line ' + firstLine(caption).length + ' chars (max ' + L.hookMax + ')', firstLine(caption)));
    if (tags > L.hashtags) errors.push(mk('R16', 'caption', tags + ' hashtags (Instagram: 0-3)', tagList.concat(inlineTags(caption)).join(' ')));
    else if (!tagsAtEnd(caption)) errors.push(mk('R16', 'caption', 'hashtags must sit at the end of the caption', ''));
    if (metrics.emoji > L.emoji) errors.push(mk('R17', 'caption', metrics.emoji + ' emoji in caption (max 3)', ''));
    if (EMOJI_BULLET_RE.test(caption)) errors.push(mk('R17', 'caption', 'emoji used as a bullet', ''));
    const capParas = paragraphs(caption.replace(HASHTAG_RE, ' '));
    if (capParas.length) {
      const asks = [...new Set([...capParas[capParas.length - 1].matchAll(ASK_VERBS_RE)].map((m) => m[1].toLowerCase()))];
      if (asks.length > 1) errors.push(mk('R23', 'caption', 'more than one ask in the closing line: ' + asks.join(', '), capParas[capParas.length - 1]));
    }
  }

  // ---- closing line of text posts (R23)
  if (shape === 'x_tweet' || shape === 'li_text' || shape === 'li_carousel') {
    const ps = paragraphs(content.replace(HASHTAG_RE, ' '));
    if (ps.length) {
      const asks = [...new Set([...ps[ps.length - 1].matchAll(ASK_VERBS_RE)].map((m) => m[1].toLowerCase()))];
      if (asks.length > 1) errors.push(mk('R23', 'content', 'more than one ask in the close: ' + asks.join(', '), ps[ps.length - 1]));
    }
  }

  // ---- hashtags given as an array, and city tags on non-city posts (R16)
  tagList.forEach((h) => {
    if (!/^#[\p{L}\p{N}_]+$/u.test(h)) errors.push(mk('R16', 'hashtags', 'malformed hashtag: ' + h, h));
  });
  const allTags = tagList.concat(inlineTags(content), inlineTags(caption)).map((h) => h.toLowerCase());
  const bodyText = [content, caption].concat(slides).join(' ').replace(HASHTAG_RE, ' ').toLowerCase();
  allTags.forEach((h) => {
    const city = CITIES.find((c) => h.includes(c));
    if (city && !new RegExp('\\b' + city + '\\b').test(bodyText)) {
      errors.push(mk('R16', 'hashtags', 'city hashtag ' + h + ' on a post that is not about ' + city, h));
    }
  });

  // ---- R28 selling before the close (warn)
  const sellBody = (shape === 'ig_carousel' || shape === 'li_carousel') ? slides.slice(0, -1).join(NL) : paragraphs(content).slice(0, -1).join(NL);
  if (SELL_RE.test(sellBody) || SELL_BAT_RE.test(sellBody)) warnings.push(mk('R28', 'piece', 'sales mention before the last paragraph or slide', ''));

  const res = { ok: errors.length === 0, errors, warnings, metrics };
  if (fixed.content !== undefined) res.fixed = fixed;
  return res;
}

function topicOf(p) {
  if (!p) return '';
  if (p.topic) return String(p.topic);
  if (Array.isArray(p.slides) && p.slides.length) return String(p.slides[0]);
  return firstLine(p.content);
}

// items: pieces or n8n items ({ json: piece }). recentTopics: topics approved in the last 14 days (R24).
function lintBatch(items, facts, recentTopics) {
  const seen = (recentTopics || []).map(String);
  const results = (items || []).map((it) => {
    const piece = it && it.json && typeof it.json === 'object' ? it.json : it;
    const res = lintPiece(piece, facts);
    const topic = topicOf(piece);
    const hit = seen.find((old) => overlap(old, topic) > 0.5);
    if (hit) {
      res.errors.push(mk('R24', 'piece', 'topic repeats a recent or same-batch piece', hit));
      res.ok = false;
    }
    if (topic) seen.push(topic);
    return res;
  });
  const byRule = {};
  results.forEach((r) => r.errors.forEach((e) => { byRule[e.rule] = (byRule[e.rule] || 0) + 1; }));
  return {
    ok: results.every((r) => r.ok),
    results,
    summary: { pieces: results.length, passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, by_rule: byRule },
  };
}

try {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { RULES_VERSION, LIMITS, lintPiece, lintBatch, xWeightedLength, normNum };
  }
} catch (e) { /* not a CommonJS context */ }

// ---------------------------------------------------------------- n8n entry (runs only inside n8n)
if (typeof $input !== 'undefined') {
  let facts = null;
  let recent = [];
  try { const j = $('Facts').first().json; facts = j && j.facts && j.facts.facts ? j.facts : j; } catch (e) { facts = null; }
  try { recent = ($getWorkflowStaticData('global').approved || []).filter((a) => Date.now() - a.at < 1209600000).map((a) => a.topic); } catch (e) { recent = []; }
  const all = $input.all();
  const batch = lintBatch(all, facts, recent);
  return all.map((it, i) => ({ json: Object.assign({}, it.json, { lint: batch.results[i] }) }));
}
