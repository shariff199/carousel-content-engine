"""BAT carousel v2: frame partials and components as small HTML builders.

Every builder takes plain data and returns an HTML string. Text is always escaped here, so
spec copy can never inject markup. Names are placeholders ("Customer", "Your Shop").
"""
import html
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))

# ---- brand config: the ONE place the social handle lives. The real Instagram handle is not
# confirmed yet; change it here and every closing slide and animation picks it up.
# A spec may override per carousel with "brand_handle".
BRAND_HANDLE = "@blackarrowtech"
BRAND_FOLLOW_REASON = "AI news and systems for business owners, every day."
BRAND_WORDMARK = "Black Arrow Technologies"
LOGO_SVG = os.path.join(HERE, "assets", "bat-logo.svg")

# ---- third-party brand marks. The one moment of colour on an otherwise greyscale slide, and
# the reason is attention: six of the AI-news pages in research/2026-09-14-ai-news-pages-and-trend-radar.md
# put a circle logo badge of the company in the story on the cover. BAT's own palette does not
# change (BAT_BRAND_GUIDELINES s4 stays a hard lock); the colour is quoted from the company
# being reported on, the same way the source line quotes their name.
#
# Marks are vendored by fetch_logos.py so a render never touches the network. A company that
# asked Simple Icons to delist it (OpenAI, Microsoft, LinkedIn, Slack, ...) has no mark here and
# gets its name set as a wordmark in its colour instead.
LOGO_DIR = os.path.join(HERE, "assets", "logos")
_LOGOS = None


def logos():
    global _LOGOS
    if _LOGOS is None:
        try:
            with open(os.path.join(LOGO_DIR, "logos.json")) as f:
                _LOGOS = json.load(f)
        except OSError:
            _LOGOS = {}
    return _LOGOS


def brand_slug(name):
    """'WhatsApp Business' -> 'whatsapp'. Returns None when we hold no mark for it."""
    if not name:
        return None
    key = re.sub(r"[^a-z0-9]", "", str(name).lower())
    if not key:
        return None
    table = logos()
    if key in table:
        return key
    # longest slug that the name starts with, so "googlegemini" beats "google"
    hits = [k for k in table if key.startswith(k) or k.startswith(key)]
    return max(hits, key=len) if hits else None


def brand_of(name):
    slug = brand_slug(name)
    return (slug, logos()[slug]) if slug else (None, None)


def _ink_for(hex_):
    """Black or off-white on top of the brand colour, whichever is readable (WCAG relative luminance)."""
    h = hex_.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    f = lambda v: v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    lum = 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
    return "#0B0B0B" if lum > 0.36 else "#F5F5F2"


def brand_badge(name, size="lg"):
    """A circle badge holding the company's mark in the company's colour, or its name as a
    wordmark chip when we hold no mark. Empty string when the company is unknown: a missing
    badge must never break a slide."""
    slug, meta = brand_of(name)
    if not meta:
        return ""
    hex_ = meta["hex"]
    label = esc(meta["title"])
    if meta.get("wordmark"):
        return (f'<div class="brand-badge brand-word brand-{size}" data-brand="{slug}" '
                f'style="--brand:{hex_};--brand-ink:{_ink_for(hex_)}" aria-label="{label}">'
                f'<span>{label}</span></div>')
    try:
        with open(os.path.join(LOGO_DIR, slug + ".svg")) as f:
            raw = f.read()
    except OSError:
        return ""
    paths = "".join(re.findall(r"<path[^>]*/>", raw))
    if not paths:
        return ""
    return (f'<div class="brand-badge brand-{size}" data-brand="{slug}" '
            f'style="--brand:{hex_}" aria-label="{label}">'
            f'<svg viewBox="0 0 24 24" role="img" aria-hidden="true">{paths}</svg></div>')



def esc(t):
    return html.escape(str(t), quote=True)


def highlight(text, words, cls="hl"):
    """Escape text, then wrap each highlight phrase (case-insensitive, first match each)."""
    out = esc(text)
    for w in sorted({w for w in (words or []) if w}, key=len, reverse=True):
        pat = re.compile(r"(?<![\w>])(" + re.escape(esc(w)) + r")(?![\w<])", re.I)
        out, _ = pat.subn(lambda m: f'<span class="{cls}">{m.group(1)}</span>', out, count=1)
    return out


