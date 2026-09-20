#!/usr/bin/env python3
"""One-off: vendor the brand marks the carousel is allowed to show, so renders never hit the
network (same contract as fetch_fonts.py).

Source is Simple Icons (CC0), which ships one flat SVG path per brand plus that brand's own
hex. Both matter here: the mark is the attention device and the hex is the only colour a slide
is allowed to borrow.

  python3 engine/render/fetch_logos.py          # writes assets/logos/<slug>.svg + logos.json

Trademark: these marks belong to their owners. They are used here to report news about that
company, which is nominative use. Never put one on a slide in a way that suggests the company
endorses, partners with or is a client of Black Arrow Technologies.
"""
import json
import os
import re
import ssl
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "assets", "logos")
CDN = "https://cdn.jsdelivr.net/npm/simple-icons@16/icons/{}.svg"
META = "https://cdn.jsdelivr.net/npm/simple-icons@16/data/simple-icons.json"

# The companies that actually turn up in the radar feeds, plus the tools a small-business owner
# already has open. Extend this list, rerun, commit the result.
WANTED = """
openai anthropic claude googlegemini google googlechrome meta microsoft nvidia apple
amazonwebservices perplexity huggingface mistralai xai deepseek github githubcopilot cursor
whatsapp gmail googlecalendar googledrive googledocs googlesheets googlemaps instagram facebook
messenger telegram slack discord zoom x linkedin youtube tiktok pinterest reddit
shopify hubspot salesforce zapier make notion airtable trello asana clickup monday
canva figma adobe wordpress wix squarespace webflow framer
stripe paypal square quickbooks xero wise revolut
mailchimp klaviyo brevo intercom zendesk freshdesk twilio calendly
whatsappbusiness ebay etsy amazon uber doordash tripadvisor yelp booking airbnb
"""

# Simple Icons has delisted these at the brand owner's request, and OpenAI and Microsoft are the
# two most likely to come up in AI news. We do not go and find their logo somewhere else: a company
# that asked to be removed from an icon set has said what it wants. Instead the slide sets the
# company NAME as a wordmark in its own colour, which reads as deliberate rather than as a gap.
# Hex values are the brands' published colours, entered by hand because there is no feed for them.
WORDMARK_ONLY = {
    "openai": ("OpenAI", "#10A37F"),
    "chatgpt": ("ChatGPT", "#10A37F"),
    "microsoft": ("Microsoft", "#F25022"),
    "copilot": ("Copilot", "#0078D4"),
    "linkedin": ("LinkedIn", "#0A66C2"),
    "slack": ("Slack", "#4A154B"),
    "salesforce": ("Salesforce", "#00A1E0"),
    "adobe": ("Adobe", "#EC1C24"),
    "canva": ("Canva", "#00C4CC"),
    "amazon": ("Amazon", "#FF9900"),
    "aws": ("AWS", "#FF9900"),
    "twilio": ("Twilio", "#F22F46"),
}

ctx = ssl.create_default_context()


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "bat-content-engine"})
    return urllib.request.urlopen(req, context=ctx, timeout=30).read()


def main():
    os.makedirs(OUT, exist_ok=True)
    slugs = [s for s in WANTED.split() if s]
    print(f"fetching metadata for {len(slugs)} marks")
    meta = json.loads(get(META).decode())
    rows = meta["icons"] if isinstance(meta, dict) else meta
    by_slug = {}
    for r in rows:
        title = r.get("title", "")
        slug = r.get("slug") or re.sub(r"[^a-z0-9]", "", title.lower())
        by_slug[slug] = r

    index, missing = {}, []
    for slug in slugs:
        row = by_slug.get(slug)
        if not row:
            missing.append(slug)
            continue
        path = os.path.join(OUT, slug + ".svg")
        if not os.path.exists(path):
            try:
                svg = get(CDN.format(slug)).decode()
            except Exception as e:  # a renamed or withdrawn mark must not break the build
                missing.append(f"{slug} ({e})")
                continue
            # The CDN file is a bare monochrome path; colour is applied at render time.
            with open(path, "w") as f:
                f.write(svg)
        index[slug] = {"title": row["title"], "hex": "#" + row["hex"].lstrip("#")}

    for slug, (title, hex_) in WORDMARK_ONLY.items():
        index.setdefault(slug, {"title": title, "hex": hex_, "wordmark": True})

    with open(os.path.join(OUT, "logos.json"), "w") as f:
        json.dump(index, f, indent=1, sort_keys=True)
    marks = sum(1 for v in index.values() if not v.get("wordmark"))
    print(f"vendored {marks} marks + {len(index) - marks} wordmarks into {OUT}")
    if missing:
        print("no mark available (wordmark if listed above, else drop):", ", ".join(missing))


if __name__ == "__main__":
    main()
