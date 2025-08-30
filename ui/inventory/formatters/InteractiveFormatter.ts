// Interactive Formatter for Rich HTML Inventory Display
// Creates clickable, interactive inventory displays in chat

import { InventoryData, InventoryItem } from '../core/InventoryManager';
import { ConfigManager } from '../core/ConfigManager';

export class InteractiveFormatter {
  constructor(private configManager: ConfigManager) {}

  formatInventoryInteractive(inventory: InventoryData): string {
    const { items, carryWeight, maxWeight, currency } = inventory;
    const weightPercentage = (carryWeight / maxWeight) * 100;
    const weightClass = this.getWeightClass(weightPercentage);
    
    return `
<div class="stres-inventory-display">
  <div class="inventory-header">
    <h3>🎒 Inventory</h3>
    <div class="inventory-stats">
      <div class="weight-display">
        <span class="weight-label">Weight:</span>
        <span class="weight-value">${carryWeight.toFixed(1)}/${maxWeight} kg</span>
        <div class="weight-bar">
          <div class="weight-fill ${weightClass}" style="width: ${Math.min(weightPercentage, 100)}%"></div>
        </div>
      </div>
      <div class="currency-display">
        <span class="currency-icon">💰</span>
        <span class="currency-value">${currency.gold}g ${currency.silver}s ${currency.copper}c</span>
      </div>
    </div>
  </div>
  
  <div class="inventory-tabs">
    <button class="tab-btn active" onclick="STRES.inventory.filterItems('all')">All (${items.length})</button>
    <button class="tab-btn" onclick="STRES.inventory.filterItems('weapon')">⚔️ Weapons</button>
    <button class="tab-btn" onclick="STRES.inventory.filterItems('armor')">🛡️ Armor</button>
    <button class="tab-btn" onclick="STRES.inventory.filterItems('consumable')">🧪 Items</button>
    <button class="tab-btn" onclick="STRES.inventory.filterItems('misc')">📦 Misc</button>
  </div>
  
  <div class="inventory-items" id="inventory-items-display">
    ${this.renderItemsList(items)}
  </div>
  
  <div class="inventory-actions">
    <button class="btn-action" onclick="STRES.inventory.refresh()">🔄 Refresh</button>
    <button class="btn-action" onclick="STRES.inventory.toggleCompact()">📱 Compact</button>
    <button class="btn-action" onclick="STRES.inventory.close()">✖️ Close</button>
  </div>
</div>

<style>
.stres-inventory-display {
  background: var(--SmartThemeBlurTintColor, rgba(0,0,0,0.9));
  border: 1px solid var(--SmartThemeBorderColor, #444);
  border-radius: 8px;
  padding: 12px;
  margin: 8px 0;
  font-family: var(--mainFontFamily, monospace);
}

.inventory-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--SmartThemeBorderColor, #444);
}

.inventory-header h3 {
  margin: 0;
  color: var(--SmartThemeBodyColor, #fff);
}

.inventory-stats {
  display: flex;
  gap: 16px;
  align-items: center;
}

.weight-display {
  display: flex;
  align-items: center;
  gap: 8px;
}

.weight-bar {
  width: 80px;
  height: 8px;
  background: var(--black30a, rgba(0,0,0,0.3));
  border-radius: 4px;
  overflow: hidden;
}

.weight-fill {
  height: 100%;
  transition: width 0.3s ease;
}

.weight-ok { background: #4ade80; }
.weight-warning { background: #facc15; }
.weight-critical { background: #ef4444; }

.currency-display {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--SmartThemeQuoteColor, #aaa);
}

.inventory-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.tab-btn {
  background: var(--black30a, rgba(0,0,0,0.3));
  border: 1px solid var(--SmartThemeBorderColor, #444);
  color: var(--SmartThemeBodyColor, #fff);
  padding: 4px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
}

.tab-btn:hover {
  background: var(--SmartThemeQuoteColor, #666);
}

.tab-btn.active {
  background: var(--SmartThemeCheckboxBorderColor, #007acc);
  border-color: var(--SmartThemeCheckboxBorderColor, #007acc);
}

.inventory-items {
  max-height: 300px;
  overflow-y: auto;
  margin-bottom: 12px;
}

.inventory-item {
  display: flex;
  align-items: center;
  padding: 6px;
  margin-bottom: 4px;
  background: var(--black30a, rgba(0,0,0,0.2));
  border-radius: 4px;
  transition: background 0.2s;
}

.inventory-item:hover {
  background: var(--black50a, rgba(0,0,0,0.5));
}

.item-icon {
  font-size: 18px;
  margin-right: 8px;
}

.item-details {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.item-name {
  color: var(--SmartThemeBodyColor, #fff);
  font-weight: 500;
}

.item-equipped {
  color: #4ade80;
  font-size: 10px;
  margin-left: 4px;
}

.item-meta {
  font-size: 11px;
  color: var(--SmartThemeQuoteColor, #aaa);
  display: flex;
  gap: 8px;
}

.durability-bar {
  width: 40px;
  height: 3px;
  background: var(--black30a, rgba(0,0,0,0.3));
  border-radius: 2px;
  overflow: hidden;
  margin-top: 2px;
}

.durability-fill {
  height: 100%;
  transition: width 0.3s ease;
}

.item-actions {
  display: flex;
  gap: 4px;
}

.btn-item {
  background: transparent;
  border: 1px solid var(--SmartThemeBorderColor, #444);
  color: var(--SmartThemeBodyColor, #fff);
  padding: 2px 8px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 11px;
  transition: all 0.2s;
}

.btn-item:hover {
  background: var(--SmartThemeCheckboxBorderColor, #007acc);
  border-color: var(--SmartThemeCheckboxBorderColor, #007acc);
}

.inventory-actions {
  display: flex;
  justify-content: center;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--SmartThemeBorderColor, #444);
}

.btn-action {
  background: var(--black30a, rgba(0,0,0,0.3));
  border: 1px solid var(--SmartThemeBorderColor, #444);
  color: var(--SmartThemeBodyColor, #fff);
  padding: 4px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
}

.btn-action:hover {
  background: var(--SmartThemeQuoteColor, #666);
}

/* Scrollbar styling */
.inventory-items::-webkit-scrollbar {
  width: 6px;
}

.inventory-items::-webkit-scrollbar-track {
  background: var(--black30a, rgba(0,0,0,0.3));
  border-radius: 3px;
}

.inventory-items::-webkit-scrollbar-thumb {
  background: var(--SmartThemeBorderColor, #444);
  border-radius: 3px;
}

.inventory-items::-webkit-scrollbar-thumb:hover {
  background: var(--SmartThemeQuoteColor, #666);
}

/* Mobile responsive */
@media (max-width: 768px) {
  .stres-inventory-display {
    padding: 8px;
  }
  
  .inventory-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
  
  .inventory-tabs {
    font-size: 11px;
  }
  
  .tab-btn {
    padding: 3px 8px;
  }
  
  .inventory-items {
    max-height: 200px;
  }
}
</style>
`;
  }