# --------------------------------------------------------------------------- icons (authored SVG)

def _logo_path():
    svg = open(LOGO_SVG, encoding="utf-8").read()
    return re.search(r'<path d="([^"]+)"', svg).group(1)


_LOGO_D = None


def bat_logo_svg():
    global _LOGO_D
    if _LOGO_D is None:
        _LOGO_D = _logo_path()
    # measured path bounds in the 500x500 source: x 0-490, y 0-297 (getBBox), plus 4px air
    return (f'<svg viewBox="-4 -4 498 305" aria-hidden="true">'
            f'<path fill="currentColor" d="{_LOGO_D}"/></svg>')


ICON = {
    "check": '<svg viewBox="0 0 24 24"><path d="M4.5 12.5l5 5L19.5 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    "cross": '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
    "dash": '<svg viewBox="0 0 24 24"><path d="M6 12h12" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
    "back": '<svg class="back" viewBox="0 0 12 20"><path d="M10 2L2 10l8 8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    "ticks": '<svg viewBox="0 0 30 20"><path d="M2 11l5 5L17 5M12 14l2 2L25 5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    "tick1": '<svg viewBox="0 0 30 20"><path d="M7 11l5 5L23 5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    "copy": '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 5.5V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    "bookmark": '<svg viewBox="0 0 22 30"><path d="M3 3.5A1.5 1.5 0 0 1 4.5 2h13A1.5 1.5 0 0 1 19 3.5V27l-8-6-8 6z" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"/></svg>',
    "send": '<svg viewBox="0 0 24 24"><path d="M4 12l16-8-6 16-2.5-6.5z" fill="#F5F5F2"/></svg>',
    "video": '<svg viewBox="0 0 24 24"><rect x="2.5" y="6" width="13" height="12" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15.5 10.5l6-3.5v10l-6-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
    "phone": '<svg viewBox="0 0 24 24"><path d="M6.6 3.5l2.6.4 1.3 4-2 1.6a12 12 0 0 0 6 6l1.6-2 4 1.3.4 2.6c0 1.2-1 2.1-2.2 2.1A16.4 16.4 0 0 1 4.5 5.7c0-1.2.9-2.2 2.1-2.2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
    "signal": '<svg viewBox="0 0 70 20"><rect x="0" y="13" width="4" height="7" rx="1" fill="currentColor"/><rect x="7" y="9" width="4" height="11" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="15" rx="1" fill="currentColor"/><rect x="21" y="1" width="4" height="19" rx="1" fill="currentColor"/><rect x="36" y="3" width="28" height="14" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><rect x="39" y="6" width="19" height="8" rx="2" fill="currentColor"/><rect x="66" y="7" width="3" height="6" rx="1" fill="currentColor"/></svg>',
    "clock": '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v5.5l3.5 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    "lock": '<svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2.5" fill="currentColor"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>',
    "team": '<svg viewBox="0 0 56 56"><g fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"><circle cx="20" cy="20" r="7"/><circle cx="38" cy="22" r="5.5"/><path d="M7 45c1.6-8 6.6-12 13-12s11.4 4 13 12M34 34.5c1.3-.4 2.6-.5 4-.5 5 0 9 3.3 10.4 10"/></g></svg>',
    "spark": '<svg viewBox="0 0 56 56"><g fill="none" stroke="currentColor" stroke-width="3.5" stroke-linejoin="round"><path d="M26 7c1.6 9.4 5.6 13.4 15 15-9.4 1.6-13.4 5.6-15 15-1.6-9.4-5.6-13.4-15-15 9.4-1.6 13.4-5.6 15-15z"/><path d="M42 34c.8 4.4 2.6 6.2 7 7-4.4.8-6.2 2.6-7 7-.8-4.4-2.6-6.2-7-7 4.4-.8 6.2-2.6 7-7z"/></g></svg>',
    "person": '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4.5 20.5c1-4 3.8-6 7.5-6s6.5 2 7.5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    # tiles: account, card, qr
    "account": '<svg viewBox="0 0 56 56"><rect x="6" y="8" width="44" height="40" rx="6" fill="none" stroke="currentColor" stroke-width="3.5"/><circle cx="22" cy="24" r="6" fill="none" stroke="currentColor" stroke-width="3.5"/><path d="M13 39c1.8-5 5-7 9-7s7.2 2 9 7M35 22h9M35 30h7" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/></svg>',
    "card": '<svg viewBox="0 0 56 56"><rect x="5" y="12" width="46" height="32" rx="6" fill="none" stroke="currentColor" stroke-width="3.5"/><path d="M5 22h46M12 35h10" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/></svg>',
    "qr": '<svg viewBox="0 0 56 56"><g fill="none" stroke="currentColor" stroke-width="3.5"><rect x="7" y="7" width="16" height="16" rx="3"/><rect x="33" y="7" width="16" height="16" rx="3"/><rect x="7" y="33" width="16" height="16" rx="3"/></g><g fill="currentColor"><rect x="13" y="13" width="4" height="4"/><rect x="39" y="13" width="4" height="4"/><rect x="13" y="39" width="4" height="4"/><rect x="33" y="33" width="6" height="6"/><rect x="43" y="33" width="6" height="6"/><rect x="38" y="43" width="6" height="6"/></g></svg>',
}


