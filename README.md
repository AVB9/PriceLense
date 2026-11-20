# PriceLens

https://pricelenseextension.web.app/

**Version 3.3.0** · **Manifest V3 (Gecko & Chromium)** · **15+ Supported Browsers** · **MIT License**

**PriceLens** is a cross-browser Manifest V3 shopping intelligence extension built with an Apple macOS Sequoia / iOS 18 Pro Dark material interface. It extracts live variant pricing, pulls verified historical price curves and milestones from [Buyhatke](https://buyhatke.com/) silently in the background, saves products into a cross-tab **Compare Memory**, and tracks multi-store spend in a **Universal Budget Cart**.

## Core Capabilities

- **Dedicated Buyhatke Client-Side Engine** — Queries Buyhatke's SvelteKit `Price Stats` semantic icons (`highPrice`, `averagePrice`, `lowPrice`, `greatSalesPrice`), `Deal Score Breakup`, and live `Highcharts 11.4.8` series (`window.Highcharts.charts[0].series[0]` with SVG path reconstruction fallback) directly from the user's browser session. Resolved canonical slugs (`-price-in-india-<pos>-<pid>`) are cached locally for sub-400ms repeat lookups.
- **Two-Phase Zero-Flash Pipeline** — Renders live on-page DOM pricing, MRP, coupons, and Local Price Vault history in under `15ms` (Phase 1), then quietly hydrates historical milestones in the background (Phase 2) without layout shifts or flashing.
- **Multi-Product Compare Memory** — Save up to 5 products across Amazon, Flipkart, Myntra, Croma, Ajio, Tata CLiQ, and Reliance Digital into persistent storage and compare Current Price, All-Time Low, Average, and `% Off MRP` side-by-side.
- **Universal Cross-Store Budget Cart** — Combine items from multiple retailers into a single cart with a configurable `₹` target budget, store-by-store spend splits, and 1-click multi-tab checkout.
- **In-Page Dynamic Island Capsule** — Minimal frosted dark pill injected on supported product pages for live price glanceability and 1-click `+ Compare` / `+ Cart` actions.

## Browser Support

PriceLens ships a universal Manifest V3 architecture (`background.scripts` for Gecko + `background.service_worker` for Chromium, PNG icons, and hybrid 1-argument `browser.*` Promise / `chrome.*` callback wrappers):

| Engine | Supported Browsers | Bundle |
| :--- | :--- | :--- |
| **Gecko MV3** | Firefox, Zen Browser, LibreWolf, Waterfox, Floorp, Mullvad, Firefox Nightly / Iceraven (Android) | `web/downloads/pricelens-firefox-v3.3.zip` |
| **Chromium MV3** | Google Chrome, Brave, Microsoft Edge, Arc, Opera / Opera GX, Vivaldi, Kiwi & Mises (Android) | `web/downloads/pricelens-chromium-v3.3.zip` |

## Quick Installation

### Firefox, Zen Browser, LibreWolf & Waterfox
1. Download and unzip `web/downloads/pricelens-firefox-v3.3.zip` (or use this repository folder directly).
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on...** and select `manifest.json`.
4. *(Optional permanent install on Zen, Developer Edition, Nightly, LibreWolf, or Waterfox)*: Set `xpinstall.signatures.required` to `false` in `about:config`, then install the `.zip` from `about:addons` → Gear Icon → **Install Add-on From File**.

### Chrome, Brave, Edge, Arc, Opera & Vivaldi
1. Download and unzip `web/downloads/pricelens-chromium-v3.3.zip`.
2. Open `chrome://extensions` (or `brave://extensions`, `edge://extensions`, `arc://extensions`).
3. Toggle **Developer mode** ON in the top-right corner.
4. Click **Load unpacked** and select the extracted folder.

## Local Packaging & Firebase Distribution

This repository includes a minimal grainy-gradient Firebase Hosting portal in `web/`, a Python packager in `scripts/package-bundles.py`, and a GitHub Actions deployment workflow in `.github/workflows/deploy-firebase.yml`.

```bash
# 1. Build all three browser ZIP bundles into web/downloads/
python3 scripts/package-bundles.py

# 2. Deploy manually to Firebase Hosting
firebase login
firebase use --add
firebase deploy --only hosting
```

### Automated GitHub Actions CI/CD
Every push to `main` triggers `.github/workflows/deploy-firebase.yml`, which runs `scripts/package-bundles.py` and deploys `web/` to Firebase Hosting live channel.

Required GitHub Repository Secret:
- `FIREBASE_SERVICE_ACCOUNT` — Service account JSON key from **Firebase Console → Project Settings → Service accounts** (or generated via `firebase init hosting:github`).

## Repository Structure

```text
PriceLense/
├── .github/workflows/
│   └── deploy-firebase.yml       # Automated ZIP build + Firebase Hosting deploy on push to main
├── scripts/
│   └── package-bundles.py        # Builds Firefox, Chromium, and Universal MV3 ZIP bundles
├── background/
│   ├── background.js             # Buyhatke tab hydrator, Highcharts bridge & slug cache
│   └── service-worker.js         # Chromium MV3 service worker entry point
├── content/
│   ├── content.js                # Live DOM variant/price extractor & Dynamic Island capsule
│   └── content.css               # Dark glassmorphic capsule styling
├── lib/
│   ├── url-cleaner.js            # Canonical URL normalizer & ASIN/PID parser
│   ├── providers.js              # Storage wrappers, Compare Memory, Budget Cart & Vault
│   ├── parsers.js                # Buyhatke Price Stats, Deal Score & SvelteKit parser
│   ├── scrapers.js               # Buyhatke-first scraper coordinator
│   └── chart.js                  # Interactive SVG price curve & frosted tooltip renderer
├── popup/                        # Extension popup UI (Apple Sequoia Dark)
├── options/                      # Extension preferences & custom provider manager
├── icons/                        # Vector SVG & rasterized 48/128px PNG icons
├── web/                          # Minimal grainy-gradient Firebase Hosting download portal
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   └── downloads/
├── manifest.json                 # Universal MV3 manifest
├── firebase.json                 # Firebase Hosting configuration
├── .firebaserc                   # Firebase project alias
├── .gitignore
├── LICENSE
└── README.md
```

## License

Released under the [MIT License](LICENSE).
