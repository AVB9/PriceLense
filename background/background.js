/**
 * Background Service Worker / Event Script for Firefox (PriceLens v3.1)
 * Coordinates tab detection, variant-aware caching, parallel Multi-PTP scraping,
 * redirect-tolerant background tab DOM hydration, Local Price Vault,
 * Multi-Product Comparison Memory, and Universal Cross-Platform Budget Cart.
 */

const extAPI = typeof browser !== 'undefined' ? browser : chrome;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 Minutes Cache TTL

// In-memory registry for latest active tab variant updates & in-flight deduplication
const tabVariantState = new Map();
const inFlightScrapes = new Map();

extAPI.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request) return;
  const action = request.action || request.type;

  if (action === 'GET_CURRENT_TAB_INFO') {
    handleGetCurrentTab()
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (action === 'GET_INSTANT_BASELINE') {
    handleGetInstantBaseline(request.url, request.providerId, request.liveData)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (action === 'FETCH_PRICE_INSIGHTS') {
    handleFetchPriceInsights(request.url, request.providerId, request.liveData, request.forceRefresh)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (action === 'OPEN_ACTIVE_PROVIDER_FOR_URL') {
    handleOpenActiveProvider(request.url)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (action === 'LIVE_VARIANT_UPDATED') {
    const details = request.details || request.pageDetails;
    if (sender && sender.tab && sender.tab.id && details) {
      tabVariantState.set(sender.tab.id, details);
    }
    if (details && details.cleanUrl && details.currentPrice > 0 && typeof WorkspaceManager !== 'undefined') {
      WorkspaceManager.recordLocalPriceObservation(details.cleanUrl, details.currentPrice, details.originalPrice || 0).catch(() => {});
    }
    sendResponse({ received: true });
    return false;
  }

  if (action === 'GET_ALL_PROVIDERS') {
    ProviderManager.getAllProviders()
      .then(providers => sendResponse({ providers }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (action === 'OPEN_PROVIDER_TAB') {
    extAPI.tabs.create({ url: request.url });
    sendResponse({ success: true });
    return false;
  }

  // =========================================================
  // WORKSPACE ACTIONS: COMPARE MEMORY & UNIVERSAL BUDGET CART
  // =========================================================
  if (action === 'GET_WORKSPACE_STATE') {
    Promise.all([
      WorkspaceManager.getCompareList(),
      WorkspaceManager.getCartState()
    ]).then(([compareList, cart]) => {
      sendResponse({ compareList, cart });
    }).catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (action === 'TOGGLE_COMPARE_ITEM') {
    WorkspaceManager.toggleCompareItem(request.item)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (action === 'UPSERT_COMPARE_ITEM') {
    WorkspaceManager.upsertCompareItem(request.item)
      .then(list => sendResponse({ list }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (action === 'REMOVE_COMPARE_ITEM') {
    WorkspaceManager.removeFromCompare(request.cleanUrl)
      .then(list => sendResponse({ list }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (action === 'CLEAR_COMPARE') {
    WorkspaceManager.clearCompare()
      .then(list => sendResponse({ list }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (action === 'ADD_TO_CART') {
    WorkspaceManager.addOrUpdateCartItem(request.item, request.quantityDelta || 1)
      .then(cart => sendResponse({ cart }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (action === 'SET_CART_ITEM_QTY') {
    WorkspaceManager.setCartItemQuantity(request.cleanUrl, request.quantity)
      .then(cart => sendResponse({ cart }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (action === 'REMOVE_CART_ITEM') {
    WorkspaceManager.removeCartItem(request.cleanUrl)
      .then(cart => sendResponse({ cart }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (action === 'CLEAR_CART') {
    WorkspaceManager.clearCart()
      .then(cart => sendResponse({ cart }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (action === 'SET_BUDGET_LIMIT') {
    WorkspaceManager.setBudgetLimit(request.budgetLimit)
      .then(cart => sendResponse({ cart }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
});

/**
 * Open target provider URL cleanly without stripping Flipkart or custom query IDs
 */
async function handleOpenActiveProvider(rawUrl) {
  const cleanUrl = URLCleaner.getCanonicalUrl(rawUrl);
  const activeProvider = await ProviderManager.getActiveProvider();
  const targetUrl = ProviderManager.buildTargetUrl(activeProvider, cleanUrl);
  extAPI.tabs.create({ url: targetUrl });
  return { success: true, targetUrl };
}

/**
 * Identify current active tab, clean canonical URL, and pull live on-page price
 * Uses hybrid Promise + Callback wrappers so Firefox MV3 never hangs.
 */
function queryTabsSafe(queryInfo) {
  return new Promise((resolve) => {
    try {
      let settled = false;
      const done = (tabs) => {
        if (!settled) {
          settled = true;
          resolve(Array.isArray(tabs) ? tabs : []);
        }
      };
      setTimeout(() => done([]), 500);

      if (typeof browser !== 'undefined' && browser.tabs && browser.tabs.query) {
        browser.tabs.query(queryInfo).then(done).catch(() => done([]));
      } else if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
        chrome.tabs.query(queryInfo, (tabs) => done(tabs));
      } else {
        done([]);
      }
    } catch (_) {
      resolve([]);
    }
  });
}

function sendTabMessageSafe(tabId, msg, timeoutMs = 450) {
  return new Promise((resolve) => {
    try {
      let settled = false;
      const done = (val) => {
        if (!settled) {
          settled = true;
          resolve(val || null);
        }
      };
      setTimeout(() => done(null), timeoutMs);

      if (typeof browser !== 'undefined' && browser.tabs && browser.tabs.sendMessage) {
        browser.tabs.sendMessage(tabId, msg).then(done).catch(() => done(null));
      } else if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.sendMessage) {
        chrome.tabs.sendMessage(tabId, msg, (response) => {
          if (chrome.runtime && chrome.runtime.lastError) done(null);
          else done(response || null);
        });
      } else {
        done(null);
      }
    } catch (_) {
      resolve(null);
    }
  });
}

function createTabSafe(createProps) {
  return new Promise((resolve) => {
    try {
      let settled = false;
      const done = (tab) => {
        if (!settled) {
          settled = true;
          resolve(tab || null);
        }
      };
      setTimeout(() => done(null), 1500);

      if (typeof browser !== 'undefined' && browser.tabs && browser.tabs.create) {
        browser.tabs.create(createProps).then(done).catch(() => done(null));
      } else if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
        chrome.tabs.create(createProps, (tab) => done(tab));
      } else {
        done(null);
      }
    } catch (_) {
      resolve(null);
    }
  });
}

async function handleGetCurrentTab() {
  const tabs = await queryTabsSafe({ active: true, currentWindow: true });
  if (!tabs || tabs.length === 0) {
    return { url: '', cleanUrl: '', title: '', isShoppingSite: false, liveData: null };
  }

  const activeTab = tabs[0];
  const rawUrl = activeTab.url || '';
  const cleanUrl = URLCleaner.getCanonicalUrl(rawUrl);
  const store = URLCleaner.detectStore(rawUrl);

  const isShoppingSite = [
    'amazon', 'flipkart', 'myntra', 'croma', 'tatacliq',
    'ajio', 'reliancedigital', 'nykaa', 'snapdeal', 'meesho', 'jiomart'
  ].some(s => rawUrl.toLowerCase().includes(s));

  let liveData = tabVariantState.get(activeTab.id) || null;
  if (isShoppingSite && activeTab.id) {
    const queried = await sendTabMessageSafe(
      activeTab.id,
      { action: 'GET_LIVE_ON_PAGE_DETAILS', type: 'GET_LIVE_ON_PAGE_DETAILS' },
      450
    );
    if (queried) {
      liveData = queried;
      tabVariantState.set(activeTab.id, queried);
      if (queried.cleanUrl && queried.currentPrice > 0 && typeof WorkspaceManager !== 'undefined') {
        WorkspaceManager.recordLocalPriceObservation(queried.cleanUrl, queried.currentPrice, queried.originalPrice || 0).catch(() => {});
      }
    }
  }

  const activeCleanUrl = (liveData && liveData.cleanUrl) || cleanUrl;

  return {
    tabId: activeTab.id,
    rawUrl,
    cleanUrl: activeCleanUrl,
    title: (liveData && liveData.title) || activeTab.title || 'Product Page',
    store,
    isShoppingSite,
    liveData
  };
}

/**
 * Phase 1: Instant Zero-Latency Baseline (<15ms)
 * Returns cached verified tracker data if available, OR immediate Live DOM + MRP + Local Vault baseline
 * so the popup renders immediately with zero flashing or layout shift.
 */
async function handleGetInstantBaseline(rawProductUrl, providerId = null, tabLiveData = null) {
  const cleanUrl = URLCleaner.getCanonicalUrl(rawProductUrl, tabLiveData?.variantId);
  const providers = await ProviderManager.getAllProviders();
  const provider = (providerId && providers.find(p => p.id === providerId)) || await ProviderManager.getActiveProvider();
  const variantId = (tabLiveData && tabLiveData.variantId) || '';
  const livePrice = (tabLiveData && Number(tabLiveData.currentPrice) > 0) ? Number(tabLiveData.currentPrice) : 0;
  const originalPrice = (tabLiveData && Number(tabLiveData.originalPrice) > 0) ? Number(tabLiveData.originalPrice) : 0;

  const cacheKey = `cache_v32_${provider.id}_${cleanUrl}_${variantId}`;

  try {
    const cachedMap = await storageGet([cacheKey]);
    const cachedEntry = cachedMap ? cachedMap[cacheKey] : null;

    if (cachedEntry && cachedEntry.timestamp && (Date.now() - cachedEntry.timestamp < CACHE_TTL_MS)) {
      const cachedResult = cachedEntry.data;
      if (livePrice > 0 && cachedResult.insights) {
        cachedResult.insights.currentPrice = livePrice;
      }
      return { ...cachedResult, isFromCache: true, needsBackgroundSync: false };
    }
  } catch (e) {}

  let localVaultPoints = [];
  if (typeof WorkspaceManager !== 'undefined') {
    if (livePrice > 0) {
      localVaultPoints = await WorkspaceManager.recordLocalPriceObservation(cleanUrl, livePrice, originalPrice);
    } else {
      localVaultPoints = await WorkspaceManager.getLocalPriceObservations(cleanUrl);
    }
  }

  const targetLookupUrl = ProviderManager.buildTargetUrl(provider, cleanUrl);
  const storeInfo = URLCleaner.detectStore(cleanUrl);

  const baselineInsights = Parsers.mergeMultiSourceInsights({
    providerResults: [],
    crossStoreOptions: [],
    liveData: tabLiveData,
    localVaultPoints,
    primaryProviderName: provider.shortName || provider.name,
    targetLookupUrl
  });

  return {
    success: true,
    provider: provider.shortName || provider.name,
    providerId: provider.id,
    targetLookupUrl,
    cleanUrl,
    storeInfo,
    isEstimatedHistory: true,
    needsBackgroundSync: true,
    insights: baselineInsights
  };
}

/**
 * Optional MAIN-world probe to extract raw Highcharts 11.4.8 series data directly from window.Highcharts
 * and attach it to document.documentElement.dataset.pricelensHc for the isolated snapshot extractor.
 */
function injectedMainWorldHighchartsBridge() {
  try {
    if (window.Highcharts && Array.isArray(window.Highcharts.charts)) {
      for (const chart of window.Highcharts.charts) {
        if (!chart || !Array.isArray(chart.series) || chart.series.length === 0) continue;
        const s = chart.series[0];
        const pts = [];
        if (Array.isArray(s.xData) && Array.isArray(s.yData) && s.xData.length > 1) {
          const len = s.xData.length;
          const step = Math.max(1, Math.floor(len / 45));
          for (let i = 0; i < len; i += step) {
            if (s.yData[i] > 0) pts.push([s.xData[i], s.yData[i]]);
          }
          if (s.yData[len - 1] > 0) pts.push([s.xData[len - 1], s.yData[len - 1]]);
        } else if (Array.isArray(s.data) && s.data.length > 1) {
          const len = s.data.length;
          const step = Math.max(1, Math.floor(len / 45));
          for (let i = 0; i < len; i += step) {
            const d = s.data[i];
            if (d && d.y > 0) pts.push([d.x, d.y]);
          }
          const last = s.data[len - 1];
          if (last && last.y > 0) pts.push([last.x, last.y]);
        }
        if (pts.length > 1) {
          document.documentElement.setAttribute('data-pricelens-hc', JSON.stringify(pts));
          break;
        }
      }
    }
  } catch (_) {}
}

/**
 * Synchronous, single-frame DOM snapshot extractor injected on each poll tick from background.js.
 * - Built specifically around Buyhatke's 2026 SvelteKit codebase:
 *   1. Semantic icon alt selectors: img[alt="highPrice" | "averagePrice" | "lowPrice" | "greatSalesPrice"]
 *   2. Both "Price Stats" ("Should you buy now?") and "Deal Score Breakup" layouts
 *   3. Highcharts 11.4.8 live memory bridge + SVG path.highcharts-graph coordinate reconstruction
 *   4. Cross-store comparison cards ("Flipkart ₹157 15% Cheaper" & "Compare X Available Prices")
 *   5. Strict LookAlike / "Deals in this category" footer slicing
 */
function injectedSingleFrameSnapshot() {
  function parsePrice(text) {
    if (typeof text === 'number') return isFinite(text) ? text : 0;
    if (!text || typeof text !== 'string') return 0;
    const str = text.trim();
    const kMatch = str.match(/^(?:₹|Rs\.?|INR|\$)?\s*([\d,]+(?:\.\d+)?)\s*([kKlL])\b/);
    if (kMatch) {
      const base = parseFloat(kMatch[1].replace(/,/g, ''));
      const mult = kMatch[2].toLowerCase() === 'l' ? 100000 : 1000;
      return isNaN(base) ? 0 : Math.round(base * mult);
    }
    const clean = str.replace(/[^0-9.]/g, '');
    const num = parseFloat(clean);
    return isNaN(num) ? 0 : num;
  }

  const body = document.body;
  if (!body) return { isHydrated: false };

  const currentUrl = window.location.href;
  const fullText = body.innerText || '';

  // Trigger scroll so lazy IntersectionObserver components (Highcharts & Price Stats / Deal Score) mount
  try {
    window.scrollTo(0, 480);
    window.scrollTo(0, 920);
  } catch (_) {}

  window.__plPollTicks = (window.__plPollTicks || 0) + 1;

  const hasPriceStatsIcons = !!(
    document.querySelector('img[alt="lowPrice"]') ||
    document.querySelector('img[alt="highPrice"]') ||
    document.querySelector('img[alt="averagePrice"]')
  );

  // Guard: If still on unredirected lookup path (/http...) without product milestones, wait for SvelteKit redirect
  const isUnredirectedShell = currentUrl.includes('/http') &&
    !hasPriceStatsIcons &&
    !/Price\s+Stats/i.test(fullText) &&
    !/Should\s+you\s+buy\s+now/i.test(fullText) &&
    !/Deal\s+Score/i.test(fullText) &&
    !/All[\s-]*time\s+low/i.test(fullText) &&
    !/Lowest\s+Price/i.test(fullText) &&
    !/6\s*months?\s+low/i.test(fullText);

  if (isUnredirectedShell) {
    window.__plPollTicks = 0;
    return { isHydrated: false, waitingForRedirect: true, currentUrl };
  }

  // Strictly slice out LookAlike & footer sections so unrelated product prices never pollute extraction
  const bodyText = fullText.split(/Set\s+price\s+drop\s+alert\s+to\s+buy\s+later|LookAlike|Found\s+\d+\+?\s+similar\s+looking\s+products|Deals\s+in\s+this\s+category/i)[0] || '';

  let currentPrice = 0;
  let lowestPrice = 0;
  let sixMonthLow = 0;
  let highestPrice = 0;
  let lastSalePrice = 0;
  let averagePrice = 0;
  let dealScore = 0;
  let saleHikeWarning = false;
  let historyPoints = [];
  const cheaperOptions = [];

  // 1. Extract from Buyhatke's "Price Stats" semantic icon alt attributes (img[alt="highPrice" | "averagePrice" | "lowPrice" | "greatSalesPrice"])
  function extractByImgAlt(altValue) {
    const img = document.querySelector(`img[alt="${altValue}"]`);
    if (!img) return 0;
    let el = img.parentElement;
    for (let depth = 0; depth < 3 && el; depth++) {
      const txt = el.innerText || el.textContent || '';
      const m = txt.match(/(?:₹|Rs\.?)\s*([\d,]+(?:\.\d+)?)/);
      if (m && m[1]) {
        const p = parsePrice(m[1]);
        if (p > 0) return Math.round(p);
      }
      el = el.parentElement;
    }
    return 0;
  }

  const iconHigh = extractByImgAlt('highPrice');
  const iconAvg = extractByImgAlt('averagePrice');
  const iconLow = extractByImgAlt('lowPrice');
  const iconSale = extractByImgAlt('greatSalesPrice');

  if (iconHigh > 0) highestPrice = iconHigh;
  if (iconAvg > 0) averagePrice = iconAvg;
  if (iconLow > 0) lowestPrice = iconLow;
  if (iconSale > 0) {
    sixMonthLow = iconSale;
    if (!lowestPrice || iconSale < lowestPrice) lowestPrice = iconSale;
  }

  // 2. Text Milestone Patterns (covers both "Price Stats" layout and "Deal Score Breakup" layout)
  const highStatMatch = bodyText.match(/Highest\s+Price(?:\s+highPrice)?\s*[:\s]*(?:₹|Rs\.?)\s*([\d,]+(?:\.\d+)?)/i) ||
                        bodyText.match(/(?:Highest|All[\s-]Time\s+High|Max(?:imum)?)\s*(?:Price)?\s*[:\s]*[₹Rs.]+\s*([\d,]+(?:\.\d+)?)/i);
  if (highStatMatch && highStatMatch[1]) {
    highestPrice = Math.max(highestPrice, Math.round(parsePrice(highStatMatch[1])));
  }

  const avgStatMatch = bodyText.match(/Average\s+Price(?:\s+averagePrice)?\s*[:\s]*(?:₹|Rs\.?)\s*([\d,]+(?:\.\d+)?)/i) ||
                       bodyText.match(/average\s*(?:price|productPrice)?\s*\(\s*(?:₹|Rs\.?|INR|\$)?\s*([\d,]+(?:\.\d+)?)\s*\)/i) ||
                       bodyText.match(/(?:Average|Typical|Avg)\s*(?:Price)?\s*[:\s]*[₹Rs.]+\s*([\d,]+(?:\.\d+)?)/i);
  if (avgStatMatch && avgStatMatch[1]) {
    averagePrice = Math.round(parsePrice(avgStatMatch[1]));
  }

  const lowStatMatch = bodyText.match(/Lowest\s+Price(?:\s+lowPrice)?\s*[:\s]*(?:₹|Rs\.?)\s*([\d,]+(?:\.\d+)?)/i) ||
                       bodyText.match(/All[\s-]*time\s+low\s*(?:price|productPrice)?\s*\(\s*(?:₹|Rs\.?|INR|\$)?\s*([\d,]+(?:\.\d+)?)\s*\)/i) ||
                       bodyText.match(/(?:Lowest|All[\s-]Time\s+Low)\s*(?:Price)?\s*[:\s]*[₹Rs.]+\s*([\d,]+(?:\.\d+)?)/i);
  if (lowStatMatch && lowStatMatch[1]) {
    lowestPrice = Math.round(parsePrice(lowStatMatch[1]));
  }

  const sixMoMatch = bodyText.match(/6\s*months?\s+low\s*(?:price|productPrice)?\s*\(\s*(?:₹|Rs\.?|INR|\$)?\s*([\d,]+(?:\.\d+)?)\s*\)/i) ||
                     bodyText.match(/(?:GIF|BBD|Prime\s+Day|Great\s+Indian\s+Festival)\s*\d*\s*Price[\s\S]{0,90}?(?:₹|Rs\.?)\s*([\d,]+(?:\.\d+)?)/i);
  if (sixMoMatch && sixMoMatch[1]) {
    sixMonthLow = Math.round(parsePrice(sixMoMatch[1]));
    if (!lowestPrice && sixMonthLow > 0) lowestPrice = sixMonthLow;
  }

  const lastSaleMatch = bodyText.match(/Last\s+sale\s*(?:price|productPrice)?\s*\(\s*(?:₹|Rs\.?|INR|\$)?\s*([\d,]+(?:\.\d+)?)\s*\)/i);
  if (lastSaleMatch && lastSaleMatch[1]) {
    lastSalePrice = Math.round(parsePrice(lastSaleMatch[1]));
    if (!highestPrice) highestPrice = lastSalePrice;
  }

  const scoreMatch = bodyText.match(/Deal\s+Score\s+(\d{1,3})/i);
  if (scoreMatch && scoreMatch[1]) {
    dealScore = parseInt(scoreMatch[1], 10);
  } else if (/Go\s+Ahead\s*&\s*Buy\s+now|Optimal\s+price\s+point|Lowest\s+Price\s+Ever|Lowest\s+Since\s+Launch/i.test(bodyText)) {
    dealScore = 90;
  } else if (/Better\s+Than\s+Last\s+Sale/i.test(bodyText)) {
    dealScore = 78;
  } else if (/More\s+Than\s+Average\s+Price|Wait\s+for\s+price\s+drop/i.test(bodyText)) {
    dealScore = 38;
  }

  if ((/Price\s+hiked\s+before\s+sale/i.test(bodyText) && !/No\s+Price\s+hike\s+before\s+sale/i.test(bodyText)) || /Seller\s+Price\s+Pump\s+detected/i.test(bodyText)) {
    saleHikeWarning = true;
  }

  // Hero Current Price before "Should you buy now?" / "Price Stats" / "Deal Scanner"
  const heroSplit = bodyText.split(/Should\s+you\s+buy\s+now|Price\s+Stats|Deal\s+Scanner|Deal\s+Score\s+Breakup/i)[0] || '';
  const heroPriceMatch = heroSplit.match(/₹\s*([\d,]+(?:\.\d+)?)\s*(?:Share\s+on|Buy\s+on|Compare\s+\d+\s+Available)/i) ||
                         heroSplit.match(/₹\s*([\d,]+(?:\.\d+)?)/) ||
                         bodyText.match(/(?:Current|Latest|Now|Price\s*Now)\s*(?:Price)?\s*\*?\s*[:\s]*[₹Rs.]+\s*([\d,]+(?:\.\d+)?)/i);
  if (heroPriceMatch && heroPriceMatch[1]) {
    currentPrice = Math.round(parsePrice(heroPriceMatch[1]));
  }

  // 3A. Check Highcharts 11.4.8 live memory bridge (from window.wrappedJSObject.Highcharts or data-pricelens-hc)
  try {
    const hcWin = (typeof window.wrappedJSObject !== 'undefined' && window.wrappedJSObject.Highcharts)
      ? window.wrappedJSObject.Highcharts
      : window.Highcharts;
    if (hcWin && Array.isArray(hcWin.charts)) {
      for (const chart of hcWin.charts) {
        if (!chart || !Array.isArray(chart.series) || chart.series.length === 0) continue;
        const s = chart.series[0];
        if (Array.isArray(s.xData) && Array.isArray(s.yData) && s.xData.length > 1) {
          const len = s.xData.length;
          const step = Math.max(1, Math.floor(len / 36));
          for (let i = 0; i < len; i += step) {
            const ts = Number(s.xData[i]) > 1e11 ? Number(s.xData[i]) : Number(s.xData[i]) * 1000;
            const pr = Math.round(Number(s.yData[i]));
            if (pr > 0 && ts > 1262304000000) {
              const dt = new Date(ts);
              historyPoints.push({
                date: dt.toISOString().slice(0, 10),
                formattedDate: dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                price: pr
              });
            }
          }
          break;
        }
      }
    }

    if (historyPoints.length === 0) {
      const hcAttr = document.documentElement.getAttribute('data-pricelens-hc');
      if (hcAttr) {
        const rawPairs = JSON.parse(hcAttr);
        if (Array.isArray(rawPairs) && rawPairs.length > 1) {
          historyPoints = rawPairs.map(pair => {
            const ts = Number(pair[0]) > 1e11 ? Number(pair[0]) : Number(pair[0]) * 1000;
            const d = new Date(ts > 1262304000000 ? ts : Date.now());
            return {
              date: d.toISOString().slice(0, 10),
              formattedDate: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
              price: Math.round(Number(pair[1]))
            };
          }).filter(p => p.price > 0);
        }
      }
    }
  } catch (_) {}

  // 3B. Reconstruct Real Price Curve from Rendered Highcharts SVG (`<svg class="highcharts-root">`)
  if (historyPoints.length === 0) {
    try {
      const svgRoot = document.querySelector('svg.highcharts-root');
      if (svgRoot) {
        const graphPath = svgRoot.querySelector('path.highcharts-graph');
        if (graphPath) {
          const dAttr = graphPath.getAttribute('d') || '';
          const vertices = [];
          const cmdRegex = /[ML]\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/gi;
          let cm;
          while ((cm = cmdRegex.exec(dAttr)) !== null) {
            vertices.push({ x: parseFloat(cm[1]), y: parseFloat(cm[2]) });
          }

          if (vertices.length >= 2) {
            const yLabelEls = svgRoot.querySelectorAll('.highcharts-yaxis-labels text');
            const axisPrices = [];
            yLabelEls.forEach(el => {
              const p = parsePrice(el.textContent || '');
              if (p > 0) axisPrices.push(p);
            });

            const ys = vertices.map(v => v.y);
            const minY = Math.min(...ys);
            const maxY = Math.max(...ys);
            const lastY = vertices[vertices.length - 1].y;

            const chartFloorPrice = lowestPrice > 0
              ? lowestPrice
              : (axisPrices.length > 0 ? Math.min(...axisPrices) : currentPrice);

            let chartPeakPrice = highestPrice > chartFloorPrice ? highestPrice : 0;
            if (!chartPeakPrice && currentPrice > chartFloorPrice && maxY > lastY && (maxY - minY) > 2) {
              const ratio = (maxY - minY) / Math.max(1, maxY - lastY);
              chartPeakPrice = Math.round(chartFloorPrice + (currentPrice - chartFloorPrice) * Math.min(4, ratio));
            }
            if (!chartPeakPrice && axisPrices.length > 0) {
              chartPeakPrice = Math.max(...axisPrices);
            }
            if (!chartPeakPrice || chartPeakPrice < chartFloorPrice) {
              chartPeakPrice = Math.max(currentPrice, chartFloorPrice);
            }

            if (chartPeakPrice > highestPrice) highestPrice = chartPeakPrice;

            const step = Math.max(1, Math.floor(vertices.length / 24));
            const sampled = [];
            for (let i = 0; i < vertices.length; i += step) {
              sampled.push(vertices[i]);
            }
            if (sampled[sampled.length - 1] !== vertices[vertices.length - 1]) {
              sampled.push(vertices[vertices.length - 1]);
            }

            const now = Date.now();
            const spanDays = 90;
            const ySpan = Math.max(1, maxY - minY);

            historyPoints = sampled.map((v, idx) => {
              const fracFromBottom = (maxY - minY) < 1.5 ? 0 : (maxY - v.y) / ySpan;
              const interpPrice = Math.round(chartFloorPrice + fracFromBottom * (chartPeakPrice - chartFloorPrice));
              const daysAgo = Math.round(((sampled.length - 1 - idx) / Math.max(1, sampled.length - 1)) * spanDays);
              const dt = new Date(now - daysAgo * 86400000);
              return {
                date: dt.toISOString().slice(0, 10),
                formattedDate: dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                price: idx === sampled.length - 1 && currentPrice > 0 ? currentPrice : interpPrice
              };
            });
          }
        }
      }
    } catch (_) {}
  }

  // 4. Cross-Store Comparison Block (supports both "Flipkart ₹157 15% Cheaper" rows and "Compare X Available Prices")
  const heroAndCompare = bodyText.split(/Should\s+you\s+buy\s+now|Price\s+Stats|Deal\s+Scanner|Price\s+History/i)[0] || bodyText;
  const storeRegex = /\b(Amazon|Flipkart|Myntra|Ajio|Croma|Tata\s*CLiQ|Reliance\s*Digital|Nykaa|Meesho|JioMart|BookScrap|Vijay\s*Sales)\b[\s\S]{1,45}?₹\s*([\d,]+(?:\.\d+)?)(?:\s+(\d+)%\s*(Cheaper|Higher))?/gi;
  const seen = new Set();
  let sm;
  while ((sm = storeRegex.exec(heroAndCompare)) !== null) {
    const stName = sm[1].trim();
    const stPrice = Math.round(parsePrice(sm[2]));
    const k = `${stName.toLowerCase()}_${stPrice}`;
    if (stPrice > 0 && !seen.has(k)) {
      seen.add(k);
      cheaperOptions.push({
        store: stName,
        price: stPrice,
        link: currentUrl,
        currency: '₹'
      });
    }
  }

  const h1 = document.querySelector('h1');
  const title = (h1 && !/find best price|advance price tracker/i.test(h1.textContent))
    ? h1.textContent.trim()
    : document.title.replace(/^Price History of\s+/i, '').replace(/\s*-\s*Buyhatke.*$/i, '').trim();

  const hasMilestones = (lowestPrice > 0) || (averagePrice > 0) || (highestPrice > 0) || (dealScore > 0);
  const hasChart = historyPoints.length >= 2;
  const isHydrated = (hasMilestones && hasChart) ||
                     (hasMilestones && window.__plPollTicks >= 2) ||
                     (hasChart && window.__plPollTicks >= 2);

  return {
    isHydrated,
    resolvedUrl: currentUrl,
    title,
    currentPrice: currentPrice || (cheaperOptions[0]?.price || 0),
    lowestPrice,
    sixMonthLow,
    highestPrice,
    lastSalePrice,
    averagePrice,
    dealScore,
    saleHikeWarning,
    historyPoints,
    cheaperOptions
  };
}

/**
 * Redirect-Tolerant Background Tab Hydrator for Buyhatke
 * Spawns an inactive background tab and polls every 450ms from background.js
 * so client-side SvelteKit redirects never abort the poller.
 */
async function runHeadlessTabScraper(targetLookupUrl, providerId, maxTimeoutMs = 7500) {
  return new Promise((resolve) => {
    let tabId = null;
    let finished = false;
    let pollTimer = null;
    let bestPartialSnap = null;

    function buildReturnFromSnap(snap) {
      if (!snap) return null;
      const currentPrice = snap.currentPrice || 0;
      const lowestPrice = snap.lowestPrice || 0;
      const highestPrice = Math.max(snap.highestPrice || 0, currentPrice);
      const averagePrice = snap.averagePrice || 0;
      const dealScore = snap.dealScore || 0;
      const historyPoints = snap.historyPoints || [];

      if (!currentPrice && !lowestPrice && !highestPrice && historyPoints.length === 0) return null;

      return {
        provider: providerId === 'buyhatke' ? 'Buyhatke' : providerId,
        providerId,
        providerUrl: snap.resolvedUrl || targetLookupUrl,
        title: snap.title || '',
        currentPrice,
        lowestPrice: lowestPrice || currentPrice,
        sixMonthLow: snap.sixMonthLow || lowestPrice || currentPrice,
        highestPrice,
        lastSalePrice: snap.lastSalePrice || 0,
        averagePrice: averagePrice || Math.round(((lowestPrice || currentPrice) + highestPrice) / 2),
        providerDealScore: dealScore,
        saleHikeWarning: !!snap.saleHikeWarning,
        historyPoints,
        cheaperOptions: snap.cheaperOptions || [],
        isEstimatedHistory: historyPoints.length < 2,
        hasVerifiedMilestones: !!(lowestPrice > 0 || averagePrice > 0 || highestPrice > 0 || dealScore > 0 || historyPoints.length >= 2),
        rawFound: true,
        isHydratedFromTab: true
      };
    }

    function finish(res) {
      if (finished) return;
      finished = true;
      if (pollTimer) clearInterval(pollTimer);
      if (tabId) {
        try {
          if (typeof browser !== 'undefined' && browser.tabs && browser.tabs.remove) {
            browser.tabs.remove(tabId).catch(() => {});
          } else if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.remove) {
            chrome.tabs.remove(tabId, () => {});
          }
        } catch (_) {}
        tabId = null;
      }
      resolve(res || buildReturnFromSnap(bestPartialSnap));
    }

    const masterTimeout = setTimeout(() => {
      finish(null);
    }, maxTimeoutMs);

    createTabSafe({ url: targetLookupUrl, active: false }).then((createdTab) => {
      if (!createdTab || !createdTab.id) {
        clearTimeout(masterTimeout);
        return finish(null);
      }
      tabId = createdTab.id;

      async function pollOnce() {
        if (finished || !tabId) return;
        try {
          let snap = null;
          if (extAPI.scripting && extAPI.scripting.executeScript) {
            try {
              await extAPI.scripting.executeScript({
                target: { tabId },
                world: 'MAIN',
                func: injectedMainWorldHighchartsBridge
              });
            } catch (_) {}

            const results = await extAPI.scripting.executeScript({
              target: { tabId },
              func: injectedSingleFrameSnapshot
            });
            if (results && results[0] && results[0].result) {
              snap = results[0].result;
            }
          } else if (extAPI.tabs && extAPI.tabs.executeScript) {
            const code = `(${injectedSingleFrameSnapshot.toString()})()`;
            const results = await new Promise((r) => {
              extAPI.tabs.executeScript(tabId, { code }, (res) => r(res));
            });
            if (results && results[0]) {
              snap = results[0];
            }
          }

          if (snap) {
            if (snap.lowestPrice > 0 || snap.averagePrice > 0 || snap.highestPrice > 0 || (snap.historyPoints && snap.historyPoints.length > 0)) {
              bestPartialSnap = snap;
            }
            if (snap.isHydrated) {
              clearTimeout(masterTimeout);
              finish(buildReturnFromSnap(snap));
            }
          }
        } catch (_) {
          // Tab is mid-redirect; ignore and wait for next poll tick
        }
      }

      pollTimer = setInterval(pollOnce, 450);
    });
  });
}

/**
 * Fetch insights with Variant-Aware Caching, Multi-PTP Consensus Engine & Local Price Vault
 */
async function handleFetchPriceInsights(rawProductUrl, providerId = null, tabLiveData = null, forceRefresh = false) {
  const cleanUrl = URLCleaner.getCanonicalUrl(rawProductUrl, tabLiveData?.variantId);
  const providers = await ProviderManager.getAllProviders();
  let provider = null;

  if (providerId) {
    provider = providers.find(p => p.id === providerId);
  }
  if (!provider) {
    provider = await ProviderManager.getActiveProvider();
  }

  const livePrice = (tabLiveData && Number(tabLiveData.currentPrice) > 0) ? Number(tabLiveData.currentPrice) : 0;
  const originalPrice = (tabLiveData && Number(tabLiveData.originalPrice) > 0) ? Number(tabLiveData.originalPrice) : 0;
  const variantId = (tabLiveData && tabLiveData.variantId) || '';

  let localVaultPoints = [];
  if (typeof WorkspaceManager !== 'undefined') {
    if (livePrice > 0) {
      localVaultPoints = await WorkspaceManager.recordLocalPriceObservation(cleanUrl, livePrice, originalPrice);
    } else {
      localVaultPoints = await WorkspaceManager.getLocalPriceObservations(cleanUrl);
    }
  }

  const cacheKey = `cache_v32_${provider.id}_${cleanUrl}_${variantId}`;

  if (!forceRefresh) {
    try {
      const cachedMap = await storageGet([cacheKey]);
      const cachedEntry = cachedMap ? cachedMap[cacheKey] : null;

      if (cachedEntry && cachedEntry.timestamp && (Date.now() - cachedEntry.timestamp < CACHE_TTL_MS)) {
        const cachedResult = cachedEntry.data;
        if (livePrice > 0 && cachedResult.insights) {
          cachedResult.insights.currentPrice = livePrice;
        }
        return { ...cachedResult, isFromCache: true };
      }
    } catch (e) {}
  }

  const targetLookupUrl = ProviderManager.buildTargetUrl(provider, cleanUrl);
  const storeInfo = URLCleaner.detectStore(cleanUrl);
  const amazonInfo = URLCleaner.getAmazonDetails(cleanUrl, variantId);

  const keepaChartUrl = amazonInfo
    ? `https://graph.keepa.com/pricehistory.png?asin=${amazonInfo.asin}&domain=${amazonInfo.domain}`
    : null;

  let mergedInsights = null;

  // 2. Buyhatke-First Client-Side Scraper Pipeline:
  //    a) If we already cached the resolved Buyhatke canonical SSR slug (-price-in-india-<pos>-<pid>), fetch it directly (<400ms).
  //    b) Otherwise, skip slow unredirected shell fetches and launch the user-side Background Tab Hydrator immediately.
  if (provider.id === 'buyhatke') {
    let cachedSlugUrl = null;
    try {
      const slugMapWrap = await storageGet(['buyhatke_slug_map_v1']);
      const slugMap = (slugMapWrap && slugMapWrap.buyhatke_slug_map_v1) || {};
      if (slugMap[cleanUrl] && slugMap[cleanUrl].includes('price-in-india')) {
        cachedSlugUrl = slugMap[cleanUrl];
      }
    } catch (_) {}

    if (cachedSlugUrl && typeof MultiPtpScrapers !== 'undefined') {
      try {
        const [pageRes, dataJsonRes] = await Promise.allSettled([
          MultiPtpScrapers.fetchWithTimeout(cachedSlugUrl, {}, 3000),
          MultiPtpScrapers.fetchWithTimeout(`${cachedSlugUrl.replace(/\/$/, '')}/__data.json`, {}, 2500)
        ]);
        let slugHtml = '';
        let svelteJson = null;
        if (pageRes.status === 'fulfilled' && pageRes.value && pageRes.value.ok) {
          slugHtml = await pageRes.value.text();
        }
        if (dataJsonRes.status === 'fulfilled' && dataJsonRes.value && dataJsonRes.value.ok) {
          try { svelteJson = await dataJsonRes.value.json(); } catch (_) {}
        }
        if (slugHtml || svelteJson) {
          const parsed = Parsers.parseBuyhatke(slugHtml, cachedSlugUrl, svelteJson);
          if (parsed && parsed.rawFound && parsed.hasVerifiedMilestones) {
            mergedInsights = Parsers.mergeMultiSourceInsights({
              providerResults: [parsed],
              crossStoreOptions: parsed.cheaperOptions || [],
              liveData: tabLiveData,
              localVaultPoints,
              primaryProviderName: 'Buyhatke',
              targetLookupUrl: cachedSlugUrl
            });
          }
        }
      } catch (_) {}
    }

    if (!mergedInsights || !mergedInsights.hasExternalMilestones) {
      try {
        const botResult = await runHeadlessTabScraper(cachedSlugUrl || targetLookupUrl, provider.id, 7500);
        if (botResult && botResult.rawFound) {
          if (botResult.providerUrl && botResult.providerUrl.includes('price-in-india')) {
            try {
              const slugMapWrap = await storageGet(['buyhatke_slug_map_v1']);
              const slugMap = { ...((slugMapWrap && slugMapWrap.buyhatke_slug_map_v1) || {}) };
              slugMap[cleanUrl] = botResult.providerUrl;
              await storageSet({ buyhatke_slug_map_v1: slugMap });
            } catch (_) {}
          }
          mergedInsights = Parsers.mergeMultiSourceInsights({
            providerResults: [botResult],
            crossStoreOptions: botResult.cheaperOptions || [],
            liveData: tabLiveData,
            localVaultPoints,
            primaryProviderName: 'Buyhatke',
            targetLookupUrl: botResult.providerUrl || targetLookupUrl
          });
        }
      } catch (botErr) {
        console.warn('Buyhatke background tab hydrator skipped:', botErr);
      }
    }
  } else {
    // Non-Buyhatke provider explicitly selected in dropdown
    try {
      if (typeof MultiPtpScrapers !== 'undefined') {
        mergedInsights = await MultiPtpScrapers.scrapeAllParallel(
          cleanUrl,
          provider.id,
          tabLiveData,
          localVaultPoints
        );
      }
    } catch (scrapeErr) {
      console.warn('Static PTP scrapers error:', scrapeErr);
    }
  }

  // 4. Ensure fallback consensus object if page was offline or non-shopping
  if (!mergedInsights) {
    mergedInsights = Parsers.mergeMultiSourceInsights({
      providerResults: [],
      crossStoreOptions: [],
      liveData: tabLiveData,
      localVaultPoints,
      primaryProviderName: provider.shortName || provider.name,
      targetLookupUrl
    });
  }

  // 5. Auto-enrich Compare Memory if this product is already saved in Compare Memory
  try {
    if (typeof WorkspaceManager !== 'undefined') {
      const compareList = await WorkspaceManager.getCompareList();
      if (compareList.some(item => item.cleanUrl === cleanUrl)) {
        const bestAlt = (mergedInsights.cheaperOptions || [])[0] || null;
        await WorkspaceManager.upsertCompareItem({
          cleanUrl,
          url: rawProductUrl,
          title: mergedInsights.title,
          store: storeInfo.name,
          storeBadge: storeInfo.badge,
          variantLabel: tabLiveData?.variantLabel || '',
          currentPrice: mergedInsights.currentPrice,
          originalPrice: originalPrice || mergedInsights.highestPrice,
          lowestPrice: mergedInsights.lowestPrice,
          highestPrice: mergedInsights.highestPrice,
          averagePrice: mergedInsights.averagePrice,
          dealBadge: mergedInsights.dealRating?.badge || 'Tracked',
          dealType: mergedInsights.dealRating?.type || 'neutral',
          dealScore: mergedInsights.dealRating?.score || 0,
          rating: tabLiveData?.rating || '',
          imageUrl: tabLiveData?.imageUrl || '',
          bestAltStore: bestAlt ? bestAlt.store : '',
          bestAltPrice: bestAlt ? bestAlt.price : 0,
          bestAltUrl: bestAlt ? bestAlt.link : ''
        });
      }
    }
  } catch (_) {}

  const result = {
    success: true,
    provider: provider.shortName || provider.name,
    providerId: provider.id,
    targetLookupUrl: mergedInsights.providerUrl || targetLookupUrl,
    cleanUrl,
    storeInfo,
    keepaChartUrl,
    isEstimatedHistory: !!mergedInsights.isEstimatedHistory,
    insights: mergedInsights
  };

  // ONLY cache in storage if external tracker milestones were genuinely verified
  if (mergedInsights.hasExternalMilestones) {
    try {
      await storageSet({
        [cacheKey]: {
          timestamp: Date.now(),
          data: result
        }
      });
      cleanExpiredCache();
    } catch (e) {}
  }

  return result;
}

async function cleanExpiredCache() {
  try {
    const allData = await storageGet(null);
    if (!allData) return;
    const now = Date.now();
    const expiredKeys = [];
    for (const key in allData) {
      if (key.startsWith('cache_')) {
        const entry = allData[key];
        if (entry && entry.timestamp && (now - entry.timestamp > 60 * 60 * 1000)) {
          expiredKeys.push(key);
        }
      }
    }
    if (expiredKeys.length > 0) {
      if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
        browser.storage.local.remove(expiredKeys).catch(() => {});
      } else if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.remove(expiredKeys, () => {});
      }
    }
  } catch (_) {}
}