def dot_arrow_svg():
    """BAT's ornament: a dot-matrix arrow, drawn from dots on a 7x5 grid."""
    pts = [(0, 2), (1, 2), (2, 2), (3, 2), (4, 2), (5, 2), (6, 2),
           (4, 0), (5, 1), (5, 3), (4, 4)]
    dots = "".join(f'<circle cx="{3 + x * 5.6}" cy="{3 + y * 5.5}" r="2.3" fill="currentColor"/>'
                   for x, y in pts)
    return f'<svg viewBox="0 0 40 28" aria-hidden="true">{dots}</svg>'


# --------------------------------------------------------------------------- frame partials

def counter(i, n):
    return f'<div class="counter"><b>{i:02d}</b>/{n:02d}</div>'


def bat_mark(word=True):
    label = '<span>BAT</span>' if word else ""
    return f'<div class="bat-mark" aria-label="Black Arrow Technologies">{bat_logo_svg()}{label}</div>'


def swipe_cue(label="Swipe"):
    return f'<div class="cue cue-swipe">{esc(label)}{dot_arrow_svg()}</div>'


def save_cue(label="Save this"):
    return f'<div class="cue cue-save">{ICON["bookmark"]}{esc(label)}</div>'


def source_line(text):
    return f'<div class="source-line">{esc(text)}</div>' if text else ""


def frame_top(left="", right=None, ruled=False):
    right = bat_mark() if right is None else right
    return f'<div class="frame-top{" ruled" if ruled else ""}">{left or "<span></span>"}{right}</div>'


def frame_foot(left="", right="", ruled=False):
    return (f'<div class="frame-foot{" ruled" if ruled else ""}">'
            f'{left or "<span></span>"}{right or "<span></span>"}</div>')


def hud_svg():
    """The optional futuristic frame: four corner brackets and two side rulers (decorative)."""
    corner = lambda k: (f'<svg class="hud-c {k}" viewBox="0 0 56 56"><path class="hud-path" pathLength="1" '
                        f'd="M1.25 55V1.25H55"/></svg>')
    ticks = "".join(
        f'<line class="{"major" if k in (0, 8, 16) else ""}" x1="0" x2="{22 if k in (0, 8, 16) else 12}" '
        f'y1="{1 + k * 16.125:.2f}" y2="{1 + k * 16.125:.2f}"/>' for k in range(17))
    rulers = "".join(f'<svg class="hud-ticks {side}" viewBox="0 0 22 260">{ticks}</svg>' for side in ("l", "r"))
    return (f'<div class="hud" aria-hidden="true" data-deco>{corner("tl")}{corner("tr")}{corner("bl")}{corner("br")}'
            f'{rulers}</div>')


