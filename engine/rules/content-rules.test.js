// Tests for content-rules.js. Run: node --test (from this folder).
// Section 0 fixtures are copied verbatim from content/2026-07-24-bat-batch.md,
// 2026-07-28-bat-batch.md, 2026-07-28-bat-batch-v2.md and 2026-07-29-bat-calendar.md.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, 'content-rules.js');
const R = require(SRC);
const FACTS = JSON.parse(fs.readFileSync(path.join(__dirname, 'facts.base.json'), 'utf8'));
const NL = String.fromCharCode(10);
const YEAR = new Date().getFullYear();

const lint = (p, f) => R.lintPiece(p, f || FACTS);
const ids = (res) => new Set(res.errors.map((e) => e.rule));
const warnIds = (res) => new Set(res.warnings.map((e) => e.rule));
const lines = (...a) => a.join(NL);

function expectReject(res, rules) {
  const got = ids(res);
  assert.strictEqual(res.ok, false, 'expected a reject, got ok. warnings: ' + JSON.stringify(res.warnings));
  for (const r of rules) {
    assert.ok(got.has(r), 'expected ' + r + ', got ' + JSON.stringify(res.errors, null, 1));
  }
}
function expectPass(res) {
  assert.strictEqual(res.ok, true, 'expected pass, got: ' + JSON.stringify(res.errors, null, 1));
}
function hasExcerpt(res, rule, needle) {
  return res.errors.some((e) => e.rule === rule && (e.excerpt + ' ' + e.message).includes(needle));
}

// Splits the old "S1: .. | S2: .." batch format into slides.
const splitSlides = (s) => s.split(' | ').map((x) => x.replace(/^S\d+: /, ''));

// ================================================================ section 0: real failures

test('R0.1 24 Jul IG carousel: invented "60%" statistic is rejected (R1)', () => {
  const res = lint({
    platform: 'instagram', type: 'carousel', template: null, content: '',
    slides: splitSlides("S1: Why 60% of small business web leads go cold in 15 minutes. | S2: Most teams take 4 to 24 hours to reply to a web form inquiry. | S3: A prospect fills out three forms at once. The first business to answer gets the call. | S4: AI auto-responders read the message, qualify the fit, and book a calendar slot in 30 seconds. | S5: Your sales team wakes up to qualified appointments, not raw unvetted leads. | S6: Want this set up on your site? DM us 'LEADS'."),
    caption: 'Slow response times kill lead conversion rates. Automated routing turns forms into booked meetings instantly. What is your current average response time for inquiries?',
    hashtags: ['#AIautomation', '#SMB', '#LeadGeneration', '#BusinessOperations', '#SalesAutomation', '#BangaloreTech'],
  });
  expectReject(res, ['R1', 'R13', 'R16']);
  assert.ok(hasExcerpt(res, 'R1', '60%'));
});

test('R0.2 24 Jul X: "80% of customer support emails" is rejected (R1)', () => {
  const res = lint({ platform: 'x', type: 'tweet', template: null,
    content: '80% of customer support emails ask the same 5 questions: pricing, hours, location, booking, and policies. An AI agent trained on your internal docs answers these instantly 24/7. Your team handles only the remaining 20%.' });
  expectReject(res, ['R1']);
  assert.ok(hasExcerpt(res, 'R1', '80%'));
  assert.ok(hasExcerpt(res, 'R1', '24/7'));
});

test('R0.3 24 Jul X: no-shows "20%" and "over half" rejected (R1, R2, R14)', () => {
  const res = lint({ platform: 'x', type: 'tweet', template: null,
    content: 'No-shows cost service businesses up to 20% of daily revenue. Automated WhatsApp and SMS reminders with 1-click confirmation links reduce missed appointments by over half. Zero manual staff calls required.' });
  expectReject(res, ['R1', 'R2', 'R14']);
});

// v1.2: the audience is worldwide, so the tools here are fine. The post still fails on invented numbers.
test('R0.4 24 Jul LinkedIn: "QuickBooks, Xero, and Tally" post rejected for its invented numbers (R1), not the tools', () => {
  const content = lines(
    'An employee spending 10 hours a week on manual invoice entry spends 500 hours a year on administrative maintenance.', '',
    'At standard pay scales, that is significant capital spent moving numbers from PDFs into spreadsheets.', '',
    'It also introduces human error: missing digits, duplicate entries, and late payment penalties.', '',
    'AI document processing handles this in four steps:',
    '1. An email arrives with an attached PDF invoice.',
    '2. The system extracts vendor name, total amount, line items, and due date.',
    '3. Data maps directly into your accounting system.',
    '4. Your team receives a notification to approve payment with one click.', '',
    'Processing time drops from 15 minutes per invoice to 10 seconds.', '',
    'Custom software built from scratch is unnecessary. Existing AI workflows integrate directly into tools like QuickBooks, Xero, and Tally.', '',
    'Stop paying human rates for copy-paste operations. Put your team back on high-value work.');
  const res = lint({ platform: 'linkedin', type: 'post', template: null, content });
  expectReject(res, ['R1']);
  assert.ok(hasExcerpt(res, 'R1', '500 hours'));
  assert.ok(!ids(res).has('R6') && !hasExcerpt(res, 'R1', 'QuickBooks'), 'global tools are allowed in v1.2');
});