  private renderItemsList(items: InventoryItem[]): string {
    if (items.length === 0) {
      return '<div class="no-items">No items in inventory</div>';
    }

    return items.map(item => this.renderItem(item)).join('');
  }

  private renderItem(item: InventoryItem): string {
    const durabilityBar = item.durability !== undefined && item.maxDurability !== undefined
      ? this.renderDurabilityBar(item.durability, item.maxDurability)
      : '';
    
    const equipped = item.equipped ? '<span class="item-equipped">[EQUIPPED]</span>' : '';
    const quantity = item.quantity > 1 ? ` x${item.quantity}` : '';
    const enchanted = item.enchantments && item.enchantments.length > 0 ? ' ⚡' : '';
    
    return `
<div class="inventory-item" data-item-id="${item.id}">
  <div class="item-icon">${this.getItemIcon(item)}</div>
  <div class="item-details">
    <div class="item-name">
      ${item.name}${quantity}${enchanted} ${equipped}
    </div>
    <div class="item-meta">
      <span>${item.type}</span>
      <span>${item.weight}kg</span>
      <span>${item.value}g</span>
    </div>
    ${durabilityBar}
  </div>
  <div class="item-actions">
    ${this.renderItemActions(item)}
  </div>
</div>
`;
  }

  private renderDurabilityBar(current: number, max: number): string {
    const percentage = (current / max) * 100;
    const durabilityClass = 
      percentage >= 70 ? 'weight-ok' :
      percentage >= 30 ? 'weight-warning' :
      'weight-critical';
    
    return `
<div class="durability-bar">
  <div class="durability-fill ${durabilityClass}" style="width: ${percentage}%"></div>
</div>
`;
  }