def closing_block(recap="", handle=None, reason=None, wordmark=True, recap_cls=""):
    """v2.1 premium closing: the real BAT mark as the hero, a one-line recap, the follow line.
    The mark is never boxed, recoloured beyond the ground's ink/off-white, or given a glow."""
    handle = handle or BRAND_HANDLE
    reason = BRAND_FOLLOW_REASON if reason is None else reason
    mark = f'<div class="closing-mark" aria-label="Black Arrow Technologies">{bat_logo_svg()}</div>'
    word = f'<div class="closing-word">{esc(BRAND_WORDMARK)}</div>' if wordmark else ""
    # The payoff is the slide. Until 16 Sept the loudest thing here was FOLLOW and the one line a
    # reader could act on was set small above it, so the ask beat the value. research/
    # 2026-09-14-visual-and-animation-guide.md specifies the opposite for T1 and T3: the last
    # slide carries "what your business can copy" / "what to do this week". Follow is now a cue.
    pay = f'<p class="closing-payoff {recap_cls}" data-text="head">{esc(recap)}</p>' if recap else ""
    follow = (f'<p class="closing-follow" data-text="body">Follow <span class="hl handle">{esc(handle)}</span> for more</p>'
              f'<p class="closing-reason" data-text="body">{esc(reason)}</p>')
    return (f'<div class="closing-stack"><div class="closing-brand">{mark}{word}</div>'
            f'{pay}<div class="closing-cta">{follow}</div></div>')


# --------------------------------------------------------------------------- components

def phone_whatsapp(d):
    """d: {contact, status, day, messages:[{from:'in'|'out', text, time, ticks:'read'|'sent'}], typing, height}"""
    msgs = []
    for m in d.get("messages", []):
        side = "out" if m.get("from") == "out" else "in"
        tick = ""
        if side == "out":
            tick = ICON["ticks"].replace("<svg", '<svg class="read"') if m.get("ticks", "read") == "read" else ICON["tick1"]
        msgs.append(f'<div class="wa-msg {side}"><p>{esc(m["text"])}</p>'
                    f'<div class="wa-meta">{esc(m.get("time", ""))}{tick}</div></div>')
    if d.get("typing"):
        msgs.append('<div class="wa-typing"><i></i><i></i><i></i></div>')
    name = d.get("contact", "Customer")
    style = f' style="height:{int(d["height"])}px"' if d.get("height") else ""
    return f'''<div class="phone" data-box="phone"{style}><div class="phone-screen">
  <div class="wa-status"><span>9:41</span><span class="island"></span>{ICON["signal"]}</div>
  <div class="wa-head">{ICON["back"]}<div class="wa-avatar">{esc(name[:1].upper())}</div>
    <div class="wa-who"><div class="wa-name">{esc(name)}</div><div class="wa-sub">{esc(d.get("status", "online"))}</div></div>
    <div class="wa-icons">{ICON["video"]}{ICON["phone"]}</div></div>
  <div class="wa-chat">{f'<div class="wa-day">{esc(d.get("day", "Today"))}</div>' if d.get("day", "Today") else ""}{"".join(msgs)}</div>
  <div class="wa-input"><div class="wa-field">Message</div><div class="wa-send">{ICON["send"]}</div></div>
</div></div>'''


def copy_box(d):
    """d: {text, label, kind, caret}"""
    caret = '<span class="caret"></span>' if d.get("caret") else ""
    foot = (f'<div class="copybox-foot">{ICON["clock"]}<span>{esc(d["when"])}</span></div>'
            if d.get("when") else "")
    return f'''<div class="copybox" data-box="copybox">
  <div class="copybox-bar"><span class="copybox-label">{ICON["copy"]}{esc(d.get("label", "Copy this"))}</span>
  <span class="copybox-kind">{esc(d.get("kind", "WhatsApp message"))}</span></div>
  <div class="copybox-body" data-text="body">{esc(d["text"])}{caret}</div>{foot}
</div>'''


