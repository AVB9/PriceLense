/**
 * Provider System for Price Tracking & Comparison
 * Supports Buyhatke, PriceBefore, PriceHistoryApp, Keepa, Google Shopping,
 * and User-Defined Custom Providers.
 */

const DEFAULT_PROVIDERS = [
  {
    id: 'buyhatke',
    name: 'Buyhatke (Default)',
    shortName: 'Buyhatke',
    description: 'India\'s leading price tracker & comparison engine for Amazon, Flipkart, Myntra, etc.',
    website: 'https://buyhatke.com',
    urlTemplate: 'https://buyhatke.com/{{url}}',
    isBuiltin: true,
    enabled: true,
    supportedStores: ['amazon', 'flipkart', 'myntra', 'croma', 'tatacliq', 'ajio', 'reliancedigital', 'nykaa'],
    parser: 'parseBuyhatke'
  },
  {
    id: 'pricebefore',
    name: 'PriceBefore',
    shortName: 'PriceBefore',
    description: 'Tracks price history graph and price drop alerts across Indian e-commerce.',
    website: 'https://www.pricebefore.com',
    urlTemplate: 'https://www.pricebefore.com/search/?q={{encodedUrl}}',
    isBuiltin: true,
    enabled: true,
    supportedStores: ['amazon', 'flipkart', 'snapdeal', 'myntra', 'paytmmall'],
    parser: 'parsePriceBefore'
  },
  {
    id: 'pricehistoryapp',
    name: 'PriceHistory.app',
    shortName: 'PriceHistory',
    description: 'Price drop tracker and price comparison for Amazon, Flipkart & Myntra.',
    website: 'https://pricehistory.app',
    urlTemplate: 'https://pricehistory.app/p/{{encodedUrl}}',
    isBuiltin: true,
    enabled: true,
    supportedStores: ['amazon', 'flipkart', 'myntra'],
    parser: 'parseCustom'
  },
  {
    id: 'keepa',
    name: 'Keepa (Amazon Chart)',
    shortName: 'Keepa',
    description: 'Amazon price history tracker and chart generator.',
    website: 'https://keepa.com',
    urlTemplate: 'https://keepa.com/#!product/{{domain}}-{{asin}}',
    chartImageUrl: 'https://graph.keepa.com/pricehistory.png?asin={{asin}}&domain={{domain}}',
    isBuiltin: true,
    enabled: true,
    supportedStores: ['amazon'],
    parser: 'parseCamelCamelCamel'
  },
  {
    id: 'googleshopping',
    name: 'Google Shopping',
    shortName: 'Google Shop',
    description: 'Compare real-time prices across all Indian online stores.',
    website: 'https://shopping.google.com',
    urlTemplate: 'https://www.google.com/search?tbm=shop&q={{encodedUrl}}',
    isBuiltin: true,
    enabled: true,
    supportedStores: ['amazon', 'flipkart', 'croma', 'reliance', 'all'],
    parser: 'parseCustom'
  }
];

function storageGet(keys) {
  return new Promise((resolve) => {
    try {
      let settled = false;
      const done = (val) => {
        if (!settled) {
          settled = true;
          resolve(val || {});
        }
      };
      setTimeout(() => done({}), 600);

      if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
        browser.storage.local.get(keys).then(done).catch(() => done({}));
      } else if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(keys, (res) => done(res));
      } else {
        done({});
      }
    } catch (_) {
      resolve({});
    }
  });
}

function storageSet(obj) {
  return new Promise((resolve) => {
    try {
      let settled = false;
      const done = () => {
        if (!settled) {
          settled = true;
          resolve(true);
        }
      };
      setTimeout(() => done(), 600);

      if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
        browser.storage.local.set(obj).then(done).catch(() => done());
      } else if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set(obj, () => done());
      } else {
        done();
      }
    } catch (_) {
      resolve(false);
    }
  });
}

class ProviderManager {
  static async getAllProviders() {
    const res = await storageGet(['customProviders']);
    const custom = (res && Array.isArray(res.customProviders)) ? res.customProviders : [];
    return [...DEFAULT_PROVIDERS, ...custom];
  }

  static async getActiveProvider() {
    const providers = await this.getAllProviders();
    const res = await storageGet(['activeProviderId']);
    const activeId = res && res.activeProviderId;
    const found = providers.find(p => p.id === activeId);
    return found || providers[0];
  }

  static async setActiveProvider(id) {
    await storageSet({ activeProviderId: id });
  }

  static async getSettings() {
    const defaults = {
      displayMode: 'dashboard', // Default to in-popup analytics dashboard
      autoRedirectInstant: false,
      enableFloatingBadge: true,
      activeProviderId: 'buyhatke'
    };
    const res = await storageGet(Object.keys(defaults));
    return { ...defaults, ...(res || {}) };
  }

