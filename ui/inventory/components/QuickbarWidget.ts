// Quickbar Widget Component
// Displays inventory status in the SillyTavern quickbar

import { InventoryManager, InventoryData } from '../core/InventoryManager';
import { configManager } from '../core/ConfigManager';

export class QuickbarWidget {
  private container: HTMLElement | null = null;
  private updateInterval: number | null = null;
  private unsubscribe: (() => void) | null = null;
  private currentData: InventoryData | null = null;

  constructor(private inventoryManager: InventoryManager) {}

  mount(): void {
    this.createWidget();
    this.attachEventListeners();
    this.startAutoUpdate();
    this.updateDisplay();
  }

  private createWidget(): void {
    // Remove existing widget if any
    this.destroy();
    
    // Create widget container
    this.container = document.createElement('div');
    this.container.className = 'stres-inventory-widget';
    this.container.id = 'stres-inventory-widget';
    
    // Get quickbar host or create one
    let quickbarHost = document.getElementById('stres-quickbar-host');
    if (!quickbarHost) {
      // Try to find SillyTavern's quickbar
      const existingQuickbar = document.querySelector('.quickReplyBar') || 
                              document.querySelector('#quickbar') ||
                              document.querySelector('[data-quickbar]');
      
      if (existingQuickbar) {
        quickbarHost = document.createElement('div');
        quickbarHost.id = 'stres-quickbar-host';
        existingQuickbar.appendChild(quickbarHost);
      } else {
        // Create standalone quickbar host
        quickbarHost = document.createElement('div');
        quickbarHost.id = 'stres-quickbar-host';
        quickbarHost.style.cssText = this.getHostStyles();
        document.body.appendChild(quickbarHost);
      }
    }
    
    // Apply position from config
    this.applyPosition(quickbarHost);
    
    // Set initial HTML
    this.container.innerHTML = this.getWidgetHTML();
    
    // Mount to host
    quickbarHost.appendChild(this.container);
  }

  private getHostStyles(): string {
    const position = configManager.getQuickbarPosition();
    const baseStyles = `
      position: fixed;
      z-index: 1000;
      pointer-events: none;
    `;
    
    switch (position) {
      case 'top':
        return `${baseStyles} top: 10px; left: 50%; transform: translateX(-50%);`;
      case 'bottom':
        return `${baseStyles} bottom: 10px; left: 50%; transform: translateX(-50%);`;
      case 'left':
        return `${baseStyles} left: 10px; top: 50%; transform: translateY(-50%);`;
      case 'right':
        return `${baseStyles} right: 10px; top: 50%; transform: translateY(-50%);`;
      default:
        return `${baseStyles} bottom: 10px; right: 10px;`;
    }
  }

  private applyPosition(host: HTMLElement): void {
    const position = configManager.getQuickbarPosition();
    
    // Reset all position styles
    host.style.top = '';
    host.style.bottom = '';
    host.style.left = '';
    host.style.right = '';
    host.style.transform = '';
    
    switch (position) {
      case 'top':
        host.style.top = '10px';
        host.style.left = '50%';
        host.style.transform = 'translateX(-50%)';
        break;
      case 'bottom':
        host.style.bottom = '10px';
        host.style.left = '50%';
        host.style.transform = 'translateX(-50%)';
        break;
      case 'left':
        host.style.left = '10px';
        host.style.top = '50%';
        host.style.transform = 'translateY(-50%)';
        break;
      case 'right':
        host.style.right = '10px';
        host.style.top = '50%';
        host.style.transform = 'translateY(-50%)';
        break;
    }
  }

  private getWidgetHTML(): string {
    const config = configManager.getEffectiveConfig();
    
    if (config.quickbar.compactMode) {
      return this.getCompactHTML();
    } else {
      return this.getFullHTML();
    }
  }

  private getCompactHTML(): string {
    const data = this.currentData || this.getDefaultData();
    const weightClass = this.getWeightClass(data.carryWeight, data.maxWeight);
    
    return `
      <div class="inventory-widget-compact" style="pointer-events: auto;">
        <span class="inventory-icon" title="Inventory">🎒</span>
        <span class="item-count" title="Items carried">${data.items.length}</span>
        <span class="weight-indicator ${weightClass}" title="${data.carryWeight.toFixed(1)}/${data.maxWeight} kg">●</span>
      </div>
    `;
  }