def checklist(d):
    """d: {items:[str | {text, sub, state:'done'|'open'|'cross', num}]}"""
    rows = []
    for k, it in enumerate(d.get("items", []), start=1):
        if isinstance(it, str):
            it = {"text": it}
        state = it.get("state", d.get("state", "done"))
        if d.get("numbered"):
            mark = f'<span class="num">{k}</span>'
        else:
            mark = {"done": ICON["check"], "cross": ICON["cross"], "open": ""}.get(state, ICON["check"])
        sub = f'<span class="ck-sub" data-text="sub">{esc(it["sub"])}</span>' if it.get("sub") else ""
        rows.append(f'<li class="{state}"><span class="box">{mark}</span>'
                    f'<span class="ck-text" data-text="body">{esc(it["text"])}{sub}</span></li>')
    return f'<ul class="checklist" data-box="checklist">{"".join(rows)}</ul>'


def timeline(d):
    """d: {steps:[{when, what, sub, state:'done'|'now'|'todo'}]}"""
    rows = []
    for s in d.get("steps", []):
        sub = f'<small data-text="sub">{esc(s["sub"])}</small>' if s.get("sub") else ""
        rows.append(f'<li class="is-{s.get("state", "done")}"><span class="tl-when">{esc(s.get("when", ""))}</span>'
                    f'<span class="tl-node"></span><span class="tl-what" data-text="body">{esc(s["what"])}{sub}</span></li>')
    return f'<ol class="timeline" data-box="timeline">{"".join(rows)}</ol>'


def before_after(d):
    """d: {before:{label, items, foot}, after:{label, items, foot}}"""
    def col(side, c, icon):
        items = "".join(f'<li>{ICON[icon]}<span data-text="body">{esc(t)}</span></li>' for t in c.get("items", []))
        foot = f'<div class="ba-foot">{esc(c["foot"])}</div>' if c.get("foot") else ""
        return (f'<div class="ba-col ba-{side}"><div class="ba-head">{esc(c.get("label", side.title()))}</div>'
                f'<ul>{items}</ul>{foot}</div>')
    return (f'<div class="ba" data-box="before-after">{col("before", d["before"], "dash")}'
            f'{col("after", d["after"], "check")}</div>')


def invoice_card(d):
    """d: {number, from, to, lines:[[label, amount]], total, due, status:'paid'|'due'|'overdue', status_label, sample}"""
    chip_cls = {"paid": "chip-paid", "due": "chip-due", "overdue": "chip-overdue"}[d.get("status", "due")]
    chip_icon = ICON["check"] if d.get("status") == "paid" else ""
    label = d.get("status_label") or {"paid": "Paid", "due": "Due", "overdue": "Overdue"}[d.get("status", "due")]
    lines = "".join(f'<div class="inv-line"><span>{esc(a)}</span><span>{esc(b)}</span></div>' for a, b in d.get("lines", []))
    sample = '<div class="sample-tag" style="margin-top:22px">Sample invoice</div>' if d.get("sample", True) else ""
    return f'''<div class="invoice card" data-box="invoice">
  <div class="inv-top"><div><div class="inv-label">Invoice</div><div class="inv-no">{esc(d.get("number", "No. 0142"))}</div></div>
  <span class="chip {chip_cls}">{chip_icon}{esc(label)}</span></div>
  <div class="inv-parties"><div><span>From</span><b>{esc(d.get("from", "Your Shop"))}</b></div><div><span>Billed to</span><b>{esc(d.get("to", "Customer"))}</b></div></div>
  <div class="inv-lines">{lines}</div>
  <div class="inv-total"><span>Total</span><b>{esc(d.get("total", ""))}</b></div>
  <div class="inv-due"><span>{esc(d.get("due_label", "Due"))}</span><b>{esc(d.get("due", ""))}</b></div>
  {sample}
</div>'''


def _tag(text):
    return f'<span class="ring-tag">{esc(text)}</span>' if text else ""