test('R0.5 28 Jul IG: "78% of buyers" and "Setup takes 3 days. Saves 50+ hours" rejected (R1)', () => {
  const res = lint({
    platform: 'instagram', type: 'carousel', template: null, content: '',
    slides: splitSlides('S1: Your team loses 14 hours a week on manual lead sorting. | S2: Average response time to a website form is 5 hours. | S3: 78% of buyers purchase from the company that responds first. | S4: An AI workflow tags, routes, and replies in 45 seconds. | S5: Setup takes 3 days. Saves 50+ hours every month. | S6: Send us a DM with TRIAGE to see a live demo flow.'),
    caption: 'Manual data entry slows down your sales cycle. Automated routing puts instant answers in front of warm leads. What is your current average response time?',
    hashtags: ['#AIAutomation', '#SmallBusiness', '#WorkflowAutomation', '#BusinessEfficiency', '#LeadGeneration', '#Operations', '#TechForBusiness', '#BangaloreTech'],
  });
  expectReject(res, ['R1', 'R13']);
  assert.ok(hasExcerpt(res, 'R1', '78%'));
  assert.ok(hasExcerpt(res, 'R1', '3 days'));
  assert.ok(hasExcerpt(res, 'R1', '50+'));
});

test('R0.6 28 Jul LinkedIn: "$30 per user for CRM. $20 for invoicing." rejected as unconfirmed numbers (R1), not for the dollar sign', () => {
  const content = lines(
    'Most small businesses run on 8 to 12 different software subscriptions.', '',
    'You pay $30 per user for CRM. $20 for invoicing. $15 for scheduling. $50 for email marketing.', '',
    'The monthly bill stacks up fast. Worse, none of these tools talk to each other without manual copy-pasting.', '',
    'When you build custom internal automation on your own infrastructure:',
    '1. You own the workflow outright.',
    '2. You stop paying per-seat recurring fees for simple logic.',
    '3. Data moves between your database, email, and WhatsApp instantly.', '',
    'Example: An incoming web form creates a database entry, checks stock, generates a PDF quote, and sends a WhatsApp message in 12 seconds.', '',
    'Zero human intervention. No monthly SaaS markup on basic API calls.', '',
    'We build these exact systems for service businesses and local suppliers.', '',
    'Fix the process first. Then lock it into code.');
  const res = lint({ platform: 'linkedin', type: 'post', template: null, content });
  expectReject(res, ['R1', 'R14']);
  assert.ok(hasExcerpt(res, 'R1', '$30'));
  assert.ok(!ids(res).has('R5'), 'USD is the house currency in v1.2');
});

test('R0.7 28 Jul LinkedIn: "drops support ticket volume by 40% in week one" rejected (R1)', () => {
  const content = lines(
    'In India and SE Asia, email open rates hover around 15%. WhatsApp open rates sit above 90%.', '',
    'Yet most small businesses still run customer operations through personal WhatsApp phones or manual email threads.', '',
    'This creates three distinct failure points:',
    '- Staff spend 3 hours daily answering where is my order?',
    '- Customer interaction data stays trapped on individual handsets.',
    '- Leads drop off when staff go off shift.', '',
    'The fix is connecting the official WhatsApp Business API directly to your core database.', '',
    'When a customer texts their order ID:',
    '1. An automated worker queries your database.',
    '2. Returns real-time status in 3 seconds.',
    '3. Escalates to a human only if an exception flag is triggered.', '',
    'This drops support ticket volume by 40% in week one.', '',
    'Simple logic beats complex hires.');
  const res = lint({ platform: 'linkedin', type: 'post', template: null, content });
  expectReject(res, ['R1']);
  assert.ok(hasExcerpt(res, 'R1', '40%'));
});

test('R0.8 28 Jul X: invented case study "We rebuilt a local supplier site" rejected (R1, R3)', () => {
  const content = lines(
    'A business website taking 4 seconds to load loses 25% of visitors before the page renders.', '',
    'We rebuilt a local supplier site using clean code and zero heavy plugins.', '',
    'Load time dropped from 4.2s to 0.8s.',
    'Inquiries increased by 18% in 30 days without extra ad spend.');
  const res = lint({ platform: 'x', type: 'tweet', template: null, content });
  expectReject(res, ['R1', 'R3']);
  assert.ok(hasExcerpt(res, 'R3', 'rebuilt'));
});

test('R0.9 28 Jul v2 IG: "Comment \'SYSTEM\' for a free audit" and "Stop paying hosting fees" rejected (R13, R9)', () => {
  const res = lint({
    platform: 'instagram', type: 'carousel', template: null, content: '',
    slides: splitSlides("S1: Your website is your worst employee. | S2: It opens at 9, closes at 6, and leaves every client question on read. | S3: A proper website answers pricing, books Calendly meetings, and captures leads at 2 AM. | S4: Stop paying hosting fees for an online brochure that does zero work. | S5: Turn your site into a 24/7 account executive that handles admin tasks. | S6: BAT builds websites that do real labor. Comment 'SYSTEM' for a free audit."),
    caption: 'Most small business websites are digital paperweights. They hand all customer communication straight back to your busy office staff. If a visitor has to wait until morning for a quote, they bought from your competitor at midnight. What is the single biggest task your current website fails to handle?',
    hashtags: ['#smallbusiness', '#webdevelopment', '#automation', '#bangaloretech', '#businesssystems', '#operations', '#scale'],
  });
  expectReject(res, ['R13', 'R9']);
  assert.ok(hasExcerpt(res, 'R13', 'SYSTEM'));
  assert.ok(warnIds(res).has('R27'), 'prevalence claim "Most small business websites" should warn');
});

test('R0.10 28 Jul v2 X: staccato "No code. No new hire." rejected (R9)', () => {
  const content = lines(
    'No code. No new hire.', '',
    'Just a website that calculates custom quotes, checks inventory, and books sales calls at 11 PM while your team sleeps.', '',
    "If your site only displays text and a 'Contact Us' button, it is a brochure, not a tool.");
  const res = lint({ platform: 'x', type: 'tweet', template: null, content });
  expectReject(res, ['R9']);
  assert.ok(hasExcerpt(res, 'R9', 'No code'));
});

