// Core Inventory Manager for SillyTavern Integration
// Handles inventory state, caching, and API communication

export interface InventoryItem {
  id: string;
  name: string;
  type: 'weapon' | 'armor' | 'consumable' | 'tool' | 'misc';
  quantity: number;
  weight: number;
  value: number;
  equipped?: boolean;
  durability?: number;
  maxDurability?: number;
  enchantments?: string[];
  description?: string;
  icon?: string;
}

export interface InventoryData {
  items: InventoryItem[];
  carryWeight: number;
  maxWeight: number;
  currency: {
    gold: number;
    silver: number;
    copper: number;
  };
  weapons: InventoryItem[];
  armor: InventoryItem[];
  consumables: InventoryItem[];
  equippedWeapon?: InventoryItem;
  equippedArmor?: InventoryItem[];
}

export interface InventoryAction {
  type: 'equip' | 'unequip' | 'use' | 'drop' | 'store' | 'retrieve' | 'trade';
  itemId: string;
  targetId?: string;
  quantity?: number;
}

export interface ActionResult {
  success: boolean;
  message: string;
  updatedInventory?: InventoryData;
  effects?: string[];
}

export interface InventoryUpdate {
  type: 'item_added' | 'item_removed' | 'item_equipped' | 'item_used' | 'weight_changed';
  itemId?: string;
  inventory: InventoryData;
  timestamp: number;
}

export class InventoryManager {
  private cache: Map<string, { data: InventoryData; timestamp: number }> = new Map();
  private cacheTimeout = 30000; // 30 seconds
  private apiBase = '/api/inventory';
  private updateCallbacks: Set<(update: InventoryUpdate) => void> = new Set();
  private currentPlayerId: string | null = null;

  constructor() {
    this.initializeWebSocket();
  }

  private initializeWebSocket(): void {
    try {
      const wsUrl = `ws://${window.location.host}/api/inventory/ws`;
      const ws = new WebSocket(wsUrl);
      
      ws.onmessage = (event) => {
        const update: InventoryUpdate = JSON.parse(event.data);
        this.handleInventoryUpdate(update);
      };
      
      ws.onerror = (error) => {
        console.warn('Inventory WebSocket error, falling back to polling:', error);
        this.startPolling();
      };
      
      ws.onclose = () => {
        setTimeout(() => this.initializeWebSocket(), 5000);
      };
    } catch (error) {
      console.warn('WebSocket not available, using polling:', error);
      this.startPolling();
    }
  }

  private startPolling(): void {
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
    }, 10000); // Poll every 10 seconds
  }

  async getPlayerInventory(playerId?: string): Promise<InventoryData> {
    const id = playerId || this.currentPlayerId || 'default';
    this.currentPlayerId = id;
    
    // Check cache first
    const cached = this.cache.get(id);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }
    
    // Fetch from API
    const inventory = await this.fetchInventory(id);
    if (inventory) {
      this.cache.set(id, { data: inventory, timestamp: Date.now() });
      return inventory;
    }
    
    // Return default empty inventory
    return this.getDefaultInventory();
  }

  private async fetchInventory(playerId: string): Promise<InventoryData | null> {
    try {
      const response = await fetch(`${this.apiBase}/${playerId}`);
      if (!response.ok) throw new Error(`Failed to fetch inventory: ${response.status}`);
      
      const data = await response.json();
      return this.transformApiData(data);
    } catch (error) {
      console.error('Failed to fetch inventory:', error);
      return null;
    }
  }

  private transformApiData(apiData: any): InventoryData {
    const items = apiData.items || [];
    
    return {
      items,
      carryWeight: this.calculateWeight(items),
      maxWeight: apiData.maxWeight || 60,
      currency: apiData.currency || { gold: 0, silver: 0, copper: 0 },
      weapons: items.filter((i: InventoryItem) => i.type === 'weapon'),
      armor: items.filter((i: InventoryItem) => i.type === 'armor'),
      consumables: items.filter((i: InventoryItem) => i.type === 'consumable'),
      equippedWeapon: items.find((i: InventoryItem) => i.type === 'weapon' && i.equipped),
      equippedArmor: items.filter((i: InventoryItem) => i.type === 'armor' && i.equipped)
    };
  }

  private calculateWeight(items: InventoryItem[]): number {
    return items.reduce((total, item) => total + (item.weight * item.quantity), 0);
  }

  private getDefaultInventory(): InventoryData {
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

  async executeAction(action: InventoryAction): Promise<ActionResult> {
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
      
      // Update cache if successful
      if (result.success && result.inventory) {
        const inventory = this.transformApiData(result.inventory);
        this.cache.set(this.currentPlayerId!, { 
          data: inventory, 
          timestamp: Date.now() 
        });
        
        // Notify subscribers
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
    } catch (error) {
      console.error('Failed to execute action:', error);
      return {
        success: false,
        message: 'Failed to execute action. Please try again.'
      };
    }
  }

  private getUpdateType(actionType: string): InventoryUpdate['type'] {
    switch (actionType) {
      case 'equip': return 'item_equipped';
      case 'use': return 'item_used';
      case 'drop': return 'item_removed';
      case 'store': return 'item_removed';
      default: return 'weight_changed';
    }
  }

  private getActionMessage(action: InventoryAction, success: boolean): string {
    if (!success) return `Failed to ${action.type} item`;
    
    switch (action.type) {
      case 'equip': return 'Item equipped successfully';
      case 'unequip': return 'Item unequipped successfully';
      case 'use': return 'Item used successfully';
      case 'drop': return 'Item dropped';
      case 'store': return 'Item stored successfully';
      default: return 'Action completed';
    }
  }

  subscribeToUpdates(callback: (update: InventoryUpdate) => void): () => void {
    this.updateCallbacks.add(callback);
    return () => this.updateCallbacks.delete(callback);
  }

  private handleInventoryUpdate(update: InventoryUpdate): void {
    // Update cache
    if (this.currentPlayerId) {
      this.cache.set(this.currentPlayerId, {
        data: update.inventory,
        timestamp: Date.now()
      });
    }
    
    // Notify all subscribers
    this.updateCallbacks.forEach(callback => callback(update));
  }

  clearCache(): void {
    this.cache.clear();
  }

  async searchItems(query: string): Promise<InventoryItem[]> {
    const inventory = await this.getPlayerInventory();
    const lowerQuery = query.toLowerCase();
    
    return inventory.items.filter(item => 
      item.name.toLowerCase().includes(lowerQuery) ||
      item.type.toLowerCase().includes(lowerQuery) ||
      item.description?.toLowerCase().includes(lowerQuery)
    );
  }

  async getItemById(itemId: string): Promise<InventoryItem | undefined> {
    const inventory = await this.getPlayerInventory();
    return inventory.items.find(item => item.id === itemId);
  }

  getCategoryIcon(category: string): string {
    const icons: Record<string, string> = {
      weapon: '⚔️',
      armor: '🛡️',
      consumable: '🧪',
      tool: '🔧',
      misc: '📦'
    };
    return icons[category.toLowerCase()] || '📦';
  }

  getItemIcon(item: InventoryItem): string {
    if (item.icon) return item.icon;
    return this.getCategoryIcon(item.type);
  }
}

// Export singleton instance
export const inventoryManager = new InventoryManager();