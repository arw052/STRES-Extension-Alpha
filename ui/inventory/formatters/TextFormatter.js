"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TextFormatter = void 0;
class TextFormatter {
    constructor(configManager) {
        this.configManager = configManager;
    }
    formatInventoryList(inventory, options = {}) {
        const config = this.configManager.getEffectiveConfig();
        if (config.chatCommands.richFormatting) {
            return this.createRichDisplay(inventory, options);
        }
        else {
            return this.createSimpleDisplay(inventory, options);
        }
    }
    createRichDisplay(inventory, options) {
        const { items, carryWeight, maxWeight, currency } = inventory;
        const weightBar = this.createWeightBar(carryWeight, maxWeight);
        const itemsDisplay = this.formatItemsByCategory(items, options);
        return `\`\`\`
┌─────────────────── INVENTORY ───────────────────┐
│ 📦 Weight: ${carryWeight.toFixed(1)}/${maxWeight} kg ${weightBar} │
├─────────────────────────────────────────────────┤
${itemsDisplay}│                                                 │
│ 💰 Currency: ${currency.gold}g ${currency.silver}s ${currency.copper}c             │
└─────────────────────────────────────────────────┘
\`\`\``;
    }
    createSimpleDisplay(inventory, options) {
        const { items, carryWeight, maxWeight, currency } = inventory;
        let output = `**🎒 Inventory** (${carryWeight.toFixed(1)}/${maxWeight} kg)\n\n`;
        const categories = this.groupItemsByCategory(items);
        for (const [category, categoryItems] of categories) {
            if (options.filter && options.filter !== category.toLowerCase())
                continue;
            output += `**${this.getCategoryIcon(category)} ${category}:**\n`;
            for (const item of categoryItems.slice(0, 10)) {
                const equipped = item.equipped ? '[E]' : '';
                const quantity = item.quantity > 1 ? ` x${item.quantity}` : '';
                output += `• ${item.name}${quantity} ${equipped}\n`;
            }
            if (categoryItems.length > 10) {
                output += `  _...and ${categoryItems.length - 10} more_\n`;
            }
            output += '\n';
        }
        output += `💰 **Currency:** ${currency.gold}g ${currency.silver}s ${currency.copper}c`;
        return output;
    }
    formatItemsByCategory(items, options) {
        const categories = this.groupItemsByCategory(items);
        const pageSize = this.configManager.get('chatCommands.pageSize') || 10;
        let output = '';
        for (const [category, categoryItems] of categories) {
            if (options.filter && options.filter !== category.toLowerCase())
                continue;
            output += `│ ${this.getCategoryIcon(category)} ${category.toUpperCase().padEnd(43)} │\n`;
            output += '├─────────────────────────────────────────────────┤\n';
            const startIdx = (options.page || 0) * pageSize;
            const endIdx = startIdx + pageSize;
            const pageItems = categoryItems.slice(startIdx, endIdx);
            for (const item of pageItems) {
                const line = this.formatItemLine(item);
                output += `│ ${line.padEnd(47)} │\n`;
            }
            if (categoryItems.length > endIdx) {
                output += `│ ...${categoryItems.length - endIdx} more items (page ${(options.page || 0) + 2})          │\n`;
            }
            output += '├─────────────────────────────────────────────────┤\n';
        }
        return output;
    }
    formatItemLine(item) {
        const equipped = item.equipped ? '[E]' : '   ';
        const enchanted = item.enchantments && item.enchantments.length > 0 ? '⚡' : ' ';
        const quantity = item.quantity > 1 ? `(${item.quantity})` : '';
        const durability = item.durability !== undefined ?
            ` [${this.getDurabilitySymbol(item.durability, item.maxDurability)}]` : '';
        const name = item.name.substring(0, 20);
        return `${equipped} ${name.padEnd(20)} ${quantity.padEnd(5)} ${enchanted}${durability}`;
    }
    createWeightBar(current, max) {
        const percentage = (current / max) * 100;
        const barLength = 10;
        const filled = Math.round((percentage / 100) * barLength);
        let bar = '[';
        for (let i = 0; i < barLength; i++) {
            if (i < filled) {
                if (percentage >= 90)
                    bar += '▓';
                else if (percentage >= 70)
                    bar += '▒';
                else
                    bar += '░';
            }
            else {
                bar += ' ';
            }
        }
        bar += ']';
        return bar;
    }
    getDurabilitySymbol(current, max) {
        if (current === undefined || max === undefined)
            return '---';
        const percentage = (current / max) * 100;
        if (percentage >= 80)
            return '████';
        if (percentage >= 60)
            return '███░';
        if (percentage >= 40)
            return '██░░';
        if (percentage >= 20)
            return '█░░░';
        return '░░░░';
    }
    groupItemsByCategory(items) {
        const categories = new Map();
        for (const item of items) {
            const category = item.type.charAt(0).toUpperCase() + item.type.slice(1);
            if (!categories.has(category)) {
                categories.set(category, []);
            }
            categories.get(category).push(item);
        }
        const sortedCategories = new Map([...categories.entries()].sort((a, b) => {
            const order = ['Weapon', 'Armor', 'Consumable', 'Tool', 'Misc'];
            return order.indexOf(a[0]) - order.indexOf(b[0]);
        }));
        return sortedCategories;
    }
    formatSearchResults(items, query) {
        if (items.length === 0) {
            return `No items found matching "${query}"`;
        }
        let output = `**🔍 Search Results for "${query}"** (${items.length} found)\n\n`;
        for (const item of items.slice(0, 10)) {
            const equipped = item.equipped ? ' [EQUIPPED]' : '';
            const quantity = item.quantity > 1 ? ` x${item.quantity}` : '';
            output += `${this.getCategoryIcon(item.type)} **${item.name}**${quantity}${equipped}\n`;
            if (item.description) {
                output += `  _${item.description.substring(0, 50)}${item.description.length > 50 ? '...' : ''}_\n`;
            }
            output += `  Weight: ${item.weight}kg | Value: ${item.value}g\n\n`;
        }
        if (items.length > 10) {
            output += `_...and ${items.length - 10} more items_`;
        }
        return output;
    }
    formatItemDetails(item) {
        let output = `**${this.getCategoryIcon(item.type)} ${item.name}**\n\n`;
        if (item.description) {
            output += `_${item.description}_\n\n`;
        }
        output += `**Type:** ${item.type.charAt(0).toUpperCase() + item.type.slice(1)}\n`;
        output += `**Quantity:** ${item.quantity}\n`;
        output += `**Weight:** ${item.weight} kg${item.quantity > 1 ? ` (${item.weight * item.quantity} kg total)` : ''}\n`;
        output += `**Value:** ${item.value} gold${item.quantity > 1 ? ` (${item.value * item.quantity}g total)` : ''}\n`;
        if (item.equipped) {
            output += `**Status:** EQUIPPED\n`;
        }
        if (item.durability !== undefined && item.maxDurability !== undefined) {
            const percentage = (item.durability / item.maxDurability) * 100;
            output += `**Durability:** ${item.durability}/${item.maxDurability} (${percentage.toFixed(0)}%)\n`;
        }
        if (item.enchantments && item.enchantments.length > 0) {
            output += `**Enchantments:**\n`;
            for (const enchantment of item.enchantments) {
                output += `• ${enchantment}\n`;
            }
        }
        return output;
    }
    formatCompactInventory(inventory) {
        var _a, _b;
        return `🎒 **Inventory** (${inventory.carryWeight.toFixed(1)}/${inventory.maxWeight} kg)

⚔️ **Weapons:** ${inventory.weapons.length}
• ${((_a = inventory.equippedWeapon) === null || _a === void 0 ? void 0 : _a.name) || 'None equipped'}

🛡️ **Armor:** ${inventory.armor.length}  
• ${((_b = inventory.equippedArmor) === null || _b === void 0 ? void 0 : _b.map(a => a.name).join(', ')) || 'None equipped'}

🧪 **Consumables:** ${inventory.consumables.length}

💰 **Currency:** ${inventory.currency.gold}g ${inventory.currency.silver}s`;
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
}
exports.TextFormatter = TextFormatter;
