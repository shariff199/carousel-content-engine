#!/usr/bin/env python3
"""
BAT carousel renderer v2: JSON spec -> 1080x1350 PNG slides through headless Chrome.

  python3 render_v2.py samples/t2-whatsapp-replies.json --out samples/t2 --sheet
  python3 render_v2.py spec.json --out dir --accent "#E9B44C"     # option B, single accent
  python3 render_v2.py --samples                                   # every samples/*.json + sheets + comparisons
  python3 render_v2.py spec.json --out dir --debug                 # draws the safe zones

v2.1: every template ends on the premium closing slide (role "closing"); the v2 closing layout
is role "recap". The handle lives in components.BRAND_HANDLE. Animated versions: animate_v2.py.

Spec:
  {"template": "t1|t2|t3|t4", "accent": null, "bg_image": null,
   "slides": [{"role": "cover|body|closing", "text": "...", "title": "...", "highlight": ["..."],
               "component": "copy-box", "data": {...}, "source": "Source: ..."}]}

Rendering waits for document.fonts.ready, then measures every slide in the same page:
text overflow against its component box and clipping ancestors, text in the feed-UI zone,
the smallest font per role, and WCAG contrast per text run. Results go to <out>/checks.json.

Needs Python Playwright driving the system Chrome (no browser download). Falls back to
Chrome's --screenshot CLI (no measurement) when Playwright is missing.
Fonts are vendored in ./fonts, so a render never touches the network.
"""
import argparse
import glob
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import templates as T  # noqa: E402

W, H = 1080, 1350
CSS = ["fonts.css", "tokens.css", "frame.css", "components.css", "templates.css"]
DEFAULT_ACCENT = "#E9B44C"


# ------------------------------------------------------------------ rulebook lint (cheap subset)

def lint(spec):
    """The slide-level rules from the content rulebook that can be checked without facts.json."""
    issues = []
    slides = spec.get("slides", [])
    if not 5 <= len(slides) <= 10:
        issues.append(f"slide count {len(slides)} (rulebook: 6-10, guide: 5-8)")
    for k, s in enumerate(slides, start=1):
        texts = [s.get("text", ""), s.get("title", ""), s.get("dim", ""), s.get("note", "")]
        data = json.dumps(s.get("data", {}), ensure_ascii=False)
        joined = " ".join(texts) + " " + data
        head = (s.get("text", "") + (" " + s["dim"] if s.get("dim") else "")).strip()
        if s["role"] == "cover" and len(head) > 60:
            issues.append(f"slide {k}: cover is {len(head)} chars (max 60)")
        if s["role"] == "body" and len(s.get("text", "")) > 90:
            issues.append(f"slide {k}: body text is {len(s['text'])} chars (max 90)")
        if s["role"] == "recap" and len(s.get("text", "")) > 140:
            issues.append(f"slide {k}: recap is {len(s['text'])} chars (max 140)")
        # Measured 16 Sept: the closing box holds 82 chars; 83 pushes the brand stack 21px past it.
        if s["role"] == "closing" and len(s.get("text", "")) > 80:
            issues.append(f"slide {k}: closing recap is {len(s['text'])} chars (max 80, one line of thought)")
        if s["role"] == "closing" and k != len(slides):
            issues.append(f"slide {k}: the closing slide must be last")
        if s["role"] == "cover" and head.rstrip().endswith("?"):
            issues.append(f"slide {k}: cover ends in a question (R19)")
        # Our own scrape: every cover that worked marks 2 to 4 words, and those words carry the
        # meaning alone. A cover with nothing marked has no target for the eye.
        if s["role"] == "cover" and not 2 <= len(s.get("highlight", []) or []) <= 4:
            issues.append(f"slide {k}: cover highlights {len(s.get('highlight', []) or [])} words (needs 2 to 4)")
        # Instagram re-shows slide 2 to anyone who did not swipe, so it has to read cold.
        if k == 2 and re.match(r"^\s*(and|so|but|this means|that means|it |they |he |she |which )",
                               s.get("text", "") or s.get("title", ""), re.I):
            issues.append(f"slide {k}: slide 2 continues slide 1; it must work as a second cover on its own")
        if re.search("[\u2014\u2013]|--", joined):
            issues.append(f"slide {k}: em/en dash (R11)")
        # v2.1: worldwide audience. No India-only rails or rupee amounts; dollar amounts only
        # inside something labelled as a sample or illustration.
        if re.search(r"\u20B9|\bRs\.?\s?\d|\b(lakh|crore|UPI|GST|Tally|RuPay|NPCI|Paytm)\b", joined, re.I):
            issues.append(f"slide {k}: India-specific money or tool reference (v2.1 global)")
        if re.search(r"\$\s?\d", joined) and not re.search(r"sample|illustration|example", joined, re.I) \
                and s.get("component") != "invoice-card":
            issues.append(f"slide {k}: dollar amount without a Sample/Illustration label")
        if re.search(r"https?://|www\.|\b[a-z0-9-]+\.(com|in|io|ai|co)\b", joined, re.I):
            issues.append(f"slide {k}: link or domain (R15)")
        if re.search("[\u201C\u201D\u2018\u2019]", joined):
            issues.append(f"slide {k}: curly quotes (R12)")
        if re.search("[\U0001F300-\U0001FAFF\u2600-\u27BF]", joined):
            issues.append(f"slide {k}: emoji (R17)")
        if re.search(r"\b(comment|dm us|type)\s+[\"']?[A-Z]{3,}", joined):
            issues.append(f"slide {k}: comment-keyword CTA (R13)")
        for w in s.get("highlight", []) or []:
            hay = head if s["role"] == "cover" else " ".join(texts)
            if w.lower() not in hay.lower():
                issues.append(f"slide {k}: highlight '{w}' not found in text")
    return issues