test('R0.11 28 Jul v2 IG tags: a city hashtag ("#bangaloretech", "#londonbusiness") on a post not about that city rejected (R16)', () => {
  const res = lint({
    platform: 'instagram', type: 'image', template: null,
    content: 'Your website closes when your office does.',
    caption: lines('An enquiry form that lands in an inbox nobody opens is a closed shop door.', '', 'Send the form into WhatsApp and a sheet, so the receptionist sees it the same evening.'),
    hashtags: ['#smallbusiness', '#webdevelopment', '#bangaloretech'],
  });
  expectReject(res, ['R16']);
  assert.deepStrictEqual([...ids(res)], ['R16'], 'only the city tag should fail');
  const inCity = lint({ platform: 'instagram', type: 'image', template: null, content: 'Your Bangalore showroom closes at night. Your website does not.',
    caption: 'Enquiries still arrive after the shutters come down.', hashtags: ['#bangaloretech'] });
  assert.ok(!ids(inCity).has('R16'), JSON.stringify(inCity.errors));
  assert.ok(hasExcerpt(res, 'R16', 'bangalore'));
  const london = lint({ platform: 'instagram', type: 'image', template: null, content: 'Your website closes when your office does.',
    caption: 'Enquiries still arrive after the shutters come down.', hashtags: ['#londonbusiness'] });
  expectReject(london, ['R16']);
  assert.ok(hasExcerpt(london, 'R16', 'london'));
  const increase = lint({ platform: 'instagram', type: 'image', template: null, content: 'Your website closes when your office does.',
    caption: 'Enquiries still arrive after the shutters come down.', hashtags: ['#increasesales'] });
  assert.ok(!ids(increase).has('R16'), 'a place name hidden inside an ordinary word is not a city tag: ' + JSON.stringify(increase.errors));
});

test('R0.12 29 Jul LinkedIn carousel: "Step 1, 4, 3, 4" numbering and invented conversion rates rejected (R21, R1)', () => {
  const res = lint({
    platform: 'linkedin', type: 'carousel', template: null,
    content: 'Your 4-hour lead response time is killing your sales. Here is how 15-person teams fix it with a webhook, an AI parser, an alert and a calendar link. The steps below cover the whole path from form to booked call, and none of them needs a developer on staff. Save the document for the next time a lead waits overnight.',
    slides: [
      'Your 4-hour lead response time is killing your sales.',
      '5 minutes late equals an 80% drop in lead qualification. Here is how 15-person teams fix it in 4 steps.',
      'Step 1: Webhook Catch. Stop manually checking inbox submissions. Connect your web form directly to Make or Zapier via webhook.',
      'Step 4: Instant AI Parsing. Pass incoming form data to an LLM call. Parse intent, budget, and company size in 1.8 seconds.',
      "Step 3: Slack and SMS Alert. Route qualified leads directly to your sales rep's phone with a pre-formatted draft response.",
      'Step 4: Auto-Calendar Dispatch. Send an automated, personalized follow-up email with a rep-specific booking link under 60 seconds.',
      'The System Result. Old Way: 240 minutes, 12% conversion rate. Automated Way: 45 seconds, 38% conversion rate. Zero extra staff needed.',
      "Want us to build this exact lead engine for your business? DM us 'SYSTEM'.",
    ],
  });
  expectReject(res, ['R21', 'R1', 'R13']);
  assert.ok(res.errors.some((e) => e.rule === 'R21' && /number/i.test(e.message)), 'numbering error expected');
  assert.ok(hasExcerpt(res, 'R1', '12%'));
});

test('R0.13 29 Jul X: "$60,000 salary ... into QuickBooks" rejected for the invented numbers (R1, R9), not for $ or the tool', () => {
  const content = lines(
    "Paying a $60,000 salary for a staff member to copy invoice data from PDF into QuickBooks isn't employment. It's a very expensive copy-paste routine.", '',
    'A $30/month API script does it in 2 seconds without typos.');
  const res = lint({ platform: 'x', type: 'tweet', template: null, content });
  expectReject(res, ['R1', 'R9']);
  assert.ok(hasExcerpt(res, 'R1', '$60,000'));
  assert.ok(hasExcerpt(res, 'R1', '$30'));
  assert.ok(!ids(res).has('R5') && !ids(res).has('R6'));
});

test('R0.14 the best real July line (24 Jul X decision rule) passes', () => {
  const res = lint({ platform: 'x', type: 'tweet', template: null,
    content: 'If a process in your business follows a clear, written SOP, it can be automated. If it requires subjective human judgment every single time, keep a human on it. Map your repeated daily tasks before buying new software.' });
  expectPass(res);
});

// ================================================================ good pieces, T1 to T4

const T1 = {
  platform: 'instagram', type: 'carousel', template: 'T1', content: '',
  slides: [
    'What delivery apps send after you order',
    'The first message repeats what you ordered, in plain words, straight away.',
    'The next message says when it will arrive, before you have to ask.',
    'When something goes wrong, the message names a person you can reach.',
    'A clinic can copy this: confirm every booking on WhatsApp the moment it is made.',
    'Confirm what they asked for. Say when it happens. Name who to call. Save this before you set up booking replies.',
  ],
  caption: lines(
    'Delivery apps have trained your customers to expect a confirmation the moment they book.', '',
    'You do not need an app to match it. A WhatsApp Business message that repeats the booking, gives the time and names the receptionist covers most of what those apps do.', '',
    'Save this for whoever handles bookings at your front desk.'),
  hashtags: ['#clinicmanagement', '#whatsappbusiness'],
};

