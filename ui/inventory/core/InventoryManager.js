"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inventoryManager = exports.InventoryManager = void 0;
class InventoryManager {
    constructor() {
        this.cache = new Map();
        this.cacheTimeout = 30000;
        this.apiBase = '/api/inventory';
        this.updateCallbacks = new Set();
        this.currentPlayerId = null;
        this.initializeWebSocket();
    }
    initializeWebSocket() {
        try {
            const wsUrl = `ws://${window.location.host}/api/inventory/ws`;
            const ws = new WebSocket(wsUrl);
            ws.onmessage = (event) => {
                const update = JSON.parse(event.data);
                this.handleInventoryUpdate(update);
            };
            ws.onerror = (error) => {
                console.warn('Inventory WebSocket error, falling back to polling:', error);
                this.startPolling();
            };
            ws.onclose = () => {
                setTimeout(() => this.initializeWebSocket(), 5000);
            };
        }
        catch (error) {
            console.warn('WebSocket not available, using polling:', error);
            this.startPolling();
        }
    }
    startPolling() {
        setInterval(async () => {
            if (this.currentPlayerId) {
                const inventory = await this.fetchInventory(this.currentPlayerId);
                if (inventory) {
                    this.handleInventoryUpdate({
                        type: 'weight_changed',
                        inventory,
                        timestamp: Date.now()
                    });
                }
            }
        }, 10000);
    }
    async getPlayerInventory(playerId) {
        const id = playerId || this.currentPlayerId || 'default';
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
    async executeAction(action) {
        try {
            const response = await fetch(`${this.apiBase}/action`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...action,
                    playerId: this.currentPlayerId
                })
            });
            if (!response.ok) {
                throw new Error(`Action failed: ${response.status}`);
            }
            const result = await response.json();
            if (result.success && result.inventory) {
                const inventory = this.transformApiData(result.inventory);
                this.cache.set(this.currentPlayerId, {
                    data: inventory,
                    timestamp: Date.now()
                });
                this.handleInventoryUpdate({
                    type: this.getUpdateType(action.type),
                    itemId: action.itemId,
                    inventory,
                    timestamp: Date.now()
                });
            }
            return {
                success: result.success,
                message: result.message || this.getActionMessage(action, result.success),
                updatedInventory: result.inventory,
                effects: result.effects
            };
        }
        catch (error) {
            console.error('Failed to execute action:', error);
            return {
                success: false,
                message: 'Failed to execute action. Please try again.'
            };
        }
    }
    getUpdateType(actionType) {
        switch (actionType) {
            case 'equip': return 'item_equipped';
            case 'use': return 'item_used';
            case 'drop': return 'item_removed';
            case 'store': return 'item_removed';
            default: return 'weight_changed';
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
