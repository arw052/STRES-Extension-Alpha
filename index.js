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
        break;
      case 'add':
        this.addItem(parts.slice(2).join(' '));
        break;
      case 'remove':
        this.removeItem(parts.slice(2).join(' '));
        break;
      case 'use':
        this.useItem(parts.slice(2).join(' '));
        break;
      default:
        this.showHelp();
    }
  },

  handleStresCommand(command) {
    try {
      const parts = command.split(' ');
      const action = parts && parts.length > 1 ? parts[1] : '';

      switch(action) {
        case 'status':
          this.showStatus();
          break;
        case 'join':
          this.rejoinWebSocket();
          break;
        case 'campaign':
          this.showCampaign();
          break;
        case 'settings':
          window.STRES?.toggleSettings?.();
          break;
        case 'reset':
          this.resetSettings();
          break;
        case 'debug':
          this.showDebugInfo();
          break;
        case 'fixport':
          this.fixPortConfiguration();
          break;
        default:
          this.showHelp();
      }
    } catch (error) {
      console.error('[STRES] Error in handleStresCommand:', error);
      this.sendToChat('❌ Error processing STRES command: ' + error.message);
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
  },

  resetSettings() {
    if (window.extension_settings) {
      window.extension_settings[extensionName] = structuredClone(defaultSettings);
      this.sendToChat('✅ STRES settings reset to defaults');
    } else {
      this.sendToChat('❌ Cannot reset settings - extension_settings not available');
    }
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
  },

  fixPortConfiguration() {
    if (window.extension_settings) {
      if (!window.extension_settings[extensionName]) {
        window.extension_settings[extensionName] = {};
      }
      window.extension_settings[extensionName].serverUrl = "http://localhost:3001";
      this.sendToChat('✅ STRES API URL fixed to http://localhost:3001');
      this.sendToChat('🔄 Try /stres status again to test the connection');
    } else {
      this.sendToChat('❌ Cannot fix port - extension_settings not available');
    }
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
  },

  rejoinWebSocket() {
    this.sendToChat('🔄 WebSocket reconnection requested');
  },

  showCampaign() {
    const settings = window.extension_settings?.[extensionName] || {};
    const message = `
**Campaign Info**
• Campaign ID: ${settings.campaignId || 'None'}
• Server URL: ${settings.serverUrl || defaultSettings.serverUrl}
    `.trim();

    this.sendToChat(message);
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
  },

  async useItem(argStr) {
    const itemId = argStr.trim();
    if (!itemId) {
      this.sendToChat('Usage: /inventory use <itemId>');
      return;
    }
    this.sendToChat(`⚔️ Used ${itemId} (simulated)`);
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
  },

  handleCombatCommand(command) {
    const parts = command.split(' ');
    const subcommand = parts[1];

    switch(subcommand) {
      case 'act':
        this.handleCombatAct(parts.slice(2));
        break;
      case 'status':
        this.showCombatStatus();
        break;
      default:
        this.sendToChat('**Combat Commands:**\n• /combat act attack <targetId> - Submit attack action\n• /combat status - Show current combat state');
    }
  },

  handleCombatAct(args) {
    if (args.length < 2 || args[0] !== 'attack') {
      this.sendToChat('Usage: /combat act attack <targetId>');
      return;
    }

    const targetId = args[1];
    this.sendToChat(`⚔️ Combat action: Attack ${targetId} (simulated)`);
  },

  showCombatStatus() {
    this.sendToChat('**Combat Status**\n• Active: No\n• Current Turn: None\n*Note: Connect to STRES backend for real combat*');
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