const T2 = {
  platform: 'instagram', type: 'carousel', template: 'T2', content: '',
  slides: [
    '4 payment reminder messages you can copy today',
    '1. On the due date: Hi [Customer], invoice [No.] for $[amount] is due today. You can pay by card here: [payment link]. Thank you.',
    '2. A few days later: Hi [Customer], a gentle reminder that invoice [No.] is still open. Reply PAID if you have already paid.',
    '3. After a week: Hi [Customer], invoice [No.] for $[amount] is now a week overdue. Can you share a payment date?',
    '4. Hand it to a person: after the third message, your accountant calls. There is no fourth automatic reminder.',
    'Polite on the due date. Gentle a few days later. Firm after a week. Then a phone call. Save this for your accountant.',
  ],
  caption: lines(
    'Four reminder messages for unpaid invoices, from polite to firm, ready to paste into WhatsApp.', '',
    'The wording changes at each step because the relationship matters more than one late payment. Keep disputed bills and key accounts off the automatic list, and let your accountant make the call after the third message.', '',
    'Save this for whoever sends reminders from the office phone.'),
  hashtags: ['#paymentreminders', '#invoicing', '#smallbusiness'],
};

const T3 = {
  platform: 'instagram', type: 'carousel', template: 'T3', content: '',
  slides: [
    'WHAT A WHATSAPP AI AGENT CAN AND CANNOT ANSWER',
    'It can answer the questions your price list and clinic timings already answer.',
    'It cannot decide a discount or a refund. Those go to a person.',
    'The handoff is the part to check: the chat moves to your receptionist with its history.',
    'Ask any vendor who gets alerted when the agent breaks, and how you switch it off.',
    'Price list questions go to the agent. Discounts and complaints go to a person. Save this before you speak to a vendor.',
  ],
  caption: lines(
    'A WhatsApp agent is good at the questions your price list already answers.', '',
    'It is bad at anything that needs judgement: a discount, a refund, an angry patient. Before anyone builds one for your clinic, decide the exact moment the chat moves to your receptionist, and who gets a message when the agent stops replying.', '',
    'Save this for the next time a vendor pitches you a bot.'),
  hashtags: [],
};

const T4 = {
  platform: 'instagram', type: 'carousel', template: 'T4', content: '',
  slides: [
    'Hiring another admin person is the expensive fix',
    'Reminder calls and retyping from QuickBooks follow rules that can be written down.',
    'Write each rule down once and a system can run it every day.',
    'Keep your people for the calls that need judgement.',
    'Save this before the next hiring conversation.',
  ],
  caption: lines(
    'Before you hire for admin work, list the jobs that follow a rule.', '',
    'Payment reminders on the due date, a booking confirmation on WhatsApp, the Monday sales sheet: each of these can be written as a rule once. The person you were about to hire is better spent on the customer who needs a phone call.', '',
    'Save this before your next hiring conversation.'),
  hashtags: ['#smallbusiness'],
};

test('T1 business move breakdown carousel passes', () => expectPass(lint(T1)));
test('T2 saveable resource carousel passes (placeholders, "Reply here", 4 numbered items)', () => expectPass(lint(T2)));
test('T3 AI explained carousel passes', () => expectPass(lint(T3)));
test('T4 one belief carousel passes with 5 slides', () => expectPass(lint(T4)));

const LI_PAGE = lines(
  'Hiring another receptionist, or letting the missed calls go. Both leave the same gap: nobody replies after 7 PM.', '',
  'Picture a dental clinic at closing time. The front desk phone rings twice after the receptionist has left, and a WhatsApp enquiry about teeth cleaning sits unread until the next morning. By then the patient has booked somewhere that answered.', '',
  'The fix is smaller than a hire. A missed call can trigger a WhatsApp Business message that offers two callback slots for the next morning. The receptionist opens the day with a list of people who picked a slot, instead of a call log to work through.', '',
  'What to set up this week:',
  '1. Write the one message a missed caller gets, in the tone your receptionist uses.',
  '2. Decide the two callback slots the front desk can keep every day.',
  '3. Keep a person on anything about pain, refunds or a complaint.', '',
  'A salary is the expensive way to answer a question a rule can answer. Who in your clinic sees the missed calls from last night?');

test('LinkedIn company page post (900-1300 chars, no hashtags) passes', () => {
  const p = { platform: 'linkedin-page', type: 'image', template: 'T4', content: LI_PAGE };
  const res = lint(p);
  assert.ok(LI_PAGE.length >= 900 && LI_PAGE.length <= 1300, 'fixture length ' + LI_PAGE.length);
  expectPass(res);
});

test('Instagram single image passes', () => {
  expectPass(lint({
    platform: 'instagram', type: 'image', template: 'T4',
    content: 'Your website closes when your office does.',
    caption: lines('An enquiry form that drops into an inbox nobody opens waits until someone is free.', '', 'Send the form into WhatsApp and a Google Sheet, so the receptionist sees it the same evening.'),
    hashtags: ['#websitesforbusiness'],
  }));
});

// ================================================================ v1.1 platform limits

test('v1.1 IG: 4 slides rejected, 11 slides rejected, 9 slides passes with a warning (R21)', () => {
  const base = { platform: 'instagram', type: 'carousel', template: null, content: '', caption: T4.caption, hashtags: [] };
  const mk = (n) => Array.from({ length: n }, (_, i) => i === 0 ? 'Hiring another admin person is the expensive fix'
    : i === n - 1 ? 'Save this before the next hiring conversation.'
    : ['Reminder calls follow a rule', 'QuickBooks exports follow a rule', 'Booking confirmations follow a rule', 'The Monday sheet follows a rule',
       'Quote follow-ups follow a rule', 'Delivery updates follow a rule', 'Ledger statements follow a rule', 'Missed call replies follow a rule',
       'Review requests follow a rule'][i - 1] + ' you can write down once.');
  expectReject(lint({ ...base, slides: mk(4) }), ['R21']);
  expectReject(lint({ ...base, slides: mk(11) }), ['R21']);
  const nine = lint({ ...base, slides: mk(9) });
  expectPass(nine);
  assert.ok(warnIds(nine).has('R21'));
});

