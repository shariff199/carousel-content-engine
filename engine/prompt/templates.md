# How a carousel spec is built

Output one JSON spec. The renderer draws it at 1080x1350. Every slide has a role:
- `cover` (slide 1), `body` (the middle), optional `recap` (second to last), `closing` (always last).

Common slide fields:
- `text`: the main line. Cover: max 10 words and 60 characters, no question mark. Body: max 90 characters, one idea, at most 2 sentences. Closing: one-line recap, max 80 characters.
- `highlight`: 1 or 2 short phrases copied exactly from `text`; they get a marker bar.
- `component` + `data`: the visual on the slide (see below). Every cover and body slide needs one, except the T4 cover.
- `source`: on news templates (t1, t3) every slide that states something from the article: "Source: <Publication>, <d Mon YYYY>".
- The closing slide has only `role`, `text`, and on news templates `source`. The renderer adds the BAT logo and "Follow @blackarrowtech for more". Never write the handle or "follow" yourself.

## Templates

t1 Business move (light ground). A real company did something with AI; what an owner can copy.
- cover: text, highlight, component, source
- body: text, highlight, component, source (the last body slide is "Copy it with your team: ..." with a timeline or checklist and no source)
- closing: text, source

t2 Saveable resource (dark ground). Scripts, templates, checklists people save.
- cover: text, highlight, note (one short line), component (phone-whatsapp, copy-box, checklist or ui-card)
- body: num ("1", "2"...), title (max 5 words, a command), text (max 90 characters), highlight, component (usually copy-box)
- recap: title ("Save this for ..."), highlight ["Save this"], text ("Five steps, in order:"), component checklist with numbered true and the step titles
- closing: text

t3 AI explained (dark ground). A launch or AI news in plain words, then what to do this week.
- cover: hud true, text (max 8 words, it sits under the card), highlight, source, swipe "Swipe for more", component (a ui-card with at most 2 rows and a button, so it stays short)
- body: title (max 5 words), text, highlight, component, source. Slide 2 is "What <company> announced" with a news-card quoting the article. The last body slide is "What to do this week" with a timeline (MON/TUE/WED/THU) and no source.
- closing: text, source

t4 One belief (paper ground, hand-drawn). One opinion, argued in 4 steps.
- cover: text (the belief, max 8 words), highlight [one word to circle]. No component.
- body: text, highlight [one short phrase to underline], component "doodle"
- closing: text

## Components and their data

copy-box: {text: the exact words to copy (max 180 characters), kind: short label like "First reply", when: "Send: <when>"}
checklist: {items: [{text (max 40 characters), sub (max 50, optional), state: "done"|"open"|"cross"}], numbered: optional true}
timeline: {steps: [{when: short label like "MON", "0:10", "GOAL", what (max 32 characters), sub (optional, max 45), state: "done"|"now"|"todo"}]}  3 or 4 steps.
before-after: {before: {label, items: [2 short strings], foot: 1-2 words}, after: {label, items: [2 short strings], foot: 1-2 words}}
ui-card: {title (app screen title), label: "Illustration" when it is not a real screen, theme: "light"|"dark", rows: [[key, value, ring?]] (max 4 rows, ring true on the one that matters), tiles: [{icon, label, ring, tag}] (2 or 3), button: {label, icon: "person", ring, tag}, note}. Icons: team, spark, person, account, card, qr, phone, lock, clock.
news-card: {source: publication name, monogram: 2 letters, date: "d Mon YYYY", quote: a phrase copied character for character from the article text (max 110 characters; code checks it against the article), chips: [2 short strings; "Official announcement" only when the publication is the company itself], theme: "dark" on t3}
phone-whatsapp: {contact: "Customer", status: "online", day: "", messages: [{from: "in"|"out", text (max 60 characters), time: "9:38 PM", ticks: "read"}], typing: true|false}  max 3 messages.
invoice-card: only for money-admin topics, always sample true, no real amounts.
doodle (t4 only): {kind, alt, labels}. Kinds and their labels:
- bars: a pile that grows. labels {a, b, c (under the three stacks), top}
- loop: the same details typed into three places. labels {a, b, c (the three boxes, max 10 characters each), loop, top}
- sort: a task list split between a system and people. labels {rows: [4 short tasks, the first 3 go to the system, the last stays with people], a: "system", b: "people"}
- curve: one line falls, one rises after a marker. labels {marker, a (falling line), b (rising line), x}
- arrow: one rising arrow. labels {a}
- circle: a circled word. labels {a}
Doodle labels max 30 characters.

## Placeholder names

Illustrations use placeholder names: "Customer", "Your Shop", "Your team". Never a real client. Numbers inside
example scripts need the word "Sample" or a placeholder like [time]; never a price.
