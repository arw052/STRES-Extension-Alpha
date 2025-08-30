"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCommandProcessor = exports.CommandProcessor = void 0;
const TextFormatter_1 = require("../formatters/TextFormatter");
const InteractiveFormatter_1 = require("../formatters/InteractiveFormatter");
class CommandProcessor {
    constructor(inventoryManager, configManager) {
        this.inventoryManager = inventoryManager;
        this.commands = new Map();
        this.configManager = configManager;
        this.textFormatter = new TextFormatter_1.TextFormatter(configManager);
        this.interactiveFormatter = new InteractiveFormatter_1.InteractiveFormatter(configManager);
        this.registerCommands();
    }
    registerCommands() {
        const commands = [
            new InventoryListCommand(this.textFormatter, this.interactiveFormatter, this.configManager),
            new EquipCommand(),
            new UnequipCommand(),
            new UseItemCommand(),
            new SearchItemCommand(this.textFormatter),
            new ItemInfoCommand(this.textFormatter),
            new StoreItemCommand(),
            new TradeItemCommand(),
            new HelpCommand(this)
        ];
        for (const command of commands) {
            this.commands.set(command.name.toLowerCase(), command);
            for (const alias of command.aliases) {
                this.commands.set(alias.toLowerCase(), command);
            }
        }
    }
    async processCommand(input) {
        var _a;
        if (!this.configManager.isChatCommandsEnabled()) {
            return {
                success: false,
                message: 'Inventory chat commands are disabled. Enable them in settings.'
            };
        }
        const trimmed = input.trim();
        if (!trimmed.startsWith('/')) {
            return {
                success: false,
                message: 'Commands must start with /'
            };
        }
        const parts = trimmed.slice(1).split(/\s+/);
        const commandName = (_a = parts[0]) === null || _a === void 0 ? void 0 : _a.toLowerCase();
        const args = parts.slice(1);
        if (!commandName) {
            return {
                success: false,
                message: 'Invalid command format'
            };
        }
        const handler = this.commands.get(commandName);
        if (!handler) {
            return {
                success: false,
                message: `Unknown command: /${commandName}. Type /invhelp for available commands.`
            };
        }
        try {
            return await handler.execute(args, this.inventoryManager);
        }
        catch (error) {
            console.error(`Error executing command /${commandName}:`, error);
            return {
                success: false,
                message: `Failed to execute command: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    }
    getAvailableCommands() {
        const uniqueCommands = new Map();
        this.commands.forEach(command => {
            if (!uniqueCommands.has(command.name)) {
                uniqueCommands.set(command.name, command);
            }
        });
        return Array.from(uniqueCommands.values());
    }
    isInventoryCommand(message) {
        var _a;
        const trimmed = message.trim();
        if (!trimmed.startsWith('/'))
            return false;
        const commandName = (_a = trimmed.slice(1).split(/\s+/)[0]) === null || _a === void 0 ? void 0 : _a.toLowerCase();
        return this.commands.has(commandName);
    }
}
exports.CommandProcessor = CommandProcessor;
class InventoryListCommand {
    constructor(textFormatter, interactiveFormatter, configManager) {
        this.textFormatter = textFormatter;
        this.interactiveFormatter = interactiveFormatter;
        this.configManager = configManager;
        this.name = 'inventory';
        this.aliases = ['inv', 'i', 'bag'];
        this.description = 'Display your inventory';
        this.usage = '/inventory [filter] - Filter: weapons, armor, consumables, tools, misc';
    }
    async execute(args, manager) {
        var _a;
        const filter = (_a = args[0]) === null || _a === void 0 ? void 0 : _a.toLowerCase();
        const inventory = await manager.getPlayerInventory();
        let filteredInventory = { ...inventory };
        if (filter) {
            switch (filter) {
                case 'weapons':
                case 'weapon':
                    filteredInventory.items = inventory.weapons;
                    break;
                case 'armor':
                case 'armors':
                    filteredInventory.items = inventory.armor;
                    break;
                case 'consumables':
                case 'consumable':
                    filteredInventory.items = inventory.consumables;
                    break;
                case 'tools':
                case 'tool':
                    filteredInventory.items = inventory.items.filter(i => i.type === 'tool');
                    break;
                case 'misc':
                    filteredInventory.items = inventory.items.filter(i => i.type === 'misc');
                    break;
            }
        }
        const config = this.configManager.getEffectiveConfig();
        if (config.chatCommands.interactiveButtons) {
            const html = this.interactiveFormatter.formatInventoryInteractive(filteredInventory);
            return {
                success: true,
                message: 'Inventory loaded',
                interactive: true,
                html
            };
        }
        else {
            const message = this.textFormatter.formatInventoryList(filteredInventory, { filter });
            return {
                success: true,
                message,
                interactive: false
            };
        }
    }
}
class EquipCommand {
    constructor() {
        this.name = 'equip';
        this.aliases = ['e', 'wear', 'wield'];
        this.description = 'Equip an item';
        this.usage = '/equip <item name or id>';
    }
    async execute(args, manager) {
        if (args.length === 0) {
            return {
                success: false,
                message: 'Usage: /equip <item name or id>'
            };
        }
        const itemQuery = args.join(' ');
        const items = await manager.searchItems(itemQuery);
        if (items.length === 0) {
            return {
                success: false,
                message: `No items found matching "${itemQuery}"`
            };
        }
        const item = items[0];
        if (item.type !== 'weapon' && item.type !== 'armor') {
            return {
                success: false,
                message: `${item.name} cannot be equipped`
            };
        }
        const result = await manager.executeAction({
            type: 'equip',
            itemId: item.id
        });
        return {
            success: result.success,
            message: result.message,
            effects: result.effects
        };
    }
}
class UnequipCommand {
    constructor() {
        this.name = 'unequip';
        this.aliases = ['ue', 'remove', 'takeoff'];
        this.description = 'Unequip an item';
        this.usage = '/unequip <item name or slot>';
    }
    async execute(args, manager) {
        var _a;
        if (args.length === 0) {
            return {
                success: false,
                message: 'Usage: /unequip <item name or slot>'
            };
        }
        const query = args.join(' ').toLowerCase();
        const inventory = await manager.getPlayerInventory();
        let item;
        if (query === 'weapon' && inventory.equippedWeapon) {
            item = inventory.equippedWeapon;
        }
        else if (query === 'armor' && ((_a = inventory.equippedArmor) === null || _a === void 0 ? void 0 : _a.length)) {
            item = inventory.equippedArmor[0];
        }
        else {
            const equipped = inventory.items.filter(i => i.equipped);
            item = equipped.find(i => i.name.toLowerCase().includes(query));
        }
        if (!item) {
            return {
                success: false,
                message: `No equipped item found matching "${query}"`
            };
        }
        const result = await manager.executeAction({
            type: 'unequip',
            itemId: item.id
        });
        return {
            success: result.success,
            message: result.message
        };
    }
}
class UseItemCommand {
    constructor() {
        this.name = 'use';
        this.aliases = ['u', 'consume', 'drink', 'eat'];
        this.description = 'Use a consumable item';
        this.usage = '/use <item name>';
    }
    async execute(args, manager) {
        if (args.length === 0) {
            return {
                success: false,
                message: 'Usage: /use <item name>'
            };
        }
        const itemQuery = args.join(' ');
        const items = await manager.searchItems(itemQuery);
        if (items.length === 0) {
            return {
                success: false,
                message: `No items found matching "${itemQuery}"`
            };
        }
        const item = items.find(i => i.type === 'consumable') || items[0];
        if (item.type !== 'consumable') {
            return {
                success: false,
                message: `${item.name} cannot be used`
            };
        }
        const result = await manager.executeAction({
            type: 'use',
            itemId: item.id,
            quantity: 1
        });
        return {
            success: result.success,
            message: result.message,
            effects: result.effects
        };
    }
}
class SearchItemCommand {
    constructor(textFormatter) {
        this.textFormatter = textFormatter;
        this.name = 'search';
        this.aliases = ['find', 'lookup'];
        this.description = 'Search for items in your inventory';
        this.usage = '/search <query>';
    }
    async execute(args, manager) {
        if (args.length === 0) {
            return {
                success: false,
                message: 'Usage: /search <query>'
            };
        }
        const query = args.join(' ');
        const items = await manager.searchItems(query);
        if (items.length === 0) {
            return {
                success: true,
                message: `No items found matching "${query}"`
            };
        }
        const message = this.textFormatter.formatSearchResults(items, query);
        return {
            success: true,
            message
        };
    }
}
class ItemInfoCommand {
    constructor(textFormatter) {
        this.textFormatter = textFormatter;
        this.name = 'iteminfo';
        this.aliases = ['info', 'examine', 'inspect'];
        this.description = 'Get detailed information about an item';
        this.usage = '/iteminfo <item name>';
    }
    async execute(args, manager) {
        if (args.length === 0) {
            return {
                success: false,
                message: 'Usage: /iteminfo <item name>'
            };
        }
        const itemQuery = args.join(' ');
        const items = await manager.searchItems(itemQuery);
        if (items.length === 0) {
            return {
                success: false,
                message: `No items found matching "${itemQuery}"`
            };
        }
        const item = items[0];
        const message = this.textFormatter.formatItemDetails(item);
        return {
            success: true,
            message
        };
    }
}
class StoreItemCommand {
    constructor() {
        this.name = 'store';
        this.aliases = ['stash', 'deposit'];
        this.description = 'Store an item in guild storage';
        this.usage = '/store <item name> [quantity]';
    }
    async execute(args, manager) {
        if (args.length === 0) {
            return {
                success: false,
                message: 'Usage: /store <item name> [quantity]'
            };
        }
        let quantity = 1;
        const lastArg = args[args.length - 1];
        if (!isNaN(parseInt(lastArg))) {
            quantity = parseInt(lastArg);
            args = args.slice(0, -1);
        }
        const itemQuery = args.join(' ');
        const items = await manager.searchItems(itemQuery);
        if (items.length === 0) {
            return {
                success: false,
                message: `No items found matching "${itemQuery}"`
            };
        }
        const item = items[0];
        const result = await manager.executeAction({
            type: 'store',
            itemId: item.id,
            quantity
        });
        return {
            success: result.success,
            message: result.message
        };
    }
}
class TradeItemCommand {
    constructor() {
        this.name = 'give';
        this.aliases = ['trade', 'transfer'];
        this.description = 'Give an item to another player';
        this.usage = '/give <player> <item> [quantity]';
    }
    async execute(args, manager) {
        if (args.length < 2) {
            return {
                success: false,
                message: 'Usage: /give <player> <item> [quantity]'
            };
        }
        const targetPlayer = args[0];
        let quantity = 1;
        const lastArg = args[args.length - 1];
        if (!isNaN(parseInt(lastArg))) {
            quantity = parseInt(lastArg);
            args = args.slice(1, -1);
        }
        else {
            args = args.slice(1);
        }
        const itemQuery = args.join(' ');
        const items = await manager.searchItems(itemQuery);
        if (items.length === 0) {
            return {
                success: false,
                message: `No items found matching "${itemQuery}"`
            };
        }
        const item = items[0];
        const result = await manager.executeAction({
            type: 'trade',
            itemId: item.id,
            targetId: targetPlayer,
            quantity
        });
        return {
            success: result.success,
            message: result.message
        };
    }
}
class HelpCommand {
    constructor(processor) {
        this.processor = processor;
        this.name = 'invhelp';
        this.aliases = ['inventoryhelp', 'ih'];
        this.description = 'Show available inventory commands';
        this.usage = '/invhelp';
    }
    async execute(args, manager) {
        const commands = this.processor.getAvailableCommands();
        let message = '📚 **Inventory Commands**\n\n';
        for (const command of commands) {
            message += `**/${command.name}** - ${command.description}\n`;
            if (command.aliases.length > 0) {
                message += `  Aliases: ${command.aliases.map(a => `/${a}`).join(', ')}\n`;
            }
            message += `  ${command.usage}\n\n`;
        }
        return {
            success: true,
            message
        };
    }
}
const createCommandProcessor = (inventoryManager, configManager) => {
    return new CommandProcessor(inventoryManager, configManager);
};
exports.createCommandProcessor = createCommandProcessor;