  static async saveSettings(newSettings) {
    await storageSet(newSettings);
  }

  static async saveCustomProvider(providerData) {
    const res = await storageGet(['customProviders']);
    const list = (res && Array.isArray(res.customProviders)) ? [...res.customProviders] : [];
    const existingIndex = list.findIndex(p => p.id === providerData.id);
    if (existingIndex >= 0) {
      list[existingIndex] = providerData;
    } else {
      list.push(providerData);
    }
    return storageSet({ customProviders: list });
  }

  static async deleteCustomProvider(id) {
    const res = await storageGet(['customProviders', 'activeProviderId']);
    const list = ((res && res.customProviders) || []).filter(p => p.id !== id);
    const activeId = (res && res.activeProviderId === id) ? 'buyhatke' : (res && res.activeProviderId);
    return storageSet({ customProviders: list, activeProviderId: activeId });
  }

  /**
   * Build the target lookup URL for a provider given the raw product URL
   */
  static buildTargetUrl(provider, productUrl) {
    if (!productUrl) return provider.website || 'https://buyhatke.com';
    const encoded = encodeURIComponent(productUrl);
    let template = provider.urlTemplate || 'https://buyhatke.com/{{url}}';

    // Handle Keepa template with ASIN
    if (provider.id === 'keepa' && typeof URLCleaner !== 'undefined') {
      const amazonInfo = URLCleaner.getAmazonDetails(productUrl);
      if (amazonInfo) {
        return template
          .replace(/\{\{asin\}\}/g, amazonInfo.asin)
          .replace(/\{\{domain\}\}/g, amazonInfo.domain);
      }
      return `https://keepa.com/#!search/${encoded}`;
    }

    // Default template replacement
    return template
      .replace(/\{\{encodedUrl\}\}/g, encoded)
      .replace(/\{\{url\}\}/g, productUrl);
  }
}

/**
 * Multi-Product Comparison Memory, Universal Cart & Local Price Vault Manager
 */
class WorkspaceManager {
  static COMPARE_KEY = 'pricelens_compare_memory_v1';
  static CART_KEY = 'pricelens_universal_cart_v1';
  static VAULT_KEY = 'pricelens_local_price_vault_v1';
  static MAX_COMPARE_ITEMS = 5;

