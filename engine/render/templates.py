"""The four BAT carousel templates. Each returns (slide classes, inner HTML) for one slide.

Spec per slide: {role: cover|body|recap|closing, text, title, dim, highlight:[...], component, data,
source, note, swipe, hud}. Cover `text` is the headline. Body `title` is the step or news title and
`text` the one sentence.

v2.1 roles:
  recap    the v2 closing layout (big "Save this" / "What you can copy" title + a component)
  closing  the premium brand slide: BAT mark as the hero, `text` as the one-line recap, the
           "Follow <BRAND_HANDLE> for more" line, "Save this" as the secondary cue. `title` is
           ignored, so v2 specs with role "closing" still render.
`hud: true` (per slide, or top-level for the carousel) adds the futuristic corner-bracket frame.
"""
import re

import components as C


def hl(text, words, cls="hl", extra=""):
    """Highlight phrases; `extra` (an SVG mark) is appended inside each highlight span."""
    out = C.highlight(text or "", words, cls)
    if extra:
        out = re.sub(r'<span class="' + re.escape(cls) + r'">(.*?)</span>',
                     lambda m: f'<span class="{cls}">{m.group(1)}{extra}</span>', out)
    return out


def _foot_right(s, last):
    return "" if last else C.swipe_cue(s.get("swipe", "Swipe"))


def _hud(s, spec):
    return C.hud_svg() if s.get("hud", spec.get("hud")) else ""


def closing(s, i, n, spec, tex="", extra_cls="", source=None, default_hud=True):
    """The shared premium closing slide. Every template calls this with its own ground texture."""
    src = s.get("source") if source is None else source
    hud = C.hud_svg() if s.get("hud", default_hud) else ""
    grid = '<div class="closing-grid" aria-hidden="true"></div>'
    block = C.closing_block(s.get("text", ""), handle=s.get("handle") or spec.get("brand_handle"),
                            reason=s.get("reason"), recap_cls=extra_cls)
    return (tex + grid + hud + C.frame_top(C.counter(i, n), right="")
            + f'<div class="content closing-content">{block}</div>'
            + C.frame_foot(C.save_cue(), C.source_line(src or "")))


# ------------------------------------------------------------------ T1 business move (light)

def t1(s, i, n, spec):
    role, last = s["role"], i == n
    comp = C.component(s.get("component"), s.get("data"))
    src = s.get("source") or (spec.get("source") if role != "closing" else "")
    if role == "cover":
        dim = f' <span class="dim">{C.esc(s["dim"])}</span>' if s.get("dim") else ""
        inner = (_hud(s, spec) + C.frame_top(ruled=True)
                 + f'<div class="content">{_brand_row(s, spec, size="md")}<h1 class="headline cover-head" data-text="head">{hl(s["text"], s.get("highlight"))}{dim}</h1>'
                 + f'<div class="stage">{comp}</div></div>'
                 + C.frame_foot(C.source_line(src), _foot_right(s, last), ruled=True))
    elif role == "closing":
        inner = closing(s, i, n, spec, source=s.get("source", ""))
    elif role == "recap":
        inner = (_hud(s, spec) + C.frame_top(C.counter(i, n), ruled=True)
                 + f'<div class="content"><h2 class="headline closing-head" data-text="head">{hl(s.get("title", ""), s.get("highlight"))}</h2>'
                 + f'<div class="stage">{comp}</div></div>'
                 + C.frame_foot(C.save_cue(), _foot_right(s, last), ruled=True))
    else:
        inner = (_hud(s, spec) + C.frame_top(C.counter(i, n), ruled=True)
                 + f'<div class="content"><p class="sentence" data-text="head">{hl(s["text"], s.get("highlight"))}</p>'
                 + f'<div class="stage">{comp}</div></div>'
                 + C.frame_foot(C.source_line(s.get("source", "")), _foot_right(s, last), ruled=True))
    return "ground-light", inner


# ------------------------------------------------------------------ T2 saveable resource (dark)

def t2(s, i, n, spec):
    role, last = s["role"], i == n
    comp = C.component(s.get("component"), s.get("data"))
    tex = '<div class="texture texture-corner"></div><div class="vignette"></div>'
    if role == "cover":
        note = f'<p class="cover-note" data-text="body">{C.esc(s["note"])}</p>' if s.get("note") else ""
        inner = (tex + _hud(s, spec) + C.frame_top()
                 + f'<div class="content">{_brand_row(s, spec, size="sm")}<h1 class="headline" data-text="head">{hl(s["text"], s.get("highlight"))}</h1>{note}</div>'
                 + f'<div class="cover-phone" data-bleed>{comp}</div>'
                 + C.frame_foot(C.swipe_cue(s.get("swipe", "Swipe")), ""))
    elif role == "closing":
        inner = closing(s, i, n, spec, tex=tex)
    elif role == "recap":
        inner = (tex + _hud(s, spec) + C.frame_top(C.counter(i, n))
                 + f'<div class="content"><h2 class="headline closing-head" data-text="head">{hl(s.get("title", "Save this."), s.get("highlight"))}</h2>'
                 + (f'<p class="body-text" data-text="body">{C.esc(s["text"])}</p>' if s.get("text") else "")
                 + f'<div class="stage">{comp}</div></div>'
                 + C.frame_foot(C.save_cue(), _foot_right(s, last)))
    else:
        num = s.get("num")
        ghost = f'<div class="ghost-num" aria-hidden="true" data-deco>{C.esc(num)}</div>' if num else ""
        inner = (tex + _hud(s, spec) + ghost + C.frame_top(C.counter(i, n))
                 + f'<div class="content"><h2 class="step-title" data-text="head">{C.esc(s.get("title", ""))}</h2>'
                 + f'<p class="body-text" data-text="body">{hl(s["text"], s.get("highlight"), "hl-weight")}</p>'
                 + f'<div class="stage">{comp}</div></div>'
                 + C.frame_foot(C.save_cue(), _foot_right(s, last)))
    return "ground-dark", inner


