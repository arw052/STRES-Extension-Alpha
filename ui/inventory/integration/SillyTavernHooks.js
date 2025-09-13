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
        apiEndpoint: 'http://localhost:3001',
        debugMode: true
    };
    
    // Minimal combat helper for submitting actions
    STRES.combat = {
        _turnTimer: null,
        clearTurnTimer() {
            if (this._turnTimer) {
                clearTimeout(this._turnTimer);
                this._turnTimer = null;
            }
        },
        scheduleAutoAct(turn) {
            this.clearTurnTimer();
            // Auto-act in 6 seconds to meet 8s requirement
            this._turnTimer = setTimeout(async () => {
                try {
                    const enemies = Array.isArray(turn.enemies) ? turn.enemies : [];
                    const target = enemies[0]?.id;
                    if (!target) {
                        log('No enemies available to auto-act');
                        return;
                    }
                    log('Auto-acting: attack', target);
                    await this.submitAction(turn, { type: 'attack', targetId: target });
                } catch (e) {
                    log('Auto-act failed:', e);
                }
            }, 6000);
        },
        async submitAction(turn, action) {
            try {
                const apiBase = STRES.api.getApiBase();
                const res = await fetch(`${apiBase}/api/combat/act`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        encounterId: turn.encounterId,
                        round: turn.round,
                        actorId: turn.actorId,
                        action
                    })
                });
                if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
                const data = await res.json();
                return { success: true, data };
            } catch (e) {
                return { success: false, error: e.message };
            }
        }
    };

    // Logging utility
    const log = (message, ...args) => {
        if (CONFIG.debugMode) {
            console.log(`[${CONFIG.extensionName}]`, message, ...args);
        }
    };

    // Settings Manager
    const SettingsManager = {
        get(key, defaultValue) {
            try {
                const saved = localStorage.getItem(`stres-${key}`);
                return saved ? JSON.parse(saved) : defaultValue;
            } catch (error) {
                log('Failed to load setting:', key, error);
                return defaultValue;
            }
        },

        set(key, value) {
            try {
                localStorage.setItem(`stres-${key}`, JSON.stringify(value));
            } catch (error) {
                log('Failed to save setting:', key, error);
            }
        },

        getApiBase() {
            return this.get('apiBase', CONFIG.apiEndpoint);
        },

        setApiBase(value) {
            this.set('apiBase', value);
        },

        getCampaignId() {
            return this.get('campaignId', CONFIG.defaultCampaignId);
        },

        setCampaignId(value) {
            this.set('campaignId', value);
        },

        getCharacterId() {
            return this.get('characterId', CONFIG.defaultCharacterId);
        },

        setCharacterId(value) {
            this.set('characterId', value);
        }
    };

    // WebSocket Service - Unified connection for all real-time updates
    const WebSocketService = {
        ws: null,
        isConnected: false,
        reconnectAttempts: 0,
        maxReconnectAttempts: 5,
        reconnectDelay: 1000,
        eventHandlers: new Map(),
        replayMode: false,

        connect() {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                return; // Already connected
            }

            const apiBase = STRES.api.getApiBase();
            const wsUrl = apiBase.replace(/^http/, 'ws');

            log('Connecting to WebSocket:', wsUrl);

            try {
                this.ws = new WebSocket(wsUrl);

                this.ws.onopen = () => {
                    log('WebSocket connected');
                    this.isConnected = true;
                    this.reconnectAttempts = 0;
                    this.joinCampaign();
                };

                this.ws.onmessage = (event) => {
                    try {
                        const envelope = JSON.parse(event.data);
                        this.handleEnvelope(envelope);
                    } catch (error) {
                        log('Failed to parse WebSocket message:', error, event.data);
                    }
                };

                this.ws.onclose = (event) => {
                    log('WebSocket disconnected:', event.code, event.reason);
                    this.isConnected = false;
                    try { if (window.STRES && window.STRES.state) { window.STRES.state.wsConnected = false; window.STRES.inventory?.startPolling?.(); } } catch(_) {}
                    this.scheduleReconnect();
                };

                this.ws.onerror = (error) => {
                    log('WebSocket error:', error);
                };

            } catch (error) {
                log('Failed to create WebSocket connection:', error);
                this.scheduleReconnect();
            }
        },

        disconnect() {
            if (this.ws) {
                this.ws.close(1000, 'Client disconnect');
                this.ws = null;
            }
            this.isConnected = false;
        },

        scheduleReconnect() {
            if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                log('Max reconnection attempts reached, giving up');
                return;
            }

            this.reconnectAttempts++;
            const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

            log(`Scheduling reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`);

            setTimeout(() => {
                this.connect();
            }, delay);
        },

        joinCampaign() {
            if (!this.isConnected || !this.ws) return;

            const campaignId = SettingsManager.getCampaignId();
            const joinMessage = {
                type: 'join.campaign',
                campaignId: campaignId,
                filters: {
                    channels: ['inventory', 'combat', 'campaign', 'token']
                }
            };

            log('Sending join.campaign:', joinMessage);
            this.ws.send(JSON.stringify(joinMessage));
        },

        handleEnvelope(envelope) {
            const { type, eventId, data, timestamp } = envelope;

            log('Received WS envelope:', type, eventId);

            // Handle replay markers
            if (type === 'replay.start') {
                this.replayMode = true;
                log('Entering replay mode');
                return;
            }

            if (type === 'replay.end') {
                this.replayMode = false;
                log('Exiting replay mode');
                return;
            }

            // Route events by channel
            if (type.startsWith('inventory.')) {
                this.routeEvent('inventory', type, data, eventId, timestamp);
            } else if (type.startsWith('combat.')) {
                this.routeEvent('combat', type, data, eventId, timestamp);
            } else if (type.startsWith('campaign.')) {
                this.routeEvent('campaign', type, data, eventId, timestamp);
            } else if (type.startsWith('token.')) {
                this.routeEvent('token', type, data, eventId, timestamp);
            } else if (type === 'join.ack') {
                log('Join acknowledged by server');
            this.routeEvent('system', type, data, eventId, timestamp);
            } else {
                log('Unhandled event type:', type);
            }
        },

        routeEvent(channel, type, data, eventId, timestamp) {
            const handlers = this.eventHandlers.get(channel) || [];
            handlers.forEach(handler => {
                try {
                    handler({ type, data, eventId, timestamp, channel });
                } catch (error) {
                    log('Error in event handler:', error);
                }
            });
        },

        on(channel, handler) {
            if (!this.eventHandlers.has(channel)) {
                this.eventHandlers.set(channel, []);
            }
            this.eventHandlers.get(channel).push(handler);

            // Return unsubscribe function
            return () => {
                const handlers = this.eventHandlers.get(channel);
                if (handlers) {
                    const index = handlers.indexOf(handler);
                    if (index > -1) {
                        handlers.splice(index, 1);
                    }
                }
            };
        },

        off(channel, handler) {
            const handlers = this.eventHandlers.get(channel);
            if (handlers) {
                const index = handlers.indexOf(handler);
                if (index > -1) {
                    handlers.splice(index, 1);
                }
            }
        }
    };

    // Initialize STRES state
    STRES.state = {
        isInitialized: false,
        apiHealthy: false,
        wsConnected: false,
        currentCampaign: null,
        currentCharacter: null,
        inventory: {
            items: [],
            capacity: 100,
            used: 0
        },
        combat: {
            isActive: false,
            currentTurn: null,
            log: []
        },
        settings: {
            autoSync: true,
            showQuickbar: true,
            enableNotifications: true
        }
    };

    // Add WebSocket service to STRES
    STRES.websocket = WebSocketService;
    
    // API Client
    STRES.api = {
        getApiBase() {
            return SettingsManager.getApiBase();
        },

        async request(endpoint, options = {}) {
            try {
                const apiBase = this.getApiBase();
                const response = await fetch(`${apiBase}${endpoint}`, {
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
            return this.request(`/api/inventory/${characterId}`);
        }
    };
    
    // Inventory Manager
    STRES.inventory = {
        _poller: null,
        _pollMs: 10000,
        async loadInventory(characterId) {
            try {
                const raw = await STRES.api.getInventory(characterId);
                const inv = raw && raw.data ? raw.data : raw;
                if (inv && typeof inv === 'object') {
                    STRES.state.inventory = inv;
                    this.updateUI();
                    return { success: true, data: inv };
                }
                return { success: false, error: 'Invalid inventory response' };
            } catch (error) {
                log('Failed to load inventory:', error);
                return { success: false, error: error.message };
            }
        },

        startPolling() {
            if (this._poller) return;
            this._poller = setInterval(async () => {
                try {
                    if (!STRES.state.wsConnected && STRES.state.apiHealthy) {
                        const characterId = SettingsManager.getCharacterId();
                        await this.loadInventory(characterId);
                    }
                } catch (_) {}
            }, this._pollMs);
            log('Inventory polling started');
        },

        stopPolling() {
            if (this._poller) {
                clearInterval(this._poller);
                this._poller = null;
                log('Inventory polling stopped');
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
            const parts = command.split(' ');
            const action = parts[1];

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
                    window.STRES.toggleSettings();
                    break;
                default:
                    this.showHelp();
            }
        },

        rejoinWebSocket() {
            if (window.STRES && window.STRES.websocket) {
                window.STRES.websocket.disconnect();
                setTimeout(() => {
                    window.STRES.websocket.connect();
                }, 1000);
                this.sendToChat('🔄 Reconnecting to WebSocket...');
            } else {
                this.sendToChat('❌ WebSocket service not available');
            }
        },

        async addItem(argStr) {
            const parts = argStr.trim().split(/\s+/);
            const itemId = parts[0];
            const quantity = parts[1] ? parseInt(parts[1], 10) : 1;
            if (!itemId) {
                this.sendToChat('Usage: /inventory add <itemId> <quantity?>');
                return;
            }
            const characterId = SettingsManager.getCharacterId();
            try {
                const apiBase = STRES.api.getApiBase();
                const res = await fetch(`${apiBase}/api/inventory/${characterId}/items`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ itemId, quantity })
                });
                if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
                const data = await res.json();
                if (data?.inventory) {
                    STRES.state.inventory = data.inventory;
                    STRES.inventory.updateUI();
                } else {
                    await STRES.inventory.loadInventory(characterId);
                }
                this.sendToChat(`✅ Added ${quantity} ${itemId}`);
            } catch (e) {
                this.sendToChat(`❌ Add failed: ${e.message}`);
            }
        },

        async removeItem(argStr) {
            const parts = argStr.trim().split(/\s+/);
            const itemId = parts[0];
            const quantity = parts[1] ? parseInt(parts[1], 10) : 1;
            if (!itemId) {
                this.sendToChat('Usage: /inventory remove <itemId> <quantity?>');
                return;
            }
            const characterId = SettingsManager.getCharacterId();
            try {
                const apiBase = STRES.api.getApiBase();
                const res = await fetch(`${apiBase}/api/inventory/${characterId}/items/${itemId}`, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ quantity })
                });
                if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
                const data = await res.json();
                if (data?.inventory) {
                    STRES.state.inventory = data.inventory;
                    STRES.inventory.updateUI();
                } else {
                    await STRES.inventory.loadInventory(characterId);
                }
                this.sendToChat(`✅ Removed ${quantity} ${itemId}`);
            } catch (e) {
                this.sendToChat(`❌ Remove failed: ${e.message}`);
            }
        },

        async useItem(argStr) {
            const itemId = argStr.trim();
            if (!itemId) {
                this.sendToChat('Usage: /inventory use <itemId>');
                return;
            }
            const characterId = SettingsManager.getCharacterId();
            try {
                const apiBase = STRES.api.getApiBase();
                const res = await fetch(`${apiBase}/api/inventory/${characterId}/items/${itemId}/use`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
                const data = await res.json();
                if (data?.inventory) {
                    STRES.state.inventory = data.inventory;
                    STRES.inventory.updateUI();
                }
                this.sendToChat(`✅ Used ${itemId}`);
            } catch (e) {
                this.sendToChat(`❌ Use failed: ${e.message}`);
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
        
        async showStatus() {
            const apiBase = STRES.api.getApiBase();
            let apiStatus = 'checking...';
            try {
                const health = await STRES.api.request('/health');
                apiStatus = health?.status || 'unknown';
            } catch (_) {
                apiStatus = 'unreachable';
            }
            const wsStatus = STRES.state.wsConnected ? 'connected' : 'disconnected';

            const message = `
**STRES Status**
• Version: ${CONFIG.version}
• API: ${apiBase} (${apiStatus})
• WebSocket: ${wsStatus}
• Campaign ID: ${SettingsManager.getCampaignId()}
• Character ID: ${SettingsManager.getCharacterId()}
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
• /inventory use [item] - Use item
• /stres status - Show STRES status
• /stres join - Reconnect WebSocket
• /stres campaign - Show campaign info
• /stres settings - Toggle settings panel
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

        async handleCombatAct(args) {
            if (args.length < 2 || args[0] !== 'attack') {
                this.sendToChat('Usage: /combat act attack <targetId>');
                return;
            }

            const targetId = args[1];

            // Check if we have an active combat manager
            if (!STRES.combatManager) {
                this.sendToChat('Combat system not initialized');
                return;
            }

            const state = STRES.combatManager.getCurrentState();
            if (!state.currentTurn) {
                this.sendToChat('No active turn to act on');
                return;
            }

            this.sendToChat(`Performing attack on ${targetId}...`);
            const result = await STRES.combatManager.performAttack(targetId);

            if (result.success) {
                this.sendToChat('Attack action submitted successfully');
            } else {
                this.sendToChat(`Attack failed: ${result.error}`);
            }
        },

        showCombatStatus() {
            if (!STRES.combatManager) {
                this.sendToChat('Combat system not initialized');
                return;
            }

            const state = STRES.combatManager.getCurrentState();
            const message = `
**Combat Status**
• Active: ${state.isActive ? 'Yes' : 'No'}
• Current Turn: ${state.currentTurn ? `${state.currentTurn.actorId} (Round ${state.currentTurn.round})` : 'None'}
• Log entries: ${state.log.length}
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

        // Initialize managers
        STRES.initManagers();

        // Check API connection
        STRES.api.request('/health')
            .then(data => {
                log('API connected:', data);
                STRES.state.apiHealthy = true;

                // Start polling fallback; it will only fetch when WS is disconnected
                try { STRES.inventory.startPolling(); } catch(_) {}

                // Connect to WebSocket after API is healthy
                STRES.websocket.connect();

                // Set up WebSocket event handlers
                STRES.websocket.on('system', (event) => {
                    if (event.type === 'join.ack') {
                        STRES.state.wsConnected = true;
                        log('WebSocket join acknowledged');
                    }
                });

                // Inventory event handlers
                STRES.websocket.on('inventory', (event) => {
                    const { type, data } = event;
                    log('Inventory event:', type, data);

                    if (data.inventory) {
                        STRES.state.inventory = data.inventory;
                        STRES.inventory.updateUI();
                    }

                    // Show toast notifications for item changes
                    if (type === 'inventory.item_added') {
                        STRES.chat.sendToChat(`📦 Item added: ${data.item?.name || 'Unknown item'}`);
                    } else if (type === 'inventory.item_removed') {
                        STRES.chat.sendToChat(`📦 Item removed: ${data.item?.name || 'Unknown item'}`);
                    } else if (type === 'inventory.item_used') {
                        STRES.chat.sendToChat(`⚔️ Item used: ${data.item?.name || 'Unknown item'}`);
                    }
                });

                // Combat event handlers
                STRES.websocket.on('combat', (event) => {
                    const { type, data } = event;
                    log('Combat event:', type, data);

                    // Update combat state
                    if (type === 'combat.started') {
                        STRES.state.combat.isActive = true;
                        STRES.state.combat.log = [];
                        STRES.chat.sendToChat(`⚔️ Combat started!`);
                    } else if (type === 'combat.ended') {
                        STRES.state.combat.isActive = false;
                        STRES.chat.sendToChat(`⚔️ Combat ended!`);
                    } else if (type === 'combat.turn.requested') {
                        STRES.state.combat.currentTurn = data;
                        STRES.chat.sendToChat(`🎯 Your turn! Actor: ${data.actorId}, Round: ${data.round}`);
                        // Schedule auto-act to ensure response within 8 seconds
                        STRES.combat.scheduleAutoAct(data);
                        log('Turn requested - auto-act scheduled in ~6s');
                    } else if (type === 'combat.action.applied') {
                        STRES.combat.clearTurnTimer();
                        STRES.state.combat.log.push({
                            type: 'action',
                            data,
                            timestamp: event.timestamp
                        });
                        STRES.chat.sendToChat(`✅ Action applied: ${data.action?.type || 'Unknown'}`);
                    } else if (type === 'combat.action.rejected') {
                        STRES.combat.clearTurnTimer();
                        STRES.chat.sendToChat(`❌ Action rejected: ${data.reason || 'Unknown reason'}`);
                    } else if (type === 'combat.carcass.created') {
                        STRES.chat.sendToChat(`💀 Carcass created: ${data.carcassId}`);
                    } else if (type === 'combat.harvested') {
                        STRES.chat.sendToChat(`🌾 Harvest successful: ${data.materialId} x${data.quantity}`);
                    } else if (type === 'combat.ended') {
                        STRES.combat.clearTurnTimer();
                    }
                });

                // Campaign event handlers
                STRES.websocket.on('campaign', (event) => {
                    const { type, data } = event;
                    log('Campaign event:', type, data);

                    if (type === 'campaign.updated') {
                        STRES.chat.sendToChat(`📜 Campaign updated`);
                    }
                });

                // Token event handlers
                STRES.websocket.on('token', (event) => {
                    const { type, data } = event;
                    log('Token event:', type, data);

                    if (type === 'token.usage') {
                        // Optional: display token usage info
                        log('Token usage:', data);
                    }
                });
            })
            .catch(error => {
                console.error('[STRES] Failed to connect to API:', error);
                console.warn('[STRES] Extension will work in offline mode');
                STRES.state.apiHealthy = false;
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

    // Initialize combat and websocket managers
    STRES.initManagers = function() {
        // These will be set by the compiled modules when loaded
        // For now, we'll stub them
        if (typeof window.STRES_COMPILED !== 'undefined') {
            const { WebSocketManager, CombatManager, CombatPanel } = window.STRES_COMPILED;

            if (WebSocketManager && CombatManager && CombatPanel) {
                // Create config manager if not exists
                if (!STRES.configManager) {
                    STRES.configManager = window.STRES_CONFIG_MANAGER || {
                        getEffectiveConfig: () => ({
                            combat: {
                                apiBase: CONFIG.apiEndpoint,
                                campaignId: 'default-campaign',
                                characterId: '22222222-2222-2222-2222-222222222222',
                                enabled: true,
                                showPanel: true,
                                autoAct: false
                            }
                        })
                    };
                }

                // Initialize WebSocket Manager
                STRES.webSocketManager = new WebSocketManager(STRES.configManager);
                const config = STRES.configManager.getEffectiveConfig();
                STRES.webSocketManager.connect(config.combat.apiBase);

                // Initialize Combat Manager
                STRES.combatManager = new CombatManager(STRES.configManager, STRES.webSocketManager);

                // Initialize Combat Panel
                STRES.combatPanel = new CombatPanel(STRES.combatManager, STRES.configManager);
                STRES.combatPanel.mount('#stres-extension-root');

                log('Combat system initialized');
            }
        } else {
            log('Compiled modules not available, combat system disabled');
        }
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