def ui_card(d):
    """Generic app screen. d: {title, theme:'light'|'dark', kicker, amount, rows:[[k,v,ring?]],
    tiles:[{icon,label,ring}], button:{label, ring, icon}, ghost, note, tag:{text, x, y}, width}"""
    theme = "surface-dark" if d.get("theme") == "dark" else "surface-light"
    parts = []
    if d.get("kicker"):
        parts.append(f'<div class="ui-kicker">{esc(d["kicker"])}</div>')
    if d.get("amount"):
        parts.append(f'<div class="ui-amount">{esc(d["amount"])}</div>')
    if d.get("tiles"):
        tiles = "".join(
            f'<div class="ui-tile{" ring" if t.get("ring") else ""}">{ICON.get(t.get("icon", "card"), "")}'
            f'<b>{esc(t["label"])}</b>{_tag(t.get("tag"))}</div>' for t in d["tiles"])
        cols = f' style="grid-template-columns:repeat({len(d["tiles"])},1fr)"' if len(d["tiles"]) != 3 else ""
        parts.append(f'<div class="ui-tiles"{cols}>{tiles}</div>')
    if d.get("rows"):
        rows = "".join(
            f'<div class="ui-row{" ring" if (len(r) > 2 and r[2]) else ""}"><span>{esc(r[0])}</span><b>{esc(r[1])}</b></div>'
            for r in d["rows"])
        parts.append(f'<div class="ui-rows">{rows}</div>')
    if d.get("button"):
        b = d["button"]
        icon = ICON.get(b.get("icon", ""), "")
        parts.append(f'<div class="ui-button{" ring" if b.get("ring") else ""}">{icon}{esc(b["label"])}{_tag(b.get("tag"))}</div>')
    if d.get("ghost"):
        parts.append(f'<div class="ui-button ghost">{esc(d["ghost"])}</div>')
    if d.get("note"):
        parts.append(f'<div class="ui-note">{esc(d["note"])}</div>')
    tag = ""
    width = f' style="width:{int(d["width"])}px;margin:0 auto"' if d.get("width") else ""
    return f'''<div class="ui-wrap" style="position:relative"><div class="ui card {theme}" data-box="ui-card"{width}>
  <div class="ui-bar">{ICON["back"]}<span class="ui-title">{esc(d.get("title", ""))}</span>{f'<span class="sample-tag">{esc(d["label"])}</span>' if d.get("label") else '<span class="ui-dots"><i></i><i></i><i></i></span>'}</div>
  <div class="ui-body">{"".join(parts)}</div>
</div>{tag}</div>'''


QUOTE_MARK = ('<svg class="news-quote-mark" viewBox="0 0 44 34"><path fill="currentColor" d="M0 34V21C0 9.6 6 2.6 17 0l2.2 4.6C12.8 7 10 11 10 16.4h8V34zm25 0V21C25 9.6 31 2.6 42 0l2 4.6C37.8 7 35 11 35 16.4h8V34z"/></svg>')


def news_card(d):
    """d: {source, date, monogram, quote, chips:[...], theme}"""
    theme = "surface-dark" if d.get("theme") == "dark" else "surface-light"
    # The real mark when we hold it, the two-letter monogram when we do not.
    badge = brand_badge(d.get("brand") or d.get("source"), size="sm")
    mono = d.get("monogram") or "".join(w[0] for w in d.get("source", "N").split()[:2]).upper()
    chips = "".join(f'<span class="chip">{esc(c)}</span>' for c in d.get("chips", []))
    foot = f'<div class="news-foot">{chips}</div>' if chips else ""
    return f'''<div class="news card {theme}" data-box="news-card">
  <div class="news-src">{badge or f'<span class="mono">{esc(mono)}</span>'}<div><b>{esc(d.get("source", ""))}</b><span>{esc(d.get("date", ""))}</span></div></div>
  {QUOTE_MARK}<div class="news-quote" data-text="body">{esc(d.get("quote", ""))}</div>
  {foot}
</div>'''


# --------------------------------------------------------------------------- doodles (T4)
# Hand-authored paths with a small wobble. Stroke weight is fixed so every doodle matches.
# viewBox is 904 x 600; labels use Caveat.

def _label(x, y, text, size=46, anchor="start", rot=0):
    tr = f' transform="rotate({rot} {x} {y})"' if rot else ""
    return f'<text x="{x}" y="{y}" font-size="{size}" text-anchor="{anchor}"{tr}>{esc(text)}</text>'


