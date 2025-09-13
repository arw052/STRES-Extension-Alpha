/**
 * STRES Runtime - UI Components and Logic
 * Provides the main UI functionality for the STRES extension
 */

(function() {
    'use strict';
    
    const STRES = window.STRES || {};
    window.STRES = STRES;

    // Load compiled modules
    window.STRES_COMPILED = {};
    
    // Quickbar Component
    STRES.mountQuickBar = function(selector) {
        const container = document.querySelector(selector);
        if (!container) return;
        
        container.innerHTML = `
            <div class="stres-quickbar-container">
                <div class="stres-quickbar-toggle" title="STRES Quick Access">
                    <span class="stres-icon">⚔️</span>
                    <span class="stres-label">STRES</span>
                </div>
                <div class="stres-quickbar-menu" style="display: none;">
                    <button class="stres-btn" data-action="inventory">📦 Inventory</button>
                    <button class="stres-btn" data-action="campaign">🗺️ Campaign</button>
                    <button class="stres-btn" data-action="world">🌍 World</button>
                    <button class="stres-btn" data-action="settings">⚙️ Settings</button>
                </div>
            </div>
        `;
        
        // Add event listeners
        const toggle = container.querySelector('.stres-quickbar-toggle');
        const menu = container.querySelector('.stres-quickbar-menu');
        
        toggle?.addEventListener('click', () => {
            const isVisible = menu.style.display !== 'none';
            menu.style.display = isVisible ? 'none' : 'flex';
        });
        
        // Handle button clicks
        container.addEventListener('click', (e) => {
            if (e.target.matches('.stres-btn')) {
                const action = e.target.dataset.action;
                handleQuickBarAction(action);
            }
        });
    };
    
    // Settings Panel Component
    STRES.mountSettingsPanel = function(selector, options = {}) {
        const container = document.querySelector(selector);
        if (!container) return;
        
        const hidden = options.startHidden ? 'true' : 'false';
        
        container.innerHTML = `
            <div class="stres-settings-panel" aria-hidden="${hidden}">
                <div class="stres-settings-header">
                    <h2>STRES Settings</h2>
                    <button class="stres-settings-close" aria-label="Close">✕</button>
                </div>
                <div class="stres-settings-content">
                    <div class="stres-settings-section">
                        <h3>General</h3>
                        <label class="stres-setting">
                            <input type="checkbox" id="stres-auto-sync" checked>
                            <span>Auto-sync with backend</span>
                        </label>
                        <label class="stres-setting">
                            <input type="checkbox" id="stres-show-quickbar" checked>
                            <span>Show quickbar</span>
                        </label>
                        <label class="stres-setting">
                            <input type="checkbox" id="stres-enable-notifications" checked>
                            <span>Enable notifications</span>
                        </label>
                    </div>
                    
                    <div class="stres-settings-section">
                        <h3>API Configuration</h3>
                        <label class="stres-setting-input">
                            <span>Backend URL:</span>
                            <input type="text" id="stres-api-url" value="http://localhost:3001" placeholder="http://localhost:3001">
                        </label>
                        <label class="stres-setting-input">
                            <span>Campaign ID:</span>
                            <input type="text" id="stres-campaign-id" value="default-campaign" placeholder="default-campaign">
                        </label>
                        <label class="stres-setting-input">
                            <span>Character ID:</span>
                            <input type="text" id="stres-character-id" value="22222222-2222-2222-2222-222222222222" placeholder="Character UUID">
                        </label>
                        <button class="stres-btn stres-btn-primary" id="stres-test-connection">Test Connection</button>
                    </div>
                    
                    <div class="stres-settings-section">
                        <h3>Campaign</h3>
                        <label class="stres-setting-input">
                            <span>Active Campaign:</span>
                            <select id="stres-campaign-select">
                                <option value="">None</option>
                            </select>
                        </label>
                        <button class="stres-btn" id="stres-refresh-campaigns">Refresh Campaigns</button>
                    </div>
                    
                    <div class="stres-settings-section">
                        <h3>Debug</h3>
                        <label class="stres-setting">
                            <input type="checkbox" id="stres-debug-mode">
                            <span>Enable debug mode</span>
                        </label>
                        <button class="stres-btn" id="stres-clear-cache">Clear Cache</button>
                    </div>
                </div>
                <div class="stres-settings-footer">
                    <button class="stres-btn stres-btn-primary" id="stres-save-settings">Save Settings</button>
                    <button class="stres-btn" id="stres-reset-settings">Reset to Defaults</button>
                </div>
            </div>
        `;
        
        // Add event listeners
        const panel = container.querySelector('.stres-settings-panel');
        const closeBtn = container.querySelector('.stres-settings-close');
        
        closeBtn?.addEventListener('click', () => {
            panel.setAttribute('aria-hidden', 'true');
        });
        
        // Test connection button
        const testBtn = container.querySelector('#stres-test-connection');
        testBtn?.addEventListener('click', async () => {
            testBtn.disabled = true;
            testBtn.textContent = 'Testing...';

            try {
                const url = document.querySelector('#stres-api-url').value;
                const response = await fetch(`${url}/health`);
                const data = await response.json();

                if (data.status === 'healthy') {
                    testBtn.textContent = '✅ Connected';
                    showNotification('API connection successful!', 'success');
                } else {
                    throw new Error('Unhealthy status');
                }
            } catch (error) {
                testBtn.textContent = '❌ Failed';
                showNotification('API connection failed: ' + error.message, 'error');
            } finally {
                setTimeout(() => {
                    testBtn.disabled = false;
                    testBtn.textContent = 'Test Connection';
                }, 2000);
            }
        });
        
        // Save settings
        const saveBtn = container.querySelector('#stres-save-settings');
        saveBtn?.addEventListener('click', () => {
            saveSettings();
            showNotification('Settings saved!', 'success');
        });
        
        // Load campaigns
        const refreshBtn = container.querySelector('#stres-refresh-campaigns');
        refreshBtn?.addEventListener('click', loadCampaigns);
        
        // Load initial settings
        loadSettings();
    };
    
    // Handle quickbar actions
    function handleQuickBarAction(action) {
        switch(action) {
            case 'inventory':
                showInventoryModal();
                break;
            case 'campaign':
                showCampaignModal();
                break;
            case 'world':
                showWorldModal();
                break;
            case 'settings':
                STRES.toggleSettings();
                break;
        }
    }
    
    // Modal functions
    function showInventoryModal() {
        const modal = createModal('Inventory', `
            <div class="stres-inventory">
                <div class="stres-inventory-stats">
                    <span>Capacity: <strong id="inv-capacity">0/100</strong></span>
                    <span>Weight: <strong id="inv-weight">0 kg</strong></span>
                </div>
                <div class="stres-inventory-grid" id="inventory-grid">
                    <div class="stres-loading">Loading inventory...</div>
                </div>
            </div>
        `);
        
        // Load inventory data
        if (STRES.inventory) {
            STRES.inventory.loadInventory('current');
        }
    }
    
    function showCampaignModal() {
        const campaign = STRES.state?.currentCampaign || 'No active campaign';
        const modal = createModal('Campaign Info', `
            <div class="stres-campaign-info">
                <h3>Current Campaign</h3>
                <p>${campaign}</p>
                <div class="stres-campaign-stats">
                    <div>Characters: <strong>0</strong></div>
                    <div>Locations: <strong>0</strong></div>
                    <div>Session: <strong>0</strong></div>
                </div>
            </div>
        `);
    }
    
    function showWorldModal() {
        const modal = createModal('World Information', `
            <div class="stres-world-info">
                <h3>World Pack</h3>
                <p>No world pack loaded</p>
                <button class="stres-btn">Load World Pack</button>
            </div>
        `);
    }
    
    // Helper functions
    function createModal(title, content) {
        const existing = document.querySelector('.stres-modal');
        if (existing) existing.remove();
        
        const modal = document.createElement('div');
        modal.className = 'stres-modal';
        modal.innerHTML = `
            <div class="stres-modal-backdrop"></div>
            <div class="stres-modal-content">
                <div class="stres-modal-header">
                    <h2>${title}</h2>
                    <button class="stres-modal-close">✕</button>
                </div>
                <div class="stres-modal-body">
                    ${content}
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Add close handlers
        modal.querySelector('.stres-modal-close')?.addEventListener('click', () => modal.remove());
        modal.querySelector('.stres-modal-backdrop')?.addEventListener('click', () => modal.remove());
        
        return modal;
    }
    
    function showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `stres-notification stres-notification-${type}`;
        notification.textContent = message;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.classList.add('stres-notification-show');
        }, 10);
        
        setTimeout(() => {
            notification.classList.remove('stres-notification-show');
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }
    
    function saveSettings() {
        const settings = {
            autoSync: document.querySelector('#stres-auto-sync')?.checked,
            showQuickbar: document.querySelector('#stres-show-quickbar')?.checked,
            enableNotifications: document.querySelector('#stres-enable-notifications')?.checked,
            apiUrl: document.querySelector('#stres-api-url')?.value,
            campaignId: document.querySelector('#stres-campaign-id')?.value,
            characterId: document.querySelector('#stres-character-id')?.value,
            debugMode: document.querySelector('#stres-debug-mode')?.checked,
            campaign: document.querySelector('#stres-campaign-select')?.value
        };

        localStorage.setItem('stres-settings', JSON.stringify(settings));

        // Apply settings to STRES if available
        if (window.STRES) {
            if (window.STRES.state) {
                window.STRES.state.settings = settings;
            }

            // Update STRES settings manager if available
            if (window.STRES.api && window.STRES.api.getApiBase) {
                // This will trigger a reconnection if API base changed
                if (settings.apiUrl && settings.apiUrl !== window.STRES.api.getApiBase()) {
                    console.log('[STRES] API base changed, may need restart');
                }
            }
        }

        showNotification('Settings saved!', 'success');
    }
    
    function loadSettings() {
        const saved = localStorage.getItem('stres-settings');
        if (!saved) return;
        
        try {
            const settings = JSON.parse(saved);
            
            // Apply to UI
            const elements = {
                '#stres-auto-sync': settings.autoSync,
                '#stres-show-quickbar': settings.showQuickbar,
                '#stres-enable-notifications': settings.enableNotifications,
                '#stres-debug-mode': settings.debugMode
            };

            for (const [selector, value] of Object.entries(elements)) {
                const el = document.querySelector(selector);
                if (el) el.checked = value;
            }

            const apiUrl = document.querySelector('#stres-api-url');
            if (apiUrl) apiUrl.value = settings.apiUrl || 'http://localhost:3001';

            const campaignId = document.querySelector('#stres-campaign-id');
            if (campaignId) campaignId.value = settings.campaignId || 'default-campaign';

            const characterId = document.querySelector('#stres-character-id');
            if (characterId) characterId.value = settings.characterId || '22222222-2222-2222-2222-222222222222';

            const campaign = document.querySelector('#stres-campaign-select');
            if (campaign) campaign.value = settings.campaign || '';
            
        } catch (error) {
            console.error('[STRES] Failed to load settings:', error);
        }
    }
    
    async function loadCampaigns() {
        const select = document.querySelector('#stres-campaign-select');
        if (!select || !STRES.api) return;
        
        try {
            const data = await STRES.api.getCampaigns();
            if (data.success && data.data) {
                select.innerHTML = '<option value="">None</option>';
                data.data.forEach(campaign => {
                    const option = document.createElement('option');
                    option.value = campaign.id;
                    option.textContent = campaign.name;
                    select.appendChild(option);
                });
            }
        } catch (error) {
            console.error('[STRES] Failed to load campaigns:', error);
        }
    }
    
    // Load compiled modules dynamically
    async function loadModules() {
        try {
            // Load WebSocketManager
            const wsModule = await import('./inventory/core/WebSocketManager.js');
            window.STRES_COMPILED.WebSocketManager = wsModule.WebSocketManager;

            // Load CombatManager
            const combatModule = await import('./inventory/core/CombatManager.js');
            window.STRES_COMPILED.CombatManager = combatModule.CombatManager;

            // Load CombatPanel
            const panelModule = await import('./inventory/components/CombatPanel.js');
            window.STRES_COMPILED.CombatPanel = panelModule.CombatPanel;

            // Load ConfigManager
            const configModule = await import('./inventory/core/ConfigManager.js');
            window.STRES_CONFIG_MANAGER = configModule.configManager;

            console.log('[STRES] Compiled modules loaded successfully');
        } catch (error) {
            console.warn('[STRES] Failed to load compiled modules:', error);
            console.warn('[STRES] Combat system will be disabled');
        }
    }

    // Initialize when ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', async () => {
            console.log('[STRES] Runtime loaded');
            await loadModules();
        });
    } else {
        console.log('[STRES] Runtime loaded');
        loadModules();
    }
    
})();