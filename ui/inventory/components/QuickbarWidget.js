"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QuickbarWidget = void 0;
const ConfigManager_1 = require("../core/ConfigManager");
class QuickbarWidget {
    constructor(inventoryManager) {
        this.inventoryManager = inventoryManager;
        this.container = null;
        this.updateInterval = null;
        this.unsubscribe = null;
        this.currentData = null;
    }
    mount() {
        this.createWidget();
        this.attachEventListeners();
        this.startAutoUpdate();
        this.updateDisplay();
    }
    createWidget() {
        this.destroy();
        this.container = document.createElement('div');
        this.container.className = 'stres-inventory-widget';
        this.container.id = 'stres-inventory-widget';
        let quickbarHost = document.getElementById('stres-quickbar-host');
        if (!quickbarHost) {
            const existingQuickbar = document.querySelector('.quickReplyBar') ||
                document.querySelector('#quickbar') ||
                document.querySelector('[data-quickbar]');
            if (existingQuickbar) {
                quickbarHost = document.createElement('div');
                quickbarHost.id = 'stres-quickbar-host';
                existingQuickbar.appendChild(quickbarHost);
            }
            else {
                quickbarHost = document.createElement('div');
                quickbarHost.id = 'stres-quickbar-host';
                quickbarHost.style.cssText = this.getHostStyles();
                document.body.appendChild(quickbarHost);
            }
        }
        this.applyPosition(quickbarHost);
        this.container.innerHTML = this.getWidgetHTML();
        quickbarHost.appendChild(this.container);
    }
    getHostStyles() {
        const position = ConfigManager_1.configManager.getQuickbarPosition();
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
    applyPosition(host) {
        const position = ConfigManager_1.configManager.getQuickbarPosition();
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
    getWidgetHTML() {
        const config = ConfigManager_1.configManager.getEffectiveConfig();
        if (config.quickbar.compactMode) {
            return this.getCompactHTML();
        }
        else {
            return this.getFullHTML();
        }
    }
    getCompactHTML() {
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
    getFullHTML() {
        const config = ConfigManager_1.configManager.getEffectiveConfig();
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
    getEquippedGearHTML(data) {
        var _a;
        const weapon = data.equippedWeapon;
        const armor = (_a = data.equippedArmor) === null || _a === void 0 ? void 0 : _a[0];
        return `
      <div class="equipped-gear">
        <div class="gear-slot ${weapon ? 'equipped' : ''}" title="${(weapon === null || weapon === void 0 ? void 0 : weapon.name) || 'No weapon equipped'}">
          ⚔️
        </div>
        <div class="gear-slot ${armor ? 'equipped' : ''}" title="${(armor === null || armor === void 0 ? void 0 : armor.name) || 'No armor equipped'}">
          🛡️
        </div>
        <div class="gear-slot" title="No accessory equipped">
          💍
        </div>
      </div>
    `;
    }
    getDefaultData() {
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
    getWeightClass(current, max) {
        const ratio = current / max;
        if (ratio < 0.7)
            return 'weight-ok';
        if (ratio < 0.9)
            return 'weight-warning';
        return 'weight-critical';
    }
    attachEventListeners() {
        this.unsubscribe = this.inventoryManager.subscribeToUpdates((update) => {
            this.currentData = update.inventory;
            this.updateDisplay();
        });
        const unsubscribeConfig = ConfigManager_1.configManager.onChange(() => {
            this.updateDisplay();
        });
        const originalUnsubscribe = this.unsubscribe;
        this.unsubscribe = () => {
            originalUnsubscribe();
            unsubscribeConfig();
        };
    }
    startAutoUpdate() {
        this.updateInterval = window.setInterval(() => {
            this.updateDisplay();
        }, 30000);
        this.updateDisplay();
    }
    async updateDisplay() {
        try {
            const data = await this.inventoryManager.getPlayerInventory();
            this.currentData = data;
            if (!this.container)
                return;
            this.container.innerHTML = this.getWidgetHTML();
            this.container.classList.add('updated');
            setTimeout(() => {
                var _a;
                (_a = this.container) === null || _a === void 0 ? void 0 : _a.classList.remove('updated');
            }, 300);
        }
        catch (error) {
            console.error('[STRES Inventory] Failed to update widget:', error);
        }
    }
    destroy() {
        if (this.updateInterval !== null) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }
        if (this.container) {
            this.container.remove();
            this.container = null;
        }
        const host = document.getElementById('stres-quickbar-host');
        if (host && host.children.length === 0) {
            host.remove();
        }
    }
}
exports.QuickbarWidget = QuickbarWidget;
