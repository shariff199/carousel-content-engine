## 1. What the page is for

Grow followers for Black Arrow Technologies with information, education, AI news and engagement.
Audience: small-business owners and teams worldwide. Not a sales page.

Owner decisions (Tauheed, 14 Sept):
- No prices. No client names. No client results.
- Made-up scenarios are fine when framed as an example ("Picture a clinic that...").
  A made-up story told as a real client is not allowed.
- Worldwide topics and global tools. No India-only content unless the story is global.
- Start posting now with the current fonts and design. Adjust after a week of real posts.
- Nothing publishes without Tauheed's tap on Telegram (or his yes in chat for manual posts).

## 2. Posting rules (the ones that matter day to day)

The rules run as code (`deploy/n8n/rules/content-rules.js`, 52 tests). A piece that breaks one goes
back to Gemini once with the error list, and is dropped if it fails again.

Truth
- Every number must be a dated news fact with a source, or part of a clearly framed example. Invented stats are rejected.
- No "we helped / one of our clients / a client told us".
- No "studies show", "experts say" without a named source.
- No "fully automated", "no human needed", "set and forget".
- News posts name the source and date on the slide ("Source: Salesforce newsroom, 11 Sept 2026").

Writing
- Plain words. The banned AI-tell word and phrase lists apply (delve, pivotal, seamless, "not only X but also Y"...).
- No em dashes, no curly quotes, no markdown symbols, no placeholders like [Your Name].
- No question as the first line or the cover.
- One call to action per post. Default is "Save this". No "comment X below" until an auto-reply exists.
- No links in posts.

Instagram carousel
- 5 to 8 slides, 10 maximum. 1080x1350.
- Cover: 10 words or fewer, 60 characters or fewer.
- Every slide has a real visual (chat, checklist, timeline, before/after, drawing). No plain text on a background.
- Last slide: BAT logo, one-line recap, "Follow @blackarrowtech for more".
- Caption: first line stands alone in 125 characters. 0 to 3 hashtags. 0 to 3 emoji, never as bullets.
- Text stays clear of the bottom 120px, where Instagram's buttons sit (checked by the renderer).

LinkedIn company page
- Single image + text by default. 900 to 1,300 characters. First line under 140 characters.
- No hashtags, no links, no markdown.

X
- One idea per post, under 270 characters. No links (a link makes the post cost 13x more). 0 or 1 hashtag.

The reasoning behind the hook, close and colour rules, with the evidence from our own scrape,
is in bat-brain `deploy/CAROUSEL-DESIGN-RULES.md`.
