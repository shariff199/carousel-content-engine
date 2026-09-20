#!/usr/bin/env node
// Sends today's carousel to Telegram as a PREVIEW: the slides as an album, then the caption.
// Publishes nothing: the caption message carries Publish / Skip buttons, and engine/publish.mjs acts on the tap.
// On a dropped day it sends the reasons instead.
//
//   node engine/telegram-preview.mjs [--date YYYY-MM-DD]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { ROOT, telegram } from './lib.mjs';
import { loadChannels, skipReason } from './channels.mjs';

const args = process.argv.slice(2);
const DATE = args.includes('--date') ? args[args.indexOf('--date') + 1] : new Date().toISOString().slice(0, 10);
const RUN = join(ROOT, 'runs', DATE);
const chat_id = (process.env.TELEGRAM_CHAT_ID || '').trim();

async function main() {
  if (!chat_id) throw new Error('TELEGRAM_CHAT_ID missing');
  const resultPath = join(RUN, 'result.json');
  if (!existsSync(resultPath)) throw new Error('no result.json for ' + DATE);
  const result = JSON.parse(readFileSync(resultPath, 'utf8'));
  const sent = { date: DATE, status: result.status, message_ids: [] };

  if (result.status !== 'ready') {
    const text = [`BAT carousel ${DATE}: today's carousel dropped.`, '', ...(result.reasons || []).map((r) => '- ' + r)].join('\n').slice(0, 4000);
    const m = await telegram('sendMessage', { chat_id, text, disable_web_page_preview: true });
    sent.message_ids.push(m.message_id);
  } else {
    const jpgs = result.jpgs.slice(0, 10);
    const form = new FormData();
    form.append('chat_id', chat_id);
    form.append('media', JSON.stringify(jpgs.map((p, i) => ({ type: 'photo', media: 'attach://s' + i }))));
    jpgs.forEach((p, i) => form.append('s' + i, new Blob([readFileSync(p)], { type: 'image/jpeg' }), basename(p)));
    const album = await telegram('sendMediaGroup', form);
    sent.message_ids.push(...album.map((m) => m.message_id));

    const caption = readFileSync(join(RUN, 'caption.txt'), 'utf8').trim();
    const textsPath = join(RUN, 'channel-texts.json');
    const texts = existsSync(textsPath) ? JSON.parse(readFileSync(textsPath, 'utf8')) : {};
    const channels = Object.values(loadChannels());
    const going = channels.filter((c) => !skipReason(c, texts)).map((c) => c.label);
    const channelLines = channels.map((c) => { const why = skipReason(c, texts); return (why ? 'no  ' : 'yes ') + c.label + (why ? ' (' + why + ')' : ''); });

    // The other channels' texts go in their own message, so the control message stays under Telegram's limit.
    const block = (label, t) => !t ? null : `${label}${t.ok ? '' : ' (FAILED the rules, will not post)'}:\n\n${t.text || '(missing)'}${t.ok ? '' : '\n\nWhy: ' + t.errors.slice(0, 3).join('; ')}`;
    const other = [block('X text', texts.x_text), block('LinkedIn page text', texts.linkedin_text)].filter(Boolean);
    if (other.length) {
      const tm = await telegram('sendMessage', { chat_id, text: other.join('\n\n----------\n\n').slice(0, 4000), disable_web_page_preview: true, reply_to_message_id: album[0].message_id });
      sent.message_ids.push(tm.message_id);
    }
    const header = [
      'PREVIEW, not posted yet.',
      'Tap Publish before 19:30 IST. No tap = not posted.',
      `Template ${String(result.template).toUpperCase()} | ${result.topic}`,
      result.publication ? `Source: ${result.publication}, ${result.source_date} ${result.url}` : 'Source: none (resource or belief post)',
      `Rules: passed${result.repaired ? ' after one repair' : ''} | ${result.slides} slides | model ${result.model}`,
      `Publish sends it to: ${going.join(', ') || 'nothing (no channel ready)'}`,
      ...channelLines.map((l) => '  ' + l),
    ].join('\n');
    // The control message carries the buttons. engine/publish.mjs reads the taps (getUpdates) and edits this message.
    const text = (header + '\n\nCaption:\n\n' + caption).slice(0, 3800);
    const reply_markup = { inline_keyboard: [[
      { text: 'Publish', callback_data: 'pub:' + DATE },
      { text: 'Skip', callback_data: 'skip:' + DATE },
    ]] };
    const m = await telegram('sendMessage', { chat_id, text, disable_web_page_preview: true, reply_to_message_id: album[0].message_id, reply_markup });
    sent.message_ids.push(m.message_id);
    sent.control_message_id = m.message_id;
    sent.control_text = text;
  }
  writeFileSync(join(RUN, 'telegram.json'), JSON.stringify({ ...sent, ok: true, at: new Date().toISOString() }, null, 2));
  console.log('[telegram] ok', sent.status, 'messages', sent.message_ids.join(','));
}

main().catch((e) => {
  console.error('[telegram] failed:', String(e.message || e));
  try { writeFileSync(join(RUN, 'telegram.json'), JSON.stringify({ date: DATE, ok: false, error: String(e.message || e) }, null, 2)); } catch {}
  process.exitCode = 1;
});
