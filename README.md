# Carousel content engine

A daily social-media carousel, generated, checked, approved by a human, and published, entirely on
GitHub Actions. No server, no laptop, nothing to keep alive. It has run the daily post for Black
Arrow Technologies since September 2026.

The interesting part is not that a model writes the slides. It is everything that refuses to let the
model's output reach an account.

## How a day runs

1. **Tests first.** 71 tests over the rules, channels and approval code, no network. A failing test
   stops the day before anything is generated.
2. **Radar.** 24 free news feeds are pulled, clustered and scored. A story qualifies at score 8+,
   with no politics, and only if it has not been used in the last 14 days.
3. **Generate.** The day's template is picked, the article is read through a text extractor, and
   **only the numbers that actually appear in the article are whitelisted**. Gemini then writes the
   slide spec, the caption and the per-channel text in one call.
4. **Lint.** A rules module checks the output: claims against a facts whitelist, banned phrasing,
   client names, per-platform length limits. The renderer measures slide overflow, contrast and the
   space the Instagram bottom bar eats.
5. **Repair once.** Failures go back to the model with the error list for exactly one more attempt.
   If it still fails, the day is dropped and the reasons are recorded. A dropped day is a normal
   outcome, not an error.
6. **Ask a human.** The slides go to Telegram as a preview. Nothing is published until an approver
   taps Publish, and the tap must come from the configured chat and from an allowed user id.
7. **Publish.** Each enabled, connected channel posts independently. A channel whose text failed the
   rules is skipped with a recorded reason; it never takes the rest of the run down.

## Decisions worth reading

**A number has to be on a list before it can be published.** `engine/rules/facts.base.json` is a
whitelist. A figure reaches a post only when its entry is marked confirmed, marked public, and has a
review date that has not passed. This exists because the engine once wrote a statistic with no
source. The rule is what stopped it happening twice.

**One repair round, then stop.** Letting a model retry until it passes teaches it to satisfy the
linter rather than write something true, and the cost has no ceiling. One round, then the day is
dropped with its reasons.

**Skipping is not failing.** Every channel records why it did not post. A missing integration, an
over-length caption and a depleted API quota are all recorded outcomes rather than exceptions, so a
broken connection on one platform never costs the post on the others.

**The approval gate is a real gate.** A tap is accepted only from the configured chat, and only from
a user id on the approver list. Taps are parsed and re-serialised so a display name cannot smuggle
anything into the control string.

## Layout

```
engine/radar/      feed pulling, clustering, scoring
engine/rules/      the linter and the facts whitelist
engine/render/     slide rendering, overflow and contrast measurement
engine/prompt/     templates and the playbook the model is held to
engine/channels.*  per-channel enablement, limits and skip reasons
clock/             Cloudflare Worker that turns a Telegram tap into a workflow dispatch
.github/workflows/ the daily run and the publish run
```

## Running it

```sh
node --test engine/rules/ engine/test/     # 71 tests, no network needed
node engine/radar/news-radar.mjs           # score today's feeds
node engine/generate.mjs                   # needs GEMINI_API_KEY
```

Setup and secrets: [`docs/SETUP.md`](docs/SETUP.md).

## What is not in here

This is the public copy. The confirmed price list, the client name lists the linter refuses to
publish, and the daily run records are kept out of it. The facts file ships example entries instead,
which is why every price entry is marked `needs_fact`.

MIT licensed.