  private renderItemActions(item: InventoryItem): string {
    const actions = [];
    
    if (item.type === 'weapon' || item.type === 'armor') {
      if (item.equipped) {
        actions.push(`<button class="btn-item" onclick="STRES.inventory.unequip('${item.id}')">Unequip</button>`);
      } else {
        actions.push(`<button class="btn-item" onclick="STRES.inventory.equip('${item.id}')">Equip</button>`);
      }
    }
    
    if (item.type === 'consumable') {
      actions.push(`<button class="btn-item" onclick="STRES.inventory.use('${item.id}')">Use</button>`);
    }
    
    actions.push(`<button class="btn-item" onclick="STRES.inventory.showItemInfo('${item.id}')">Info</button>`);
    
    return actions.join('');
  }

  private getWeightClass(percentage: number): string {
    if (percentage >= 90) return 'weight-critical';
    if (percentage >= 70) return 'weight-warning';
    return 'weight-ok';
  }

  private getItemIcon(item: InventoryItem): string {
    if (item.icon) return item.icon;
    
    const icons: Record<string, string> = {
      weapon: '⚔️',
      armor: '🛡️',
      consumable: '🧪',
      tool: '🔧',
      misc: '📦'
    };
    
    return icons[item.type] || '📦';
  }

  formatCompactInteractive(inventory: InventoryData): string {
    const { carryWeight, maxWeight, currency } = inventory;
    const weightPercentage = (carryWeight / maxWeight) * 100;
    const weightClass = this.getWeightClass(weightPercentage);
    
    return `
<div class="stres-inventory-compact">
  <div class="compact-header">
    <span class="compact-icon">🎒</span>
    <span class="compact-weight">${carryWeight.toFixed(1)}/${maxWeight}kg</span>
    <span class="weight-indicator ${weightClass}">●</span>
  </div>
  <div class="compact-stats">
    <span>⚔️ ${inventory.weapons.length}</span>
    <span>🛡️ ${inventory.armor.length}</span>
    <span>🧪 ${inventory.consumables.length}</span>
    <span>💰 ${currency.gold}g</span>
  </div>
  <button class="compact-expand" onclick="STRES.inventory.showFull()">Expand →</button>
</div>

<style>
.stres-inventory-compact {
  background: var(--SmartThemeBlurTintColor, rgba(0,0,0,0.9));
  border: 1px solid var(--SmartThemeBorderColor, #444);
  border-radius: 6px;
  padding: 8px;
  margin: 4px 0;
  display: inline-block;
}

.compact-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.compact-stats {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: var(--SmartThemeQuoteColor, #aaa);
  margin-bottom: 4px;
}

.compact-expand {
  background: var(--black30a, rgba(0,0,0,0.3));
  border: 1px solid var(--SmartThemeBorderColor, #444);
  color: var(--SmartThemeBodyColor, #fff);
  padding: 2px 8px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 11px;
  width: 100%;
  margin-top: 4px;
}

.compact-expand:hover {
  background: var(--SmartThemeCheckboxBorderColor, #007acc);
}

.weight-indicator {
  font-size: 8px;
}
</style>
`;
  }
}