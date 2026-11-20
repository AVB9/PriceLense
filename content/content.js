/**
 * Content Script for E-Commerce Retailers (PriceLens v3.2 - Apple Dark Material Design)
 * - Extracts live DOM variant prices, MRP, coupons, bank offers, and 30-day low badges
 * - Strictly deduplicates MutationObserver events by state signature so the popup UI never loops or flashes
 * - Ignores mutations inside PriceLens's own floating capsule
 */

(function () {
  const extAPI = typeof browser !== 'undefined' ? browser : chrome;

  // State signature to prevent redundant LIVE_VARIANT_UPDATED broadcasts
  let lastBroadcastSignature = '';

  function cleanPrice(text) {
    if (typeof text === 'number') return text;
    if (!text || typeof text !== 'string') return 0;
    const num = parseFloat(text.replace(/[^0-9.]/g, ''));
    return isNaN(num) ? 0 : num;
  }

  // Extract real live price, variant, MRP, coupon/deal badges, rating, and image from active webpage DOM
  function extractLivePageDetails() {
    const rawUrl = window.location.href;
    const host = window.location.hostname.toLowerCase();
    let currentPrice = 0;
    let originalPrice = 0;
    let couponDiscount = 0;
    let dealBadgeText = '';
    let title = '';
    let store = 'Store';
    let storeBadge = 'generic';
    let variantId = '';
    let variantLabel = '';
    let rating = '';
    let imageUrl = '';

    if (host.includes('amazon.')) { store = 'Amazon'; storeBadge = 'amazon'; }
    else if (host.includes('flipkart.com')) { store = 'Flipkart'; storeBadge = 'flipkart'; }
    else if (host.includes('croma.com')) { store = 'Croma'; storeBadge = 'croma'; }
    else if (host.includes('myntra.com')) { store = 'Myntra'; storeBadge = 'myntra'; }
    else if (host.includes('ajio.com')) { store = 'Ajio'; storeBadge = 'ajio'; }
    else if (host.includes('tatacliq.com')) { store = 'Tata CLiQ'; storeBadge = 'tatacliq'; }
    else if (host.includes('reliancedigital.in')) { store = 'Reliance Digital'; storeBadge = 'reliance'; }

    // =========================================================================
    // TIER 1: STORE-SPECIFIC LIVE DOM EXTRACTION (FIRST PRIORITY)
    // =========================================================================

    if (store === 'Amazon') {
      const domAsinEl = document.querySelector('#ASIN, input[name="ASIN"]') ||
                        document.querySelector('[data-csa-c-asin]');
      if (domAsinEl) {
        variantId = domAsinEl.value || domAsinEl.getAttribute('data-csa-c-asin') || '';
      }

      const twisterParts = [];
      const colorSel = document.querySelector('#variation_color_name .selection, #inline-twister-expanded-dimension-text-color_name');
      const sizeSel = document.querySelector('#variation_size_name .selection, #inline-twister-expanded-dimension-text-size_name');
      const styleSel = document.querySelector('#variation_style_name .selection');
      if (colorSel && colorSel.textContent.trim()) twisterParts.push(colorSel.textContent.trim());
      if (sizeSel && sizeSel.textContent.trim()) twisterParts.push(sizeSel.textContent.trim());
      if (styleSel && styleSel.textContent.trim()) twisterParts.push(styleSel.textContent.trim());
      if (twisterParts.length > 0) variantLabel = twisterParts.join(' / ');

      const titleEl = document.querySelector('#productTitle, #title');
      if (titleEl) title = titleEl.textContent.trim();

      // Primary Buybox / Apex Price Selectors
      const priceSelectors = [
        '#corePriceDisplay_desktop_feature_div .priceToPay .a-offscreen',
        '#corePriceDisplay_desktop_feature_div .apexPriceToPay .a-offscreen',
        '#apex_desktop .priceToPay .a-offscreen',
        '#corePrice_feature_div .priceToPay .a-offscreen',
        '#corePrice_desktop .a-price:not([data-a-strike="true"]) .a-offscreen',
        '#priceblock_dealprice',
        '#priceblock_ourprice',
        '#price_inside_buybox'
      ];
      for (const sel of priceSelectors) {
        const el = document.querySelector(sel);
        if (el) {
          const val = cleanPrice(el.textContent);
          if (val > 0) {
            currentPrice = val;
            break;
          }
        }
      }

      // Fallback whole + fraction if .a-offscreen was empty
      if (!currentPrice) {
        const wholeEl = document.querySelector('#corePriceDisplay_desktop_feature_div .priceToPay .a-price-whole, #apex_desktop .a-price-whole');
        if (wholeEl) {
          currentPrice = cleanPrice(wholeEl.textContent);
        }
      }

      // MRP / List Price
      const mrpSelectors = [
        '#corePriceDisplay_desktop_feature_div span.a-price[data-a-strike="true"] .a-offscreen',
        '#basisPrice .a-offscreen',
        'span.basisPrice .a-offscreen',
        '#corePrice_desktop span.a-text-price .a-offscreen',
        '#listPrice'
      ];
      for (const sel of mrpSelectors) {
        const el = document.querySelector(sel);
        if (el) {
          const val = cleanPrice(el.textContent);
          if (val > currentPrice) {
            originalPrice = val;
            break;
          }
        }
      }

      // On-page Coupon & Deal Badges ("Lowest price in 30 days", "Apply ₹500 coupon")
      const couponEl = document.querySelector('#couponBadgeRegularVpc, [id*="couponText"], .promoPriceBlockMessage');
      if (couponEl) {
        const cText = couponEl.textContent || '';
        const flatMatch = cText.match(/(?:Apply|Save)\s*₹\s*([\d,]+)/i);
        const pctMatch = cText.match(/(?:Apply|Save)\s*(\d+)%\s*coupon/i);
        if (flatMatch) couponDiscount = cleanPrice(flatMatch[1]);
        else if (pctMatch && currentPrice > 0) couponDiscount = Math.round(currentPrice * (parseFloat(pctMatch[1]) / 100));
      }

      const dealBadgeEl = document.querySelector('#dealBadgeSupportingText, .dealBadgeText, #zeitgeistBadge_feature_div');
      if (dealBadgeEl && dealBadgeEl.textContent.trim()) {
        dealBadgeText = dealBadgeEl.textContent.replace(/\s+/g, ' ').trim();
      }

      const ratingEl = document.querySelector('#acrPopover .a-size-base, span[data-hook="rating-out-of-text"]');
      if (ratingEl) {
        const rm = ratingEl.textContent.match(/(\d+(?:\.\d+)?)/);
        if (rm) rating = rm[1];
      }

      const imgEl = document.querySelector('#landingImage, #imgBlkFront');
      if (imgEl && imgEl.src) imageUrl = imgEl.src;
    }

    else if (store === 'Flipkart') {
      try {
        const u = new URL(rawUrl);
        const pid = u.searchParams.get('pid');
        const lid = u.searchParams.get('lid');
        if (pid) variantId = pid;
        if (lid) variantId += `_${lid}`;
      } catch (e) {}

      const swatchEl = document.querySelector('li._3V2wfe.selected, ._1fQZEK.selected, div._2C41yO');
      if (swatchEl) variantLabel = swatchEl.textContent.trim();

      const titleEl = document.querySelector('h1 span.VU-ZEz, h1 span.B_NuCI, h1 ._6EBuvT, h1 span, h1');
      if (titleEl) title = titleEl.textContent.trim();

      const curPriceEl = document.querySelector('div.Nx9bqj.CxhGGd, div.Nx9bqj, div._30jeq3._16Jk6d, div._30jeq3, div.Nx9daj, div._1vC4OE');
      if (curPriceEl) currentPrice = cleanPrice(curPriceEl.textContent);

      const mrpEl = document.querySelector('div.yRaY8j.A6+E6v, div.yRaY8j, div._3I9_wc._2p6lqe, div._3I9_wc');
      if (mrpEl) originalPrice = cleanPrice(mrpEl.textContent);

      const ratingEl = document.querySelector('div.XQDdHH, div._3LWZlK');
      if (ratingEl) {
        const rm = ratingEl.textContent.match(/(\d+(?:\.\d+)?)/);
        if (rm) rating = rm[1];
      }

      const imgEl = document.querySelector('img.DByuf4, img._396cs4, img._2r_T1I');
      if (imgEl && imgEl.src) imageUrl = imgEl.src;
    }

    else if (store === 'Croma') {
      const titleEl = document.querySelector('h1.pdp-title, h1');
      if (titleEl) title = titleEl.textContent.trim();

      const curPriceEl = document.querySelector('#pdp-product-price, span.amount, .pdp-price');
      if (curPriceEl) currentPrice = cleanPrice(curPriceEl.textContent);

      const mrpEl = document.querySelector('span.old-price, .mrp-price');
      if (mrpEl) originalPrice = cleanPrice(mrpEl.textContent);
    }

    else if (store === 'Myntra') {
      const brandEl = document.querySelector('h1.pdp-title');
      const nameEl = document.querySelector('h1.pdp-name');
      if (brandEl && nameEl) {
        title = `${brandEl.textContent.trim()} ${nameEl.textContent.trim()}`;
      } else if (nameEl || brandEl) {
        title = (nameEl || brandEl).textContent.trim();
      }

      const curPriceEl = document.querySelector('.pdp-price strong, .pdp-price');
      if (curPriceEl) currentPrice = cleanPrice(curPriceEl.textContent);

      const mrpEl = document.querySelector('.pdp-mrp s');
      if (mrpEl) originalPrice = cleanPrice(mrpEl.textContent);
    }

    else if (store === 'Ajio') {
      const titleEl = document.querySelector('.prod-name, h1.prod-title, h1');
      if (titleEl) title = titleEl.textContent.trim();

      const curPriceEl = document.querySelector('.prod-sp, span.prod-sp, .price-value');
      if (curPriceEl) currentPrice = cleanPrice(curPriceEl.textContent);

      const mrpEl = document.querySelector('.prod-cp, span.prod-cp');
      if (mrpEl) originalPrice = cleanPrice(mrpEl.textContent);
    }

    else if (store === 'Tata CLiQ') {
      const titleEl = document.querySelector('.ProductDetailsMainCard__productName, h1.ProductDetailsMainCard__title, h1');
      if (titleEl) title = titleEl.textContent.trim();

      const curPriceEl = document.querySelector('.ProductDetailsMainCard__price, .ProductPrice__price, h3[class*="price"]');
      if (curPriceEl) currentPrice = cleanPrice(curPriceEl.textContent);

      const mrpEl = document.querySelector('.ProductPrice__mrp, .ProductDetailsMainCard__mrp');
      if (mrpEl) originalPrice = cleanPrice(mrpEl.textContent);
    }

    else if (store === 'Reliance Digital') {
      const titleEl = document.querySelector('.pdp__title, h1.pdp__title, h1');
      if (titleEl) title = titleEl.textContent.trim();

      const curPriceEl = document.querySelector('.pdp__offerPrice, .text__highlight, span[class*="offerPrice"]');
      if (curPriceEl) currentPrice = cleanPrice(curPriceEl.textContent);

      const mrpEl = document.querySelector('.pdp__mrp, span[class*="mrp"]');
      if (mrpEl) originalPrice = cleanPrice(mrpEl.textContent);
    }

    // =========================================================================
    // TIER 2: STRUCTURED JSON-LD FALLBACK
    // =========================================================================
    if (!currentPrice || !title || !imageUrl) {
      const jsonLd = extractJsonLdProduct();
      if (jsonLd) {
        if (!title && jsonLd.title) title = jsonLd.title;
        if (!currentPrice && jsonLd.currentPrice > 0) currentPrice = jsonLd.currentPrice;
        if (!originalPrice && jsonLd.originalPrice > 0) originalPrice = jsonLd.originalPrice;
        if (!rating && jsonLd.rating) rating = jsonLd.rating;
        if (!imageUrl && jsonLd.imageUrl) imageUrl = jsonLd.imageUrl;
      }
    }

    // =========================================================================
    // TIER 3: OPENGRAPH & PRODUCT META TAGS FALLBACK
    // =========================================================================
    if (!currentPrice || !title || !imageUrl) {
      const meta = extractMetaDetails();
      if (!title && meta.title) title = meta.title;
      if (!currentPrice && meta.currentPrice > 0) currentPrice = meta.currentPrice;
      if (!imageUrl && meta.imageUrl) imageUrl = meta.imageUrl;
    }

    if (!title) {
      title = document.title.replace(/\s*[-|:]\s*(Amazon|Flipkart|Croma|Myntra|Ajio|Tata CLiQ|Reliance Digital).*$/i, '').trim();
    }

    let cleanUrl = rawUrl;
    try {
      const u = new URL(rawUrl);
      if (store === 'Amazon') {
        const asin = variantId || (u.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i)?.[1]);
        if (asin) cleanUrl = `${u.protocol}//${u.host}/dp/${asin.toUpperCase()}`;
      } else if (store === 'Flipkart') {
        const pid = u.searchParams.get('pid');
        const lid = u.searchParams.get('lid');
        const q = [];
        if (pid) q.push(`pid=${pid}`);
        if (lid) q.push(`lid=${lid}`);
        cleanUrl = `${u.protocol}//${u.host}${u.pathname}${q.length ? '?' + q.join('&') : ''}`;
      }
    } catch (e) {}

    return {
      success: true,
      store,
      storeBadge,
      title,
      variantId,
      variantLabel,
      currentPrice,
      originalPrice: originalPrice > currentPrice ? originalPrice : 0,
      couponDiscount,
      dealBadgeText,
      rating,
      imageUrl,
      currency: '₹',
      url: rawUrl,
      cleanUrl
    };
  }

  function extractJsonLdProduct() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      try {
        const raw = JSON.parse(script.textContent);
        const candidates = [];

        function collectItems(node) {
          if (!node) return;
          if (Array.isArray(node)) {
            node.forEach(collectItems);
          } else if (typeof node === 'object') {
            if (node['@type'] === 'Product' || (typeof node['@type'] === 'string' && node['@type'].includes('Product'))) {
              candidates.push(node);
            }
            if (Array.isArray(node['@graph'])) {
              node['@graph'].forEach(collectItems);
            }
          }
        }

        collectItems(raw);

        for (const item of candidates) {
          let price = 0;
          let originalPrice = 0;
          const title = item.name || item.headline || '';
          const rating = item.aggregateRating?.ratingValue ? String(item.aggregateRating.ratingValue) : '';
          const imageUrl = Array.isArray(item.image) ? item.image[0] : (typeof item.image === 'string' ? item.image : '');

          if (item.offers) {
            const offers = Array.isArray(item.offers) ? item.offers : [item.offers];
            for (const offer of offers) {
              const p = cleanPrice(offer.price || offer.lowPrice);
              if (p > 0) {
                price = p;
                if (offer.highPrice) originalPrice = cleanPrice(offer.highPrice);
                break;
              }
            }
          }

          if (price > 0 || title) {
            return { title, currentPrice: price, originalPrice, rating, imageUrl };
          }
        }
      } catch (e) {}
    }
    return null;
  }

  function extractMetaDetails() {
    let price = 0;
    let title = '';
    let imageUrl = '';

    const priceMeta = document.querySelector(
      'meta[property="product:price:amount"], ' +
      'meta[property="og:price:amount"], ' +
      'meta[name="twitter:data1"]'
    );
    if (priceMeta) {
      price = cleanPrice(priceMeta.getAttribute('content'));
    }

    const titleMeta = document.querySelector(
      'meta[property="og:title"], ' +
      'meta[name="twitter:title"]'
    );
    if (titleMeta) {
      title = (titleMeta.getAttribute('content') || '').trim();
    }

    const imgMeta = document.querySelector('meta[property="og:image"]');
    if (imgMeta) {
      imageUrl = imgMeta.getAttribute('content') || '';
    }

    return { title, currentPrice: price, imageUrl };
  }

  extAPI.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!request) return;
    const action = request.action || request.type;
    if (action === 'GET_LIVE_ON_PAGE_DETAILS') {
      const details = extractLivePageDetails();
      sendResponse(details);
      return false;
    }
  });

  function isProductPage() {
    const url = window.location.href;
    const path = window.location.pathname;

    if (url.includes('amazon.') && (path.includes('/dp/') || path.includes('/gp/product/'))) return true;
    if (url.includes('flipkart.com') && (path.includes('/p/') || window.location.search.includes('pid='))) return true;
    if (url.includes('croma.com') && path.includes('/p/')) return true;
    if (url.includes('myntra.com') && /\/\d+\/buy/.test(path)) return true;
    if (url.includes('tatacliq.com') && (path.includes('/p-') || path.includes('p-mp'))) return true;
    if (url.includes('ajio.com') && (path.includes('/p/') || /\/\d+$/.test(path))) return true;
    if (url.includes('reliancedigital.in') && (path.includes('/p/') || path.includes('/item/'))) return true;
    return false;
  }

  if (!isProductPage()) return;

  let floatingBadgeEl = null;

  function sendRuntimeMsg(msg) {
    return new Promise((resolve) => {
      try {
        let settled = false;
        const done = (val) => {
          if (!settled) {
            settled = true;
            resolve(val || null);
          }
        };
        setTimeout(() => done(null), 1500);
        if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.sendMessage) {
          browser.runtime.sendMessage(msg).then(done).catch(() => done(null));
        } else if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage(msg, (res) => done(res || null));
        } else {
          done(null);
        }
      } catch (_) {
        resolve(null);
      }
    });
  }

  function getFloatingBadgeSetting() {
    return new Promise((resolve) => {
      try {
        if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
          browser.storage.local.get(['enableFloatingBadge']).then(r => resolve(r || {})).catch(() => resolve({}));
        } else if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.get(['enableFloatingBadge'], (r) => resolve(r || {}));
        } else {
          resolve({});
        }
      } catch (_) {
        resolve({});
      }
    });
  }

  getFloatingBadgeSetting().then((settings) => {
    if (settings && settings.enableFloatingBadge === false) return;
    initFloatingUI();
  });

  /**
   * Check for genuine variant or price changes and broadcast ONLY when state signature changes.
   * Eliminates infinite MutationObserver broadcast loops.
   */
  function syncLiveProductState(forceBroadcast = false) {
    const pageData = extractLivePageDetails();
    const nextSignature = `${pageData.cleanUrl}|${pageData.variantId}|${pageData.variantLabel}|${pageData.currentPrice}|${pageData.originalPrice}`;

    if (floatingBadgeEl) {
      const priceText = pageData.currentPrice > 0 ? `₹${pageData.currentPrice.toLocaleString('en-IN')}` : 'Analyze';
      const strongEl = floatingBadgeEl.querySelector('.pricelens-main-price');
      if (strongEl && strongEl.textContent !== priceText) {
        strongEl.textContent = priceText;
      }
    }

    if (!forceBroadcast && nextSignature === lastBroadcastSignature) {
      return;
    }

    lastBroadcastSignature = nextSignature;

    sendRuntimeMsg({
      action: 'LIVE_VARIANT_UPDATED',
      type: 'LIVE_VARIANT_UPDATED',
      details: pageData,
      pageDetails: pageData
    });
  }

  function initFloatingUI() {
    if (document.getElementById('pricelens-floating-badge')) return;

    const pageData = extractLivePageDetails();
    const priceText = pageData.currentPrice > 0 ? `₹${pageData.currentPrice.toLocaleString('en-IN')}` : 'Analyze';

    const badge = document.createElement('div');
    badge.id = 'pricelens-floating-badge';
    badge.innerHTML = `
      <div class="pricelens-capsule-main" title="Open PriceLens Tracker Analysis">
        <span class="pricelens-status-dot"></span>
        <svg class="pricelens-trend-icon" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M2 11l4-4 3 3 5-6M10 4h4v4"/>
        </svg>
        <span>PriceLens: <strong class="pricelens-main-price">${priceText}</strong></span>
      </div>
      <div class="pricelens-capsule-divider"></div>
      <button type="button" class="pricelens-capsule-btn" id="pricelens-cap-compare" title="Save to Compare Memory">
        <span>+ Compare</span>
      </button>
      <button type="button" class="pricelens-capsule-btn" id="pricelens-cap-cart" title="Add to Universal Budget Cart">
        <span>+ Cart</span>
      </button>
    `;

    document.body.appendChild(badge);
    floatingBadgeEl = badge;

    const mainTrigger = badge.querySelector('.pricelens-capsule-main');
    const compareBtn = badge.querySelector('#pricelens-cap-compare');
    const cartBtn = badge.querySelector('#pricelens-cap-cart');

    mainTrigger.addEventListener('click', () => {
      const details = extractLivePageDetails();
      sendRuntimeMsg({
        action: 'OPEN_ACTIVE_PROVIDER_FOR_URL',
        url: details.cleanUrl || window.location.href
      });
    });

    compareBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const details = extractLivePageDetails();
      sendRuntimeMsg({
        action: 'TOGGLE_COMPARE_ITEM',
        item: details
      }).then((res) => {
        if (res && res.added) {
          compareBtn.textContent = `Saved (${res.list.length})`;
          compareBtn.classList.add('active');
        } else {
          compareBtn.textContent = '+ Compare';
          compareBtn.classList.remove('active');
        }
      });
    });

    cartBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const details = extractLivePageDetails();
      sendRuntimeMsg({
        action: 'ADD_TO_CART',
        item: details
      }).then((res) => {
        const count = res?.cart?.analytics?.totalItemsCount || 1;
        cartBtn.textContent = `In Cart (${count})`;
        cartBtn.classList.add('active-green');
      });
    });

    sendRuntimeMsg({ action: 'GET_WORKSPACE_STATE' }).then((res) => {
      if (!res) return;
      const cleanUrl = pageData.cleanUrl;
      if (Array.isArray(res.compareList) && res.compareList.some(i => i.cleanUrl === cleanUrl)) {
        compareBtn.textContent = `Saved (${res.compareList.length})`;
        compareBtn.classList.add('active');
      }
      if (res.cart && Array.isArray(res.cart.items) && res.cart.items.some(i => i.cleanUrl === cleanUrl)) {
        cartBtn.textContent = `In Cart (${res.cart.analytics?.totalItemsCount || 1})`;
        cartBtn.classList.add('active-green');
      }
    });

    syncLiveProductState(true);
    initSpaAndDomObserver();
  }

  function initSpaAndDomObserver() {
    let debounceTimer = null;

    function scheduleCheck() {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        syncLiveProductState(false);
      }, 450);
    }

    const observer = new MutationObserver((mutations) => {
      // Ignore mutations that happened exclusively inside our own floating badge
      const hasExternalMutation = mutations.some(m => {
        if (!floatingBadgeEl) return true;
        return !floatingBadgeEl.contains(m.target);
      });
      if (!hasExternalMutation) return;
      scheduleCheck();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });

    const origPushState = history.pushState;
    if (origPushState) {
      history.pushState = function () {
        origPushState.apply(this, arguments);
        scheduleCheck();
      };
    }

    const origReplaceState = history.replaceState;
    if (origReplaceState) {
      history.replaceState = function () {
        origReplaceState.apply(this, arguments);
        scheduleCheck();
      };
    }

    window.addEventListener('popstate', scheduleCheck);
    window.addEventListener('hashchange', scheduleCheck);
  }

})();
