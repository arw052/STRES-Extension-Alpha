// STRES Extension Entry
// Mounts UI components and wires SillyTavern integration without blocking chat.

// STRES Extension Configuration
const extensionName = "stres";
const defaultSettings = {
  serverUrl: "http://localhost:3001",
  campaignId: null,
  chatCampaigns: {},
  autoInjection: {
    enabled: true,
    mode: "basic",
    frequency: "every_message"
  },
  ui: {
    theme: "fantasy",
    showHUD: true,
    panelPosition: "right"
  }
};

// Override default to match current backend port
defaultSettings.serverUrl = "http://localhost:3001";

// Global STRES object
let stresClient;
let characterPanel;
let autoInjector;
let commandProcessor;
let toolIntegration;
let lorebookManager;
let characterCardManager;
let worldMapViewer;

// STRES API Client
class STRESClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.apiPrefix = '/api';
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${this.apiPrefix}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.statusText}`);
    }

    return response.json();
  }

  async getHealth() {
    try {
      return await this.request('/health');
    } catch (error) {
      return { status: 'unreachable', error: error.message };
    }
  }
}

// STRES Chat Integration
const STRESChat = {
  processMessage(message) {
    // Check for inventory commands
    if (message.startsWith('/inventory') || message.startsWith('/inv')) {
      this.handleInventoryCommand(message);
      return true; // Prevent default handling
    }

    // Check for combat commands
    if (message.startsWith('/combat')) {
      this.handleCombatCommand(message);
      return true;
    }

    // Check for STRES commands
    if (message.startsWith('/stres')) {
      this.handleStresCommand(message);
      return true;
    }

    return false;
  },

  handleInventoryCommand(command) {
    const parts = command.split(' ');
    const action = parts[1];

    switch(action) {
      case 'show':
      case 'list':
        this.showInventory();
        return '';
      case 'add':
        this.addItem(parts.slice(2).join(' '));
        return '';
      case 'remove':
        this.removeItem(parts.slice(2).join(' '));
        return '';
      case 'use':
        this.useItem(parts.slice(2).join(' '));
        return '';
      default:
        this.showHelp();
        return '';
    }
    return '';
  },

  handleStresCommand(command) {
    try {
      const parts = command.split(' ');
      const action = parts && parts.length > 1 ? parts[1] : '';

      switch(action) {
        case 'status':
          this.showStatus();
          return '';
        case 'join':
          this.rejoinWebSocket();
          return '';
        case 'campaign':
          this.showCampaign();
          return '';
        case 'settings':
          try { window.STRES?.toggleSettings?.(); } catch {}
          this.sendToChat('⚙️ Opened STRES settings panel');
          return '';
        case 'reset':
          this.resetSettings();
          return '';
        case 'debug':
          this.showDebugInfo();
          return '';
        case 'fixport':
          this.fixPortConfiguration();
          return '';
        default:
          this.showHelp();
          return '';
      }
    } catch (error) {
      console.error('[STRES] Error in handleStresCommand:', error);
      this.sendToChat('❌ Error processing STRES command: ' + error.message);
      return '';
    }
  },

  async showStatus() {
    const settings = window.extension_settings?.[extensionName] || {};
    const apiBase = settings.serverUrl || defaultSettings.serverUrl;
    let apiStatus = 'checking...';

    try {
      const health = await fetch(`${apiBase}/health`);
      if (health.ok) {
        const data = await health.json();
        apiStatus = `healthy (${data.version || 'unknown'})`;
      } else {
        apiStatus = `error: ${health.status}`;
      }
    } catch (error) {
      apiStatus = `unreachable (${error.message})`;
    }

    const message = `
**STRES Status**
• Version: 0.1.2
• API: ${apiBase} (${apiStatus})
• Default API: ${defaultSettings.serverUrl}
• Settings API: ${settings.serverUrl || 'not set'}
• Campaign ID: ${settings.campaignId || 'None'}
• Character ID: ${settings.characterId || 'None'}
• Extension: Loaded ✅
    `.trim();

    this.sendToChat(message);
    return '';
  },

  resetSettings() {
    if (window.extension_settings) {
      window.extension_settings[extensionName] = structuredClone(defaultSettings);
      // Persist via SillyTavern if available
      try {
        const ctx = window.SillyTavern?.getContext?.();
        (ctx?.saveSettingsDebounced || window.saveSettingsDebounced)?.();
      } catch {}
      this.sendToChat('✅ STRES settings reset to defaults');
    } else {
      this.sendToChat('❌ Cannot reset settings - extension_settings not available');
    }
    return '';
  },

  showDebugInfo() {
    const settings = window.extension_settings?.[extensionName] || {};
    const debugMessage = `
