/**
 * STRES SillyTavern Integration Hooks
 * Simplified JavaScript version for direct browser execution
 */

(function() {
    'use strict';
    
    // Check if we're in SillyTavern environment
    if (typeof window.SillyTavern === 'undefined') {
        console.warn('[STRES] SillyTavern global not found. Extension may not work properly.');
        return;
    }
    
    const STRES = window.STRES || {};
    window.STRES = STRES;
    
    // Configuration
    const CONFIG = {
        extensionName: 'STRES',
        version: '2.0.0',
        apiEndpoint: 'http://localhost:3000/api',
        debugMode: true
    };
    
    // Logging utility
    const log = (message, ...args) => {
        if (CONFIG.debugMode) {
            console.log(`[${CONFIG.extensionName}]`, message, ...args);
        }
    };
    
    // Initialize STRES state
    STRES.state = {
        isInitialized: false,
        currentCampaign: null,
        currentCharacter: null,
        inventory: {
            items: [],
            capacity: 100,
            used: 0
        },
        settings: {
            autoSync: true,
            showQuickbar: true,
            enableNotifications: true
        }
    };
    
    // API Client
    STRES.api = {
        async request(endpoint, options = {}) {
            try {
                const response = await fetch(`${CONFIG.apiEndpoint}${endpoint}`, {
                    ...options,
                    headers: {
                        'Content-Type': 'application/json',
                        ...options.headers
                    }
                });
                
                if (!response.ok) {
                    throw new Error(`API Error: ${response.status} ${response.statusText}`);
                }
                
                return await response.json();
            } catch (error) {
                log('API request failed:', error);
                throw error;
            }
        },
        
        async getCampaigns() {
            return this.request('/campaigns');
        },
        
        async getCharacters(campaignId) {
            return this.request(`/campaigns/${campaignId}/characters`);
        },
        
        async getInventory(characterId) {
            return this.request(`/inventory/items/${characterId}`);
        }
    };
    
    // Inventory Manager
    STRES.inventory = {
        async loadInventory(characterId) {
            try {
                const data = await STRES.api.getInventory(characterId);
                if (data.success) {
                    STRES.state.inventory = data.data;
                    this.updateUI();
                }
                return data;
            } catch (error) {
                log('Failed to load inventory:', error);
                return { success: false, error: error.message };
            }
        },
        
        updateUI() {
            // Update quickbar if it exists
            const quickbar = document.querySelector('#stres-quickbar-host');
            if (quickbar) {
                this.renderQuickbar(quickbar);
            }
            
            // Dispatch event for other components
            window.dispatchEvent(new CustomEvent('stres:inventory:updated', {
                detail: STRES.state.inventory
            }));
        },
        
        renderQuickbar(container) {
            const { items, capacity, used } = STRES.state.inventory;
            const percentUsed = (used / capacity) * 100;
            
            container.innerHTML = `
                <div class="stres-quickbar">
                    <div class="stres-quickbar-header">
                        <span class="stres-quickbar-title">Inventory</span>
                        <span class="stres-quickbar-capacity">${used}/${capacity}</span>
                    </div>
                    <div class="stres-quickbar-progress">
                        <div class="stres-quickbar-progress-bar" style="width: ${percentUsed}%"></div>
                    </div>
                    <div class="stres-quickbar-items">
                        ${items.slice(0, 5).map(item => `
                            <div class="stres-quickbar-item" data-item-id="${item.id}">
                                <span class="stres-quickbar-item-name">${item.name}</span>
                                <span class="stres-quickbar-item-qty">${item.quantity || 1}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }
    };
    
    // Chat Integration
    STRES.chat = {
        processMessage(message) {
            // Check for inventory commands
            if (message.startsWith('/inventory') || message.startsWith('/inv')) {
                this.handleInventoryCommand(message);
                return true; // Prevent default handling
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
                default:
                    this.showHelp();
            }
        },
        
        handleStresCommand(command) {
            const parts = command.split(' ');
            const action = parts[1];
            
            switch(action) {
                case 'status':
                    this.showStatus();
                    break;
                case 'campaign':
                    this.showCampaign();
                    break;
                case 'settings':
                    window.STRES.toggleSettings();
                    break;
                default:
                    this.showHelp();
            }
        },
        
        showInventory() {
            const { items, capacity, used } = STRES.state.inventory;
            const message = `
**Inventory (${used}/${capacity})**
${items.map(item => `• ${item.name} ${item.quantity > 1 ? `(${item.quantity})` : ''}`).join('\n')}
            `.trim();
            
            this.sendToChat(message);
        },
        
        showStatus() {
            const message = `
**STRES Status**
• Version: ${CONFIG.version}
• API: ${CONFIG.apiEndpoint}
• Campaign: ${STRES.state.currentCampaign || 'None'}
• Character: ${STRES.state.currentCharacter || 'None'}
            `.trim();
            
            this.sendToChat(message);
        },
        
        showHelp() {
            const message = `
**STRES Commands**
• /inventory show - Display inventory
• /inventory add [item] - Add item
• /inventory remove [item] - Remove item
• /stres status - Show STRES status
• /stres campaign - Show campaign info
• /stres settings - Toggle settings panel
            `.trim();
            
            this.sendToChat(message);
        },
        
        sendToChat(message) {
            // Try to use SillyTavern's chat system if available
            if (window.SillyTavern && typeof window.SillyTavern.sendSystemMessage === 'function') {
                window.SillyTavern.sendSystemMessage(message);
            } else {
                // Fallback to console
                console.log(message);
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
    
    // Hook into SillyTavern events
    STRES.hooks = {
        install() {
            // Hook into chat input
            this.hookChatInput();
            
            // Hook into character changes
            this.hookCharacterChange();
            
            // Listen for SillyTavern events
            this.listenToEvents();
            
            log('Hooks installed');
        },
        
        hookChatInput() {
            // Override or hook into chat submission
            const chatForm = document.querySelector('#send_form');
            if (chatForm) {
                const originalSubmit = chatForm.onsubmit;
                chatForm.onsubmit = function(e) {
                    const input = document.querySelector('#send_textarea');
                    if (input && STRES.chat.processMessage(input.value)) {
                        e.preventDefault();
                        input.value = '';
                        return false;
                    }
                    if (originalSubmit) {
                        return originalSubmit.call(this, e);
                    }
                };
            }
        },
        
        hookCharacterChange() {
            // Listen for character selection changes
            document.addEventListener('click', (e) => {
                if (e.target.closest('.character_select')) {
                    const characterElement = e.target.closest('.character_select');
                    const characterName = characterElement.querySelector('.ch_name')?.textContent;
                    if (characterName) {
                        STRES.state.currentCharacter = characterName;
                        log('Character changed to:', characterName);
                        
                        // Load inventory for new character
                        // This would need proper character ID mapping
                        // STRES.inventory.loadInventory(characterId);
                    }
                }
            });
        },
        
        listenToEvents() {
            // Listen for SillyTavern custom events if they exist
            window.addEventListener('character_changed', (e) => {
                log('Character changed event:', e.detail);
            });
            
            window.addEventListener('chat_changed', (e) => {
                log('Chat changed event:', e.detail);
            });
            
            window.addEventListener('world_info_updated', (e) => {
                log('World info updated event:', e.detail);
            });
        }
    };
    
    // Initialize extension
    STRES.init = function() {
        if (STRES.state.isInitialized) {
            log('Already initialized');
            return;
        }
        
        log('Initializing STRES Extension...');
        
        // Install hooks
        STRES.hooks.install();
        
        // Check API connection
        STRES.api.request('/health')
            .then(data => {
                log('API connected:', data);
            })
            .catch(error => {
                console.error('[STRES] Failed to connect to API:', error);
                console.warn('[STRES] Extension will work in offline mode');
            });
        
        // Initialize UI components
        setTimeout(() => {
            STRES.inventory.updateUI();
        }, 100);
        
        STRES.state.isInitialized = true;
        log('Initialization complete');
        
        // Dispatch ready event
        window.dispatchEvent(new CustomEvent('stres:ready', {
            detail: { version: CONFIG.version }
        }));
    };
    
    // Auto-initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', STRES.init);
    } else {
        // DOM already loaded
        setTimeout(STRES.init, 100);
    }
    
    // Expose STRES globally for debugging
    window.STRES = STRES;
    
})();