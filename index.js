// STRES Extension Entry
// Mounts UI components and wires SillyTavern integration without blocking chat.

(function initStresUI() {
  const doc = document;
  const rootId = 'stres-extension-root';

  if (doc.getElementById(rootId)) return; // already mounted

  const root = doc.createElement('div');
  root.id = rootId;
  root.setAttribute('data-theme', 'auto');
  root.style.position = 'relative';
  doc.body.appendChild(root);

  // Styles - using proper extension paths
  const extensionPath = '/scripts/extensions/third-party/STRES-Extension-Alpha';
  
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = `${extensionPath}/styles/base.css`;
  doc.head.appendChild(link);
  const linkSettings = doc.createElement('link');
  linkSettings.rel = 'stylesheet';
  linkSettings.href = `${extensionPath}/styles/settings.css`;
  doc.head.appendChild(linkSettings);
  const linkQuick = doc.createElement('link');
  linkQuick.rel = 'stylesheet';
  linkQuick.href = `${extensionPath}/styles/quickbar.css`;
  doc.head.appendChild(linkQuick);
  const linkInventory = doc.createElement('link');
  linkInventory.rel = 'stylesheet';
  linkInventory.href = `${extensionPath}/styles/inventory.css`;
  doc.head.appendChild(linkInventory);
  // Import UI removed - using folder-based system instead

  // Load runtime (precompiled) UI logic if available
  const runtimeScript = doc.createElement('script');
  runtimeScript.src = `${extensionPath}/ui/runtime.js`;
  runtimeScript.defer = true;
  doc.head.appendChild(runtimeScript);
  
  // Load inventory system
  const inventoryScript = doc.createElement('script');
  inventoryScript.type = 'module';
  inventoryScript.src = `${extensionPath}/ui/inventory/integration/SillyTavernHooks.js`;
  inventoryScript.defer = true;
  doc.head.appendChild(inventoryScript);

  // Lazy-load TypeScript-built modules if available; otherwise fallback to precompiled JS shims
  // Note: In this skeleton we attach modules on window.STRES until a bundler is configured.
  const w = /** @type {Window & { STRES?: any }} */ (window);
  if (!w.STRES) w.STRES = {};

  // Simple mounting of components in DOM containers
  const quickBarHost = doc.createElement('div');
  quickBarHost.id = 'stres-quickbar-host';
  root.appendChild(quickBarHost);

  const settingsHost = doc.createElement('div');
  settingsHost.id = 'stres-settings-host';
  root.appendChild(settingsHost);

  const combatHost = doc.createElement('div');
  combatHost.id = 'stres-combat-host';
  root.appendChild(combatHost);

  // Import host removed - using folder-based system

  // Import UMD-like shims if present
  // These shims are generated from TypeScript sources and attached to window.STRES
  const init = () => {
    const { mountQuickBar, mountSettingsPanel, mountImportUI } = w.STRES || {};
    if (typeof mountQuickBar === 'function') {
      mountQuickBar('#stres-quickbar-host');
    }
    if (typeof mountSettingsPanel === 'function') {
      // Start hidden; toggled via a button in the quickbar
      mountSettingsPanel('#stres-settings-host', { startHidden: true });
    }
    // Import UI removed - using folder-based system
  };

  // Defer to idle so we don’t block chat
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(init);
  } else {
    setTimeout(init, 0);
  }

  // Expose a minimal API to toggle settings
  w.STRES.toggleSettings = () => {
    const panel = doc.querySelector('#stres-settings-host .stres-settings-panel');
    if (!panel) return;
    const hidden = panel.getAttribute('aria-hidden') === 'true';
    panel.setAttribute('aria-hidden', hidden ? 'false' : 'true');
  };

  // Import functions removed - using folder-based system with file watcher
})();