# ------------------------------------------------------------------ html

def page_html(spec, i, accent=None, debug=False, layers=""):
    n = len(spec["slides"])
    s = spec["slides"][i - 1]
    tpl = spec["template"]
    ground, inner = T.TEMPLATES[tpl](s, i, n, spec)
    style = ""
    if accent:
        style = f' style="--accent-custom:{accent};--accent-custom-ink:#0B0B0B"'
    links = "".join(f'<link rel="stylesheet" href="{c}">' for c in CSS)
    base = "file://" + HERE.replace("\\", "/") + "/"
    return (f'<!doctype html><html lang="en"><head><meta charset="utf-8"><base href="{base}">{links}'
            f'<title>{tpl} slide {i}</title></head>'
            f'<body class="{"debug" if debug else ""}"><main class="slide {tpl} {s["role"]} {ground}"{style}>'
            f'{layers}{inner}</main></body></html>')


# ------------------------------------------------------------------ measurement (runs in the page)

CHECK_JS = r"""
() => {
  const slide = document.querySelector('.slide');
  const S = slide.getBoundingClientRect();
  const IG = 120, TOL = 1.5;
  const out = { overflow: [], runs: [], fontsStatus: document.fonts.status };

  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null;
    const p = m[1].split(',').map(x => parseFloat(x)); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const over = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a),
                                b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  const lum = (c) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
  const desc = (el) => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '');

  // effective background under an element: composite background-colors from the root down
  const bgOf = (el) => {
    const chain = []; let e = el;
    while (e && e.nodeType === 1) { chain.push(e); e = e.parentElement; }
    let bg = { r: 0, g: 0, b: 0, a: 1 };
    for (const x of chain.reverse()) {
      const xs = getComputedStyle(x);
      let c = parse(xs.backgroundColor);
      // a flat linear-gradient (the marker bar) is a background too
      if ((!c || c.a === 0) && xs.backgroundImage.startsWith('linear-gradient')) {
        const cols = xs.backgroundImage.match(/rgba?\([^)]+\)/g) || [];
        if (cols.length && cols.every(k => k === cols[0])) c = parse(cols[0]);
      }
      if (c && c.a > 0) bg = over(c, bg);
    }
    return bg;
  };
  const opacityOf = (el) => { let o = 1, e = el; while (e && e.nodeType === 1) { o *= parseFloat(getComputedStyle(e).opacity); e = e.parentElement; } return o; };

  // 1. clipping containers whose content is taller or wider than the box (skip the slide itself: covers bleed on purpose)
  for (const el of slide.querySelectorAll('*')) {
    if (el.closest('svg')) continue;
    const cs = getComputedStyle(el);
    if (cs.overflow === 'visible' && cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
    if (el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2)
      out.overflow.push({ kind: 'scroll', el: desc(el), sh: el.scrollHeight, ch: el.clientHeight, sw: el.scrollWidth, cw: el.clientWidth });
  }
  // .content must hold its children
  const content = slide.querySelector('.content');
  if (content) {
    const C = content.getBoundingClientRect();
    // Only the outermost box that breaks out is worth reporting: its children break out with it, and a
    // list of every nested div, svg and path (slide 7, 16 Sept) says nothing about what to shorten.
    const reported = [];
    for (const ch of content.querySelectorAll('*')) {
      if (ch.closest('svg') && ch.tagName.toLowerCase() !== 'svg') continue;
      if (ch.closest('[data-bleed]') || ch.closest('.frame-box')) continue;
      if (getComputedStyle(ch).display === 'inline') continue;
      const r = ch.getBoundingClientRect();
      if (r.height === 0) continue;
      // A centred block that is taller than the box breaks out of BOTH edges, so take the worse one.
      const over = Math.max(r.bottom - C.bottom, C.top - r.top);
      if (over <= TOL) continue;
      if (reported.some((p) => p.contains(ch))) continue;
      reported.push(ch);
      out.overflow.push({ kind: 'content-box', el: desc(ch), top: Math.round(r.top), bottom: Math.round(r.bottom),
        boxTop: Math.round(C.top), boxBottom: Math.round(C.bottom),
        over_px: Math.round(over), tall_px: Math.round(r.height - C.height) });
    }
  }

  // 2. every text run: size, contrast, and whether it escapes its component, a clipping ancestor, or the canvas
  const walker = document.createTreeWalker(slide, NodeFilter.SHOW_TEXT, { acceptNode: n => n.textContent.trim() ? 1 : 2 });
  let node;
  while ((node = walker.nextNode())) {
    const el = node.parentElement;
    if (el.closest('[data-deco]')) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const range = document.createRange(); range.selectNodeContents(node);
    const rects = [...range.getClientRects()].filter(r => r.width > 0);
    if (!rects.length) continue;
    const box = { left: Math.min(...rects.map(r => r.left)), right: Math.max(...rects.map(r => r.right)),
                  top: Math.min(...rects.map(r => r.top)), bottom: Math.max(...rects.map(r => r.bottom)) };
    const text = node.textContent.trim().slice(0, 40);
    const inSvg = !!el.closest('svg');
    const size = parseFloat(cs.fontSize);
    let role = 'frame';
    if (el.closest('[data-text]')) role = el.closest('[data-text]').dataset.text;       // head | body
    else if (el.closest('[data-box]')) role = 'component';
    if (inSvg) role = 'doodle-label';

    const probs = [];
    const bled = el.closest('[data-bleed]');
    if (!bled && (box.left < S.left - TOL || box.right > S.right + TOL || box.top < S.top - TOL || box.bottom > S.bottom + TOL)) probs.push('off-canvas');
    const comp = el.closest('[data-box]');
    if (comp && !inSvg) { const R = comp.getBoundingClientRect();
      if (box.right > R.right + TOL || box.left < R.left - TOL || box.bottom > R.bottom + TOL) probs.push('escapes ' + comp.dataset.box); }
    let a = el.parentElement;
    while (a && a !== slide) { const acs = getComputedStyle(a);
      if (acs.overflow !== 'visible') { const R = a.getBoundingClientRect();
        if (box.bottom > R.bottom + TOL || box.right > R.right + TOL) { probs.push('clipped by ' + desc(a)); break; } }
      a = a.parentElement; }
    // v2.1: bleed visuals are not exempt. Any text whose VISIBLE part enters the bottom band fails.
    const visTop = Math.max(box.top, S.top), visBot = Math.min(box.bottom, S.bottom);
    if (visBot > visTop && visBot > S.bottom - IG) probs.push('in feed-UI zone');
    if (visBot > visTop) out.maxTextBottom = Math.max(out.maxTextBottom || 0, Math.round(visBot));
    // svg doodles can be scaled by their viewBox: report the rendered size
    let px = size;
    if (inSvg) { const svg = el.closest('svg'); const vb = svg.viewBox.baseVal; if (vb && vb.width) px = size * svg.getBoundingClientRect().width / vb.width; }

    let fg = parse(inSvg ? cs.fill : cs.color) || { r: 0, g: 0, b: 0, a: 1 };
    fg = { ...fg, a: fg.a * opacityOf(el) };
    const bg = bgOf(el);
    const cr = ratio(over(fg, bg), bg);
    out.runs.push({ text, role, px: Math.round(px * 10) / 10, weight: cs.fontWeight, contrast: Math.round(cr * 100) / 100,
                    top: Math.round(box.top), bottom: Math.round(box.bottom), probs });
    if (probs.length) out.overflow.push({ kind: 'text', text, probs });
  }
  // 3. headline and body lines must not run under a component card. On covers the visual and the
  //    headline share the slide, and a long headline slides beneath the card (14 Sept, engine run).
  const cards = [...slide.querySelectorAll('[data-box]')].map(b => ({ b, R: b.getBoundingClientRect() }));
  for (const t of slide.querySelectorAll('[data-text="head"], [data-text="body"]')) {
    if (t.closest('[data-box]')) continue;
    const range = document.createRange(); range.selectNodeContents(t);
    const lines = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0);
    for (const { b, R } of cards) {
      if (b.contains(t) || t.contains(b)) continue;
      for (const L of lines) {
        const ix = Math.min(L.right, R.right) - Math.max(L.left, R.left);
        const iy = Math.min(L.bottom, R.bottom) - Math.max(L.top, R.top);
        if (ix > 4 && iy > 4) { out.overflow.push({ kind: 'collision', text: t.textContent.trim().slice(0, 40), box: b.dataset.box, overlap_px: Math.round(iy) }); break; }
      }
    }
  }
  return out;
}
"""


