"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inventoryManager = exports.InventoryManager = void 0;
class InventoryManager {
    constructor() {
        this.cache = new Map();
        this.cacheTimeout = 30000;
        this.updateCallbacks = new Set();
        this.currentPlayerId = null;
        this.wsSubscription = null;
        this.pollingInterval = null;

        // Get API base from STRES settings if available
        this.updateApiBase();

        // WebSocket integration with unified service
        this.initializeWebSocket();
    }

    updateApiBase() {
        if (window.STRES && window.STRES.api) {
            this.apiBase = window.STRES.api.getApiBase() + '/api/inventory';
        } else {
            this.apiBase = 'http://localhost:3001/api/inventory';
        }
    }
    initializeWebSocket() {
        // Wait for STRES to be initialized
        const initWebSocket = () => {
            if (window.STRES && window.STRES.websocket) {
                // Subscribe to inventory events from the unified WebSocket service
                this.wsSubscription = window.STRES.websocket.on('inventory', (event) => {
                    const { type, data } = event;

                    // Transform unified envelope to inventory update format
                    let updateType = 'inventory_updated';
                    if (type === 'inventory.item_added') {
                        updateType = 'item_added';
                    } else if (type === 'inventory.item_removed') {
                        updateType = 'item_removed';
                    } else if (type === 'inventory.item_used') {
                        updateType = 'item_used';
                    }

                    const update = {
                        type: updateType,
                        inventory: data.inventory,
                        itemId: data.itemId,
                        item: data.item,
                        timestamp: event.timestamp
                    };

                    this.handleInventoryUpdate(update);
                });

                console.log('[InventoryManager] WebSocket integration initialized');
            } else {
                // STRES not ready yet, try again
                setTimeout(initWebSocket, 1000);
            }
        };

        initWebSocket();
    }
    startPolling() {
        // Only start polling if WebSocket is not available or disconnected
        if (this.wsSubscription) {
            console.log('[InventoryManager] WebSocket available, skipping polling');
            return;
        }

        console.log('[InventoryManager] Starting polling fallback (10s interval)');
        this.pollingInterval = setInterval(async () => {
            if (this.currentPlayerId && !this.wsSubscription) {
                const inventory = await this.fetchInventory(this.currentPlayerId);
                if (inventory) {
                    this.handleInventoryUpdate({
                        type: 'inventory_updated',
                        inventory,
                        timestamp: Date.now()
                    });
                }
            }
        }, 10000);
    }
    async getPlayerInventory(playerId) {
        let id = playerId || this.currentPlayerId;

        // If no ID provided, try to get from STRES settings
        if (!id && window.STRES) {
            // This would need a way to get character ID from STRES settings
            // For now, we'll use the default
            id = 'default';
        }

        id = id || 'default';
        this.currentPlayerId = id;
        const cached = this.cache.get(id);
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
            return cached.data;
        }
        const inventory = await this.fetchInventory(id);
        if (inventory) {
            this.cache.set(id, { data: inventory, timestamp: Date.now() });
            return inventory;
        }
        return this.getDefaultInventory();
    }
    async fetchInventory(playerId) {
        try {
            const response = await fetch(`${this.apiBase}/${playerId}`);
            if (!response.ok)
                throw new Error(`Failed to fetch inventory: ${response.status}`);
            const data = await response.json();
            return this.transformApiData(data);
        }
        catch (error) {
            console.error('Failed to fetch inventory:', error);
            return null;
        }
    }
    transformApiData(apiData) {
        const items = apiData.items || [];
        return {
            items,
            carryWeight: this.calculateWeight(items),
            maxWeight: apiData.maxWeight || 60,
            currency: apiData.currency || { gold: 0, silver: 0, copper: 0 },
            weapons: items.filter((i) => i.type === 'weapon'),
            armor: items.filter((i) => i.type === 'armor'),
            consumables: items.filter((i) => i.type === 'consumable'),
            equippedWeapon: items.find((i) => i.type === 'weapon' && i.equipped),
            equippedArmor: items.filter((i) => i.type === 'armor' && i.equipped)
        };
    }
    calculateWeight(items) {
        return items.reduce((total, item) => total + (item.weight * item.quantity), 0);
    }
    getDefaultInventory() {
        return {
            items: [],
            carryWeight: 0,
            maxWeight: 60,
            currency: { gold: 0, silver: 0, copper: 0 },
            weapons: [],
            armor: [],
            consumables: [],
            equippedWeapon: undefined,
            equippedArmor: []
        };
    }
    async addItem(characterId, itemId, quantity = 1) {
        try {
            const response = await fetch(`${this.apiBase}/${characterId}/items`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ itemId, quantity })
            });
            if (!response.ok) {
                throw new Error(`Failed to add item: ${response.status}`);
            }
            const result = await response.json();
            if (result.inventory) {
                const inventory = this.transformApiData(result.inventory);
                this.cache.set(characterId, {
                    data: inventory,
                    timestamp: Date.now()
                });
                this.handleInventoryUpdate({
                    type: 'item_added',
                    itemId,
                    inventory,
                    timestamp: Date.now()
                });
            }
            return {
                success: true,
                message: `Added ${quantity} ${itemId}(s) to inventory`,
                updatedInventory: result.inventory
            };
        }
        catch (error) {
            console.error('Failed to add item:', error);
            return {
                success: false,
                message: 'Failed to add item. Please try again.'
            };
        }
    }

    async removeItem(characterId, itemId, quantity = 1) {
        try {
            const response = await fetch(`${this.apiBase}/${characterId}/items/${itemId}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ quantity })
            });
            if (!response.ok) {
                throw new Error(`Failed to remove item: ${response.status}`);
            }
            const result = await response.json();
            if (result.inventory) {
                const inventory = this.transformApiData(result.inventory);
                this.cache.set(characterId, {
                    data: inventory,
                    timestamp: Date.now()
                });
                this.handleInventoryUpdate({
                    type: 'item_removed',
                    itemId,
                    inventory,
                    timestamp: Date.now()
                });
            }
            return {
                success: true,
                message: `Removed ${quantity} ${itemId}(s) from inventory`,
                updatedInventory: result.inventory
            };
        }
        catch (error) {
            console.error('Failed to remove item:', error);
            return {
                success: false,
                message: 'Failed to remove item. Please try again.'
            };
        }
    }

    async useItem(characterId, itemId) {
        try {
            const response = await fetch(`${this.apiBase}/${characterId}/items/${itemId}/use`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            if (!response.ok) {
                throw new Error(`Failed to use item: ${response.status}`);
            }
            const result = await response.json();
            if (result.inventory) {
                const inventory = this.transformApiData(result.inventory);
                this.cache.set(characterId, {
                    data: inventory,
                    timestamp: Date.now()
                });
                this.handleInventoryUpdate({
                    type: 'item_used',
                    itemId,
                    inventory,
                    timestamp: Date.now()
                });
            }
            return {
                success: true,
                message: `Used ${itemId}`,
                updatedInventory: result.inventory,
                effects: result.effects
            };
        }
        catch (error) {
            console.error('Failed to use item:', error);
            return {
                success: false,
                message: 'Failed to use item. Please try again.'
            };
        }
    }

    // Legacy method for backward compatibility - routes to appropriate new method
    async executeAction(action) {
        const characterId = action.characterId || this.currentPlayerId;
        if (!characterId) {
            return { success: false, message: 'No character ID specified' };
        }

        switch (action.type) {
            case 'add':
                return this.addItem(characterId, action.itemId, action.quantity || 1);
            case 'remove':
                return this.removeItem(characterId, action.itemId, action.quantity || 1);
            case 'use':
                return this.useItem(characterId, action.itemId);
            default:
                return { success: false, message: 'Unsupported action type' };
        }
    }
    getUpdateType(actionType) {
        switch (actionType) {
            case 'add': return 'item_added';
            case 'remove': return 'item_removed';
            case 'use': return 'item_used';
            case 'equip': return 'item_equipped';
            case 'drop': return 'item_removed';
            case 'store': return 'item_removed';
            default: return 'inventory_updated';
        }
    }
    getActionMessage(action, success) {
        if (!success)
            return `Failed to ${action.type} item`;
        switch (action.type) {
            case 'equip': return 'Item equipped successfully';
            case 'unequip': return 'Item unequipped successfully';
            case 'use': return 'Item used successfully';
            case 'drop': return 'Item dropped';
            case 'store': return 'Item stored successfully';
            default: return 'Action completed';
        }
    }
    subscribeToUpdates(callback) {
        this.updateCallbacks.add(callback);
        return () => this.updateCallbacks.delete(callback);
    }
    handleInventoryUpdate(update) {
        if (this.currentPlayerId) {
            this.cache.set(this.currentPlayerId, {
                data: update.inventory,
                timestamp: Date.now()
            });
        }
        this.updateCallbacks.forEach(callback => callback(update));
    }
    clearCache() {
        this.cache.clear();
    }

    disconnectWebSocket() {
        if (this.wsSubscription) {
            this.wsSubscription(); // Call unsubscribe function
            this.wsSubscription = null;
        }
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
    }

    isWebSocketConnected() {
        return this.wsSubscription !== null;
    }
    async searchItems(query) {
        const inventory = await this.getPlayerInventory();
        const lowerQuery = query.toLowerCase();
        return inventory.items.filter(item => {
            var _a;
            return item.name.toLowerCase().includes(lowerQuery) ||
                item.type.toLowerCase().includes(lowerQuery) ||
                ((_a = item.description) === null || _a === void 0 ? void 0 : _a.toLowerCase().includes(lowerQuery));
        });
    }
    async getItemById(itemId) {
        const inventory = await this.getPlayerInventory();
        return inventory.items.find(item => item.id === itemId);
    }
    getCategoryIcon(category) {
        const icons = {
            weapon: '⚔️',
            armor: '🛡️',
            consumable: '🧪',
            tool: '🔧',
            misc: '📦'
        };
        return icons[category.toLowerCase()] || '📦';
    }
    getItemIcon(item) {
        if (item.icon)
            return item.icon;
        return this.getCategoryIcon(item.type);
    }
}
exports.InventoryManager = InventoryManager;
exports.inventoryManager = new InventoryManager();
