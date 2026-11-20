/**
 * URL Cleaner, Canonicalizer & Product Identifier Extractor
 * Strips tracking parameters while strictly preserving product and variant identifiers
 * (such as active Amazon ASIN, Flipkart pid/lid) and extracts clean search queries.
 */

const URLCleaner = {
  // Strip common tracking and analytics query parameters
  stripTrackingParams(rawUrl) {
    try {
      const url = new URL(rawUrl);
      const paramsToRemove = [
        'ref', 'ref_', 'tag', 'linkCode', 'camp', 'creative', 'creativeASIN',
        'ascsubtag', 'keywords', 'qid', 'sr', 'crid', 'sprefix', 'dib', 'dib_tag',
        'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
        'gclid', 'fbclid', 'dchild', 'smid', 'pf_rd_r', 'pf_rd_p', 'pf_rd_m',
        'pf_rd_s', 'pf_rd_t', 'pf_rd_i', 'pd_rd_r', 'pd_rd_w', 'pd_rd_wg',
        '_encoding', 'psc', 'th', 'marketplace', 'store', 'spotlight',
        'otracker', 'otracker1', 'fm', 'iid', 'ppt', 'ppn', 'ssid', 'qH'
      ];

      paramsToRemove.forEach(p => url.searchParams.delete(p));
      return url.toString();
    } catch (e) {
      return rawUrl;
    }
  },

  // Extract clean canonical product URL, prioritizing live DOM variant identifier if passed
  getCanonicalUrl(rawUrl, activeAsin = null) {
    if (!rawUrl || typeof rawUrl !== 'string') return '';
    const cleanUrl = rawUrl.trim();

    try {
      const parsed = new URL(cleanUrl);
      const host = parsed.hostname.toLowerCase();
      const pathname = parsed.pathname;

      // Amazon Canonicalization: /dp/ASIN
      if (host.includes('amazon.')) {
        const targetAsin = (activeAsin && /^[A-Z0-9]{10}$/i.test(activeAsin)) ? activeAsin : (() => {
          const m = pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d|product)\/([A-Z0-9]{10})/i);
          return m ? m[1] : null;
        })();

        if (targetAsin) {
          return `${parsed.protocol}//${parsed.host}/dp/${targetAsin.toUpperCase()}`;
        }
      }

      // Flipkart Canonicalization: preserve path, pid, and lid (listing/variant ID)
      if (host.includes('flipkart.com')) {
        const pid = parsed.searchParams.get('pid');
        const lid = parsed.searchParams.get('lid');
        const itmMatch = pathname.match(/(\/[^/]+\/p\/itm[a-zA-Z0-9]+)/i) ||
                         pathname.match(/(\/p\/itm[a-zA-Z0-9]+)/i);
        const basePath = itmMatch ? pathname : pathname;

        const queryParts = [];
        if (pid) queryParts.push(`pid=${encodeURIComponent(pid)}`);
        if (lid) queryParts.push(`lid=${encodeURIComponent(lid)}`);

        if (queryParts.length > 0) {
          return `${parsed.protocol}//${parsed.host}${basePath}?${queryParts.join('&')}`;
        }
        return `${parsed.protocol}//${parsed.host}${basePath}`;
      }

      // Croma: preserve slug + /p/XXXXX
      if (host.includes('croma.com')) {
        const pMatch = pathname.match(/^(.*\/p\/\d+)/);
        if (pMatch) {
          return `${parsed.protocol}//${parsed.host}${pMatch[1]}`;
        }
      }

      // Myntra: preserve /buy path
      if (host.includes('myntra.com')) {
        const mMatch = pathname.match(/^(.*\/\d+\/buy)/);
        if (mMatch) {
          return `${parsed.protocol}//${parsed.host}${mMatch[1]}`;
        }
      }

      // Ajio: preserve /p/XXXXX
      if (host.includes('ajio.com')) {
        const pMatch = pathname.match(/^(.*\/p\/[a-zA-Z0-9_]+)/);
        if (pMatch) {
          return `${parsed.protocol}//${parsed.host}${pMatch[1]}`;
        }
      }

      // Default: clean out query string noise
      return this.stripTrackingParams(cleanUrl);
    } catch (e) {
      return cleanUrl;
    }
  },

  // Extract Amazon ASIN and Country TLD (e.g. 'in', 'com', 'co.uk')
  getAmazonDetails(rawUrl, activeAsin = null) {
    if (!rawUrl) return null;
    try {
      const parsed = new URL(rawUrl);
      if (!parsed.hostname.toLowerCase().includes('amazon.')) return null;

      let asin = (activeAsin && /^[A-Z0-9]{10}$/i.test(activeAsin)) ? activeAsin : null;
      if (!asin) {
        const dpMatch = parsed.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d|product)\/([A-Z0-9]{10})/i);
        if (dpMatch) asin = dpMatch[1];
      }
      if (!asin) return null;

      const hostParts = parsed.hostname.toLowerCase().split('.');
      let domain = hostParts[hostParts.length - 1];
      if (parsed.hostname.includes('amazon.co.uk')) domain = 'co.uk';
      if (parsed.hostname.includes('amazon.co.jp')) domain = 'co.jp';

      return {
        asin: asin.toUpperCase(),
        domain: domain || 'in'
      };
    } catch {
      return null;
    }
  },

  // Extract structured product identifiers & URL-derived title keywords
  extractProductIdentifiers(rawUrl, activeVariantId = null) {
    const info = {
      asin: null,
      flipkartPid: null,
      storeProductId: null,
      urlSlugTitle: '',
      store: this.detectStore(rawUrl)
    };

    if (!rawUrl) return info;

    try {
      const parsed = new URL(rawUrl);
      const host = parsed.hostname.toLowerCase();
      const pathname = decodeURIComponent(parsed.pathname || '');

      // 1. Amazon ASIN & Slug
      if (host.includes('amazon.')) {
        const amz = this.getAmazonDetails(rawUrl, activeVariantId);
        if (amz) {
          info.asin = amz.asin;
          info.storeProductId = amz.asin;
        }
        const slugMatch = pathname.match(/\/([^/]+)\/(?:dp|gp\/product)\/[A-Z0-9]{10}/i);
        if (slugMatch && slugMatch[1]) {
          info.urlSlugTitle = slugMatch[1].replace(/[-_]+/g, ' ').trim();
        }
      }

      // 2. Flipkart PID & Slug
      else if (host.includes('flipkart.com')) {
        const pid = parsed.searchParams.get('pid');
        if (pid) {
          info.flipkartPid = pid;
          info.storeProductId = pid;
        }
        const slugMatch = pathname.match(/^\/([^/]+)\/p\/itm/i);
        if (slugMatch && slugMatch[1]) {
          info.urlSlugTitle = slugMatch[1].replace(/[-_]+/g, ' ').trim();
        }
      }

      // 3. Myntra
      else if (host.includes('myntra.com')) {
        const m = pathname.match(/\/(\d+)\/buy/i);
        if (m) info.storeProductId = m[1];
        const parts = pathname.split('/').filter(Boolean);
        if (parts.length >= 3) {
          info.urlSlugTitle = parts.slice(0, -2).join(' ').replace(/[-_]+/g, ' ').trim();
        }
      }

      // 4. Croma
      else if (host.includes('croma.com')) {
        const m = pathname.match(/\/([^/]+)\/p\/(\d+)/i);
        if (m) {
          info.urlSlugTitle = m[1].replace(/[-_]+/g, ' ').trim();
          info.storeProductId = m[2];
        }
      }

      // 5. Tata CLiQ / Ajio / Reliance Digital
      else {
        const segments = pathname.split('/').filter(s => s.length > 3 && !/^p[-_]/i.test(s) && s !== 'p' && s !== 'item');
        if (segments.length > 0) {
          info.urlSlugTitle = segments[0].replace(/[-_]+/g, ' ').replace(/\.html?$/i, '').trim();
        }
      }
    } catch (e) {}

    return info;
  },

  // Clean a product title into high-signal search keywords for cross-store & tracker lookup
  buildSearchQuery(title, rawUrl = '', maxWords = 8) {
    let source = (title || '').trim();
    const invalidTitles = [
      'product overview', 'product page', 'detecting product...',
      'paste a product link above to inspect', 'paste any product link above',
      'price insights', 'product price details'
    ];
    if (!source || invalidTitles.includes(source.toLowerCase())) {
      const ids = this.extractProductIdentifiers(rawUrl);
      source = ids.urlSlugTitle || ids.asin || ids.flipkartPid || '';
    }

    if (!source) return '';

    const cleaned = source
      .replace(/\s*[-|:]\s*(Amazon\.in|Amazon\.com|Amazon|Flipkart\.com|Flipkart|Croma|Myntra|Ajio|Tata\s*CLiQ|Reliance\s*Digital).*$/i, '')
      .replace(/^(Buy|Online|Shop)\s+/i, '')
      .replace(/\b(Online at Best Price in India|Only Genuine Products|Free Shipping|Cash On Delivery|with Offer)\b/gi, '')
      .replace(/\([^)]{25,}\)/g, ' ') // strip overly long spec parentheses while keeping short "(128 GB)"
      .replace(/[^\w\sd.+&-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const words = cleaned.split(' ').filter(w => w.length > 1 || /\d/.test(w));
    return words.slice(0, maxWords).join(' ');
  },

  detectStore(rawUrl) {
    if (!rawUrl) return { name: 'Generic Store', domain: '', badge: 'generic' };
    try {
      const host = new URL(rawUrl).hostname.toLowerCase();
      if (host.includes('amazon')) return { name: 'Amazon', domain: host, badge: 'amazon' };
      if (host.includes('flipkart')) return { name: 'Flipkart', domain: host, badge: 'flipkart' };
      if (host.includes('myntra')) return { name: 'Myntra', domain: host, badge: 'myntra' };
      if (host.includes('croma')) return { name: 'Croma', domain: host, badge: 'croma' };
      if (host.includes('tatacliq')) return { name: 'Tata CLiQ', domain: host, badge: 'tatacliq' };
      if (host.includes('ajio')) return { name: 'Ajio', domain: host, badge: 'ajio' };
      if (host.includes('reliancedigital')) return { name: 'Reliance Digital', domain: host, badge: 'reliance' };
      if (host.includes('nykaa')) return { name: 'Nykaa', domain: host, badge: 'nykaa' };
      if (host.includes('meesho')) return { name: 'Meesho', domain: host, badge: 'meesho' };
      if (host.includes('jiomart')) return { name: 'JioMart', domain: host, badge: 'jiomart' };
      return { name: host.replace(/^www\./, ''), domain: host, badge: 'generic' };
    } catch {
      return { name: 'Store', domain: '', badge: 'generic' };
    }
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = URLCleaner;
}