# ------------------------------------------------------------------ chrome

def find_chrome(override=None):
    if override:
        return override
    for p in ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
              "/Applications/Chromium.app/Contents/MacOS/Chromium",
              r"C:/Program Files/Google/Chrome/Application/chrome.exe",
              "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"]:
        if os.path.exists(p):
            return p
    raise SystemExit("Chrome not found. Pass --chrome")


class Renderer:
    def __init__(self, chrome):
        self.chrome = chrome
        try:
            from playwright.sync_api import sync_playwright
            self._pw = sync_playwright().start()
            self.browser = self._pw.chromium.launch(executable_path=chrome, headless=True,
                                                    args=["--hide-scrollbars", "--font-render-hinting=none"])
            self.page = self.browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
        except ImportError:
            self._pw = None
            print("  playwright missing: CLI screenshots only, no measurement")

    def shoot(self, html_path, png_path):
        if not self._pw:
            prof = tempfile.mkdtemp(prefix="bat-render-")
            try:
                subprocess.run([self.chrome, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                                f"--user-data-dir={prof}", "--force-device-scale-factor=1",
                                f"--window-size={W},{H}", "--virtual-time-budget=8000",
                                f"--screenshot={png_path}", "file://" + html_path], capture_output=True, timeout=90)
            finally:
                shutil.rmtree(prof, ignore_errors=True)
            return None
        self.page.goto("file://" + html_path, wait_until="load")
        self.page.evaluate("document.fonts.ready.then(() => document.fonts.status)")
        # every face the slide actually uses must be loaded (not a fallback)
        missing = self.page.evaluate("""() => {
            const used = new Set();
            for (const el of document.querySelectorAll('.slide *')) {
                if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
                const cs = getComputedStyle(el);
                const fam = cs.fontFamily.split(',')[0].trim();
                used.add(`${cs.fontStyle} ${cs.fontWeight} 40px ${fam}`);
            }
            return [...used].filter(f => !document.fonts.check(f));
        }""")
        checks = self.page.evaluate(CHECK_JS)
        checks["fontsMissing"] = missing
        self.page.screenshot(path=png_path, clip={"x": 0, "y": 0, "width": W, "height": H})
        return checks

    def close(self):
        if self._pw:
            self.browser.close()
            self._pw.stop()


