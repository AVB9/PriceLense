#!/usr/bin/env python3
"""
Packages PriceLens extension bundles (Firefox/Gecko, Chromium, and Universal)
into web/downloads/ for Firebase Hosting distribution.
"""

import json
import os
import zipfile

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOWNLOADS_DIR = os.path.join(ROOT_DIR, "web", "downloads")

EXTENSION_FILES = [
    "icons/icon.svg",
    "icons/icon-48.png",
    "icons/icon-128.png",
    "lib/url-cleaner.js",
    "lib/providers.js",
    "lib/parsers.js",
    "lib/scrapers.js",
    "lib/chart.js",
    "background/background.js",
    "background/service-worker.js",
    "content/content.js",
    "content/content.css",
    "popup/popup.html",
    "popup/popup.css",
    "popup/popup.js",
    "options/options.html",
    "options/options.css",
    "options/options.js",
    "README.md",
]


def build_bundles():
    os.makedirs(DOWNLOADS_DIR, exist_ok=True)

    manifest_path = os.path.join(ROOT_DIR, "manifest.json")
    with open(manifest_path, "r", encoding="utf-8") as f:
        universal_manifest = json.load(f)

    # Derive major.minor tag (e.g. "3.3.0" -> "v3.3") to match web/index.html links
    version_parts = universal_manifest.get("version", "3.3.0").split(".")
    version_tag = f"v{version_parts[0]}.{version_parts[1]}" if len(version_parts) >= 2 else "v3.3"

    def write_zip(filename, manifest_obj):
        out_path = os.path.join(DOWNLOADS_DIR, filename)
        with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("manifest.json", json.dumps(manifest_obj, indent=2))
            for rel_path in EXTENSION_FILES:
                abs_path = os.path.join(ROOT_DIR, rel_path)
                if os.path.exists(abs_path):
                    zf.write(abs_path, rel_path)
        print(f"Created {out_path}")

    # 1. Universal Bundle (Gecko + Chromium)
    write_zip(f"pricelens-universal-{version_tag}.zip", universal_manifest)

    # 2. Firefox / Zen / Gecko Bundle (pure background.scripts)
    gecko_manifest = dict(universal_manifest)
    gecko_manifest["background"] = {
        "scripts": [
            "lib/url-cleaner.js",
            "lib/providers.js",
            "lib/parsers.js",
            "lib/scrapers.js",
            "background/background.js",
        ]
    }
    write_zip(f"pricelens-firefox-{version_tag}.zip", gecko_manifest)

    # 3. Chromium Bundle (Chrome, Brave, Edge, Arc, Opera, Vivaldi)
    chromium_manifest = dict(universal_manifest)
    chromium_manifest.pop("browser_specific_settings", None)
    chromium_manifest["icons"] = {
        "48": "icons/icon-48.png",
        "128": "icons/icon-128.png",
    }
    chromium_manifest["background"] = {
        "service_worker": "background/service-worker.js",
    }
    write_zip(f"pricelens-chromium-{version_tag}.zip", chromium_manifest)


if __name__ == "__main__":
    build_bundles()