test('v1.1 IG: 0 to 3 hashtags; 4 rejected, including tags written inline in the caption (R16)', () => {
  expectReject(lint({ ...T2, hashtags: ['#a1', '#b2', '#c3', '#d4'] }), ['R16']);
  expectReject(lint({ ...T2, hashtags: ['#paymentreminders', '#invoicing'], caption: T2.caption + NL + NL + '#invoices #whatsappbusiness' }), ['R16']);
  expectPass(lint({ ...T2, hashtags: [] }));
});

test('v1.1 LinkedIn page: under 900 chars rejected, any hashtag rejected (R18, R16)', () => {
  expectReject(lint({ platform: 'linkedin-page', type: 'post', template: null, content: LI_PAGE.slice(0, 800) }), ['R18']);
  expectReject(lint({ platform: 'linkedin-page', type: 'post', template: null, content: LI_PAGE + NL + NL + '#clinics' }), ['R16']);
});

test('v1.1 "Save this" CTA allowed; a second ask on the last slide rejected (R23)', () => {
  expectPass(lint(T4));
  const two = { ...T4, slides: [...T4.slides.slice(0, -1), 'Save this for later. Follow us for the next one.'] };
  expectReject(lint(two), ['R23']);
});

test('v1.1 comment-keyword CTA banned in captions and posts (R13)', () => {
  expectReject(lint({ ...T4, caption: T4.caption + NL + NL + 'Comment RULES and we will send the checklist.' }), ['R13']);
  expectReject(lint({ platform: 'x', type: 'tweet', template: null, content: 'Every reminder your accountant types by hand is a rule nobody wrote down. DM us "RULES" for the list.' }), ['R13']);
});

test('articles are paused (FORMAT)', () => {
  expectReject(lint({ platform: 'linkedin', type: 'article', template: null, content: LI_PAGE }), ['FORMAT']);
});

// ================================================================ numbers whitelist (R1) and exemptions

const tweet = (content, extra) => lint({ platform: 'x', type: 'tweet', template: null, content, ...(extra || {}) });

test('R1 exemption: clock times ("10:40 PM", "11 PM", "21:30") pass', () => {
  expectPass(tweet('10:40 PM. Scrolling the shop WhatsApp to find which customer asked for the quotation. A shared inbox with one owner per chat fixes that.'));
  expectPass(tweet('The enquiry lands at 11 PM and the reply goes out at 21:30 the next day. Put a first reply on a rule and keep the quote with a person.'));
});

test('R1 exemption: list numbering and "5 jobs" count pass; broken numbering and a wrong count rejected (R21)', () => {
  const good = lines('5 jobs to hand to a system before you hire another sales assistant:',
    '1. Missed call replies', '2. Booking confirmations', '3. Payment reminders', '4. The Monday sales sheet', '5. Quote follow-ups');
  expectPass(tweet(good));
  const gap = lines('3 jobs to hand to a system before you hire another sales assistant:', '1. Missed call replies', '2. Booking confirmations', '4. Payment reminders');
  expectReject(tweet(gap), ['R21']);
  const short = lines('5 jobs to hand to a system before you hire another sales assistant:', '1. Missed call replies', '2. Booking confirmations', '3. Payment reminders', '4. Quote follow-ups');
  expectReject(tweet(short), ['R21']);
});

test('R1 exemption: hypothetical counts pass ("Say you send 40 invoices"); hypothetical % and a third count rejected', () => {
  expectPass(tweet('Say you send 40 invoices a month from QuickBooks. Every one of them needs the same polite reminder, and none of them needs your accountant to type it.'));
  expectReject(tweet('Say your reply rate goes up 40% once reminders go out on WhatsApp. That is the reason to write the rule this week.'), ['R1']);
  expectReject(tweet('Picture a distributor with 60 retailers. Say 25 of them pay late and 12 of them dispute a bill. Those are three different reminder lists.'), ['R1']);
});

// Fixture facts. Not real BAT prices: the example file has no confirmed USD price yet.
const clone = (o) => JSON.parse(JSON.stringify(o));
function withFacts(entries) {
  const f = clone(FACTS);
  entries.forEach((e, i) => f.facts.push(Object.assign({
    id: 'fixture.' + i, pillar: [], claim: 'test fixture', forms: [], status: 'confirmed', public: true,
    usage: 'normal', source: 'test fixture', confirmed_by: 'test', confirmed_on: '2026-09-14', review_by: '2099-12-31', notes: '',
  }, e)));
  return f;
}
const USD_FACTS = withFacts([{ forms: ['$1,500', '$2,000', '$15 per user', '$150,000'] }]);
const tweetF = (content, f) => lint({ platform: 'x', type: 'tweet', template: null, content }, f);