**STRES Debug Info**
• Extension Name: ${extensionName}
• Window.STRES: ${typeof window.STRES}
• Extension Settings: ${typeof window.extension_settings}
• STRES Settings: ${typeof settings}
• Current API URL: ${settings.serverUrl || 'not set'}
• Default API URL: ${defaultSettings.serverUrl}
• Settings Keys: ${Object.keys(settings).join(', ')}
    `.trim();

    this.sendToChat(debugMessage);
    return '';
  },

  fixPortConfiguration() {
    if (window.extension_settings) {
      if (!window.extension_settings[extensionName]) {
        window.extension_settings[extensionName] = {};
      }
      window.extension_settings[extensionName].serverUrl = "http://localhost:3001";
      try {
        // Update live client base if already created
        if (stresClient && typeof stresClient === 'object') {
          stresClient.baseUrl = window.extension_settings[extensionName].serverUrl;
        }
        const ctx = window.SillyTavern?.getContext?.();
        (ctx?.saveSettingsDebounced || window.saveSettingsDebounced)?.();
        try { window.STRES?.refreshSettingsUI?.(); } catch {}
      } catch {}
      this.sendToChat('✅ STRES API URL fixed to http://localhost:3001');
      this.sendToChat('🔄 Try /stres status again to test the connection');
    } else {
      this.sendToChat('❌ Cannot fix port - extension_settings not available');
    }
    return '';
  },

  showHelp() {
    const message = `
**STRES Commands**
• /inventory show - Display inventory
• /inventory add [item] - Add item
• /inventory remove [item] - Remove item
• /inventory use [item] - Use item
• /stres status - Show STRES status
• /stres join - Reconnect WebSocket
• /stres campaign - Show campaign info
• /stres settings - Toggle settings panel
• /stres reset - Reset settings to defaults
• /stres debug - Show debug information
• /stres fixport - Fix API port configuration
    `.trim();

    this.sendToChat(message);
    return '';
  },

  rejoinWebSocket() {
    this.sendToChat('🔄 WebSocket reconnection requested');
    return '';
  },

  showCampaign() {
    const settings = window.extension_settings?.[extensionName] || {};
    const message = `
**Campaign Info**
• Campaign ID: ${settings.campaignId || 'None'}
• Server URL: ${settings.serverUrl || defaultSettings.serverUrl}
    `.trim();

    this.sendToChat(message);
    return '';
  },

  async addItem(argStr) {
    const parts = argStr.trim().split(/\s+/);
    const itemId = parts[0];
    const quantity = parts[1] ? parseInt(parts[1], 10) : 1;
    if (!itemId) {
      this.sendToChat('Usage: /inventory add <itemId> <quantity?>');
      return;
    }
    this.sendToChat(`✅ Added ${quantity} ${itemId} (simulated)`);
    return '';
  },

  async removeItem(argStr) {
    const parts = argStr.trim().split(/\s+/);
    const itemId = parts[0];
    const quantity = parts[1] ? parseInt(parts[1], 10) : 1;
    if (!itemId) {
      this.sendToChat('Usage: /inventory remove <itemId> <quantity?>');
      return;
    }
    this.sendToChat(`✅ Removed ${quantity} ${itemId} (simulated)`);
    return '';
  },

  async useItem(argStr) {
    const itemId = argStr.trim();
    if (!itemId) {
      this.sendToChat('Usage: /inventory use <itemId>');
      return;
    }
    this.sendToChat(`⚔️ Used ${itemId} (simulated)`);
    return '';
  },

  showInventory() {
    const message = `
