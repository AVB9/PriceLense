/**
 * Multi-PTP & Cross-Store Scraper Engine
 * Parallel queries across Buyhatke (Direct + Search Slug + SvelteKit __data.json),
 * PriceBefore (Search-to-Detail -m*.html), PriceHistory.app, Keepa,
 * and Live Cross-Retailer Search with consensus data merging.
 */

const MultiPtpScrapers = {
  /**
   * Fetch helper with timeout so no single slow provider blocks the pipeline
   */
  async fetchWithTimeout(url, options = {}, timeoutMs = 4200) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
          'Cache-Control': 'no-cache',
          ...(options.headers || {})
        }
      });
      clearTimeout(timer);
      return res;
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  },

  /**
   * Discover canonical tracker slug URL via Google search when direct URL lookup is a client-side shell
   */
  async discoverProviderSlugViaSearch(siteDomain, searchQuery, slugRegex) {
    if (!searchQuery) return null;
    try {
      const q = `site:${siteDomain} ${searchQuery}`;
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
      const res = await this.fetchWithTimeout(searchUrl, {}, 3500);
      if (!res.ok) return null;
      const html = await res.text();
      const match = html.match(slugRegex);
      if (match && match[1]) {
        return decodeURIComponent(match[1].split('&')[0]);
      }
    } catch (e) {}
    return null;
  },

  /**
   * Scrape Buyhatke with 3-stage resolution:
   * Stage 1: Direct URL & redirect inspection
   * Stage 2: Canonical slug discovery (`-price-in-india-<pos>-<pid>`)
   * Stage 3: SvelteKit `/__data.json` hydration endpoint fetch
   */
  async scrapeBuyhatke(productUrl, productTitle = '') {
    let targetUrl = `https://buyhatke.com/${productUrl}`;
    let html = '';

    try {
      const response = await this.fetchWithTimeout(targetUrl, {}, 3500);
      if (response && response.ok) {
        if (response.url && response.url.includes('price-in-india')) {
          targetUrl = response.url;
        }
        html = await response.text();
      }
    } catch (e) {}

    let parsed = html ? Parsers.parseBuyhatke(html, targetUrl) : { rawFound: false };

    // If direct fetch returned the unhydrated SvelteKit shell, check for embedded slug or resolve via search
    if (!parsed.rawFound || !parsed.hasVerifiedMilestones) {
      let resolvedSlugUrl = null;

      if (html) {
        const slugMatch = html.match(/https?:\/\/(?:www\.)?buyhatke\.com\/([a-z0-9-]+-price-in-india-\d+-\d+)/i) ||
                          html.match(/href=["']\/([a-z0-9-]+-price-in-india-\d+-\d+)["']/i);
        if (slugMatch && slugMatch[1]) {
          resolvedSlugUrl = `https://buyhatke.com/${slugMatch[1]}`;
        }
      }

      if (!resolvedSlugUrl && typeof URLCleaner !== 'undefined') {
        const query = URLCleaner.buildSearchQuery(productTitle, productUrl, 7);
        const found = await this.discoverProviderSlugViaSearch(
          'buyhatke.com',
          query,
          /(https?:\/\/(?:www\.)?buyhatke\.com\/[a-z0-9-]+-price-in-india-\d+-\d+)/i
        );
        if (found) resolvedSlugUrl = found;
      }

      if (resolvedSlugUrl) {
        targetUrl = resolvedSlugUrl;
        try {
          const [pageRes, dataJsonRes] = await Promise.allSettled([
            this.fetchWithTimeout(resolvedSlugUrl, {}, 3800),
            this.fetchWithTimeout(`${resolvedSlugUrl.replace(/\/$/, '')}/__data.json`, {}, 3200)
          ]);

          let slugHtml = '';
          let svelteJson = null;

          if (pageRes.status === 'fulfilled' && pageRes.value && pageRes.value.ok) {
            slugHtml = await pageRes.value.text();
          }
          if (dataJsonRes.status === 'fulfilled' && dataJsonRes.value && dataJsonRes.value.ok) {
            try {
              svelteJson = await dataJsonRes.value.json();
            } catch (_) {}
          }

          if (slugHtml || svelteJson) {
            const slugParsed = Parsers.parseBuyhatke(slugHtml, resolvedSlugUrl, svelteJson);
            if (slugParsed.rawFound) {
              return slugParsed;
            }
          }
        } catch (e) {}
      }
    }

    return parsed;
  },

  /**
   * Scrape PriceBefore with search-to-product link traversal (-m\d+.html)
   */
  async scrapePriceBefore(cleanUrl, productTitle = '') {
    const query = (typeof URLCleaner !== 'undefined')
      ? (URLCleaner.buildSearchQuery(productTitle, cleanUrl, 6) || cleanUrl)
      : (productTitle || cleanUrl);

    const searchUrl = `https://www.pricebefore.com/search/?q=${encodeURIComponent(query)}`;
    let html = '';

    try {
      const response = await this.fetchWithTimeout(searchUrl, {}, 3800);
      if (response.ok) {
        html = await response.text();
      }
    } catch (e) {}

    let parsed = html ? Parsers.parsePriceBefore(html, searchUrl) : { rawFound: false };

    // Follow PriceBefore product detail slug (e.g., /product-name-m1011367.html)
    if (!parsed.rawFound || parsed.isEstimatedHistory) {
      let detailUrl = null;
      if (html) {
        const productLinkMatch = html.match(/href=["']((?:https?:\/\/www\.pricebefore\.com)?\/[^"']*?-m\d+\.html)["']/i) ||
                                 html.match(/href=["'](\/[^"']*-p\d+\/?)["']/i);
        if (productLinkMatch && productLinkMatch[1]) {
          detailUrl = productLinkMatch[1].startsWith('http')
            ? productLinkMatch[1]
            : `https://www.pricebefore.com${productLinkMatch[1]}`;
        }
      }

      if (!detailUrl) {
        const discovered = await this.discoverProviderSlugViaSearch(
          'pricebefore.com',
          query,
          /(https?:\/\/(?:www\.)?pricebefore\.com\/[a-z0-9-]+-m\d+\.html)/i
        );
        if (discovered) detailUrl = discovered;
      }

      if (detailUrl) {
        try {
          const detailRes = await this.fetchWithTimeout(detailUrl, {}, 3800);
          if (detailRes.ok) {
            const detailHtml = await detailRes.text();
            const detailParsed = Parsers.parsePriceBefore(detailHtml, detailUrl);
            if (detailParsed.rawFound) {
              return detailParsed;
            }
          }
        } catch (e) {}
      }
    }

    return parsed;
  },

  /**
   * Scrape PriceHistory.app with /p/<slug> discovery
   */
  async scrapePriceHistoryApp(cleanUrl, productTitle = '') {
    const query = (typeof URLCleaner !== 'undefined')
      ? (URLCleaner.buildSearchQuery(productTitle, cleanUrl, 6) || cleanUrl)
      : (productTitle || cleanUrl);

    let targetUrl = `https://pricehistory.app/p/${encodeURIComponent(cleanUrl)}`;

    // Discover canonical /p/<slug> via search
    const discoveredSlug = await this.discoverProviderSlugViaSearch(
      'pricehistory.app/p/',
      query,
      /(https?:\/\/pricehistory\.app\/p\/[a-zA-Z0-9_-]+)/i
    );

    if (discoveredSlug) {
      targetUrl = discoveredSlug;
    }

    const response = await this.fetchWithTimeout(targetUrl, {}, 3800);
    if (!response.ok) {
      throw new Error(`PriceHistory.app HTTP ${response.status}`);
    }

    const html = await response.text();
    return Parsers.parsePriceHistoryApp(html, targetUrl);
  },

  /**
   * Live Cross-Retailer Price Comparison Scraper
   * Queries Google Shopping / Search snippets for competing Indian stores
   * (Amazon, Flipkart, Croma, Reliance Digital, Myntra, Ajio, Tata CLiQ)
   */
  async scrapeCrossStoreAlternatives(cleanUrl, productTitle = '', currentPrice = 0) {
    if (!productTitle && !cleanUrl) return [];
    const query = (typeof URLCleaner !== 'undefined')
      ? URLCleaner.buildSearchQuery(productTitle, cleanUrl, 7)
      : productTitle;
    if (!query || query.length < 3) return [];

    const options = [];
    try {
      const shopUrl = `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(query + ' price india')}`;
      const res = await this.fetchWithTimeout(shopUrl, {}, 3800);
      if (!res.ok) return options;

      const html = await res.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const text = doc.body ? (doc.body.innerText || doc.body.textContent || '') : html;

      const knownStores = [
        { name: 'Amazon', pattern: /Amazon\.in|Amazon\s+India/i },
        { name: 'Flipkart', pattern: /Flipkart/i },
        { name: 'Croma', pattern: /Croma/i },
        { name: 'Reliance Digital', pattern: /Reliance\s*Digital/i },
        { name: 'Tata CLiQ', pattern: /Tata\s*CLiQ/i },
        { name: 'Myntra', pattern: /Myntra/i },
        { name: 'Ajio', pattern: /Ajio/i },
        { name: 'Vijay Sales', pattern: /Vijay\s*Sales/i },
        { name: 'JioMart', pattern: /JioMart/i }
      ];

      // Match price + store mentions in shopping blocks (with accessory/refurbished noise filtering)
      const titleLower = (productTitle || query).toLowerCase();
      const accessoryWords = ['case', 'cover', 'tempered', 'protector', 'screen guard', 'strap', 'pouch', 'skin', 'stand', 'holder', 'replacement', 'refurbished', 'renewed', 'unboxed'];
      const blocks = text.split(/\n{2,}|\r\n{2,}/);
      for (const block of blocks) {
        if (block.length > 350 || block.length < 12) continue;
        const blockLower = block.toLowerCase();
        if (accessoryWords.some(w => blockLower.includes(w) && !titleLower.includes(w))) continue;
        const priceMatch = block.match(/₹\s*([\d,]+(?:\.\d+)?)/);
        if (!priceMatch) continue;
        const price = Parsers.parsePrice(priceMatch[1]);
        if (!price || price <= 0) continue;
        if (currentPrice > 0 && (price < currentPrice * 0.55 || price > currentPrice * 1.65)) continue;

        for (const st of knownStores) {
          if (st.pattern.test(block)) {
            options.push({
              store: st.name,
              price,
              link: shopUrl,
              currency: '₹',
              isCheaper: currentPrice > 0 ? price < currentPrice : false,
              savings: currentPrice > 0 && price < currentPrice ? Math.round(currentPrice - price) : 0
            });
            break;
          }
        }
      }
    } catch (e) {}

    return options;
  },

  /**
   * Keepa chart URL generator for Amazon products
   */
  resolveKeepaGraph(cleanUrl, activeAsin = null) {
    if (typeof URLCleaner === 'undefined') return null;
    const amazonInfo = URLCleaner.getAmazonDetails(cleanUrl, activeAsin);
    if (!amazonInfo) return null;
    return `https://graph.keepa.com/pricehistory.png?asin=${amazonInfo.asin}&domain=${amazonInfo.domain}`;
  },

  /**
   * Focused Buyhatke-First Scraping Pipeline
   * Avoids noisy third-party search mismatches by using Buyhatke as the sole primary data source
   * unless the user explicitly switches the provider dropdown.
   */
  async scrapeAllParallel(cleanUrl, primaryProviderId = 'buyhatke', tabLiveData = null, localVaultPoints = []) {
    const productTitle = (tabLiveData && tabLiveData.title) || '';
    const providerResults = [];

    try {
      if (primaryProviderId === 'pricebefore') {
        const pb = await this.scrapePriceBefore(cleanUrl, productTitle);
        if (pb && pb.rawFound) providerResults.push(pb);
      } else if (primaryProviderId === 'pricehistoryapp') {
        const ph = await this.scrapePriceHistoryApp(cleanUrl, productTitle);
        if (ph && ph.rawFound) providerResults.push(ph);
      } else {
        const bh = await this.scrapeBuyhatke(cleanUrl, productTitle);
        if (bh && bh.rawFound) providerResults.push(bh);
      }
    } catch (e) {}

    return Parsers.mergeMultiSourceInsights({
      providerResults,
      crossStoreOptions: [],
      liveData: tabLiveData,
      localVaultPoints,
      primaryProviderName: primaryProviderId === 'pricebefore' ? 'PriceBefore' :
                           primaryProviderId === 'pricehistoryapp' ? 'PriceHistory.app' : 'Buyhatke',
      targetLookupUrl: `https://buyhatke.com/${cleanUrl}`
    });
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MultiPtpScrapers;
}