test('R1: $ prices from facts pass in every written form ($1,500, $1.5K, US$1,500, 1,500 USD, $2k, $1,500/month, $15 per user)', () => {
  expectPass(tweetF('A landing page from us starts at $1,500. The contact form sends every enquiry to WhatsApp so nobody has to check an inbox.', USD_FACTS));
  expectPass(tweetF('A landing page from us starts at $1.5K, and the contact form sends every enquiry straight to your WhatsApp.', USD_FACTS));
  expectPass(tweetF('A landing page from us starts at US$1,500, or 1,500 USD if your accountant asks for it written that way.', USD_FACTS));
  expectPass(tweetF('A business website from us starts at $2k, and every enquiry still lands in WhatsApp for the front desk.', USD_FACTS));
  expectPass(tweetF('Site support is $1,500/month, and the shared inbox your team logs into is $15 per user on top of that.', USD_FACTS));
  expectReject(tweetF('The shared inbox your team logs into is $15 per month, on top of the site support you already pay for.', USD_FACTS), ['R1']);
  expectReject(tweetF('A landing page from us starts at $1,600. The contact form sends every enquiry to WhatsApp so nobody has to check an inbox.', USD_FACTS), ['R1']);
  assert.strictEqual(R.normNum('$1.5K'), R.normNum('$1,500'));
  assert.strictEqual(R.normNum('US$2.5M'), R.normNum('$2,500,000'));
  assert.strictEqual(R.normNum('1,500 USD'), R.normNum('$1,500'));
  assert.strictEqual(R.normNum('$1,500 a month'), R.normNum('$1,500/month'));
});

test('R1: unconfirmed $ prices are rejected (example facts carry no confirmed USD price; needs_fact and non-public never whitelist)', () => {
  const landing = FACTS.facts.find((x) => x.id === 'price.landing.from');
  assert.ok(landing && landing.status !== 'confirmed' && landing.public !== true, 'price entries must be unconfirmed until a USD price list exists');
  assert.ok(!FACTS.facts.some((x) => x.id.startsWith('price.') && x.status === 'confirmed'), 'no confirmed price entries in the example file');
  const line = 'A landing page from us starts at $1,500. The contact form sends every enquiry to WhatsApp so nobody has to check an inbox.';
  expectReject(tweet(line), ['R1']);
  expectReject(tweetF(line, withFacts([{ forms: ['$1,500'], status: 'needs_fact' }])), ['R1']);
  expectReject(tweetF(line, withFacts([{ forms: ['$1,500'], public: false }])), ['R1']);
  expectReject(tweet('Paying a $60,000 salary for someone to retype invoices from QuickBooks into WhatsApp is the expensive way to send reminders.'), ['R1']);
});

test('R5: rupee, pound and euro in BAT\'s own claims rejected, even when the number is a confirmed fact', () => {
  const rupee = tweet('A landing page from us starts at ₹9,000. The contact form sends every enquiry straight to WhatsApp.');
  expectReject(rupee, ['R5', 'R1']);
  const confirmedRupee = tweetF('A landing page from us starts at ₹9,000. The contact form sends every enquiry straight to WhatsApp.', withFacts([{ forms: ['₹9,000'] }]));
  expectReject(confirmedRupee, ['R5']);
  assert.ok(!ids(confirmedRupee).has('R1'));
  const f = withFacts([{ forms: ['15,000', '1,200', '900', '2 lakh', '5 crore'] }]);
  for (const money of ['Rs 15,000', 'INR 15,000', '£1,200', '€900', '2 lakh', '5 crore']) {
    expectReject(tweetF('A landing page from us costs ' + money + ', and the contact form sends every enquiry straight to WhatsApp.', f), ['R5']);
  }
  const dollars = tweetF('A landing page from us starts at $1,500. The contact form sends every enquiry straight to WhatsApp.', USD_FACTS);
  expectPass(dollars);
  assert.ok(!ids(tweet('A landing page from us starts at USD 1,500 and every enquiry goes to WhatsApp.')).has('R5'));
});

test('R1: fact ranges pass ("7 to 10 days"); an invented "3 days" delivery promise rejected', () => {
  expectPass(tweet('A landing page takes 7 to 10 days once your photos, prices and wording are with us. The wait is almost always the inputs.'));
  expectReject(tweet('Setup takes 3 days and the reminders start going out on WhatsApp the same week. Your accountant stops typing them.'), ['R1']);
});

test('R1: quote_only facts only in P5 build-log pieces; non-public and expired facts never whitelist', () => {
  const f = JSON.parse(JSON.stringify(FACTS));
  const stat = f.facts.find((x) => x.id === 'engine.invented_stat_jul29');
  const line = 'Our content bot once wrote that replying 5 minutes late causes an 80% drop in lead qualification. It had no source. It cannot post a number now unless the number is in our facts file.';
  expectReject(tweet(line, { pillar: 'P5' }), ['R1']); // public: false in the example file
  stat.public = true;
  expectPass(lint({ platform: 'x', type: 'tweet', template: null, pillar: 'P5', content: line }, f));
  expectReject(lint({ platform: 'x', type: 'tweet', template: null, pillar: 'P1', content: line }, f), ['R1']);
  const old = withFacts([{ forms: ['$1,500'], review_by: '2020-01-01' }]);
  expectReject(lint({ platform: 'x', type: 'tweet', template: null, content: 'A landing page from us starts at $1,500. The contact form drops straight into WhatsApp.' }, old), ['R1']);
});

test('R1 exemptions: "day 3" ladders, "02/07" counters, ordinals and dates pass; "24/7" rejected', () => {
  expectPass(tweet('A site-visit follow-up ladder: a thank-you on day 0, the brochure on day 1, a slot offer on day 3. After the 3rd message a person calls.'));
  expectPass(tweet('On 9 September the reminder rule went into the shared sheet, and slide 02/07 shows the exact wording to paste.'));
  expectReject(tweet('A WhatsApp bot answers your customers 24/7 while the office is closed and the owner is asleep at home.'), ['R1']);
});

test('R7: a year other than the current one rejected; the current year passes', () => {
  expectReject(tweet('In 2019 every clinic owner we know still wrote the appointment book by hand, and many of them still do.'), ['R7']);
  expectPass(tweet('In ' + YEAR + ' plenty of clinics still keep the appointment book as a paper diary at the front desk, and that is fine for now.'));
});

// ================================================================ X weighted length and emoji