def doodle(d):
    kind = d.get("kind", "curve")
    L = d.get("labels", {})
    defs = ('<defs><pattern id="hatch" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)">'
            '<path d="M0 8h16" stroke="currentColor" stroke-width="4.5" stroke-linecap="round"/></pattern></defs>')
    if kind == "bars":
        # a pile that grows: three stacks, each taller, plus a rising arrow
        body = ''
        stacks = [(90, 3), (345, 5), (600, 7)]
        for x, h in stacks:
            for k in range(h):
                y = 520 - k * 62
                wob = (k % 2) * 8 - 4
                body += f'<path class="ink" d="M{x + wob} {y} q3 -48 2 -54 l196 -3 q-3 28 1 54 z"/>'
            top = 520 - (h - 1) * 62
            body += f'<path class="hatch" d="M{x + 6} {top - 4} l190 -3 q-2 24 1 44 l-190 3 z"/>'
        body += '<path class="ink" d="M40 546 q420 8 830 -6"/>'
        body += _label(192, 596, L.get("a", "this month"), 44, "middle")
        body += _label(446, 596, L.get("b", "next month"), 44, "middle")
        body += _label(700, 596, L.get("c", "after that"), 44, "middle")
        body += '<path class="ink-thin" d="M860 250 q18 -110 -40 -186"/><path class="ink-thin" d="M800 86 l20 -26 l14 30"/>'
        body += _label(770, 40, L.get("top", "the admin pile"), 50, "end")
    elif kind == "loop":
        # the same details typed into three places, then again
        boxes = [(40, L.get("a", "WhatsApp")), (340, L.get("b", "Tally")), (640, L.get("c", "Excel"))]
        body = ''
        for x, name in boxes:
            body += f'<path class="ink" d="M{x} 170 q110 -6 224 2 q4 60 -2 122 q-110 6 -224 -2 q-4 -60 2 -122 z"/>'
            body += _label(x + 112, 248, name, min(52, int(480 / max(len(name), 1))), "middle")
        body += '<path class="ink-thin" d="M272 232 q30 -4 58 0"/><path class="ink-thin" d="M318 220 l14 12 l-15 12"/>'
        body += '<path class="ink-thin" d="M572 232 q30 -4 58 0"/><path class="ink-thin" d="M618 220 l14 12 l-15 12"/>'
        body += '<path class="ink" d="M752 312 q-10 170 -300 176 q-300 4 -300 -170"/><path class="ink" d="M126 346 l26 -32 l30 30"/>'
        body += _label(452, 560, L.get("loop", "type it all again"), 54, "middle")
        body += '<path class="ink-soft" d="M300 108 q150 -40 300 0"/>'
        body += _label(452, 70, L.get("top", "person one, then person two"), 44, "middle")
    elif kind == "sort":
        # a task list split in two: copying goes to a system, judgement stays with people
        body = ''
        rows = L.get("rows", ["copy the order to a sheet", "retype the invoice", "send the payment reminder", "call an unhappy customer"])
        ys = [90, 196, 302, 470]
        for k, (r, y) in enumerate(zip(rows, ys)):
            body += f'<path class="ink-thin" d="M30 {y + 16} q2 -34 0 -44 q34 2 44 0 q-2 24 0 44 q-24 2 -44 0z"/>'
            if k < 3:
                body += f'<path class="ink" d="M38 {y - 6} l12 13 l26 -34"/>'
            body += _label(100, y + 12, r, 48)
        # brace grouping the three copy tasks, arrow to "system"
        body += '<path class="ink" d="M600 52 q26 0 26 30 l0 70 q0 34 26 40 q-26 6 -26 40 l0 70 q0 30 -26 30"/>'
        body += '<path class="ink" d="M650 192 q40 -6 74 -4"/><path class="ink" d="M708 170 l24 18 l-24 20"/>'
        body += '<path class="ink" d="M748 146 q80 -6 150 2 q4 44 -2 86 q-80 6 -150 -2 q-4 -42 2 -86z"/>'
        body += _label(823, 205, L.get("a", "system"), 48, "middle")
        body += '<path class="ink-thin" d="M20 392 q300 -6 600 3" stroke-dasharray="3 16"/>'
        body += '<path class="ink" d="M630 458 q50 -2 90 -2"/><path class="ink" d="M706 436 l24 20 l-24 20"/>'
        body += '<path class="ink" d="M748 414 q80 -6 150 2 q4 44 -2 86 q-80 6 -150 -2 q-4 -42 2 -86z"/>'
        body += _label(823, 473, L.get("b", "people"), 48, "middle")
    elif kind == "curve":
        # two lines crossing after a marker: copying time falls, customer time rises
        body = '<path class="ink" d="M90 40 q-4 250 2 500 q360 -6 760 4"/>'
        body += '<path class="ink" d="M70 64 l20 -30 l22 30"/><path class="ink" d="M826 520 l30 22 l-30 20"/>'
        body += '<path class="ink" d="M110 150 q170 -10 260 40 q120 70 200 250 q60 110 250 100"/>'
        body += '<path class="ink-soft" d="M110 470 q220 10 300 -40 q120 -80 200 -230 q60 -110 240 -130"/>'
        body += '<path class="ink" d="M110 470 q220 10 300 -40 q120 -80 200 -230 q60 -110 240 -130" stroke-dasharray="0.1 20"/>'
        body += '<path class="ink-thin" d="M400 90 q-4 220 2 440" stroke-dasharray="10 16"/>'
        body += _label(400, 596, L.get("marker", "system goes in"), 44, "middle")
        body += _label(150, 118, L.get("a", "time copying"), 46, "start")
        body += _label(856, 52, L.get("b", "time with customers"), 46, "end")
        body += _label(850, 596, L.get("x", "weeks"), 40, "end")
    elif kind == "arrow":
        body = ('<path class="ink" d="M80 460 q300 -40 440 -200 q60 -70 110 -170"/>'
                '<path class="ink" d="M580 110 l56 -26 l6 62"/>')
        body += _label(80, 560, L.get("a", ""), 50)
    else:  # circle
        body = '<path class="ink" d="M190 300 q20 -210 280 -214 q280 0 280 200 q-10 210 -300 212 q-250 0 -262 -170 q4 -40 30 -70"/>'
        body += _label(452, 318, L.get("a", ""), 64, "middle")
    return (f'<svg class="doodle" data-box="doodle" viewBox="0 0 904 600" role="img" '
            f'aria-label="{esc(d.get("alt", "drawing"))}">{defs}{body}</svg>')


