/**
 * PriceLens v3.3 Minimal Distribution Portal Controller
 * - Detects visitor browser engine (Gecko vs Chromium) and highlights the matching download button
 * - Manages installation guide tabs and 1-click clipboard copy
 */

document.addEventListener('DOMContentLoaded', () => {
  const ua = navigator.userAgent || '';
  const isGecko = /Firefox|FxiOS|Zen|Waterfox|LibreWolf|Floorp/i.test(ua);
  const isChromium = /Chrome|CriOS|Edg|Brave|OPR|Vivaldi/i.test(ua) && !isGecko;

  const detectedBanner = document.getElementById('detectedBrowserBanner');
  const btnDlGecko = document.getElementById('btnDlGecko');
  const btnDlChromium = document.getElementById('btnDlChromium');

  function activateGuideTab(tabKey) {
    document.querySelectorAll('.guide-tab').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-guide') === tabKey);
    });
    document.querySelectorAll('.guide-panel').forEach(panel => {
      panel.classList.toggle('active', panel.id === `guide-${tabKey}`);
    });
  }

  if (isGecko) {
    if (detectedBanner) detectedBanner.textContent = 'Firefox / Gecko Detected · v3.3 Ready';
    if (btnDlGecko) btnDlGecko.classList.add('primary-cta');
    activateGuideTab('gecko');
  } else if (isChromium) {
    if (detectedBanner) detectedBanner.textContent = 'Chromium Browser Detected · v3.3 Ready';
    if (btnDlChromium) btnDlChromium.classList.add('primary-cta');
    activateGuideTab('chromium');
  } else {
    if (btnDlGecko) btnDlGecko.classList.add('primary-cta');
  }

  document.querySelectorAll('.guide-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      activateGuideTab(btn.getAttribute('data-guide'));
    });
  });

  document.querySelectorAll('.copy-snippet-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const text = btn.getAttribute('data-copy');
      if (!text) return;
      navigator.clipboard.writeText(text).then(() => {
        const orig = btn.textContent;
        btn.textContent = 'Copied';
        btn.style.background = '#30D158';
        btn.style.color = '#050507';
        setTimeout(() => {
          btn.textContent = orig;
          btn.style.background = '';
          btn.style.color = '';
        }, 1400);
      });
    });
  });
});
