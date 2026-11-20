/**
 * Options & Settings Page Controller for PriceLens
 * Manages Display Mode (Redirect vs Dashboard), instant auto-redirect,
 * default provider selection, and user-defined custom price comparison engines.
 */

const extAPI = typeof browser !== 'undefined' ? browser : chrome;

document.addEventListener('DOMContentLoaded', async () => {
  // Mode Selection Elements
  const modeRadioRedirect = document.getElementById('modeRadioRedirect');
  const modeRadioDashboard = document.getElementById('modeRadioDashboard');
  const autoRedirectInstant = document.getElementById('autoRedirectInstant');
  const modeCardLabels = document.querySelectorAll('.mode-card-label');

  // Provider Elements
  const defaultProviderSelect = document.getElementById('defaultProviderSelect');
  const enableFloatingBadge = document.getElementById('enableFloatingBadge');
  const providerCardsList = document.getElementById('providerCardsList');

  // Modal elements
  const providerModal = document.getElementById('providerModal');
  const showAddModalBtn = document.getElementById('showAddModalBtn');
  const closeModalBtn = document.getElementById('closeModalBtn');
  const cancelModalBtn = document.getElementById('cancelModalBtn');
  const saveProviderBtn = document.getElementById('saveProviderBtn');

  // Form inputs
  const customName = document.getElementById('customName');
  const customWebsite = document.getElementById('customWebsite');
  const customTemplate = document.getElementById('customTemplate');
  const selTitle = document.getElementById('selTitle');
  const selCurPrice = document.getElementById('selCurPrice');
  const selLowPrice = document.getElementById('selLowPrice');
  const selHighPrice = document.getElementById('selHighPrice');
  const selCheaperContainer = document.getElementById('selCheaperContainer');
  const selCheaperStore = document.getElementById('selCheaperStore');
  const selCheaperPrice = document.getElementById('selCheaperPrice');
  const selCheaperUrl = document.getElementById('selCheaperUrl');

  let editingProviderId = null;

  // Load Settings
  const settings = await ProviderManager.getSettings();

  // Initialize Display Mode Radios
  if (settings.displayMode === 'dashboard') {
    modeRadioDashboard.checked = true;
    updateSelectedModeCard('dashboard');
  } else {
    modeRadioRedirect.checked = true;
    updateSelectedModeCard('redirect');
  }

  if (autoRedirectInstant) {
    autoRedirectInstant.checked = !!settings.autoRedirectInstant;
  }

  if (enableFloatingBadge) {
    enableFloatingBadge.checked = settings.enableFloatingBadge !== false;
  }

  // Display Mode Radio Event Listeners
  modeRadioRedirect.addEventListener('change', () => {
    if (modeRadioRedirect.checked) {
      updateSelectedModeCard('redirect');
      ProviderManager.saveSettings({ displayMode: 'redirect' });
    }
  });

  modeRadioDashboard.addEventListener('change', () => {
    if (modeRadioDashboard.checked) {
      updateSelectedModeCard('dashboard');
      ProviderManager.saveSettings({ displayMode: 'dashboard' });
    }
  });

  function updateSelectedModeCard(mode) {
    modeCardLabels.forEach(label => {
      const input = label.querySelector('input');
      if (input && input.value === mode) {
        label.classList.add('selected');
      } else {
        label.classList.remove('selected');
      }
    });
  }

  // Auto-Redirect Instant Checkbox
  autoRedirectInstant.addEventListener('change', () => {
    ProviderManager.saveSettings({ autoRedirectInstant: autoRedirectInstant.checked });
  });

  // Enable Floating Badge Checkbox
  enableFloatingBadge.addEventListener('change', () => {
    ProviderManager.saveSettings({ enableFloatingBadge: enableFloatingBadge.checked });
  });

  // Default Provider Change
  defaultProviderSelect.addEventListener('change', async () => {
    await ProviderManager.setActiveProvider(defaultProviderSelect.value);
  });

  // Initialize Provider List
  await refreshUI();

  // Modal handlers
  showAddModalBtn.addEventListener('click', () => {
    editingProviderId = null;
    document.getElementById('modalTitle').textContent = 'Add Custom Price Tracker Provider';
    clearForm();
    providerModal.classList.remove('hidden');
  });

  closeModalBtn.addEventListener('click', () => providerModal.classList.add('hidden'));
  cancelModalBtn.addEventListener('click', () => providerModal.classList.add('hidden'));

  saveProviderBtn.addEventListener('click', async () => {
    const name = customName.value.trim();
    const website = customWebsite.value.trim();
    const template = customTemplate.value.trim();

    if (!name || !website || !template) {
      alert('Please fill in Provider Name, Website URL, and URL Template.');
      return;
    }

    const providerId = editingProviderId || `custom_${Date.now()}`;
    const newProvider = {
      id: providerId,
      name,
      website,
      urlTemplate: template,
      isBuiltin: false,
      enabled: true,
      selectors: {
        title: selTitle.value.trim(),
        currentPrice: selCurPrice.value.trim(),
        lowestPrice: selLowPrice.value.trim(),
        highestPrice: selHighPrice.value.trim(),
        cheaperOptionsContainer: selCheaperContainer.value.trim(),
        cheaperOptionStoreName: selCheaperStore.value.trim(),
        cheaperOptionPrice: selCheaperPrice.value.trim(),
        cheaperOptionUrl: selCheaperUrl.value.trim()
      }
    };

    await ProviderManager.saveCustomProvider(newProvider);
    providerModal.classList.add('hidden');
    await refreshUI();
  });

  async function refreshUI() {
    const providers = await ProviderManager.getAllProviders();
    const activeProvider = await ProviderManager.getActiveProvider();

    // Populate dropdown
    defaultProviderSelect.innerHTML = '';
    providers.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.name} ${p.isBuiltin ? '(Built-in)' : '(Custom)'}`;
      if (p.id === activeProvider.id) opt.selected = true;
      defaultProviderSelect.appendChild(opt);
    });

    // Populate cards
    providerCardsList.innerHTML = '';
    providers.forEach(p => {
      const card = document.createElement('div');
      card.className = 'provider-card';

      const badgeHtml = p.isBuiltin
        ? `<span class="badge-builtin">Official</span>`
        : `<span class="badge-custom">Custom</span>`;

      const deleteBtnHtml = !p.isBuiltin
        ? `<button class="btn btn-danger btn-sm delete-btn" data-id="${p.id}">Delete</button>`
        : '';

      card.innerHTML = `
        <div class="provider-info">
          <h3>${escapeHtml(p.name)} ${badgeHtml}</h3>
          <p class="provider-desc">${escapeHtml(p.description || p.website)}</p>
          <div class="provider-template-code">${escapeHtml(p.urlTemplate)}</div>
        </div>
        <div class="provider-actions">
          ${deleteBtnHtml}
        </div>
      `;

      if (!p.isBuiltin) {
        card.querySelector('.delete-btn').addEventListener('click', async (e) => {
          const id = e.target.getAttribute('data-id');
          if (confirm(`Are you sure you want to remove provider "${p.name}"?`)) {
            await ProviderManager.deleteCustomProvider(id);
            await refreshUI();
          }
        });
      }

      providerCardsList.appendChild(card);
    });
  }

  function clearForm() {
    customName.value = '';
    customWebsite.value = '';
    customTemplate.value = '';
    selTitle.value = '';
    selCurPrice.value = '';
    selLowPrice.value = '';
    selHighPrice.value = '';
    selCheaperContainer.value = '';
    selCheaperStore.value = '';
    selCheaperPrice.value = '';
    selCheaperUrl.value = '';
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
});