  private getFullHTML(): string {
    const config = configManager.getEffectiveConfig();
    const data = this.currentData || this.getDefaultData();
    
    let html = `
      <div class="inventory-widget-full" style="pointer-events: auto;">
        <div class="widget-header">
          <span class="inventory-icon">🎒</span>
          <span class="inventory-label">Inventory</span>
        </div>
    `;
    
    if (config.quickbar.showItemCount || config.quickbar.showWeight) {
      html += '<div class="widget-stats">';
      
      if (config.quickbar.showItemCount) {
        html += `<span class="item-count">${data.items.length} items</span>`;
      }
      
      if (config.quickbar.showWeight) {
        const weightClass = this.getWeightClass(data.carryWeight, data.maxWeight);
        const percentage = (data.carryWeight / data.maxWeight) * 100;
        html += `
          <div class="weight-display">
            <span class="carry-weight">${data.carryWeight.toFixed(1)}/${data.maxWeight} kg</span>
            <div class="weight-bar">
              <div class="weight-fill ${weightClass}" style="width: ${Math.min(percentage, 100)}%"></div>
            </div>
          </div>
        `;
      }
      
      html += '</div>';
    }
    
    if (config.quickbar.showEquippedGear) {
      html += this.getEquippedGearHTML(data);
    }
    
    html += `
        <div class="widget-actions">
          <button class="btn-icon" title="Open inventory" onclick="STRES.inventory.executeCommand('/inventory')">
            📋
          </button>
          <button class="btn-icon" title="Quick search" onclick="STRES.inventory.executeCommand('/search ')">
            🔍
          </button>
        </div>
      </div>
    `;
    
    return html;
  }

  private getEquippedGearHTML(data: InventoryData): string {
    const weapon = data.equippedWeapon;
    const armor = data.equippedArmor?.[0];
    
    return `
      <div class="equipped-gear">
        <div class="gear-slot ${weapon ? 'equipped' : ''}" title="${weapon?.name || 'No weapon equipped'}">
          ⚔️
        </div>
        <div class="gear-slot ${armor ? 'equipped' : ''}" title="${armor?.name || 'No armor equipped'}">
          🛡️
        </div>
        <div class="gear-slot" title="No accessory equipped">
          💍
        </div>
      </div>
    `;
  }

  private getDefaultData(): InventoryData {
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

  private getWeightClass(current: number, max: number): string {
    const ratio = current / max;
    if (ratio < 0.7) return 'weight-ok';
    if (ratio < 0.9) return 'weight-warning';
    return 'weight-critical';
  }

  private attachEventListeners(): void {
    // Subscribe to inventory updates
    this.unsubscribe = this.inventoryManager.subscribeToUpdates((update) => {
      this.currentData = update.inventory;
      this.updateDisplay();
    });
    
    // Listen for config changes
    const unsubscribeConfig = configManager.onChange(() => {
      this.updateDisplay();
    });
    
    // Store unsubscribe function
    const originalUnsubscribe = this.unsubscribe;
    this.unsubscribe = () => {
      originalUnsubscribe();
      unsubscribeConfig();
    };
  }

  private startAutoUpdate(): void {
    // Update every 30 seconds
    this.updateInterval = window.setInterval(() => {
      this.updateDisplay();
    }, 30000);
    
    // Initial update
    this.updateDisplay();
  }

  async updateDisplay(): Promise<void> {
    try {
      // Fetch latest inventory data
      const data = await this.inventoryManager.getPlayerInventory();
      this.currentData = data;
      
      if (!this.container) return;
      
      // Update HTML
      this.container.innerHTML = this.getWidgetHTML();
      
      // Add animation class
      this.container.classList.add('updated');
      setTimeout(() => {
        this.container?.classList.remove('updated');
      }, 300);
    } catch (error) {
      console.error('[STRES Inventory] Failed to update widget:', error);
    }
  }

  destroy(): void {
    // Clear interval
    if (this.updateInterval !== null) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    
    // Unsubscribe from updates
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    
    // Remove widget
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
    
    // Clean up host if empty
    const host = document.getElementById('stres-quickbar-host');
    if (host && host.children.length === 0) {
      host.remove();
    }
  }
}