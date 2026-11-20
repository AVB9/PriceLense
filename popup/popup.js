/**
 * Popup Controller for PriceLens v3.1 (Apple macOS/iOS Architecture)
 * Features Multi-Source Consensus Analytics, Multi-Product Comparison Memory,
 * Cross-Platform Universal Budget Cart, and Variant-Aware Live Updates.
 */

const extAPI = typeof browser !== 'undefined' ? browser : chrome;

document.addEventListener('DOMContentLoaded', async () => {
  // Navigation & Control Elements
  const modeRedirectBtn = document.getElementById('modeRedirectBtn');
  const modeDashboardBtn = document.getElementById('modeDashboardBtn');
  const redirectView = document.getElementById('redirectView');
  const dashboardView = document.getElementById('dashboardView');
  const openOptionsBtn = document.getElementById('openOptionsBtn');

  // Auto-Redirect Banner Elements
  const autoRedirectBanner = document.getElementById('autoRedirectBanner');
  const countdownText = document.getElementById('countdownText');
  const cancelRedirectBtn = document.getElementById('cancelRedirectBtn');

  // Input & Product Summary Card Elements
  const urlInput = document.getElementById('urlInput');
  const refreshInsightsBtn = document.getElementById('refreshInsightsBtn');
  const copyUrlBtn = document.getElementById('copyUrlBtn');
  const clearUrlBtn = document.getElementById('clearUrlBtn');
  const productStoreBadge = document.getElementById('productStoreBadge');
  const productVariantPill = document.getElementById('productVariantPill');
  const livePricePill = document.getElementById('livePricePill');
  const productSummaryTitle = document.getElementById('productSummaryTitle');

  // Quick Action Buttons on Product Card
  const saveCompareBtn = document.getElementById('saveCompareBtn');
  const saveCompareBtnText = document.getElementById('saveCompareBtnText');
  const comparePromptBtn = document.getElementById('comparePromptBtn');
  const comparePromptBtnText = document.getElementById('comparePromptBtnText');
  const addToCartBtn = document.getElementById('addToCartBtn');
  const addToCartBtnText = document.getElementById('addToCartBtnText');

  // Redirect Mode Elements
  const redirectProviderSelect = document.getElementById('redirectProviderSelect');
  const mainRedirectBtn = document.getElementById('mainRedirectBtn');
  const heroProviderName = document.getElementById('heroProviderName');
  const quickChipsContainer = document.getElementById('quickChipsContainer');
  const autoRedirectCheckbox = document.getElementById('autoRedirectCheckbox');

  // Dashboard Mode Elements
  const bgSyncBadge = document.getElementById('bgSyncBadge');
  const bgSyncText = document.getElementById('bgSyncText');
  const currentPriceEl = document.getElementById('currentPrice');
  const lowestPriceEl = document.getElementById('lowestPrice');
  const highestPriceEl = document.getElementById('highestPrice');
  const averagePriceEl = document.getElementById('averagePrice');
  const dealBanner = document.getElementById('dealBanner');
  const dealBadge = document.getElementById('dealBadge');
  const dealDesc = document.getElementById('dealDesc');
  const sourcesPillsContainer = document.getElementById('sourcesPillsContainer');
  const chartContainer = document.getElementById('chartContainer');
  const keepaChartDropdown = document.getElementById('keepaChartDropdown');
  const keepaChartImg = document.getElementById('keepaChartImg');
  const cheaperList = document.getElementById('cheaperList');
  const cheaperCount = document.getElementById('cheaperCount');
  const openProviderLink = document.getElementById('openProviderLink');
  const providerButtonLabel = document.getElementById('providerButtonLabel');

  // Compare Tab Elements
  const compareCount = document.getElementById('compareCount');
  const compareSummaryLabel = document.getElementById('compareSummaryLabel');
  const clearCompareBtn = document.getElementById('clearCompareBtn');
  const compareMatrixContainer = document.getElementById('compareMatrixContainer');

  // Cart Tab Elements
  const cartCount = document.getElementById('cartCount');
  const cartTotalSpend = document.getElementById('cartTotalSpend');
  const cartTotalSavingsPill = document.getElementById('cartTotalSavingsPill');
  const budgetLimitInput = document.getElementById('budgetLimitInput');
  const budgetProgressBar = document.getElementById('budgetProgressBar');
  const budgetStatusText = document.getElementById('budgetStatusText');
  const budgetPercentText = document.getElementById('budgetPercentText');
  const cartStoreBreakdown = document.getElementById('cartStoreBreakdown');
  const cartItemsList = document.getElementById('cartItemsList');
  const cartFooterActions = document.getElementById('cartFooterActions');
  const openAllCartTabsBtn = document.getElementById('openAllCartTabsBtn');
  const clearCartBtn = document.getElementById('clearCartBtn');

  let currentTabInfo = null;
  let latestInsightsData = null;
  let allProviders = [];
  let currentDisplayMode = 'dashboard';
  let autoRedirectTimer = null;
  let compareListState = [];
  let cartState = null;
  let lastProcessedVariantSig = '';
  let isDeepSyncRunning = false;

  // 1. Load Settings & Providers
  const settings = await ProviderManager.getSettings();
  allProviders = await ProviderManager.getAllProviders();
  const activeProvider = await ProviderManager.getActiveProvider();

  currentDisplayMode = settings.displayMode || 'dashboard';
  if (autoRedirectCheckbox) {
    autoRedirectCheckbox.checked = !!settings.autoRedirectInstant;
  }

  // 2. Load Active Tab Info (with direct tabs.query + content-script fallback so popup never hangs)
  try {
    currentTabInfo = await sendMessageAsync({ action: 'GET_CURRENT_TAB_INFO' }, 800);
  } catch (err) {
    console.warn('Could not query current tab via background:', err);
  }

  if (!currentTabInfo || !currentTabInfo.cleanUrl) {
    try {
      const tabs = await queryActiveTabsSafe();
      if (tabs && tabs.length > 0 && tabs[0].url) {
        const rawUrl = tabs[0].url;
        const cleanUrl = URLCleaner.getCanonicalUrl(rawUrl);
        const store = URLCleaner.detectStore(rawUrl);
        let directLive = null;
        if (tabs[0].id && store.badge !== 'generic') {
          directLive = await queryTabLiveDetailsSafe(tabs[0].id, 450);
        }
        currentTabInfo = {
          tabId: tabs[0].id,
          rawUrl,
          cleanUrl: (directLive && directLive.cleanUrl) || cleanUrl,
          title: (directLive && directLive.title) || tabs[0].title || 'Product Page',
          store,
          isShoppingSite: store.badge !== 'generic',
          liveData: directLive
        };
      }
    } catch (_) {}
  }

  const detectedUrl = (currentTabInfo && currentTabInfo.cleanUrl) || '';
  const liveData = (currentTabInfo && currentTabInfo.liveData) || null;
  if (liveData) {
    lastProcessedVariantSig = `${liveData.cleanUrl || detectedUrl}|${liveData.variantId || ''}|${liveData.variantLabel || ''}|${liveData.currentPrice || 0}|${liveData.originalPrice || 0}`;
  }

  // 3. Load Workspace Memory (Compare Queue + Universal Budget Cart)
  await refreshWorkspaceMemory();

  // 4. Handle Optional Instant Auto-Redirect with 600ms Cancellable Guard
  if (settings.autoRedirectInstant && detectedUrl && currentTabInfo.isShoppingSite) {
    autoRedirectBanner.classList.remove('hidden');
    let timeLeft = 600;
    const intervalStep = 100;

    const intervalTimer = setInterval(() => {
      timeLeft -= intervalStep;
      if (timeLeft > 0 && countdownText) {
        countdownText.textContent = `${timeLeft}ms`;
      }
    }, intervalStep);

    autoRedirectTimer = setTimeout(() => {
      clearInterval(intervalTimer);
      const targetUrl = ProviderManager.buildTargetUrl(activeProvider, detectedUrl);
      extAPI.tabs.create({ url: targetUrl });
      window.close();
    }, 600);

    cancelRedirectBtn.addEventListener('click', async () => {
      clearTimeout(autoRedirectTimer);
      clearInterval(intervalTimer);
      autoRedirectBanner.classList.add('hidden');
      settings.autoRedirectInstant = false;
      if (autoRedirectCheckbox) autoRedirectCheckbox.checked = false;
      await ProviderManager.saveSettings({ autoRedirectInstant: false });
    });
  }

  // 5. Populate Product Header Card
  if (detectedUrl) {
    urlInput.value = detectedUrl;
    const displayTitle = (liveData && liveData.title) || currentTabInfo.title || 'Product Overview';
    productSummaryTitle.textContent = displayTitle;
    productStoreBadge.textContent = (currentTabInfo.store && currentTabInfo.store.name) || 'Store';

    if (liveData && liveData.variantLabel) {
      productVariantPill.textContent = liveData.variantLabel;
      productVariantPill.classList.remove('hidden');
    } else {
      productVariantPill.classList.add('hidden');
    }

    if (liveData && liveData.currentPrice > 0) {
      livePricePill.textContent = `Live: ₹${Number(liveData.currentPrice).toLocaleString('en-IN')}`;
    } else {
      livePricePill.textContent = 'Active Item';
    }
  } else {
    productSummaryTitle.textContent = 'Paste a product link above or inspect saved items below';
    livePricePill.textContent = 'Ready';
  }

  updateProductCardActionButtons();

  // 6. Lazy-load Keepa dropdown image on user toggle
  if (keepaChartDropdown) {
    keepaChartDropdown.addEventListener('toggle', () => {
      if (keepaChartDropdown.open && keepaChartImg.dataset.src && !keepaChartImg.src) {
        keepaChartImg.src = keepaChartImg.dataset.src;
      }
    });

    keepaChartImg.onerror = () => {
      keepaChartDropdown.classList.add('hidden');
    };
  }

  setupProvidersUI(allProviders, activeProvider);
  switchMode(currentDisplayMode);

  // ==========================================
  // EVENT LISTENERS
  // ==========================================

  modeRedirectBtn.addEventListener('click', () => switchMode('redirect'));
  modeDashboardBtn.addEventListener('click', () => switchMode('dashboard'));

  mainRedirectBtn.addEventListener('click', () => {
    const url = getTargetProductUrl();
    const selectedProviderId = redirectProviderSelect.value;
    const provider = allProviders.find(p => p.id === selectedProviderId) || activeProvider;
    const destination = ProviderManager.buildTargetUrl(provider, url);
    extAPI.tabs.create({ url: destination });
  });

  redirectProviderSelect.addEventListener('change', async () => {
    const selectedId = redirectProviderSelect.value;
    await ProviderManager.setActiveProvider(selectedId);
    const provider = allProviders.find(p => p.id === selectedId);
    if (provider) {
      heroProviderName.textContent = provider.shortName || provider.name;
    }
    if (currentDisplayMode === 'dashboard') {
      loadDashboardInsights(false);
    }
  });

  if (autoRedirectCheckbox) {
    autoRedirectCheckbox.addEventListener('change', async () => {
      await ProviderManager.saveSettings({ autoRedirectInstant: autoRedirectCheckbox.checked });
    });
  }

  refreshInsightsBtn.addEventListener('click', () => {
    loadDashboardInsights(true);
  });

  copyUrlBtn.addEventListener('click', () => {
    const url = getTargetProductUrl();
    if (url) {
      navigator.clipboard.writeText(url).then(() => {
        copyUrlBtn.style.color = '#30D158';
        setTimeout(() => copyUrlBtn.style.color = '', 1200);
      });
    }
  });

  clearUrlBtn.addEventListener('click', () => {
    urlInput.value = '';
    urlInput.focus();
    productSummaryTitle.textContent = 'Paste any product link above';
    livePricePill.textContent = 'Ready';
  });

  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const url = urlInput.value.trim();
      if (url) {
        if (currentDisplayMode === 'dashboard') {
          loadDashboardInsights(true);
        } else {
          mainRedirectBtn.click();
        }
      }
    }
  });

  openOptionsBtn.addEventListener('click', () => {
    if (extAPI.runtime.openOptionsPage) {
      extAPI.runtime.openOptionsPage();
    } else {
      window.open(extAPI.runtime.getURL('options/options.html'));
    }
  });

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activateTab(btn.getAttribute('data-tab'));
    });
  });

  // Save/Toggle Compare Button
  saveCompareBtn.addEventListener('click', async () => {
    const payload = buildActiveProductPayload();
    if (!payload.cleanUrl) return;
    const res = await sendMessageAsync({ action: 'TOGGLE_COMPARE_ITEM', item: payload });
    if (res && Array.isArray(res.list)) {
      compareListState = res.list;
      renderCompareMatrix();
      updateProductCardActionButtons();
    }
  });

  // Contextual "Compare Now (N)" Button -> Jumps directly to Compare Matrix Tab
  comparePromptBtn.addEventListener('click', async () => {
    const payload = buildActiveProductPayload();
    if (payload.cleanUrl && !compareListState.some(i => i.cleanUrl === payload.cleanUrl)) {
      const res = await sendMessageAsync({ action: 'UPSERT_COMPARE_ITEM', item: payload });
      if (res && Array.isArray(res.list)) {
        compareListState = res.list;
      }
    }
    if (currentDisplayMode !== 'dashboard') {
      switchMode('dashboard');
    }
    renderCompareMatrix();
    updateProductCardActionButtons();
    activateTab('compare');
  });

  // Add to Universal Cart Button
  addToCartBtn.addEventListener('click', async () => {
    const payload = buildActiveProductPayload();
    if (!payload.cleanUrl) return;
    const res = await sendMessageAsync({ action: 'ADD_TO_CART', item: payload, quantityDelta: 1 });
    if (res && res.cart) {
      cartState = res.cart;
      renderCartView();
      updateProductCardActionButtons();
    }
  });

  // Clear Compare Memory
  clearCompareBtn.addEventListener('click', async () => {
    const res = await sendMessageAsync({ action: 'CLEAR_COMPARE' });
    compareListState = (res && res.list) || [];
    renderCompareMatrix();
    updateProductCardActionButtons();
  });

  // Budget Limit Change
  let budgetTimer = null;
  budgetLimitInput.addEventListener('input', () => {
    if (budgetTimer) clearTimeout(budgetTimer);
    budgetTimer = setTimeout(async () => {
      const val = parseFloat(budgetLimitInput.value) || 0;
      const res = await sendMessageAsync({ action: 'SET_BUDGET_LIMIT', budgetLimit: val });
      if (res && res.cart) {
        cartState = res.cart;
        renderCartView(false);
      }
    }, 300);
  });

  // Open All Cart Store Pages
  openAllCartTabsBtn.addEventListener('click', () => {
    if (!cartState || !Array.isArray(cartState.items)) return;
    cartState.items.forEach(item => {
      if (item.url || item.cleanUrl) {
        extAPI.tabs.create({ url: item.url || item.cleanUrl, active: false });
      }
    });
  });

  // Clear Universal Cart
  clearCartBtn.addEventListener('click', async () => {
    const res = await sendMessageAsync({ action: 'CLEAR_CART' });
    if (res && res.cart) {
      cartState = res.cart;
      renderCartView();
      updateProductCardActionButtons();
    }
  });

  // ==========================================
  // CORE FUNCTIONS
  // ==========================================

  function activateTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-tab') === tabName);
    });
    document.querySelectorAll('.tab-content').forEach(c => {
      c.classList.toggle('active', c.id === `${tabName}Tab`);
    });
  }

  function getTargetProductUrl() {
    return urlInput.value.trim() || detectedUrl || '';
  }

  function buildActiveProductPayload() {
    const cleanUrl = URLCleaner.getCanonicalUrl(getTargetProductUrl(), liveData?.variantId);
    const storeObj = URLCleaner.detectStore(cleanUrl);
    const insights = latestInsightsData?.insights || null;
    const bestAlt = (insights?.cheaperOptions || [])[0] || null;

    const currentPrice = (insights && insights.currentPrice > 0)
      ? insights.currentPrice
      : (liveData?.currentPrice || 0);

    const originalPrice = (liveData && liveData.originalPrice > 0)
      ? liveData.originalPrice
      : (insights?.highestPrice || currentPrice);

    return {
      cleanUrl,
      url: (currentTabInfo && currentTabInfo.rawUrl) || cleanUrl,
      title: (insights && insights.title) || (liveData && liveData.title) || currentTabInfo?.title || 'Product',
      store: storeObj.name,
      storeBadge: storeObj.badge,
      variantLabel: (liveData && liveData.variantLabel) || '',
      currentPrice,
      originalPrice,
      lowestPrice: (insights && insights.lowestPrice) || currentPrice,
      highestPrice: (insights && insights.highestPrice) || originalPrice,
      averagePrice: (insights && insights.averagePrice) || currentPrice,
      dealBadge: (insights && insights.dealRating?.badge) || 'Tracked',
      dealType: (insights && insights.dealRating?.type) || 'neutral',
      dealScore: (insights && insights.dealRating?.score) || 70,
      rating: (liveData && liveData.rating) || '',
      imageUrl: (liveData && liveData.imageUrl) || '',
      bestAltStore: bestAlt ? bestAlt.store : '',
      bestAltPrice: bestAlt ? bestAlt.price : 0,
      bestAltUrl: bestAlt ? bestAlt.link : ''
    };
  }

  async function refreshWorkspaceMemory() {
    try {
      let ws = await sendMessageAsync({ action: 'GET_WORKSPACE_STATE' }, 500);
      if (!ws && typeof WorkspaceManager !== 'undefined') {
        const [compareList, cart] = await Promise.all([
          WorkspaceManager.getCompareList(),
          WorkspaceManager.getCartState()
        ]);
        ws = { compareList, cart };
      }
      if (ws) {
        compareListState = Array.isArray(ws.compareList) ? ws.compareList : [];
        cartState = ws.cart || null;
        renderCompareMatrix();
        renderCartView();
        updateProductCardActionButtons();
      }
    } catch (e) {
      console.warn('Workspace state load error:', e);
    }
  }

  function updateProductCardActionButtons() {
    const activeCleanUrl = URLCleaner.getCanonicalUrl(getTargetProductUrl(), liveData?.variantId);
    const inCompare = activeCleanUrl && compareListState.some(i => i.cleanUrl === activeCleanUrl);
    const otherSavedItems = compareListState.filter(i => i.cleanUrl !== activeCleanUrl);

    if (inCompare) {
      saveCompareBtnText.textContent = `Saved (${compareListState.length})`;
      saveCompareBtn.classList.add('active');
    } else {
      saveCompareBtnText.textContent = '+ Compare';
      saveCompareBtn.classList.remove('active');
    }

    // Show contextual "Compare with N saved" prompt whenever user is on a product page and has saved products in memory
    if (activeCleanUrl && otherSavedItems.length > 0) {
      comparePromptBtn.classList.remove('hidden');
      comparePromptBtnText.textContent = `Compare (${otherSavedItems.length + 1})`;
    } else if (compareListState.length >= 2) {
      comparePromptBtn.classList.remove('hidden');
      comparePromptBtnText.textContent = `Compare (${compareListState.length})`;
    } else {
      comparePromptBtn.classList.add('hidden');
    }

    // Cart Button State
    const cartItem = activeCleanUrl && cartState?.items?.find(i => i.cleanUrl === activeCleanUrl);
    if (cartItem) {
      addToCartBtnText.textContent = `In Cart (${cartItem.quantity})`;
      addToCartBtn.classList.add('active-green');
    } else {
      addToCartBtnText.textContent = '+ Add to Cart';
      addToCartBtn.classList.remove('active-green');
    }
  }

  function switchMode(mode) {
    currentDisplayMode = mode;
    ProviderManager.saveSettings({ displayMode: mode });

    if (mode === 'redirect') {
      modeRedirectBtn.classList.add('active');
      modeDashboardBtn.classList.remove('active');
      redirectView.classList.remove('hidden');
      dashboardView.classList.add('hidden');
    } else {
      modeDashboardBtn.classList.add('active');
      modeRedirectBtn.classList.remove('active');
      redirectView.classList.add('hidden');
      dashboardView.classList.remove('hidden');
      loadDashboardInsights(false);
    }
  }

  function setupProvidersUI(providers, active) {
    redirectProviderSelect.innerHTML = '';
    quickChipsContainer.innerHTML = '';

    providers.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      if (p.id === active.id) opt.selected = true;
      redirectProviderSelect.appendChild(opt);

      const chip = document.createElement('button');
      chip.className = 'quick-chip';
      chip.textContent = p.shortName || p.name.split(' ')[0];
      chip.title = `Directly open ${p.name}`;
      chip.addEventListener('click', () => {
        const url = getTargetProductUrl() || 'https://buyhatke.com';
        const dest = ProviderManager.buildTargetUrl(p, url);
        extAPI.tabs.create({ url: dest });
      });
      quickChipsContainer.appendChild(chip);
    });

    heroProviderName.textContent = active.shortName || active.name;
  }

  function setBackgroundSyncState(active, label = 'Syncing trackers...') {
    if (bgSyncBadge) {
      bgSyncBadge.classList.toggle('hidden', !active);
    }
    if (bgSyncText && label) {
      bgSyncText.textContent = label;
    }
    if (refreshInsightsBtn) {
      refreshInsightsBtn.classList.toggle('icon-spinning', active);
    }
  }

  /**
   * Two-Phase Zero-Flash Pipeline:
   * Phase 1 (<15ms): Renders instant Live DOM + Local Vault / Cached data with zero layout shift.
   * Phase 2 (Background): Quietly runs deep multi-source tracker hydration and updates metrics in-place.
   */
  async function loadDashboardInsights(forceRefresh = false) {
    const url = getTargetProductUrl();
    if (!url) {
      if (compareListState.length > 0) activateTab('compare');
      else if (cartState && cartState.items && cartState.items.length > 0) activateTab('cart');
      return;
    }

    const activeLiveData = (currentTabInfo && currentTabInfo.liveData) || null;

    // Phase 1: Instant Baseline Render (<15ms) with direct local fallback
    if (!forceRefresh) {
      try {
        let baseline = await sendMessageAsync({
          action: 'GET_INSTANT_BASELINE',
          url,
          providerId: redirectProviderSelect.value,
          liveData: activeLiveData
        }, 500);

        if ((!baseline || !baseline.insights) && typeof Parsers !== 'undefined') {
          const cleanUrl = URLCleaner.getCanonicalUrl(url, activeLiveData?.variantId);
          const selectedProv = allProviders.find(p => p.id === redirectProviderSelect.value) || activeProvider;
          const targetLookupUrl = ProviderManager.buildTargetUrl(selectedProv, cleanUrl);
          const localVaultPoints = (typeof WorkspaceManager !== 'undefined')
            ? await WorkspaceManager.getLocalPriceObservations(cleanUrl)
            : [];
          baseline = {
            success: true,
            provider: selectedProv.shortName || selectedProv.name,
            providerId: selectedProv.id,
            targetLookupUrl,
            cleanUrl,
            storeInfo: URLCleaner.detectStore(cleanUrl),
            isEstimatedHistory: true,
            needsBackgroundSync: true,
            insights: Parsers.mergeMultiSourceInsights({
              providerResults: [],
              crossStoreOptions: [],
              liveData: activeLiveData,
              localVaultPoints,
              primaryProviderName: selectedProv.shortName || selectedProv.name,
              targetLookupUrl
            })
          };
        }

        if (baseline && baseline.insights) {
          latestInsightsData = baseline;
          renderDashboard(baseline);
          if (!baseline.needsBackgroundSync) {
            setBackgroundSyncState(false);
            return;
          }
        }
      } catch (e) {}
    }

    // Phase 2: Non-blocking Background Deep Sync (zero layout shift)
    if (isDeepSyncRunning && !forceRefresh) return;
    isDeepSyncRunning = true;
    setBackgroundSyncState(true, forceRefresh ? 'Re-syncing sources...' : 'Syncing trackers...');

    try {
      const response = await sendMessageAsync({
        action: 'FETCH_PRICE_INSIGHTS',
        url,
        providerId: redirectProviderSelect.value,
        liveData: activeLiveData,
        forceRefresh
      }, 9500);

      if (response && response.insights) {
        latestInsightsData = response;
        renderDashboard(response);
        await refreshWorkspaceMemory();
      }
    } catch (err) {
      console.warn('Dashboard background sync issue:', err);
    } finally {
      isDeepSyncRunning = false;
      setBackgroundSyncState(false);
    }
  }

  function renderDashboard(data) {
    const insights = data.insights;
    const cur = insights.currency || '₹';

    if (insights.title && insights.title !== 'Product Price Details') {
      productSummaryTitle.textContent = insights.title;
    }
    if (insights.currentPrice > 0) {
      livePricePill.textContent = `Live: ${cur}${Number(insights.currentPrice).toLocaleString('en-IN')}`;
    }

    currentPriceEl.textContent = `${cur}${Number(insights.currentPrice || 0).toLocaleString('en-IN')}`;
    lowestPriceEl.textContent = `${cur}${Number(insights.lowestPrice || 0).toLocaleString('en-IN')}`;
    highestPriceEl.textContent = `${cur}${Number(insights.highestPrice || 0).toLocaleString('en-IN')}`;
    averagePriceEl.textContent = `${cur}${Number(insights.averagePrice || 0).toLocaleString('en-IN')}`;

    const deal = insights.dealRating || { badge: 'Tracked', summary: 'Price tracked', type: 'neutral' };
    dealBadge.textContent = deal.badge;
    dealDesc.textContent = deal.summary;

    dealBanner.className = 'deal-banner';
    if (deal.type === 'excellent') dealBanner.classList.add('deal-excellent');
    else if (deal.type === 'good') dealBanner.classList.add('deal-good');
    else if (deal.type === 'warning') dealBanner.classList.add('deal-warning');
    else dealBanner.classList.add('deal-fair');

    // Render Multi-Source Attribution Micro-Pills
    sourcesPillsContainer.innerHTML = '';
    const sources = Array.isArray(insights.sourcesUsed) ? insights.sourcesUsed : [];
    sources.forEach(src => {
      const pill = document.createElement('span');
      pill.className = `source-micro-pill ${src.verified ? 'verified' : ''}`;
      pill.textContent = src.name;
      sourcesPillsContainer.appendChild(pill);
    });

    // Keepa Collapsible Dropdown
    if (data.keepaChartUrl && data.storeInfo && data.storeInfo.badge === 'amazon') {
      keepaChartDropdown.classList.remove('hidden');
      keepaChartDropdown.open = false;
      keepaChartImg.src = '';
      keepaChartImg.dataset.src = data.keepaChartUrl;
    } else {
      keepaChartDropdown.classList.add('hidden');
    }

    // Render Price History Chart with Source Provenance Label
    if (insights.historyPoints && insights.historyPoints.length > 0) {
      PriceChart.render(chartContainer, insights.historyPoints, {
        currency: cur,
        height: 150,
        isEstimated: !!insights.isEstimatedHistory,
        sourceLabel: insights.historySourceLabel
      });
    }

    renderCheaperOptions(insights.cheaperOptions, cur, data.targetLookupUrl);

    providerButtonLabel.textContent = data.provider || 'Buyhatke';
    openProviderLink.href = data.targetLookupUrl || 'https://buyhatke.com';
    openProviderLink.onclick = (e) => {
      e.preventDefault();
      extAPI.tabs.create({ url: data.targetLookupUrl });
    };
  }

  function renderCheaperOptions(options, currency, fallbackUrl) {
    cheaperList.innerHTML = '';
    const items = options || [];
    cheaperCount.textContent = items.length;

    if (items.length === 0) {
      cheaperList.innerHTML = `
        <div class="empty-tab-box">
          Current page offers the lowest verified price across tracked retailers.
        </div>
      `;
      return;
    }

    items.forEach(item => {
      const card = document.createElement('div');
      card.className = 'store-card';
      card.innerHTML = `
        <div class="store-info">
          <span class="store-name-text">${escapeHtml(item.store)}</span>
          <span class="store-savings">${item.savings > 0 ? `Save ${currency}${Number(item.savings).toLocaleString('en-IN')} vs current` : 'Verified Store Listing'}</span>
        </div>
        <div class="store-action">
          <span class="store-price-text">${currency}${Number(item.price).toLocaleString('en-IN')}</span>
          <a href="${item.link || fallbackUrl}" target="_blank" class="btn btn-sm">View</a>
        </div>
      `;
      card.querySelector('a').onclick = (e) => {
        e.preventDefault();
        extAPI.tabs.create({ url: item.link || fallbackUrl });
      };
      cheaperList.appendChild(card);
    });
  }

  // =========================================================
  // RENDER TAB 3: MULTI-PRODUCT COMPARISON MATRIX
  // =========================================================
  function renderCompareMatrix() {
    compareMatrixContainer.innerHTML = '';
    const activePayload = buildActiveProductPayload();

    // Combine saved items + active tab product (if not already saved and has a valid price)
    const combined = [...compareListState];
    if (activePayload.cleanUrl && activePayload.currentPrice > 0 && !combined.some(i => i.cleanUrl === activePayload.cleanUrl)) {
      combined.unshift({ ...activePayload, isTransientActive: true });
    }

    compareCount.textContent = compareListState.length;

    if (combined.length === 0) {
      compareSummaryLabel.textContent = 'Multi-Product Compare Memory';
      compareMatrixContainer.innerHTML = `
        <div class="empty-tab-box">
          Click <strong>Save to Compare</strong> on any product page. When you visit another product on Amazon, Flipkart, Croma, or Myntra, compare them side-by-side here.
        </div>
      `;
      return;
    }

    const pricedItems = combined.filter(i => i.currentPrice > 0);
    const minPrice = pricedItems.length > 0 ? Math.min(...pricedItems.map(i => i.currentPrice)) : 0;
    compareSummaryLabel.textContent = `Comparing ${combined.length} Product${combined.length > 1 ? 's' : ''}`;

    combined.forEach(item => {
      const isWinner = combined.length > 1 && item.currentPrice > 0 && item.currentPrice === minPrice;
      const isCurrentTab = activePayload.cleanUrl && item.cleanUrl === activePayload.cleanUrl;
      const priceDelta = (minPrice > 0 && item.currentPrice > minPrice)
        ? `+₹${Math.round(item.currentPrice - minPrice).toLocaleString('en-IN')} (+${Math.round(((item.currentPrice - minPrice) / minPrice) * 100)}%) vs lowest`
        : 'Lowest Price Option';

      const discountPct = (item.highestPrice > item.currentPrice && item.highestPrice > 0)
        ? Math.round(((item.highestPrice - item.currentPrice) / item.highestPrice) * 100)
        : 0;

      const card = document.createElement('div');
      card.className = `compare-item-card ${isWinner ? 'winner-card' : ''}`;
      card.innerHTML = `
        <div class="compare-card-header">
          <div class="compare-badges">
            <span class="store-badge">${escapeHtml(item.store || 'Store')}</span>
            ${isWinner ? '<span class="winner-pill">Best Price</span>' : ''}
            ${isCurrentTab ? '<span class="active-tab-pill">Active Tab</span>' : ''}
          </div>
          <span class="compare-delta-text ${item.currentPrice === minPrice ? 'cheapest' : ''}">${priceDelta}</span>
        </div>
        <div class="compare-title-row" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
        <div class="compare-stats-row">
          <div class="compare-stat-cell">
            <span class="compare-stat-lbl">Current</span>
            <span class="compare-stat-val">₹${Number(item.currentPrice || 0).toLocaleString('en-IN')}</span>
          </div>
          <div class="compare-stat-cell">
            <span class="compare-stat-lbl">All-Time Low</span>
            <span class="compare-stat-val text-green">₹${Number(item.lowestPrice || item.currentPrice || 0).toLocaleString('en-IN')}</span>
          </div>
          <div class="compare-stat-cell">
            <span class="compare-stat-lbl">Avg Price</span>
            <span class="compare-stat-val text-blue">₹${Number(item.averagePrice || item.currentPrice || 0).toLocaleString('en-IN')}</span>
          </div>
          <div class="compare-stat-cell">
            <span class="compare-stat-lbl">Off MRP</span>
            <span class="compare-stat-val">${discountPct > 0 ? `${discountPct}%` : '--'}</span>
          </div>
        </div>
        <div class="compare-card-footer">
          <span class="compare-delta-text">${escapeHtml(item.dealBadge || 'Tracked')}</span>
          <div class="compare-actions-group">
            ${item.isTransientActive
              ? `<button class="mini-btn primary btn-pin-compare">Pin to Memory</button>`
              : `<button class="mini-btn btn-open-item">Open</button>`
            }
            <button class="mini-btn btn-cart-from-compare">+ Cart</button>
            ${!item.isTransientActive ? `<button class="mini-btn danger btn-remove-compare" title="Remove">×</button>` : ''}
          </div>
        </div>
      `;

      const pinBtn = card.querySelector('.btn-pin-compare');
      if (pinBtn) {
        pinBtn.addEventListener('click', async () => {
          const res = await sendMessageAsync({ action: 'UPSERT_COMPARE_ITEM', item });
          if (res && res.list) {
            compareListState = res.list;
            renderCompareMatrix();
            updateProductCardActionButtons();
          }
        });
      }

      const openBtn = card.querySelector('.btn-open-item');
      if (openBtn) {
        openBtn.addEventListener('click', () => {
          extAPI.tabs.create({ url: item.url || item.cleanUrl });
        });
      }

      const toCartBtn = card.querySelector('.btn-cart-from-compare');
      if (toCartBtn) {
        toCartBtn.addEventListener('click', async () => {
          const res = await sendMessageAsync({ action: 'ADD_TO_CART', item, quantityDelta: 1 });
          if (res && res.cart) {
            cartState = res.cart;
            renderCartView();
            updateProductCardActionButtons();
            toCartBtn.textContent = 'Added';
          }
        });
      }

      const rmBtn = card.querySelector('.btn-remove-compare');
      if (rmBtn) {
        rmBtn.addEventListener('click', async () => {
          const res = await sendMessageAsync({ action: 'REMOVE_COMPARE_ITEM', cleanUrl: item.cleanUrl });
          if (res && res.list) {
            compareListState = res.list;
            renderCompareMatrix();
            updateProductCardActionButtons();
          }
        });
      }

      compareMatrixContainer.appendChild(card);
    });
  }

  // =========================================================
  // RENDER TAB 4: UNIVERSAL CROSS-PLATFORM BUDGET CART
  // =========================================================
  function renderCartView(updateInput = true) {
    if (!cartState || !cartState.analytics) return;
    const { items, budgetLimit, analytics } = cartState;

    cartCount.textContent = analytics.totalItemsCount || 0;
    cartTotalSpend.textContent = `₹${Number(analytics.totalSpend || 0).toLocaleString('en-IN')}`;

    if (updateInput && document.activeElement !== budgetLimitInput) {
      budgetLimitInput.value = budgetLimit > 0 ? budgetLimit : '';
    }

    if (analytics.totalSavingsVsMrp > 0) {
      cartTotalSavingsPill.textContent = `Save ₹${Number(analytics.totalSavingsVsMrp).toLocaleString('en-IN')} vs MRP`;
      cartTotalSavingsPill.classList.remove('hidden');
    } else {
      cartTotalSavingsPill.classList.add('hidden');
    }

    const bStatus = analytics.budgetStatus;
    budgetProgressBar.style.width = `${bStatus.percentUsed}%`;
    budgetProgressBar.className = 'budget-progress-fill';
    budgetStatusText.className = 'budget-status-text';

    if (bStatus.state === 'over') {
      budgetProgressBar.classList.add('over');
      budgetStatusText.classList.add('over');
      budgetStatusText.textContent = `Over budget by ₹${Number(bStatus.overBy).toLocaleString('en-IN')}`;
      budgetPercentText.textContent = `${bStatus.rawPercent}%`;
    } else if (bStatus.state === 'near') {
      budgetProgressBar.classList.add('near');
      budgetStatusText.textContent = `₹${Number(bStatus.remaining).toLocaleString('en-IN')} remaining before limit`;
      budgetPercentText.textContent = `${bStatus.rawPercent}%`;
    } else if (bStatus.state === 'under') {
      budgetStatusText.classList.add('under');
      budgetStatusText.textContent = `Within budget · ₹${Number(bStatus.remaining).toLocaleString('en-IN')} remaining`;
      budgetPercentText.textContent = `${bStatus.rawPercent}%`;
    } else {
      budgetStatusText.textContent = 'Enter a budget limit above to track spend';
      budgetPercentText.textContent = '--';
    }

    // Store Breakdown Chips
    cartStoreBreakdown.innerHTML = '';
    if (Array.isArray(analytics.storeBreakdown) && analytics.storeBreakdown.length > 0) {
      analytics.storeBreakdown.forEach(st => {
        const chip = document.createElement('span');
        chip.className = 'store-split-chip';
        chip.innerHTML = `${escapeHtml(st.store)}: <strong>₹${Number(st.total).toLocaleString('en-IN')}</strong> (${st.count})`;
        cartStoreBreakdown.appendChild(chip);
      });
    }

    // Cart Items List
    cartItemsList.innerHTML = '';
    if (!items || items.length === 0) {
      cartFooterActions.classList.add('hidden');
      cartItemsList.innerHTML = `
        <div class="empty-tab-box">
          Your cross-platform budget cart is empty. Click <strong>Add to Cart</strong> on any Amazon, Flipkart, Myntra, or Croma product to track your total spend.
        </div>
      `;
      return;
    }

    cartFooterActions.classList.remove('hidden');

    items.forEach(item => {
      const qty = Math.max(1, Number(item.quantity) || 1);
      const lineTotal = (Number(item.currentPrice) || 0) * qty;

      const card = document.createElement('div');
      card.className = 'cart-item-card';
      card.innerHTML = `
        <div class="cart-item-top">
          <span class="store-badge">${escapeHtml(item.store || 'Store')}</span>
          <span class="cart-item-title" title="Open ${escapeHtml(item.title)}">${escapeHtml(item.title)}</span>
          <button class="mini-btn danger btn-rm-cart" title="Remove item">×</button>
        </div>
        <div class="cart-item-bottom">
          <div class="qty-stepper">
            <button class="qty-btn btn-qty-minus">−</button>
            <span class="qty-val">${qty}</span>
            <button class="qty-btn btn-qty-plus">+</button>
          </div>
          <div class="cart-item-price-group">
            ${qty > 1 ? `<span class="compare-delta-text">₹${Number(item.currentPrice).toLocaleString('en-IN')} ea</span>` : ''}
            <span class="cart-line-price">₹${Number(lineTotal).toLocaleString('en-IN')}</span>
          </div>
        </div>
      `;

      card.querySelector('.cart-item-title').addEventListener('click', () => {
        extAPI.tabs.create({ url: item.url || item.cleanUrl });
      });

      card.querySelector('.btn-qty-minus').addEventListener('click', async () => {
        const res = await sendMessageAsync({ action: 'SET_CART_ITEM_QTY', cleanUrl: item.cleanUrl, quantity: qty - 1 });
        if (res && res.cart) {
          cartState = res.cart;
          renderCartView();
          updateProductCardActionButtons();
        }
      });

      card.querySelector('.btn-qty-plus').addEventListener('click', async () => {
        const res = await sendMessageAsync({ action: 'SET_CART_ITEM_QTY', cleanUrl: item.cleanUrl, quantity: qty + 1 });
        if (res && res.cart) {
          cartState = res.cart;
          renderCartView();
          updateProductCardActionButtons();
        }
      });

      card.querySelector('.btn-rm-cart').addEventListener('click', async () => {
        const res = await sendMessageAsync({ action: 'REMOVE_CART_ITEM', cleanUrl: item.cleanUrl });
        if (res && res.cart) {
          cartState = res.cart;
          renderCartView();
          updateProductCardActionButtons();
        }
      });

      cartItemsList.appendChild(card);
    });
  }

  // Listen for real-time live variant updates from content script (strictly deduplicated by signature)
  extAPI.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!request) return;
    const action = request.action || request.type;

    if (action === 'LIVE_VARIANT_UPDATED') {
      const details = request.details || request.pageDetails;
      if (details) {
        const sig = `${details.cleanUrl || ''}|${details.variantId || ''}|${details.variantLabel || ''}|${details.currentPrice || 0}|${details.originalPrice || 0}`;
        if (sig === lastProcessedVariantSig) {
          sendResponse({ received: true, skippedDuplicate: true });
          return false;
        }
        lastProcessedVariantSig = sig;

        if (currentTabInfo) currentTabInfo.liveData = details;
        if (details.currentPrice > 0 && livePricePill) {
          livePricePill.textContent = `Live: ₹${Math.round(details.currentPrice).toLocaleString('en-IN')}`;
        }
        if (details.title && productSummaryTitle) {
          productSummaryTitle.textContent = details.title;
        }
        if (details.variantLabel && productVariantPill) {
          productVariantPill.textContent = details.variantLabel;
          productVariantPill.classList.remove('hidden');
        }
        if (details.cleanUrl && urlInput && urlInput.value !== details.cleanUrl) {
          urlInput.value = details.cleanUrl;
          if (currentDisplayMode === 'dashboard') {
            loadDashboardInsights(false);
          }
        } else if (details.currentPrice > 0 && currentPriceEl) {
          // Update live price in-place without triggering a full dashboard reload loop
          currentPriceEl.textContent = `₹${Math.round(details.currentPrice).toLocaleString('en-IN')}`;
        }
      }
      sendResponse({ received: true });
      return false;
    }
  });

  function queryActiveTabsSafe() {
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
          browser.tabs.query({ active: true, currentWindow: true }).then(done).catch(() => done([]));
        } else if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => done(tabs));
        } else {
          done([]);
        }
      } catch (_) {
        resolve([]);
      }
    });
  }

  function queryTabLiveDetailsSafe(tabId, timeoutMs = 450) {
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
        const msg = { action: 'GET_LIVE_ON_PAGE_DETAILS', type: 'GET_LIVE_ON_PAGE_DETAILS' };
        if (typeof browser !== 'undefined' && browser.tabs && browser.tabs.sendMessage) {
          browser.tabs.sendMessage(tabId, msg).then(done).catch(() => done(null));
        } else if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.sendMessage) {
          chrome.tabs.sendMessage(tabId, msg, (res) => {
            if (chrome.runtime && chrome.runtime.lastError) done(null);
            else done(res || null);
          });
        } else {
          done(null);
        }
      } catch (_) {
        resolve(null);
      }
    });
  }

  function sendMessageAsync(msg, timeoutMs = 9000) {
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

        if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.sendMessage) {
          browser.runtime.sendMessage(msg).then(done).catch(() => done(null));
        } else if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage(msg, (response) => {
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

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
});
