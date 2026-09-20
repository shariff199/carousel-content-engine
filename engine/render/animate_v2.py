#!/usr/bin/env python3
"""
BAT carousel animation v2.1: the cover and closing slides as short MP4s, through HyperFrames.

  python3 animate_v2.py samples/t2-whatsapp-replies.json --out samples/t2-whatsapp-replies
  python3 animate_v2.py --samples                    # every samples/*.json into its own folder
  python3 animate_v2.py spec.json --out dir --only cover --keep   # keep the HyperFrames project

Each slide is the exact HTML render_v2.py builds for the still, wrapped in a HyperFrames
composition with one paused GSAP timeline. Motion is subtle and finishes by 2.8s, then the
slide holds, so the last frame is the approved still:
  cover    HUD corner brackets draw in, one scan line passes, the headline rises in,
           the marker highlight wipes across (T4: the loop and frame draw themselves),
           then the visual fades up.
  closing  grid and brackets come in, the BAT mark rises, one soft light sweep crosses it,
           recap and follow line fade up, the handle's highlight wipes across.

Output follows the Instagram video-slide spec in research/2026-09-14-visual-and-animation-guide.md:
1080x1350, H.264 High, yuv420p, 30 fps, silent AAC 48k, faststart. The final frame is compared
against slide-NN.png and the difference is written to <out>/animation-checks.json.

Needs node/npx (HyperFrames CLI, pinned below), ffmpeg, and Pillow for the comparison.
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

import render_v2 as R  # noqa: E402

HF = "hyperframes@0.8.38"
DURATION = 6
FPS = 30
LAYERS = '<div class="scanline" aria-hidden="true"></div><div class="lightsweep" aria-hidden="true"></div>'

TIMELINE_JS = r"""
document.fonts.ready.then(() => {
  const tl = gsap.timeline({ paused: true });
  const q = (s) => Array.from(document.querySelectorAll(s));
  const slide = document.querySelector('.slide');
  const closing = slide.classList.contains('closing');

  // draw an SVG path from nothing to whole, then drop the dash so the end state is the still.
  // Non-scaling strokes (T4 marker frame and loop) dash in screen pixels, so pathLength does
  // nothing there: measure the on-screen length by sampling the path through its screen CTM.
  const screenLength = (path) => {
    const m = path.getScreenCTM(), total = path.getTotalLength(), N = 240;
    let len = 0, prev = null;
    for (let k = 0; k <= N; k++) {
      const p = path.getPointAtLength(total * k / N).matrixTransform(m);
      if (prev) len += Math.hypot(p.x - prev.x, p.y - prev.y);
      prev = p;
    }
    return Math.ceil(len) + 4;
  };
  const draw = (path, at, dur) => {
    let L = 1;
    if (path.closest('[vector-effect="non-scaling-stroke"]')) L = screenLength(path);
    else path.setAttribute('pathLength', '1');
    tl.fromTo(path, { strokeDasharray: L, strokeDashoffset: L },
                    { strokeDashoffset: 0, duration: dur, ease: 'power2.inOut' }, at);
    tl.set(path, { strokeDasharray: 'none' }, at + dur);
  };
  const rise = (el, at, dist = 28, dur = 0.7) =>
    tl.fromTo(el, { opacity: 0, y: dist }, { opacity: 1, y: 0, duration: dur, ease: 'power3.out' }, at);
  const fade = (el, at, dur = 0.6) =>
    tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: dur, ease: 'power1.out' }, at);
  const wipe = (el, at) =>
    tl.fromTo(el, { '--hl-w': '0%' }, { '--hl-w': '100%', duration: 0.6, ease: 'power2.inOut' }, at);

  // the futuristic frame, wherever the slide has one
  q('.hud-c path').forEach((p, k) => draw(p, 0.15 + k * 0.08, 0.6));
  q('.hud-ticks').forEach((t) => fade(t, 0.5, 0.7));
  q('.frame-top').forEach((e) => fade(e, 0.1, 0.5));

  if (!closing) {
    const scan = document.querySelector('.scanline');
    tl.set(scan, { opacity: 1 }, 0.1);
    tl.fromTo(scan, { y: 0 }, { y: 1350 + 160, duration: 1.6, ease: 'sine.inOut' }, 0.1);
    tl.set(scan, { opacity: 0 }, 1.7);

    const head = document.querySelector('.content [data-text="head"]');
    if (head) rise(head, 0.35);
    q('.hl').forEach((e, k) => wipe(e, 1.05 + k * 0.15));
    q('.drawn-frame path').forEach((p, k) => draw(p, 0.2 + k * 0.15, 0.6));
    q('.circled svg path').forEach((p, k) => draw(p, 1.1 + k * 0.1, 0.8));
    q('.cover-note, .content .stage, .cover-phone, .cover-visual, .sign').forEach((e, k) => rise(e, 1.2 + k * 0.12, 36, 0.8));
    q('.frame-foot').forEach((e) => fade(e, 1.6, 0.5));
  } else {
    q('.closing-grid').forEach((e) => fade(e, 0, 0.9));
    const mark = document.querySelector('.closing-mark');
    if (mark) tl.fromTo(mark, { opacity: 0, y: 24, scale: 0.96 },
                              { opacity: 1, y: 0, scale: 1, duration: 0.9, ease: 'power3.out' }, 0.3);
    const sweep = document.querySelector('.lightsweep');
    tl.set(sweep, { opacity: 1 }, 1.0);
    tl.fromTo(sweep, { x: 0 }, { x: 1080 * 1.4, duration: 1.1, ease: 'sine.inOut' }, 1.0);
    tl.set(sweep, { opacity: 0 }, 2.1);
    q('.closing-word').forEach((e) => fade(e, 1.0, 0.6));
    q('.closing-recap').forEach((e) => rise(e, 1.3, 20, 0.6));
    q('.closing-cta').forEach((e) => rise(e, 1.7, 20, 0.6));
    q('.closing-follow .hl').forEach((e) => wipe(e, 2.2));
    q('.frame-foot').forEach((e) => fade(e, 2.3, 0.5));
  }
  window.__timelines["bat-slide"] = tl;
});
"""


def composition_html(spec, i, accent=None):
    """The still's page, re-rooted as a HyperFrames standalone composition."""
    page = R.page_html(spec, i, accent=accent, layers=LAYERS)
    main = re.search(r"<main .*</main>", page, re.S).group(0)
    links = "".join(f'<link rel="stylesheet" href="{c}">' for c in R.CSS)
    return (f'<!doctype html><html lang="en"><head><meta charset="utf-8">'
            f'<meta name="viewport" content="width={R.W}, height={R.H}">{links}'
            f'<script src="vendor/gsap.min.js"></script><title>BAT slide {i}</title></head><body>'
            f'<div id="root" data-composition-id="bat-slide" data-start="0" data-width="{R.W}" '
            f'data-height="{R.H}" data-duration="{DURATION}" data-fps="{FPS}" '
            f'style="position:relative;width:{R.W}px;height:{R.H}px;overflow:hidden">{main}</div>'
            f'<script>{TIMELINE_JS}</script></body></html>')


