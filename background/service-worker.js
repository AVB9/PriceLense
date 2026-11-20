/**
 * Chromium Manifest V3 Service Worker Wrapper for PriceLens v3.3
 * Imports shared libraries and the main background event coordinator
 * so the extension runs seamlessly in Chrome, Brave, Edge, Arc, Opera, and Vivaldi
 * alongside Firefox, Zen Browser, LibreWolf, Waterfox, and Floorp.
 */

if (typeof importScripts === 'function') {
  importScripts(
    '../lib/url-cleaner.js',
    '../lib/providers.js',
    '../lib/parsers.js',
    '../lib/scrapers.js',
    'background.js'
  );
}