def circle_svg():
    """A loose marker loop drawn around a highlighted word (T4)."""
    return ('<svg viewBox="0 0 200 100" preserveAspectRatio="none" aria-hidden="true">'
            '<path d="M24 58 C20 26 70 8 112 10 C160 12 194 30 190 56 C186 84 136 94 94 92 '
            'C50 90 10 76 14 50 C17 34 40 20 70 14" fill="none" stroke="currentColor" stroke-width="5" '
            'stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>')


def drawn_frame_svg():
    """Marker frame with overshooting corners, for T4 covers."""
    return ('<svg class="drawn-frame" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">'
            '<g fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" vector-effect="non-scaling-stroke">'
            '<path d="M-8 6 C300 -2 700 4 1012 0" vector-effect="non-scaling-stroke"/>'
            '<path d="M994 -10 C1000 300 992 700 998 1010" vector-effect="non-scaling-stroke"/>'
            '<path d="M1010 994 C700 1000 300 992 -12 998" vector-effect="non-scaling-stroke"/>'
            '<path d="M4 1012 C-2 700 6 300 2 -12" vector-effect="non-scaling-stroke"/>'
            '</g></svg>')


COMPONENTS = {
    "phone-whatsapp": phone_whatsapp,
    "copy-box": copy_box,
    "checklist": checklist,
    "timeline": timeline,
    "before-after": before_after,
    "invoice-card": invoice_card,
    "ui-card": ui_card,
    "news-card": news_card,
    "doodle": doodle,
}


def component(name, data):
    if not name:
        return ""
    if name not in COMPONENTS:
        raise SystemExit(f"unknown component '{name}'. Known: {', '.join(COMPONENTS)}")
    return COMPONENTS[name](data or {})