def run(cmd, **kw):
    p = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if p.returncode != 0:
        raise SystemExit(f"failed: {' '.join(cmd)}\n{p.stdout[-2000:]}\n{p.stderr[-2000:]}")
    return p.stdout


def build_project(spec, i, accent=None):
    d = tempfile.mkdtemp(prefix="bat-anim-")
    for c in R.CSS:
        shutil.copy(os.path.join(HERE, c), d)
    shutil.copytree(os.path.join(HERE, "fonts"), os.path.join(d, "fonts"))
    shutil.copytree(os.path.join(HERE, "vendor"), os.path.join(d, "vendor"))
    with open(os.path.join(d, "index.html"), "w", encoding="utf-8") as f:
        f.write(composition_html(spec, i, accent))
    return d


def normalise(src, dst):
    """Instagram video-slide spec: H.264 High, yuv420p, 30 fps, silent AAC 48k, faststart."""
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", src,
         "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
         "-map", "0:v:0", "-map", "1:a:0", "-shortest",
         "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p", "-r", str(FPS), "-crf", "16",
         "-preset", "slow", "-c:a", "aac", "-b:a", "128k", "-ar", "48000",
         "-movflags", "+faststart", dst])


def probe(path):
    out = json.loads(run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", path]))
    v = next(s for s in out["streams"] if s["codec_type"] == "video")
    a = next((s for s in out["streams"] if s["codec_type"] == "audio"), {})
    return {"width": v["width"], "height": v["height"], "codec": v["codec_name"], "profile": v.get("profile"),
            "pix_fmt": v["pix_fmt"], "fps": v["r_frame_rate"], "duration": round(float(out["format"]["duration"]), 2),
            "audio": a.get("codec_name"), "audio_rate": a.get("sample_rate")}


def frame_at(video, t, png):
    run(["ffmpeg", "-y", "-loglevel", "error", "-ss", str(t), "-i", video, "-frames:v", "1", png])
    return png


def compare(a, b):
    """Mean absolute difference (0-255) and share of pixels that differ by more than 24 on any channel."""
    from PIL import Image, ImageChops
    ia = Image.open(a).convert("RGB")
    ib = Image.open(b).convert("RGB").resize(ia.size)
    diff = ImageChops.difference(ia, ib)
    hist = diff.convert("L").histogram()
    total = ia.size[0] * ia.size[1]
    mean = sum(k * n for k, n in enumerate(hist)) / total
    big = sum(1 for px in diff.getdata() if max(px) > 24) / total
    return round(mean, 3), round(big * 100, 3)


def animate_spec(spec, out, only=("cover", "closing"), keep=False, accent=None):
    os.makedirs(out, exist_ok=True)
    accent = accent or spec.get("accent")
    roles = {s["role"]: k for k, s in enumerate(spec["slides"], start=1)}
    results = []
    for role in only:
        if role not in roles:
            continue
        i = roles[role]
        proj = build_project(spec, i, accent)
        try:
            lint = subprocess.run(["npx", "-y", HF, "lint", proj, "--json"], capture_output=True, text=True)
            raw = os.path.join(proj, "raw.mp4")
            run(["npx", "-y", HF, "render", proj, "-o", raw, "--fps", str(FPS), "--quality", "delivery", "--quiet"],
                timeout=900)
            dst = os.path.abspath(os.path.join(out, f"{role}.mp4"))
            normalise(raw, dst)
            info = probe(dst)
            still = os.path.join(out, f"slide-{i:02d}.png")
            last = frame_at(dst, DURATION - 0.1, os.path.join(proj, "last.png"))
            mean, big = compare(last, still) if os.path.exists(still) else (None, None)
            for t in (0.6, 1.3):
                frame_at(dst, t, os.path.join(out, f"{role}-t{t}.png") if keep else os.path.join(proj, f"t{t}.png"))
            res = dict(role=role, slide=i, file=os.path.basename(dst), **info,
                       last_frame_vs_still_mean_abs_diff=mean, last_frame_vs_still_pct_pixels_off=big,
                       lint_exit=lint.returncode, lint=(lint.stdout or "")[-600:])
            results.append(res)
            print(f"  {role}: {info['width']}x{info['height']} {info['codec']}/{info['profile']} {info['pix_fmt']} "
                  f"{info['fps']}fps {info['duration']}s audio={info['audio']}@{info['audio_rate']} "
                  f"| last frame vs still: mean diff {mean}, {big}% pixels off")
        finally:
            if keep:
                print("  project kept:", proj)
            else:
                shutil.rmtree(proj, ignore_errors=True)
    with open(os.path.join(out, "animation-checks.json"), "w") as f:
        json.dump(results, f, indent=1)
    return results


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("spec", nargs="?")
    ap.add_argument("--out")
    ap.add_argument("--only", help="cover, closing, or cover,closing")
    ap.add_argument("--accent")
    ap.add_argument("--keep", action="store_true", help="keep the HyperFrames project and mid-animation frames")
    ap.add_argument("--samples", action="store_true")
    a = ap.parse_args()
    only = tuple(a.only.split(",")) if a.only else ("cover", "closing")
    if a.samples:
        for path in sorted(glob.glob(os.path.join(HERE, "samples", "t*.json"))):
            name = os.path.splitext(os.path.basename(path))[0]
            print(name)
            animate_spec(json.load(open(path)), os.path.join(HERE, "samples", name), only, a.keep)
        return
    if not a.spec or not a.out:
        ap.error("spec and --out, or --samples")
    animate_spec(json.load(open(a.spec)), a.out, only, a.keep, a.accent)


if __name__ == "__main__":
    main()