# ------------------------------------------------------------------ contact sheet

def _font(size):
    from PIL import ImageFont
    for p in ["/System/Library/Fonts/Helvetica.ttc", "/System/Library/Fonts/SFNS.ttf",
              "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except OSError:
                pass
    return ImageFont.load_default()


def contact_sheet(pngs, out_path, title="", cols=4, thumb_w=432):
    from PIL import Image, ImageDraw
    thumb_h = int(thumb_w * H / W)
    gap, pad, head = 28, 56, 96 if title else 0
    rows = (len(pngs) + cols - 1) // cols
    sheet = Image.new("RGB", (pad * 2 + cols * thumb_w + (cols - 1) * gap,
                              pad * 2 + head + rows * thumb_h + (rows - 1) * gap), (38, 38, 37))
    d = ImageDraw.Draw(sheet)
    if title:
        d.text((pad, pad - 6), title, fill=(236, 236, 232), font=_font(40))
    f = _font(22)
    for k, p in enumerate(pngs):
        im = Image.open(p).convert("RGB").resize((thumb_w, thumb_h), Image.LANCZOS)
        x = pad + (k % cols) * (thumb_w + gap)
        y = pad + head + (k // cols) * (thumb_h + gap)
        sheet.paste(im, (x, y))
        d.text((x, y + thumb_h + 4), "", fill=(160, 160, 156), font=f)
    sheet.save(out_path)
    return out_path


def side_by_side(a, b, out_path, labels):
    from PIL import Image, ImageDraw
    tw = 720
    th = int(tw * H / W)
    pad, gap, head = 56, 40, 84
    sheet = Image.new("RGB", (pad * 2 + tw * 2 + gap, pad * 2 + head + th), (38, 38, 37))
    d = ImageDraw.Draw(sheet)
    for k, (p, lab) in enumerate(zip((a, b), labels)):
        x = pad + k * (tw + gap)
        d.text((x, pad), lab, fill=(236, 236, 232), font=_font(34))
        sheet.paste(Image.open(p).convert("RGB").resize((tw, th), Image.LANCZOS), (x, pad + head))
    sheet.save(out_path)
    return out_path


def grid_compare(cells, out_path, cols=2, tw=620, title=""):
    """cells: [(png, label)]. A labelled grid for A/B looks (closing slide greyscale vs accent)."""
    from PIL import Image, ImageDraw
    th = int(tw * H / W)
    pad, gap, lab, head = 56, 40, 64, (84 if title else 0)
    rows = (len(cells) + cols - 1) // cols
    sheet = Image.new("RGB", (pad * 2 + cols * tw + (cols - 1) * gap,
                              pad * 2 + head + rows * (lab + th) + (rows - 1) * gap), (38, 38, 37))
    d = ImageDraw.Draw(sheet)
    if title:
        d.text((pad, pad - 6), title, fill=(236, 236, 232), font=_font(40))
    for k, (p, text) in enumerate(cells):
        x = pad + (k % cols) * (tw + gap)
        y = pad + head + (k // cols) * (lab + th + gap)
        d.text((x, y), text, fill=(236, 236, 232), font=_font(30))
        sheet.paste(Image.open(p).convert("RGB").resize((tw, th), Image.LANCZOS), (x, y + lab))
    sheet.save(out_path)
    return out_path


# ------------------------------------------------------------------ pipeline

def render_spec(renderer, spec, out, accent=None, debug=False, only=None, sheet=False, title=""):
    os.makedirs(out, exist_ok=True)
    issues = lint(spec)
    for msg in issues:
        print("  lint:", msg)
    accent = accent or spec.get("accent")
    results, pngs = [], []
    for i in range(1, len(spec["slides"]) + 1):
        if only and i not in only:
            continue
        html_path = os.path.abspath(os.path.join(out, f"slide-{i:02d}.html"))
        png_path = os.path.abspath(os.path.join(out, f"slide-{i:02d}.png"))
        with open(html_path, "w", encoding="utf-8") as f:
            f.write(page_html(spec, i, accent=accent, debug=debug))
        checks = renderer.shoot(html_path, png_path)
        pngs.append(png_path)
        if checks is not None:
            checks["slide"] = i
            results.append(checks)
    summary = summarise(results, issues)
    with open(os.path.join(out, "checks.json"), "w") as f:
        json.dump({"summary": summary, "slides": results}, f, indent=1)
    if sheet:
        contact_sheet(pngs, os.path.join(out, "contact-sheet.png"), title)
    return pngs, summary


def summarise(results, issues):
    runs = [r for s in results for r in s["runs"]]
    def mn(key, pred):
        v = [r[key] for r in runs if pred(r)]
        return min(v) if v else None
    read = lambda r: r["role"] in ("head", "body")
    return {
        "lint_issues": len(issues),
        "overflow_count": sum(len(s["overflow"]) for s in results),
        "overflow": [dict(o, slide=s["slide"]) for s in results for o in s["overflow"]],
        "min_px_body_and_head": mn("px", read),
        "min_px_sub_lines": mn("px", lambda r: r["role"] == "sub"),
        "min_px_component": mn("px", lambda r: r["role"] == "component"),
        "min_px_frame_labels": mn("px", lambda r: r["role"] == "frame"),
        "min_px_doodle_labels": mn("px", lambda r: r["role"] == "doodle-label"),
        "min_contrast_body_and_head": mn("contrast", read),
        "min_contrast_all": mn("contrast", lambda r: True),
        "contrast_below_4_5": [dict(r, slide=s["slide"]) for s in results for r in s["runs"] if r["contrast"] < 4.5],
        "fonts_missing": sorted({f for s in results for f in s.get("fontsMissing", [])}),
        "max_text_bottom_px": max((s.get("maxTextBottom", 0) for s in results), default=None),
        "clear_of_feed_ui_px": (H - 120 - max((s.get("maxTextBottom", 0) for s in results), default=0)) if results else None,
    }


def print_summary(name, sm):
    print(f"  {name}: overflow={sm['overflow_count']} min body/head px={sm['min_px_body_and_head']} "
          f"sub px={sm['min_px_sub_lines']} component px={sm['min_px_component']} frame px={sm['min_px_frame_labels']} "
          f"min contrast body/head={sm['min_contrast_body_and_head']} all={sm['min_contrast_all']} "
          f"fonts missing={sm['fonts_missing'] or 'none'} lint={sm['lint_issues']} "
          f"lowest text={sm['max_text_bottom_px']}px (clear of feed UI by {sm['clear_of_feed_ui_px']}px)")
    for o in sm["overflow"]:
        print("    overflow:", o)
    for r in sm["contrast_below_4_5"]:
        print(f"    low contrast s{r['slide']} {r['contrast']} {r['px']}px [{r['role']}] {r['text']!r}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("spec", nargs="?")
    ap.add_argument("--out")
    ap.add_argument("--sheet", action="store_true", help="also write contact-sheet.png")
    ap.add_argument("--accent", help="single accent colour, e.g. '#E9B44C' (brand option B)")
    ap.add_argument("--debug", action="store_true", help="draw margins and the feed-UI zone")
    ap.add_argument("--only", help="comma list of slide numbers")
    ap.add_argument("--chrome")
    ap.add_argument("--samples", action="store_true", help="render every samples/*.json with sheets and comparisons")
    a = ap.parse_args()

    r = Renderer(find_chrome(a.chrome))
    try:
        if a.samples:
            sdir = os.path.join(HERE, "samples")
            overall, closings = {}, {}
            for sp in sorted(glob.glob(os.path.join(sdir, "*.json"))):
                name = os.path.splitext(os.path.basename(sp))[0]
                spec = json.load(open(sp, encoding="utf-8"))
                if not isinstance(spec, dict) or "template" not in spec:
                    continue
                out = os.path.join(sdir, name)
                _, sm = render_spec(r, spec, out, sheet=True, title=spec.get("name", name))
                shutil.copy(os.path.join(out, "contact-sheet.png"), os.path.join(sdir, f"sheet-{name}.png"))
                print_summary(name, sm)
                overall[name] = sm
                n = len(spec["slides"])
                acc_out = os.path.join(sdir, f"{name}-accent")
                accent_only = {n} | ({1} if spec["template"] in ("t2", "t3") else set())
                render_spec(r, spec, acc_out, accent=DEFAULT_ACCENT, only=accent_only)
                if spec["template"] in ("t2", "t3"):
                    side_by_side(os.path.join(out, "slide-01.png"), os.path.join(acc_out, "slide-01.png"),
                                 os.path.join(sdir, f"compare-{spec['template']}-cover.png"),
                                 ["A  Greyscale (brand lock)", f"B  Single accent {DEFAULT_ACCENT}"])
                closings[spec["template"]] = (os.path.join(out, f"slide-{n:02d}.png"), os.path.join(acc_out, f"slide-{n:02d}.png"))
            cells = []
            for t, ground in (("t3", "dark"), ("t1", "light")):
                if t in closings:
                    cells += [(closings[t][0], f"{t.upper()} {ground}  A  Greyscale (brand lock)"),
                              (closings[t][1], f"{t.upper()} {ground}  B  Accent {DEFAULT_ACCENT}")]
            if cells:
                grid_compare(cells, os.path.join(sdir, "compare-closing-slide.png"),
                             title="Closing slide: greyscale vs single accent (the mark itself never changes)")
            json.dump(overall, open(os.path.join(sdir, "checks-summary.json"), "w"), indent=1)
            return
        if not (a.spec and a.out):
            ap.error("pass a spec and --out, or --samples")
        spec = json.load(open(a.spec, encoding="utf-8"))
        only = {int(x) for x in a.only.split(",")} if a.only else None
        pngs, sm = render_spec(r, spec, a.out, accent=a.accent, debug=a.debug, only=only, sheet=a.sheet,
                               title=spec.get("name", ""))
        print_summary(os.path.basename(a.spec), sm)
        print(f"rendered {len(pngs)} slides -> {a.out}")
    finally:
        r.close()


if __name__ == "__main__":
    main()