# ------------------------------------------------------------------ T3 AI explained (dark news)

def _brand_row(s, spec, size="lg"):
    """The circle mark of the company in the story, on a rule, above the headline. Six of the
    AI-news pages in research/2026-09-14-ai-news-pages-and-trend-radar.md open exactly this way.
    Returns "" when we hold no mark, so the cover simply falls back to type."""
    badge = C.brand_badge(s.get("brand") or spec.get("brand"), size=size)
    if not badge:
        return ""
    _, meta = C.brand_of(s.get("brand") or spec.get("brand"))
    tag = f'<span class="brand-tag">{C.esc(meta["title"])}</span>' if meta and not meta.get("wordmark") else ""
    return f'<div class="brand-row">{badge}{tag}<span class="brand-rule"></span></div>'


def t3(s, i, n, spec):
    role, last = s["role"], i == n
    comp = C.component(s.get("component"), s.get("data"))
    tex = '<div class="texture texture-corner"></div>'
    if role == "cover":
        bg = s.get("bg_image") or spec.get("bg_image")
        bg_html = f'<div class="bg-image" style="background-image:url(\'{C.esc(bg)}\')"></div>' if bg else ""
        inner = (bg_html + tex + _hud(s, spec) + C.frame_top()
                 + f'<div class="cover-visual" data-bleed>{comp}</div>'
                 + f'<div class="content">{_brand_row(s, spec)}<h1 class="news-head" data-text="head">{hl(s["text"], s.get("highlight"))}</h1></div>'
                 + C.frame_foot(C.source_line(s.get("source", "")), C.swipe_cue(s.get("swipe", "Swipe for more"))))
    elif role == "closing":
        inner = closing(s, i, n, spec, tex=tex)
    elif role == "recap":
        inner = (tex + _hud(s, spec) + C.frame_top(C.counter(i, n))
                 + f'<div class="content"><h2 class="news-head" data-text="head">{hl(s.get("title", "Save this"), s.get("highlight"))}</h2>'
                 + (f'<p class="body-text" data-text="body">{C.esc(s["text"])}</p>' if s.get("text") else "")
                 + (f'<div class="stage">{comp}</div>' if comp else "") + '</div>'
                 + C.frame_foot(C.save_cue(), C.source_line(s.get("source", ""))))
    else:
        inner = (tex + _hud(s, spec) + C.frame_top(C.counter(i, n))
                 + f'<div class="content"><h2 class="news-head" data-text="head">{hl(s.get("title", ""), s.get("title_highlight"))}</h2>'
                 + f'<p class="body-text" data-text="body">{hl(s["text"], s.get("highlight"), "hl-weight")}</p>'
                 + f'<div class="stage">{comp}</div></div>'
                 + C.frame_foot(C.source_line(s.get("source", "")), _foot_right(s, last)))
    return "ground-dark", inner


# ------------------------------------------------------------------ T4 one belief (paper, hand)

def t4(s, i, n, spec):
    role, last = s["role"], i == n
    comp = C.component(s.get("component"), s.get("data"))
    tex = '<div class="texture texture-page"></div>'
    if role == "cover":
        head = hl(s["text"], s.get("highlight"), "circled", C.circle_svg())
        sign = f'<div class="sign">{C.esc(s["sign"])}</div>' if s.get("sign") else ""
        inner = (tex + C.frame_top()
                 + f'<div class="content">{_brand_row(s, spec, size="sm")}<div class="frame-box">{C.drawn_frame_svg()}'
                 + f'<h1 class="marker" data-text="head">{head}</h1>{sign}</div></div>'
                 + C.frame_foot("", C.swipe_cue(s.get("swipe", "Swipe"))))
    elif role == "closing":
        inner = closing(s, i, n, spec, tex=tex, extra_cls="recap-hand", default_hud=False)
    elif role == "recap":
        inner = (tex + C.frame_top(C.counter(i, n))
                 + f'<div class="content"><div class="frame-box">{C.drawn_frame_svg()}'
                 + f'<h2 class="marker" data-text="head">{hl(s.get("title", "Save this."), s.get("highlight"), "underlined", underline_svg())}</h2>'
                 + (f'<p class="recap" data-text="body">{C.esc(s["text"])}</p>' if s.get("text") else "")
                 + f'</div></div>' + SAVE_ARROW
                 + C.frame_foot(C.save_cue(), ""))
    else:
        inner = (tex + C.frame_top(C.counter(i, n))
                 + f'<div class="content"><p class="marker" data-text="head">{hl(s["text"], s.get("highlight"), "underlined", underline_svg())}</p>'
                 + f'<div class="stage">{comp}</div></div>'
                 + C.frame_foot("", _foot_right(s, last)))
    return "ground-paper", inner


def underline_svg():
    return ('<svg viewBox="0 0 300 20" preserveAspectRatio="none" aria-hidden="true">'
            '<path d="M4 12 C80 4 180 6 296 9 M40 17 C120 12 200 13 260 15" fill="none" stroke="currentColor" '
            'stroke-width="5" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>')


SAVE_ARROW = ('<svg class="save-arrow" viewBox="0 0 170 150" aria-hidden="true"><g fill="none" stroke="currentColor" '
              'stroke-width="6" stroke-linecap="round" stroke-linejoin="round">'
              '<path d="M160 6 C150 70 110 112 30 128"/><path d="M58 104 L28 129 L62 144"/></g></svg>')


TEMPLATES = {"t1": t1, "t2": t2, "t3": t3, "t4": t4}