test('X length: $ counts as 1, emoji count as 2 (270 passes, 271 rejected); two emoji rejected (R18, R17)', () => {
  const pad = (n) => 'Reminders go out from the system, not the owner phone. '.repeat(10).slice(0, n);
  assert.strictEqual(R.xWeightedLength('$'), 1);
  assert.strictEqual(R.xWeightedLength('👍'), 2);
  assert.strictEqual(R.xWeightedLength('👨‍👩‍👧'), 2);
  assert.strictEqual(R.xWeightedLength('abc'), 3);
  expectPass(tweet(pad(269) + '$'));
  expectReject(tweet(pad(270) + '$'), ['R18']);
  expectPass(tweet(pad(268) + '👍'));
  expectReject(tweet(pad(269) + '👍'), ['R18']);
  expectReject(tweet(pad(100) + ' 👍 👍'), ['R17']);
  expectReject(tweet('Too short.'), ['R18']);
});

test('emoji: IG caption max 3, never as a bullet, none on slides; LinkedIn none in the hook (R17)', () => {
  expectReject(lint({ ...T4, caption: T4.caption + ' 👍👍👍👍' }), ['R17']);
  expectReject(lint({ ...T4, caption: T4.caption + NL + '✅ Payment reminders' }), ['R17']);
  expectReject(lint({ ...T4, slides: [T4.slides[0], T4.slides[1] + ' ✅', ...T4.slides.slice(2)] }), ['R17']);
  expectReject(lint({ platform: 'linkedin-page', type: 'post', template: null, content: '🔥 ' + LI_PAGE }), ['R17']);
});

// ================================================================ words, phrases, format

test('R8/R9/R4/R14: banned words and phrases rejected', () => {
  const base = 'Your receptionist types the same booking confirmation on WhatsApp all day. ';
  expectReject(tweet(base + 'A seamless reminder rule fixes that.'), ['R8']);
  expectReject(tweet("Here's how a receptionist stops typing the same booking confirmation on WhatsApp all day."), ['R9']);
  expectReject(tweet(base + 'Studies show a rule fixes that.'), ['R4']);
  expectReject(tweet(base + 'A fully automated rule fixes that.'), ['R14']);
  expectReject(tweet(base + 'Thoughts?'), ['R9']);
  expectReject(tweet("It's not a staffing problem, it's a missing rule. " + base), ['R9']);
});

test('R10: 3 AI-tell markers in one paragraph rejected, 2 warn', () => {
  expectReject(tweet('Ultimately, the right solutions help your team navigate the day. Put the reminder on a rule in Xero.'), ['R10']);
  const two = tweet('Ultimately, the right solutions help your receptionist. Put the booking reminder on a rule in WhatsApp this week.');
  expectPass(two);
  assert.ok(warnIds(two).has('R10'));
});

test('R11/R12/R15/R20: dashes, curly quotes (autofixed), links and formatting leaks', () => {
  const base = 'Your receptionist types the same booking confirmation on WhatsApp all day';
  expectReject(tweet(base + '— a rule fixes that.'), ['R11']);
  expectReject(tweet(base + ' -- a rule fixes that.'), ['R11']);
  expectPass(tweet(base + ', and a follow-up rule fixes that.'));
  const curly = tweet(base + ', and a “thank you” rule fixes that.');
  expectPass(curly);
  assert.ok(warnIds(curly).has('R12'));
  assert.ok(curly.fixed && curly.fixed.content.includes('"thank you"'));
  expectReject(tweet(base + '. See blackarrowtechnologies.com for more.'), ['R15']);
  expectReject(tweet(base + '. See https://example.org for more.'), ['R15']);
  expectReject(tweet(base + '. **A rule fixes that.**'), ['R20']);
  expectReject(lint({ platform: 'linkedin-page', type: 'post', template: null, content: LI_PAGE.replace('Picture a dental clinic', '[Your Name] here. Picture a dental clinic') }), ['R20']);
});

test('R19/R22/R25: question hook, client names, hollow triad', () => {
  expectReject(tweet('Who replies to your WhatsApp enquiries after 7 PM?' + NL + 'If nobody does, a first reply rule covers the gap until morning.'), ['R19']);
  expectReject(tweet('We redid the enquiry form for Northwind so it lands in WhatsApp. Your form can do the same thing.'), ['R22']);
  expectReject(tweet('A reminder rule in Xero makes collections faster, cheaper and better for the accountant who used to type them.'), ['R25']);
});

// ================================================================ v1.2: worldwide audience, USD

test('v1.2 R29: Indian digit grouping (1,50,000) warns; western grouping (150,000) does not', () => {
  const indian = tweetF('Hiring a second office manager at $1,50,000 a year is the expensive way to send payment reminders.', USD_FACTS);
  expectPass(indian);
  assert.ok(warnIds(indian).has('R29'), JSON.stringify(indian.warnings));
  const western = tweetF('Hiring a second office manager at $150,000 a year is the expensive way to send payment reminders.', USD_FACTS);
  expectPass(western);
  assert.ok(!warnIds(western).has('R29'), JSON.stringify(western.warnings));
  assert.ok(warnIds(tweet('The shop logged 12,50,000 page views before anyone answered the contact form on the site.')).has('R29'));
});

test('v1.2: global tools are allowed (QuickBooks, Xero, HubSpot, Salesforce, Stripe, Shopify, Zapier, Slack, Notion, Microsoft 365)', () => {
  expectPass(tweet('Payments come in through Stripe, orders through Shopify and the books live in Xero. A rule that copies each order into Xero ends the retyping.'));
  expectPass(tweet('Leads sit in HubSpot or Salesforce, the team talks in Slack and the notes live in Notion. One Zapier rule can post each new lead to the right channel.'));
  expectPass(tweet('Invoices go out from QuickBooks and the reminders go out from Microsoft 365 or Google Workspace. Keep a person on the disputed ones.'));
});