  static getStorage() {
    if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
      return browser.storage.local;
    }
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      return chrome.storage.local;
    }
    return null;
  }

  static async getCompareList() {
    const res = await storageGet([this.COMPARE_KEY]);
    return (res && Array.isArray(res[this.COMPARE_KEY])) ? res[this.COMPARE_KEY] : [];
  }

  static async upsertCompareItem(productItem) {
    if (!productItem || !productItem.cleanUrl) return [];
    const list = await this.getCompareList();
    const normUrl = productItem.cleanUrl;
    const existingIdx = list.findIndex(item => item.cleanUrl === normUrl);

    const entry = {
      cleanUrl: normUrl,
      url: productItem.url || normUrl,
      title: productItem.title || 'Product',
      store: productItem.store || 'Store',
      storeBadge: productItem.storeBadge || 'generic',
      variantLabel: productItem.variantLabel || '',
      currentPrice: Number(productItem.currentPrice) || 0,
      originalPrice: Number(productItem.originalPrice) || 0,
      lowestPrice: Number(productItem.lowestPrice) || Number(productItem.currentPrice) || 0,
      highestPrice: Number(productItem.highestPrice) || Number(productItem.originalPrice) || Number(productItem.currentPrice) || 0,
      averagePrice: Number(productItem.averagePrice) || Number(productItem.currentPrice) || 0,
      dealBadge: productItem.dealBadge || 'Tracked',
      dealType: productItem.dealType || 'neutral',
      dealScore: Number(productItem.dealScore) || 0,
      rating: productItem.rating || '',
      reviewCount: productItem.reviewCount || '',
      imageUrl: productItem.imageUrl || '',
      bestAltStore: productItem.bestAltStore || '',
      bestAltPrice: Number(productItem.bestAltPrice) || 0,
      bestAltUrl: productItem.bestAltUrl || '',
      updatedAt: Date.now()
    };

    if (existingIdx >= 0) {
      list[existingIdx] = { ...list[existingIdx], ...entry };
    } else {
      list.unshift(entry);
      if (list.length > this.MAX_COMPARE_ITEMS) {
        list.pop();
      }
    }

    await storageSet({ [this.COMPARE_KEY]: list });
    return list;
  }

  static async toggleCompareItem(productItem) {
    if (!productItem || !productItem.cleanUrl) return { list: [], added: false };
    const list = await this.getCompareList();
    const exists = list.some(i => i.cleanUrl === productItem.cleanUrl);
    if (exists) {
      const updated = await this.removeFromCompare(productItem.cleanUrl);
      return { list: updated, added: false };
    } else {
      const updated = await this.upsertCompareItem(productItem);
      return { list: updated, added: true };
    }
  }

  static async removeFromCompare(cleanUrl) {
    const list = await this.getCompareList();
    const filtered = list.filter(item => item.cleanUrl !== cleanUrl);
    await storageSet({ [this.COMPARE_KEY]: filtered });
    return filtered;
  }

  static async clearCompare() {
    await storageSet({ [this.COMPARE_KEY]: [] });
    return [];
  }

  static async getCartState() {
    const defaultState = { items: [], budgetLimit: 25000, currency: '₹', updatedAt: Date.now() };
    const res = await storageGet([this.CART_KEY]);
    const raw = (res && res[this.CART_KEY]) ? res[this.CART_KEY] : defaultState;
    const normalized = {
      items: Array.isArray(raw.items) ? raw.items : [],
      budgetLimit: typeof raw.budgetLimit === 'number' ? raw.budgetLimit : 25000,
      currency: raw.currency || '₹',
      updatedAt: raw.updatedAt || Date.now()
    };
    return this.enrichCartAnalytics(normalized);
  }

  static async addOrUpdateCartItem(productItem, quantityDelta = 1) {
    if (!productItem || !productItem.cleanUrl) return this.getCartState();
    const state = await this.getCartState();
    const items = [...state.items];
    const idx = items.findIndex(i => i.cleanUrl === productItem.cleanUrl);

    if (idx >= 0) {
      const existing = items[idx];
      const nextQty = Math.max(1, (existing.quantity || 1) + quantityDelta);
      items[idx] = {
        ...existing,
        title: productItem.title || existing.title,
        currentPrice: Number(productItem.currentPrice) || existing.currentPrice,
        originalPrice: Number(productItem.originalPrice) || existing.originalPrice,
        lowestPrice: Number(productItem.lowestPrice) || existing.lowestPrice,
        bestAltStore: productItem.bestAltStore || existing.bestAltStore || '',
        bestAltPrice: Number(productItem.bestAltPrice) || existing.bestAltPrice || 0,
        bestAltUrl: productItem.bestAltUrl || existing.bestAltUrl || '',
        variantLabel: productItem.variantLabel || existing.variantLabel || '',
        quantity: nextQty,
        updatedAt: Date.now()
      };
    } else {
      items.unshift({
        cleanUrl: productItem.cleanUrl,
        url: productItem.url || productItem.cleanUrl,
        title: productItem.title || 'Product',
        store: productItem.store || 'Store',
        storeBadge: productItem.storeBadge || 'generic',
        variantLabel: productItem.variantLabel || '',
        currentPrice: Number(productItem.currentPrice) || 0,
        originalPrice: Number(productItem.originalPrice) || Number(productItem.highestPrice) || 0,
        lowestPrice: Number(productItem.lowestPrice) || 0,
        bestAltStore: productItem.bestAltStore || '',
        bestAltPrice: Number(productItem.bestAltPrice) || 0,
        bestAltUrl: productItem.bestAltUrl || '',
        imageUrl: productItem.imageUrl || '',
        quantity: Math.max(1, quantityDelta || 1),
        addedAt: Date.now()
      });
    }

    const nextState = {
      items,
      budgetLimit: state.budgetLimit,
      currency: state.currency,
      updatedAt: Date.now()
    };

    await storageSet({ [this.CART_KEY]: nextState });
    return this.enrichCartAnalytics(nextState);
  }

  static async setCartItemQuantity(cleanUrl, newQty) {
    const state = await this.getCartState();
    let items = [...state.items];

    if (newQty <= 0) {
      items = items.filter(i => i.cleanUrl !== cleanUrl);
    } else {
      items = items.map(i => i.cleanUrl === cleanUrl ? { ...i, quantity: newQty, updatedAt: Date.now() } : i);
    }

    const nextState = {
      items,
      budgetLimit: state.budgetLimit,
      currency: state.currency,
      updatedAt: Date.now()
    };
    await storageSet({ [this.CART_KEY]: nextState });
    return this.enrichCartAnalytics(nextState);
  }

  static async removeCartItem(cleanUrl) {
    return this.setCartItemQuantity(cleanUrl, 0);
  }

  static async clearCart() {
    const state = await this.getCartState();
    const nextState = {
      items: [],
      budgetLimit: state.budgetLimit,
      currency: state.currency,
      updatedAt: Date.now()
    };
    await storageSet({ [this.CART_KEY]: nextState });
    return this.enrichCartAnalytics(nextState);
  }

  static async setBudgetLimit(limitAmount) {
    const state = await this.getCartState();
    const cleanLimit = Math.max(0, Number(limitAmount) || 0);
    const nextState = {
      items: state.items,
      budgetLimit: cleanLimit,
      currency: state.currency,
      updatedAt: Date.now()
    };
    await storageSet({ [this.CART_KEY]: nextState });
    return this.enrichCartAnalytics(nextState);
  }

  static enrichCartAnalytics(cartState) {
    const items = cartState.items || [];
    let totalSpend = 0;
    let totalMrp = 0;
    let totalItemsCount = 0;
    let potentialCrossStoreSavings = 0;
    const storeMap = {};

    items.forEach(item => {
      const qty = Math.max(1, Number(item.quantity) || 1);
      const price = Math.max(0, Number(item.currentPrice) || 0);
      const mrp = Math.max(price, Number(item.originalPrice) || price);
      const lineTotal = price * qty;
      const lineMrp = mrp * qty;

      totalSpend += lineTotal;
      totalMrp += lineMrp;
      totalItemsCount += qty;

      if (item.bestAltPrice > 0 && item.bestAltPrice < price) {
        potentialCrossStoreSavings += (price - item.bestAltPrice) * qty;
      }

      const storeName = item.store || 'Store';
      if (!storeMap[storeName]) {
        storeMap[storeName] = { store: storeName, total: 0, count: 0 };
      }
      storeMap[storeName].total += lineTotal;
      storeMap[storeName].count += qty;
    });

    const storeBreakdown = Object.values(storeMap)
      .sort((a, b) => b.total - a.total)
      .map(s => ({
        ...s,
        sharePercent: totalSpend > 0 ? Math.round((s.total / totalSpend) * 100) : 0
      }));

    const limit = Number(cartState.budgetLimit) || 0;
    let budgetStatus = {
      limit,
      remaining: limit > 0 ? Math.max(0, limit - totalSpend) : 0,
      overBy: (limit > 0 && totalSpend > limit) ? (totalSpend - limit) : 0,
      percentUsed: limit > 0 ? Math.min(100, Math.round((totalSpend / limit) * 100)) : 0,
      rawPercent: limit > 0 ? Math.round((totalSpend / limit) * 100) : 0,
      state: 'unconfigured'
    };

    if (limit > 0) {
      if (totalSpend > limit) budgetStatus.state = 'over';
      else if (totalSpend >= limit * 0.85) budgetStatus.state = 'near';
      else budgetStatus.state = 'under';
    }

    return {
      ...cartState,
      analytics: {
        totalItemsCount,
        totalSpend,
        totalMrp,
        totalSavingsVsMrp: Math.max(0, totalMrp - totalSpend),
        potentialCrossStoreSavings,
        storeBreakdown,
        budgetStatus
      }
    };
  }

  static async recordLocalPriceObservation(cleanUrl, price, mrp = 0) {
    if (!cleanUrl || !price || price <= 0) return [];
    const today = new Date().toISOString().split('T')[0];
    const res = await storageGet([this.VAULT_KEY]);
    const vault = (res && res[this.VAULT_KEY]) ? { ...res[this.VAULT_KEY] } : {};
    const series = Array.isArray(vault[cleanUrl]) ? [...vault[cleanUrl]] : [];

    const existingTodayIdx = series.findIndex(pt => pt.date === today);
    if (existingTodayIdx >= 0) {
      series[existingTodayIdx].price = Number(price);
      if (mrp > 0) series[existingTodayIdx].mrp = Number(mrp);
    } else {
      series.push({
        date: today,
        formattedDate: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        price: Number(price),
        mrp: Number(mrp) || 0
      });
    }

    vault[cleanUrl] = series.slice(-120);
    const keys = Object.keys(vault);
    if (keys.length > 200) {
      delete vault[keys[0]];
    }

    await storageSet({ [this.VAULT_KEY]: vault });
    return vault[cleanUrl];
  }

  static async getLocalPriceObservations(cleanUrl) {
    if (!cleanUrl) return [];
    const res = await storageGet([this.VAULT_KEY]);
    const vault = (res && res[this.VAULT_KEY]) || {};
    return Array.isArray(vault[cleanUrl]) ? vault[cleanUrl] : [];
  }
}

// Export for extension contexts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DEFAULT_PROVIDERS, ProviderManager, WorkspaceManager };
}
