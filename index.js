// STRES Extension Entry
// Mounts UI components and wires SillyTavern integration without blocking chat.

// STRES Extension Configuration
const extensionName = "stres";
const defaultSettings = {
  serverUrl: "http://localhost:3001",
  campaignId: null,
  worldpackId: null,
  chatCampaigns: {},
  autoBindCampaignToChat: true,
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

  async getCurrentWorldpack() {
    try {
      return await this.request('/worldpack/current');
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async loadWorldpackById(packId) {
    const qp = encodeURIComponent(packId || '');
    const url = `${this.baseUrl}${this.apiPrefix}/worldpack/load?packId=${qp}`;
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const j = await res.json().catch(()=>({}));
    if (!res.ok) throw new Error(j?.error?.message || `HTTP ${res.status}`);
    return j;
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
        case 'bindchat': {
          try {
            const ctx = window.SillyTavern?.getContext?.() || {};
            const chatMeta = ctx.chatMetadata || {};
            const cid = ctx.chatId || chatMeta.chat_id;
            if (!cid) { this.sendToChat('❌ No active chat to bind'); return ''; }
            const s = window.extension_settings || (ctx.extensionSettings);
            s[extensionName] = s[extensionName] || {};
            const camp = s[extensionName].campaignId || `chat-${cid}`;
            s[extensionName].campaignId = camp;
            s[extensionName].chatCampaigns = s[extensionName].chatCampaigns || {};
            s[extensionName].chatCampaigns[cid] = camp;
            try { (ctx?.saveSettingsDebounced || window.saveSettingsDebounced)?.(); } catch {}
            this.sendToChat(`✅ Bound chat ${cid} → campaign ${camp}`);
          } catch (e) { this.sendToChat('❌ Failed to bind chat: ' + (e?.message||e)); }
          return '';
        }
        case 'showchat': {
          try {
            const ctx = window.SillyTavern?.getContext?.() || {};
            const chatMeta = ctx.chatMetadata || {};
            const cid = ctx.chatId || chatMeta.chat_id || 'unknown';
            const cname = ctx.chatName || chatMeta.chat_name || 'unknown';
            const s = window.extension_settings?.[extensionName] || {};
            const mapped = (s.chatCampaigns||{})[cid];
            this.sendToChat(`**Chat**\n• Name: ${cname}\n• ID: ${cid}\n• Bound Campaign: ${mapped || '(none)'}\n• Current Campaign: ${s.campaignId || '(none)'} `);
          } catch (e) { this.sendToChat('❌ Failed to get chat info: ' + (e?.message||e)); }
          return '';
        }
        case 'worldpack': {
          const sub = (parts[2]||'').toLowerCase();
          if (!sub || sub === 'status') {
            this.showWorldpack();
            return '';
          }
          if (sub === 'load') {
            const id = (parts[3]||'').trim();
            if (!id) { this.sendToChat('Usage: /stres worldpack load <packId>'); return ''; }
            this.loadWorldpack(id);
            return '';
          }
          this.sendToChat('Usage: /stres worldpack [status|load <packId>]');
          return '';
        }
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
        case 'setapi': {
          const url = (parts[2] || '').trim();
          if (!url) {
            this.sendToChat('Usage: /stres setapi http://host:port');
            return '';
          }
          const s = window.extension_settings || (window.SillyTavern?.getContext?.().extensionSettings);
          s[extensionName] = s[extensionName] || {};
          s[extensionName].serverUrl = url.replace(/\/$/, '');
          try { if (stresClient) stresClient.baseUrl = s[extensionName].serverUrl; } catch {}
          try { const ctx = window.SillyTavern?.getContext?.(); (ctx?.saveSettingsDebounced || window.saveSettingsDebounced)?.(); } catch {}
          try { window.STRES?.refreshSettingsUI?.(); } catch {}
          this.sendToChat(`✅ API URL set to ${s[extensionName].serverUrl}`);
          return '';
        }
        case 'set': {
          const key = (parts[2] || '').toLowerCase();
          const value = (parts.slice(3).join(' ') || '').trim();
          const s = window.extension_settings || (window.SillyTavern?.getContext?.().extensionSettings);
          s[extensionName] = s[extensionName] || {};
          if (key === 'campaign') {
            s[extensionName].campaignId = value || null;
            this.sendToChat(`✅ Campaign ID set to ${s[extensionName].campaignId || 'None'}`);
          } else if (key === 'worldpack') {
            s[extensionName].worldpackId = value || null;
            try { const ctx = window.SillyTavern?.getContext?.(); (ctx?.saveSettingsDebounced || window.saveSettingsDebounced)?.(); } catch {}
            try { window.STRES?.refreshSettingsUI?.(); } catch {}
            this.sendToChat(`✅ Worldpack ID set to ${s[extensionName].worldpackId || 'None'}`);
          } else if (key === 'char' || key === 'character') {
            s[extensionName].characterId = value || null;
            this.sendToChat(`✅ Character ID set to ${s[extensionName].characterId || 'None'}`);
          } else {
            this.sendToChat('Usage: /stres set campaign <id> | /stres set worldpack <id> | /stres set character <id>');
            return '';
          }
          try { const ctx = window.SillyTavern?.getContext?.(); (ctx?.saveSettingsDebounced || window.saveSettingsDebounced)?.(); } catch {}
          try { window.STRES?.refreshSettingsUI?.(); } catch {}
          return '';
        }
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
    let wpStatus = 'checking...';

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

    try {
      const cur = await stresClient.getCurrentWorldpack();
      if (cur && cur.success) {
        wpStatus = `${cur.id}@${cur.version}`;
      } else {
        wpStatus = 'none';
      }
    } catch {
      wpStatus = 'error';
    }

    const message = `
**STRES Status**
• Version: 0.1.2
• API: ${apiBase} (${apiStatus})
• Default API: ${defaultSettings.serverUrl}
• Settings API: ${settings.serverUrl || 'not set'}
• Campaign ID: ${settings.campaignId || 'None'}
• Worldpack ID: ${settings.worldpackId || 'None'}
• Active Worldpack: ${wpStatus}
• Character ID: ${settings.characterId || 'None'}
• Extension: Loaded ✅
    `.trim();

    this.sendToChat(message);
    return '';
  },

  async showWorldpack() {
    try {
      const cur = await stresClient.getCurrentWorldpack();
      if (cur && cur.success) {
        this.sendToChat(`**Worldpack**\n• Active: ${cur.id}@${cur.version}\n• Loaded At: ${cur.loadedAt || 'unknown'}`);
      } else {
        this.sendToChat('**Worldpack**\n• Active: None');
      }
    } catch (e) {
      this.sendToChat(`**Worldpack**\n• Error: ${e?.message || e}`);
    }
    return '';
  },

  async loadWorldpack(id) {
    try {
      const res = await stresClient.loadWorldpackById(id);
      const s = window.extension_settings || (window.SillyTavern?.getContext?.().extensionSettings);
      s[extensionName] = s[extensionName] || {};
      s[extensionName].worldpackId = id;
      try { const ctx = window.SillyTavern?.getContext?.(); (ctx?.saveSettingsDebounced || window.saveSettingsDebounced)?.(); } catch {}
      try { window.STRES?.refreshSettingsUI?.(); } catch {}
      this.sendToChat(`✅ Loaded worldpack ${res.id}@${res.version}`);
    } catch (e) {
      this.sendToChat(`❌ Failed to load worldpack: ${e?.message || e}`);
    }
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
• /stres worldpack - Show active worldpack
• /stres worldpack load <id> - Load worldpack by ID
• /stres join - Reconnect WebSocket
• /stres campaign - Show campaign info
• /stres showchat - Show current chat and bound campaign
• /stres bindchat - Bind current chat → current campaign
• /stres settings - Toggle settings panel
• /stres setapi <url> - Set API base URL
• /stres set campaign <id> - Set campaign ID
• /stres set worldpack <id> - Set worldpack ID
• /stres set character <id> - Set character ID
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

  // Auto-bind campaign to current chat, if possible
  try {
    const s = window.extension_settings[extensionName];
    if (s.autoBindCampaignToChat) {
      const chatMetadata = context.chatMetadata || {};
      const currentChatId = context.chatId || chatMetadata.chat_id;
      if (currentChatId) {
        s.chatCampaigns = s.chatCampaigns || {};
        if (s.chatCampaigns[currentChatId]) {
          s.campaignId = s.chatCampaigns[currentChatId];
        } else if (!s.campaignId) {
          // Derive a campaign ID from chat id
          s.campaignId = `chat-${currentChatId}`;
          s.chatCampaigns[currentChatId] = s.campaignId;
        } else {
          s.chatCampaigns[currentChatId] = s.campaignId;
        }
        try { (context?.saveSettingsDebounced || window.saveSettingsDebounced)?.(); } catch {}
      }
    }
  } catch {}

  // If a worldpack is configured, try to ensure it is loaded
  try {
    const s = window.extension_settings[extensionName];
    if (s.worldpackId) {
      stresClient.loadWorldpackById(s.worldpackId).catch(()=>{});
    }
  } catch {}

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

    const fldWp = doc.createElement('div'); fldWp.className = 'stres-field';
    const lblWp = doc.createElement('label'); lblWp.setAttribute('for','stres-worldpack-id'); lblWp.textContent = 'Worldpack ID';
    const inpWp = doc.createElement('input'); inpWp.type = 'text'; inpWp.id = 'stres-worldpack-id'; inpWp.placeholder = 'euterra-test-0.35.2'; inpWp.value = settings.worldpackId || '';
    fldWp.appendChild(lblWp); fldWp.appendChild(inpWp);

    const fldChar = doc.createElement('div'); fldChar.className = 'stres-field';
    const lblChar = doc.createElement('label'); lblChar.setAttribute('for','stres-character-id'); lblChar.textContent = 'Character ID';
    const inpChar = doc.createElement('input'); inpChar.type = 'text'; inpChar.id = 'stres-character-id'; inpChar.placeholder = '0000-...'; inpChar.value = settings.characterId || '';
    fldChar.appendChild(lblChar); fldChar.appendChild(inpChar);

    secConn.appendChild(hConn); secConn.appendChild(fldApi); secConn.appendChild(fldCampaign); secConn.appendChild(fldWp); secConn.appendChild(fldChar);
    content.appendChild(secConn);

    // Footer
    const footer = doc.createElement('div'); footer.className = 'stres-settings__footer';
    const notice = doc.createElement('div'); notice.className = 'stres-notice'; notice.id = 'stres-settings-notice'; notice.dataset.visible = 'false'; notice.textContent = '';

    const btnTest = doc.createElement('button'); btnTest.className = 'stres-btn stres-btn--ghost'; btnTest.textContent = 'Test Connection';
    const btnReset = doc.createElement('button'); btnReset.className = 'stres-btn stres-btn--danger'; btnReset.textContent = 'Reset';
    const btnLoadWp = doc.createElement('button'); btnLoadWp.className = 'stres-btn stres-btn--ghost'; btnLoadWp.textContent = 'Load Worldpack';
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

    btnLoadWp.addEventListener('click', async () => {
      const id = (inpWp.value || '').trim();
      if (!id) { notice.textContent = 'Enter a Worldpack ID first'; notice.dataset.visible = 'true'; setTimeout(()=>{ notice.dataset.visible = 'false'; }, 2000); return; }
      try {
        const res = await stresClient.loadWorldpackById(id);
        notice.textContent = `Loaded ${res.id}@${res.version}`;
      } catch (e) { notice.textContent = `Error: ${e?.message || e}`; }
      notice.dataset.visible = 'true'; setTimeout(()=>{ notice.dataset.visible = 'false'; }, 2500);
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
      s[extensionName].worldpackId = inpWp.value.trim() || null;
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
    footer.appendChild(btnLoadWp);
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
    // Initialize fields from persisted settings
    try { window.STRES.refreshSettingsUI(); } catch {}
  })();

  // Small floating toggle button (in case user can’t find the panel)
  (function addSettingsToggleButton(){
    try {
      const btnId = 'stres-settings-toggle';
      if (doc.getElementById(btnId)) return;
      const btn = doc.createElement('button');
      btn.id = btnId;
      btn.className = 'stres-btn stres-btn--icon';
      btn.title = 'STRES Settings';
      btn.textContent = '⚙';
      btn.style.position = 'fixed';
      btn.style.right = '1rem';
      btn.style.bottom = '1rem';
      btn.style.zIndex = '61';
      btn.style.background = 'var(--stres-surface)';
      btn.style.border = '1px solid var(--stres-border)';
      btn.style.borderRadius = '999px';
      btn.style.width = '36px';
      btn.style.height = '36px';
      btn.style.lineHeight = '34px';
      btn.addEventListener('click', () => window.STRES?.toggleSettings?.());
      root.appendChild(btn);
    } catch {}
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
      try { integrateWithExtensionsManager(); } catch {}
    });
  });
} else {
  initializeExtension().then(() => {
    setTimeout(hookChatInput, 1000);
    try { integrateWithExtensionsManager(); } catch {}
  });
}

// Register settings panel in SillyTavern's Extensions manager
function integrateWithExtensionsManager() {
  const doc = document;
  const settingsKey = `${extensionName}`;
  const drawerId = `${settingsKey}-settings-drawer`;

  function render() {
    if (doc.getElementById(drawerId)) return; // already added
    const container = doc.getElementById(`${settingsKey}-container`) || doc.getElementById('extensions_settings2');
    if (!container) return;

    // Drawer structure mirrors ST style
    const drawer = doc.createElement('div');
    drawer.id = drawerId;
    drawer.classList.add('inline-drawer');

    const toggle = doc.createElement('div');
    toggle.classList.add('inline-drawer-toggle','inline-drawer-header');
    const title = doc.createElement('b'); title.textContent = 'STRES';
    const icon = doc.createElement('div'); icon.classList.add('inline-drawer-icon','fa-solid','fa-circle-chevron-down','down');
    toggle.append(title, icon);

    const content = doc.createElement('div');
    content.classList.add('inline-drawer-content');

    // Form fields
    const fld = (labelText, inputEl) => {
      const wrap = doc.createElement('div'); wrap.style.margin = '6px 0';
      const label = doc.createElement('label'); label.textContent = labelText; label.style.display='block'; label.style.fontSize='12px'; label.style.opacity='0.8';
      wrap.append(label, inputEl); return wrap;
    };
    const api = doc.createElement('input'); api.type = 'text'; api.id = 'stres-em-api-url'; api.placeholder = 'http://localhost:3001'; api.style.width='100%';
    const camp = doc.createElement('input'); camp.type = 'text'; camp.id = 'stres-em-campaign-id'; camp.placeholder = 'default-campaign'; camp.style.width='100%';
    const wp = doc.createElement('input'); wp.type = 'text'; wp.id = 'stres-em-worldpack-id'; wp.placeholder = 'euterra-test-0.35.2'; wp.style.width='100%';
    const chr = doc.createElement('input'); chr.type = 'text'; chr.id = 'stres-em-character-id'; chr.placeholder = '0000-...'; chr.style.width='100%';

    // Buttons
    const actions = doc.createElement('div'); actions.style.display='flex'; actions.style.gap='8px'; actions.style.marginTop='8px';
    const btnTest = doc.createElement('button'); btnTest.className='menu_button'; btnTest.textContent='Test Connection';
    const btnSave = doc.createElement('button'); btnSave.className='menu_button'; btnSave.textContent='Save';
    const btnReset = doc.createElement('button'); btnReset.className='menu_button'; btnReset.textContent='Reset';
    const btnLoadWp2 = doc.createElement('button'); btnLoadWp2.className='menu_button'; btnLoadWp2.textContent='Load Worldpack';
    actions.append(btnTest, btnLoadWp2, btnReset, btnSave);

    const note = doc.createElement('div'); note.id='stres-em-note'; note.style.fontSize='12px'; note.style.opacity='0.8'; note.style.marginTop='6px';

    content.append(
      fld('API Base URL', api),
      fld('Campaign ID', camp),
      fld('Worldpack ID', wp),
      fld('Character ID', chr),
      actions,
      note
    );

    drawer.append(toggle, content);
    container.append(drawer);

    // Toggle handling
    toggle.addEventListener('click', function(){
      this.classList.toggle('open');
      icon.classList.toggle('down');
      icon.classList.toggle('up');
      content.classList.toggle('open');
    });

    // Load current settings
    function refresh() {
      const s = (window.extension_settings?.[extensionName]) || {};
      api.value = s.serverUrl || defaultSettings.serverUrl;
      camp.value = s.campaignId || '';
      wp.value = s.worldpackId || '';
      chr.value = s.characterId || '';
    }
    refresh();

    // Actions
    btnReset.addEventListener('click', () => { refresh(); note.textContent = 'Defaults restored (not saved).'; });
    btnSave.addEventListener('click', () => {
      const s = window.extension_settings || (window.SillyTavern?.getContext?.().extensionSettings);
      s[extensionName] = s[extensionName] || {};
      s[extensionName].serverUrl = (api.value || '').trim().replace(/\/$/, '') || defaultSettings.serverUrl;
      s[extensionName].campaignId = (camp.value || '').trim() || null;
      s[extensionName].worldpackId = (wp.value || '').trim() || null;
      s[extensionName].characterId = (chr.value || '').trim() || null;
      try { if (stresClient) stresClient.baseUrl = s[extensionName].serverUrl; } catch {}
      try { const ctx = window.SillyTavern?.getContext?.(); (ctx?.saveSettingsDebounced || window.saveSettingsDebounced)?.(); } catch {}
      try { window.STRES?.refreshSettingsUI?.(); } catch {}
      note.textContent = 'Settings saved.';
    });
    btnTest.addEventListener('click', async () => {
      const url = (api.value || '').trim().replace(/\/$/, '');
      try {
        const res = await fetch((url||'http://localhost:3001') + '/health');
        note.textContent = res.ok ? 'Healthy' : `HTTP ${res.status}`;
      } catch (e) { note.textContent = String(e?.message || e); }
    });
    btnLoadWp2.addEventListener('click', async () => {
      const id = (wp.value || '').trim();
      if (!id) { note.textContent = 'Enter a Worldpack ID first'; return; }
      try { const r = await stresClient.loadWorldpackById(id); note.textContent = `Loaded ${r.id}@${r.version}`; }
      catch(e){ note.textContent = String(e?.message || e); }
    });
  }

  // Try now and observe DOM for when settings panel mounts
  render();
  if (!document.getElementById('extensions_settings2')) {
    const obs = new MutationObserver(() => {
      if (document.getElementById('extensions_settings2')) { try { render(); } catch {} obs.disconnect(); }
    });
    obs.observe(document.body, { childList:true, subtree:true });
  }
}
