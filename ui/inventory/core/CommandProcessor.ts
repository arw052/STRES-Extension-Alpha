// Command Processor for Inventory Slash Commands
// Handles parsing and execution of chat-based inventory commands

import { InventoryManager, InventoryItem, ActionResult } from './InventoryManager';
import { ConfigManager } from './ConfigManager';
import { TextFormatter } from '../formatters/TextFormatter';
import { InteractiveFormatter } from '../formatters/InteractiveFormatter';

export interface CommandResult {
  success: boolean;
  message: string;
  interactive?: boolean;
  html?: string;
  effects?: string[];
}

export interface CommandHandler {
  name: string;
  aliases: string[];
  description: string;
  usage: string;
  execute(args: string[], manager: InventoryManager): Promise<CommandResult>;
}

export class CommandProcessor {
  private commands: Map<string, CommandHandler> = new Map();
  private textFormatter: TextFormatter;
  private interactiveFormatter: InteractiveFormatter;
  private configManager: ConfigManager;

  constructor(
    private inventoryManager: InventoryManager,
    configManager: ConfigManager
  ) {
    this.configManager = configManager;
    this.textFormatter = new TextFormatter(configManager);
    this.interactiveFormatter = new InteractiveFormatter(configManager);
    this.registerCommands();
  }

  private registerCommands(): void {
    const commands: CommandHandler[] = [
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
      // Register main command name
      this.commands.set(command.name.toLowerCase(), command);
      
      // Register aliases
      for (const alias of command.aliases) {
        this.commands.set(alias.toLowerCase(), command);
      }
    }
  }