**Inventory**
• Sample Item 1 (5)
• Sample Item 2 (2)
• Sample Item 3 (1)
*Note: Connect to STRES backend for real inventory*
    `.trim();

    this.sendToChat(message);
    return '';
  },

  handleCombatCommand(command) {
    const parts = command.split(' ');
    const subcommand = parts[1];

    switch(subcommand) {
      case 'act':
        this.handleCombatAct(parts.slice(2));
        return '';
      case 'status':
        this.showCombatStatus();
        return '';
      default:
        this.sendToChat('**Combat Commands:**\n• /combat act attack <targetId> - Submit attack action\n• /combat status - Show current combat state');
        return '';
    }
    return '';
  },

  handleCombatAct(args) {
    if (args.length < 2 || args[0] !== 'attack') {
      this.sendToChat('Usage: /combat act attack <targetId>');
      return;
    }

    const targetId = args[1];
    this.sendToChat(`⚔️ Combat action: Attack ${targetId} (simulated)`);
    return '';
  },

  showCombatStatus() {
    this.sendToChat('**Combat Status**\n• Active: No\n• Current Turn: None\n*Note: Connect to STRES backend for real combat*');
    return '';
  },

  sendToChat(message) {
    // Try to use SillyTavern's chat system if available
    if (window.SillyTavern && typeof window.SillyTavern.sendSystemMessage === 'function') {
      window.SillyTavern.sendSystemMessage(message);
    } else {
      // Fallback to console
      console.log('[STRES]', message);
      // Try to insert into chat manually
      const chatContainer = document.querySelector('#chat');
      if (chatContainer) {
        const messageElement = document.createElement('div');
        messageElement.className = 'mes stres-message';
        messageElement.innerHTML = `<div class="mes_text">${message.replace(/\n/g, '<br>')}</div>`;
        chatContainer.appendChild(messageElement);
      }
    }
  }
};

// Main initialization function
async function initializeExtension() {
  console.log("[STRES] Extension starting...");

  // Wait for SillyTavern to be ready
  if (typeof window.SillyTavern === 'undefined') {
    console.warn('[STRES] SillyTavern not found. Extension may not work properly.');
  }

  // Initialize settings
  const context = window.SillyTavern?.getContext?.() || {};
  const extensionSettings = context.extensionSettings || window.extension_settings || {};

  if (!extensionSettings[extensionName]) {
    extensionSettings[extensionName] = structuredClone(defaultSettings);
    if (context.saveSettingsDebounced) {
      context.saveSettingsDebounced();
    }
  }

  // Initialize STRES client
  stresClient = new STRESClient(extensionSettings[extensionName].serverUrl);

  // Make settings globally accessible
  window.extension_settings = extensionSettings;

  // Register slash commands
  registerSlashCommands(context);

  // Initialize UI components
  initializeUI();

  console.log("[STRES] Extension initialized successfully");
}

// Register slash commands with SillyTavern
function registerSlashCommands(context) {
  const registerSlashCommand = context.registerSlashCommand || window.registerSlashCommand;
  const SlashCommandParser = context.SlashCommandParser || window.SlashCommandParser;
  const SlashCommand = context.SlashCommand || window.SlashCommand;

  if (typeof SlashCommandParser !== 'undefined' && typeof SlashCommand !== 'undefined') {
    console.log("[STRES] Using modern SlashCommandParser method");

    // Register all STRES commands
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
      name: 'stres',
      callback: (args) => {
        const argString = args && args.length > 0 ? args.join(' ') : '';
        return STRESChat.handleStresCommand('/stres ' + argString);
      },
      helpString: 'STRES main commands - status, join, campaign, settings, reset, debug, fixport'
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
      name: 'stres_status',
      callback: () => STRESChat.showStatus(),
      helpString: 'Show STRES status and current campaign info'
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
      name: 'inventory',
      callback: (args) => STRESChat.handleInventoryCommand('/inventory ' + args.join(' ')),
      helpString: 'Inventory management - show, add, remove, use'
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
      name: 'combat',
      callback: (args) => STRESChat.handleCombatCommand('/combat ' + args.join(' ')),
      helpString: 'Combat commands - act, status'
    }));

    console.log("[STRES] Slash commands registered successfully using SlashCommandParser");
  } else if (typeof registerSlashCommand === 'function') {
    console.log("[STRES] Using legacy registerSlashCommand function");

    registerSlashCommand('stres', (args) => {
      const argString = args && args.length > 0 ? args.join(' ') : '';
      return STRESChat.handleStresCommand('/stres ' + argString);
    }, [], 'STRES main commands - status, join, campaign, settings, reset, debug, fixport', true, true);
    registerSlashCommand('stres_status', () => STRESChat.showStatus(), [], 'Show STRES status', true, true);
    registerSlashCommand('inventory', (args) => {
      const argString = args && args.length > 0 ? args.join(' ') : '';
      return STRESChat.handleInventoryCommand('/inventory ' + argString);
    }, [], 'Inventory management', true, true);
    registerSlashCommand('combat', (args) => {
      const argString = args && args.length > 0 ? args.join(' ') : '';
      return STRESChat.handleCombatCommand('/combat ' + argString);
    }, [], 'Combat commands', true, true);

    console.log("[STRES] Slash commands registered successfully using registerSlashCommand");
  } else {
    console.error("[STRES] No slash command registration method found");
  }
}

// Initialize UI components
function initializeUI() {
  const doc = document;
  const rootId = 'stres-extension-root';

  if (doc.getElementById(rootId)) return; // already mounted

  const root = doc.createElement('div');
  root.id = rootId;
  root.setAttribute('data-theme', 'auto');
  root.style.position = 'relative';
  doc.body.appendChild(root);

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

  // Expose a minimal API to toggle settings
  window.STRES = window.STRES || {};
  window.STRES.toggleSettings = () => {
    const panel = doc.querySelector('#stres-settings-host .stres-settings-panel');
    if (!panel) return;
    const hidden = panel.getAttribute('aria-hidden') === 'true';
    panel.setAttribute('aria-hidden', hidden ? 'false' : 'true');
  };

  // Real Settings UI
  (function renderSettingsPanel() {
    const settings = (window.extension_settings?.[extensionName]) || structuredClone(defaultSettings);

    const panel = doc.createElement('div');
    panel.className = 'stres-settings-panel';
    panel.setAttribute('aria-hidden', 'true');

    // Header
    const header = doc.createElement('div');
    header.className = 'stres-settings__header';
    const title = doc.createElement('strong');
    title.textContent = 'STRES Settings';
    const btnClose = doc.createElement('button');
    btnClose.className = 'stres-btn stres-btn--icon';
    btnClose.setAttribute('aria-label', 'Close');
    btnClose.textContent = '✕';
    btnClose.addEventListener('click', () => panel.setAttribute('aria-hidden', 'true'));
    header.appendChild(title); header.appendChild(btnClose);

    // Content
    const content = doc.createElement('div');
    content.className = 'stres-settings__content';

    const secConn = doc.createElement('div');
    secConn.className = 'stres-settings__section';
    const hConn = doc.createElement('h3'); hConn.textContent = 'Connection';
    const fldApi = doc.createElement('div'); fldApi.className = 'stres-field';
    const lblApi = doc.createElement('label'); lblApi.setAttribute('for','stres-api-url'); lblApi.textContent = 'API Base URL';
    const inpApi = doc.createElement('input'); inpApi.type = 'text'; inpApi.id = 'stres-api-url'; inpApi.placeholder = 'http://localhost:3001'; inpApi.value = settings.serverUrl || defaultSettings.serverUrl;
    fldApi.appendChild(lblApi); fldApi.appendChild(inpApi);

    const fldCampaign = doc.createElement('div'); fldCampaign.className = 'stres-field';
    const lblCamp = doc.createElement('label'); lblCamp.setAttribute('for','stres-campaign-id'); lblCamp.textContent = 'Campaign ID';
    const inpCamp = doc.createElement('input'); inpCamp.type = 'text'; inpCamp.id = 'stres-campaign-id'; inpCamp.placeholder = 'default-campaign'; inpCamp.value = settings.campaignId || '';
    fldCampaign.appendChild(lblCamp); fldCampaign.appendChild(inpCamp);

    const fldChar = doc.createElement('div'); fldChar.className = 'stres-field';
    const lblChar = doc.createElement('label'); lblChar.setAttribute('for','stres-character-id'); lblChar.textContent = 'Character ID';
    const inpChar = doc.createElement('input'); inpChar.type = 'text'; inpChar.id = 'stres-character-id'; inpChar.placeholder = '0000-...'; inpChar.value = settings.characterId || '';
    fldChar.appendChild(lblChar); fldChar.appendChild(inpChar);

    secConn.appendChild(hConn); secConn.appendChild(fldApi); secConn.appendChild(fldCampaign); secConn.appendChild(fldChar);
    content.appendChild(secConn);

    // Footer
    const footer = doc.createElement('div'); footer.className = 'stres-settings__footer';
    const notice = doc.createElement('div'); notice.className = 'stres-notice'; notice.id = 'stres-settings-notice'; notice.dataset.visible = 'false'; notice.textContent = '';

    const btnTest = doc.createElement('button'); btnTest.className = 'stres-btn stres-btn--ghost'; btnTest.textContent = 'Test Connection';
    const btnReset = doc.createElement('button'); btnReset.className = 'stres-btn stres-btn--danger'; btnReset.textContent = 'Reset';
    const btnSave = doc.createElement('button'); btnSave.className = 'stres-btn'; btnSave.textContent = 'Save';

    // Wire handlers
    async function testConnection(url) {
      let ok = false, msg = '';
      try {
        const u = (url || '').replace(/\/$/, '') || 'http://localhost:3001';
        const res = await fetch(u + '/health', { method: 'GET' });
        if (res.ok) {
          const j = await res.json().catch(()=>({}));
          ok = true; msg = `Healthy (${j.version || 'unknown'})`;
        } else {
          msg = `HTTP ${res.status}`;
        }
      } catch (e) {
        msg = String(e?.message || e);
      }
      notice.textContent = ok ? `✅ ${msg}` : `❌ ${msg}`;
      notice.dataset.visible = 'true';
      setTimeout(()=>{ notice.dataset.visible = 'false'; }, 3500);
      return ok;
    }

    btnTest.addEventListener('click', () => {
      testConnection(inpApi.value);
    });

    btnReset.addEventListener('click', () => {
      inpApi.value = defaultSettings.serverUrl;
      inpCamp.value = '';
      inpChar.value = '';
      notice.textContent = 'Defaults restored (not saved)';
      notice.dataset.visible = 'true'; setTimeout(()=>{ notice.dataset.visible = 'false'; }, 2500);
    });

    btnSave.addEventListener('click', async () => {
      const url = inpApi.value.trim().replace(/\/$/, '');
      const s = window.extension_settings || (window.SillyTavern?.getContext?.().extensionSettings);
      s[extensionName] = s[extensionName] || {};
      s[extensionName].serverUrl = url || defaultSettings.serverUrl;
      s[extensionName].campaignId = inpCamp.value.trim() || null;
      s[extensionName].characterId = inpChar.value.trim() || null;
      try {
        const ctx = window.SillyTavern?.getContext?.();
        (ctx?.saveSettingsDebounced || window.saveSettingsDebounced)?.();
      } catch {}
      try { if (stresClient) stresClient.baseUrl = s[extensionName].serverUrl; } catch {}
      notice.textContent = 'Settings saved';
      notice.dataset.visible = 'true'; setTimeout(()=>{ notice.dataset.visible = 'false'; }, 2000);
      // Optional: quick probe
      setTimeout(()=>{ testConnection(url); }, 100);
    });

    footer.appendChild(btnTest);
    footer.appendChild(btnReset);
    footer.appendChild(btnSave);

    panel.appendChild(header);
    panel.appendChild(content);
    panel.appendChild(footer);
    settingsHost.appendChild(panel);

    // Notice placement under footer
    settingsHost.appendChild(notice);

    // Public helpers to sync UI with settings
    window.STRES.refreshSettingsUI = () => {
      const cur = (window.extension_settings?.[extensionName]) || {};
      inpApi.value = cur.serverUrl || defaultSettings.serverUrl;
      inpCamp.value = cur.campaignId || '';
      inpChar.value = cur.characterId || '';
    };
  })();

  console.log("[STRES] UI components initialized");
}

// Hook into chat input for additional processing
function hookChatInput() {
  const chatForm = document.querySelector('#send_form');
  if (chatForm) {
    const originalSubmit = chatForm.onsubmit;
    chatForm.onsubmit = function(e) {
      const input = document.querySelector('#send_textarea');
      if (input && STRESChat.processMessage(input.value)) {
        e.preventDefault();
        input.value = '';
        return false;
      }
      if (originalSubmit) {
        return originalSubmit.call(this, e);
      }
    };
    console.log("[STRES] Chat input hooked successfully");
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initializeExtension().then(() => {
      setTimeout(hookChatInput, 1000); // Delay to ensure SillyTavern is fully loaded
    });
  });
} else {
  initializeExtension().then(() => {
    setTimeout(hookChatInput, 1000);
  });
}