// Fixture news facts for a made-up company, so no real company gets a made-up figure in this repo.
const NEWS_FACTS = withFacts([
  { id: 'news.acmepay_fee_cut', usage: 'news', forms: ['1.9%', '$50,000'], source: 'Acme Pay press release (fixture)', source_date: '2026-09-02' },
  { id: 'news.acmepay_uk_saving', usage: 'news', forms: ['£40 million'], source: 'Acme Pay press release (fixture)', source_date: '2026-09-02' },
]);
const T3_NEWS = {
  platform: 'instagram', type: 'carousel', template: 'T3', content: '',
  slides: [
    'What the new Acme Pay fee means for small shops',
    'On 2 September Acme Pay cut its card fee for small sellers to 1.9% per sale.',
    'The company said the cut covers sellers taking under $50,000 a year.',
    'For UK sellers it put the saving at £40 million a year in total.',
    'Check your own statement before you switch. The card fee is one line of several.',
    'The card fee dropped to 1.9%. Your statement shows the rest. Follow @handle for more.',
  ],
  caption: lines(
    'Acme Pay cut its card fee for small sellers on 2 September.', '',
    'Before you move providers, open last month\'s statement and add up every line, from the monthly plan to refunds and chargebacks. The headline fee is only one of them.', '',
    'Save this for the next time you compare payment providers.'),
  hashtags: ['#smallbusiness'],
};

test('v1.2 T3: a global news piece with a dated source passes, including a £ figure the facts file carries as news', () => {
  expectPass(lint(T3_NEWS, NEWS_FACTS));
  const undated = clone(NEWS_FACTS);
  undated.facts.filter((x) => x.usage === 'news').forEach((x) => { delete x.source_date; });
  const res = lint(T3_NEWS, undated);
  expectReject(res, ['R1', 'R5']);
  const ownClaim = { platform: 'x', type: 'tweet', template: null, content: 'Our automation saves a UK shop £40 million a year, the same figure Acme Pay put on its fee cut.' };
  expectReject(lint(ownClaim, withFacts([{ forms: ['£40 million'] }])), ['R5']);
});

test('v1.2: the follow CTA ("Follow @handle for more") passes on a closing slide and at the end of a post', () => {
  expectPass(lint({ ...T4, slides: [...T4.slides.slice(0, -1), 'Follow @handle for more.'] }));
  expectPass(tweet('Write the reminder rule once and let QuickBooks send it on the due date. Keep a person on the disputed bills.' + NL + NL + 'Follow @handle for more.'));
});

// ================================================================ batch + n8n entry

test('lintBatch flags a repeated topic (R24) and accepts n8n items', () => {
  const a = { platform: 'x', type: 'tweet', template: null, topic: 'payment reminders from QuickBooks on WhatsApp',
    content: 'Payment reminders should come from a rule in QuickBooks, not from the owner phone. The accountant keeps the disputed bills.' };
  const b = { ...a, content: 'The owner phone is the wrong place for payment reminders. Put the rule in QuickBooks and keep a person on disputed bills.' };
  const out = R.lintBatch([{ json: a }, { json: b }], FACTS);
  assert.strictEqual(out.results.length, 2);
  assert.strictEqual(out.results[0].ok, true, JSON.stringify(out.results[0].errors));
  assert.ok(ids(out.results[1]).has('R24'));
  assert.strictEqual(out.ok, false);
  const recent = R.lintBatch([a], FACTS, ['whatsapp payment reminders from quickbooks']);
  assert.ok(ids(recent.results[0]).has('R24'));
});

test('missing facts is an error, not a silent pass (FACTS)', () => {
  expectReject(R.lintPiece(T4, null), ['FACTS']);
});

test('the n8n guarded block runs with $input and attaches lint to each item', () => {
  const code = fs.readFileSync(SRC, 'utf8');
  const items = [{ json: T4 }, { json: { platform: 'x', type: 'tweet', template: null, content: '80% of owners still type reminders by hand every single week.' } }];
  const fn = new Function('$input', '$', '$getWorkflowStaticData', code);
  const out = fn({ all: () => items }, () => ({ first: () => ({ json: FACTS }) }), () => ({}));
  assert.ok(Array.isArray(out) && out.length === 2);
  assert.strictEqual(out[0].json.lint.ok, true, JSON.stringify(out[0].json.lint.errors));
  assert.strictEqual(out[1].json.lint.ok, false);
  assert.strictEqual(out[0].json.platform, 'instagram');
});

test('source file is n8n-safe: no double closing brace, no backslash-n, exports RULES_VERSION', () => {
  const code = fs.readFileSync(SRC, 'utf8');
  assert.ok(!code.includes('}' + '}'), 'found a double closing brace');
  assert.ok(!code.includes('\\' + 'n'), 'found a backslash-n escape');
  assert.ok(/^const RULES_VERSION = /m.test(code));
  assert.ok(typeof R.RULES_VERSION === 'string');
});

test('R1: product and model version names are names, not claims (GPT-6, Gemini 2.5, iOS 26, o3, v2.1)', () => {
  expectPass(tweet('OpenAI shipped GPT-6 Astra this week. Gemini 2.5 Flash and Claude Opus 5 answer the same way: an agent drafts, a person approves.'));
  expectPass(tweet('iOS 26 and Android 16 both ask before an app sends a message for you. Build your follow-up the same way, with a person approving.'));
  expectPass(tweet('The o3 model and Agentforce v2.1 both keep a human sign-off on payments. Copy that rule into your own workflows.'));
});

test('R1: a version exemption does not hide a real invented number next to it', () => {
  expectReject(tweet('GPT-6 cut support costs by 40% for small shops this month.'), ['R1']);
});