  async processCommand(input: string): Promise<CommandResult> {
    // Check if chat commands are enabled
    if (!this.configManager.isChatCommandsEnabled()) {
      return {
        success: false,
        message: 'Inventory chat commands are disabled. Enable them in settings.'
      };
    }

    // Parse command and arguments
    const trimmed = input.trim();
    if (!trimmed.startsWith('/')) {
      return {
        success: false,
        message: 'Commands must start with /'
      };
    }

    const parts = trimmed.slice(1).split(/\s+/);
    const commandName = parts[0]?.toLowerCase();
    const args = parts.slice(1);

    if (!commandName) {
      return {
        success: false,
        message: 'Invalid command format'
      };
    }

    // Find and execute command
    const handler = this.commands.get(commandName);
    if (!handler) {
      return {
        success: false,
        message: `Unknown command: /${commandName}. Type /invhelp for available commands.`
      };
    }

    try {
      return await handler.execute(args, this.inventoryManager);
    } catch (error) {
      console.error(`Error executing command /${commandName}:`, error);
      return {
        success: false,
        message: `Failed to execute command: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  getAvailableCommands(): CommandHandler[] {
    const uniqueCommands = new Map<string, CommandHandler>();
    this.commands.forEach(command => {
      if (!uniqueCommands.has(command.name)) {
        uniqueCommands.set(command.name, command);
      }
    });
    return Array.from(uniqueCommands.values());
  }

  isInventoryCommand(message: string): boolean {
    const trimmed = message.trim();
    if (!trimmed.startsWith('/')) return false;
    
    const commandName = trimmed.slice(1).split(/\s+/)[0]?.toLowerCase();
    return this.commands.has(commandName);
  }
}

// Command Implementations

class InventoryListCommand implements CommandHandler {
  name = 'inventory';
  aliases = ['inv', 'i', 'bag'];
  description = 'Display your inventory';
  usage = '/inventory [filter] - Filter: weapons, armor, consumables, tools, misc';

  constructor(
    private textFormatter: TextFormatter,
    private interactiveFormatter: InteractiveFormatter,
    private configManager: ConfigManager
  ) {}

  async execute(args: string[], manager: InventoryManager): Promise<CommandResult> {
    const filter = args[0]?.toLowerCase();
    const inventory = await manager.getPlayerInventory();

    // Apply filter if specified
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
    } else {
      const message = this.textFormatter.formatInventoryList(filteredInventory, { filter });
      return {
        success: true,
        message,
        interactive: false
      };
    }
  }
}

class EquipCommand implements CommandHandler {
  name = 'equip';
  aliases = ['e', 'wear', 'wield'];
  description = 'Equip an item';
  usage = '/equip <item name or id>';

  async execute(args: string[], manager: InventoryManager): Promise<CommandResult> {
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

class UnequipCommand implements CommandHandler {
  name = 'unequip';
  aliases = ['ue', 'remove', 'takeoff'];
  description = 'Unequip an item';
  usage = '/unequip <item name or slot>';

  async execute(args: string[], manager: InventoryManager): Promise<CommandResult> {
    if (args.length === 0) {
      return {
        success: false,
        message: 'Usage: /unequip <item name or slot>'
      };
    }

    const query = args.join(' ').toLowerCase();
    const inventory = await manager.getPlayerInventory();
    
    // Find equipped item
    let item: InventoryItem | undefined;
    if (query === 'weapon' && inventory.equippedWeapon) {
      item = inventory.equippedWeapon;
    } else if (query === 'armor' && inventory.equippedArmor?.length) {
      item = inventory.equippedArmor[0];
    } else {
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

class UseItemCommand implements CommandHandler {
  name = 'use';
  aliases = ['u', 'consume', 'drink', 'eat'];
  description = 'Use a consumable item';
  usage = '/use <item name>';

  async execute(args: string[], manager: InventoryManager): Promise<CommandResult> {
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

class SearchItemCommand implements CommandHandler {
  name = 'search';
  aliases = ['find', 'lookup'];
  description = 'Search for items in your inventory';
  usage = '/search <query>';

  constructor(private textFormatter: TextFormatter) {}

  async execute(args: string[], manager: InventoryManager): Promise<CommandResult> {
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

class ItemInfoCommand implements CommandHandler {
  name = 'iteminfo';
  aliases = ['info', 'examine', 'inspect'];
  description = 'Get detailed information about an item';
  usage = '/iteminfo <item name>';

  constructor(private textFormatter: TextFormatter) {}

  async execute(args: string[], manager: InventoryManager): Promise<CommandResult> {
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

class StoreItemCommand implements CommandHandler {
  name = 'store';
  aliases = ['stash', 'deposit'];
  description = 'Store an item in guild storage';
  usage = '/store <item name> [quantity]';

  async execute(args: string[], manager: InventoryManager): Promise<CommandResult> {
    if (args.length === 0) {
      return {
        success: false,
        message: 'Usage: /store <item name> [quantity]'
      };
    }

    // Parse quantity if provided as last argument
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

class TradeItemCommand implements CommandHandler {
  name = 'give';
  aliases = ['trade', 'transfer'];
  description = 'Give an item to another player';
  usage = '/give <player> <item> [quantity]';

  async execute(args: string[], manager: InventoryManager): Promise<CommandResult> {
    if (args.length < 2) {
      return {
        success: false,
        message: 'Usage: /give <player> <item> [quantity]'
      };
    }

    const targetPlayer = args[0];
    let quantity = 1;
    
    // Check if last arg is quantity
    const lastArg = args[args.length - 1];
    if (!isNaN(parseInt(lastArg))) {
      quantity = parseInt(lastArg);
      args = args.slice(1, -1);
    } else {
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

class HelpCommand implements CommandHandler {
  name = 'invhelp';
  aliases = ['inventoryhelp', 'ih'];
  description = 'Show available inventory commands';
  usage = '/invhelp';

  constructor(private processor: CommandProcessor) {}

  async execute(args: string[], manager: InventoryManager): Promise<CommandResult> {
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

export const createCommandProcessor = (
  inventoryManager: InventoryManager,
  configManager: ConfigManager
): CommandProcessor => {
  return new CommandProcessor(inventoryManager, configManager);
};