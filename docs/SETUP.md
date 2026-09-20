# Setup

The engine runs entirely on GitHub Actions. There is no server to keep alive.

## Secrets

Set these in the repository's Actions secrets:

| Secret | What it is |
|---|---|
| `GEMINI_API_KEY` | Generates the slide spec, caption and per-channel text |
| `TELEGRAM_BOT_TOKEN` | The bot that sends the preview and reads the taps |
| `TELEGRAM_CHAT_ID` | The chat the preview goes to; a tap from anywhere else is ignored |
| `TELEGRAM_APPROVER_IDS` | Comma-separated user ids allowed to approve. With the list empty, any member of the chat can approve |
| `POSTIZ_API_KEY` | Publishes to the connected social accounts |

## Channels

`engine/channels.json` decides where an approved carousel goes. A channel posts only when it is
enabled, connected, and its text passed the rules. Anything else is skipped with a recorded reason
rather than raising an error, so one broken integration never takes the run down.

Integration ids are read from the environment, not committed. The values in the file are
placeholders.

## Facts

`engine/rules/facts.base.json` is the whitelist the linter checks every number and claim against. A
figure is allowed into a post only when an entry has `status: confirmed`, `public: true`, and a
`review_by` date that has not passed. The file in this repository ships example entries; the real
confirmed values are kept outside it.

## Running it locally

```sh
node --test engine/rules/ engine/test/     # 71 tests, no network
node engine/radar/news-radar.mjs           # scores the feeds
node engine/generate.mjs                   # needs GEMINI_API_KEY
```
