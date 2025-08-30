// SillyTavern Integration Hooks
// Integrates inventory system with SillyTavern's chat and UI

import { inventoryManager } from '../core/InventoryManager';
import { configManager } from '../core/ConfigManager';
import { createCommandProcessor } from '../core/CommandProcessor';
import { QuickbarWidget } from '../components/QuickbarWidget';

declare global {
  interface Window {
    SillyTavern?: any;
    STRES?: any;
  }
}

export class SillyTavernIntegration {
  private static instance: SillyTavernIntegration;
  private commandProcessor = createCommandProcessor(inventoryManager, configManager);
  private quickbarWidget?: QuickbarWidget;
  private messageObserver?: MutationObserver;
  private initialized = false;

  private constructor() {}

  static getInstance(): SillyTavernIntegration {
    if (!SillyTavernIntegration.instance) {
      SillyTavernIntegration.instance = new SillyTavernIntegration();
    }
    return SillyTavernIntegration.instance;
  }

  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    console.log('[STRES Inventory] Initializing SillyTavern integration...');
    
    // Hook into message system
    this.hookMessageProcessor();
    
    // Setup UI components
    this.setupUIComponents();
    
    // Register event listeners
    this.registerEventListeners();
    
    // Expose API to window
    this.exposeAPI();
    
    // Watch for chat messages
    this.observeChatMessages();
    
    console.log('[STRES Inventory] Integration complete');
  }

  private hookMessageProcessor(): void {
    // Try to hook into SillyTavern's send message function
    const checkAndHook = () => {
      if (window.SillyTavern?.sendMessage) {
        const originalSend = window.SillyTavern.sendMessage;
        
        window.SillyTavern.sendMessage = async (message: string, ...args: any[]) => {
          // Check if this is an inventory command
          if (this.commandProcessor.isInventoryCommand(message)) {
            await this.handleInventoryCommand(message);
            return; // Don't send to chat
          }
          
          // Otherwise, call original function
          return originalSend.call(window.SillyTavern, message, ...args);
        };
        
        console.log('[STRES Inventory] Message processor hooked');
      } else {
        // Retry after delay if SillyTavern not ready
        setTimeout(checkAndHook, 1000);
      }
    };
    
    checkAndHook();
  }

  private async handleInventoryCommand(message: string): Promise<void> {
    try {
      const result = await this.commandProcessor.processCommand(message);
      
      if (result.interactive && result.html) {
        // Display interactive HTML in chat
        this.displayInChat(result.html, true);
      } else {
        // Display text message in chat
        this.displayInChat(result.message, false);
      }
      
      // Show effects if any
      if (result.effects && result.effects.length > 0) {
        for (const effect of result.effects) {
          this.showEffect(effect);
        }
      }
    } catch (error) {
      console.error('[STRES Inventory] Command error:', error);
      this.displayInChat('Failed to process inventory command', false);
    }
  }

  private displayInChat(content: string, isHtml: boolean): void {
    // Find the chat container
    const chatContainer = document.querySelector('#chat') || 
                         document.querySelector('.chat-container') ||
                         document.querySelector('[data-chat-container]');
    
    if (!chatContainer) {
      console.warn('[STRES Inventory] Chat container not found');
      return;
    }
    
    // Create message element
    const messageDiv = document.createElement('div');
    messageDiv.className = 'mes stres-inventory-message';
    messageDiv.setAttribute('data-stres-message', 'true');
    
    if (isHtml) {
      messageDiv.innerHTML = content;
    } else {
      // Convert markdown-style formatting to HTML
      const formatted = this.formatMarkdown(content);
      messageDiv.innerHTML = formatted;
    }
    
    // Add to chat
    chatContainer.appendChild(messageDiv);
    
    // Scroll to bottom
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }

  private formatMarkdown(text: string): string {
    // Basic markdown to HTML conversion
    let html = text
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/_(.+?)_/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');
    
    // Handle code blocks
    html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    
    return `<div class="stres-message-content">${html}</div>`;
  }

  private showEffect(effect: string): void {
    // Create temporary notification for effects
    const notification = document.createElement('div');
    notification.className = 'stres-effect-notification';
    notification.textContent = effect;
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: var(--SmartThemeBlurTintColor);
      border: 1px solid var(--SmartThemeBorderColor);
      border-radius: 6px;
      padding: 12px 16px;
      z-index: 10000;
      animation: slideIn 0.3s ease;
    `;
    
    document.body.appendChild(notification);
    
    // Remove after 3 seconds
    setTimeout(() => {
      notification.style.animation = 'slideOut 0.3s ease';
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }

  private setupUIComponents(): void {
    const config = configManager.getEffectiveConfig();
    
    // Setup quickbar widget if enabled
    if (config.quickbar.enabled) {
      this.quickbarWidget = new QuickbarWidget(inventoryManager);
      this.quickbarWidget.mount();
    }
    
    // Listen for config changes
    configManager.onChange((newConfig) => {
      if (newConfig.quickbar.enabled && !this.quickbarWidget) {
        this.quickbarWidget = new QuickbarWidget(inventoryManager);
        this.quickbarWidget.mount();
      } else if (!newConfig.quickbar.enabled && this.quickbarWidget) {
        this.quickbarWidget.destroy();
        this.quickbarWidget = undefined;
      }
    });
  }

  private registerEventListeners(): void {
    // Listen for character changes
    document.addEventListener('characterChanged', (event: any) => {
      const characterId = event.detail?.characterId;
      if (characterId) {
        inventoryManager.clearCache();
        inventoryManager.getPlayerInventory(characterId);
      }
    });
    
    // Listen for chat cleared
    document.addEventListener('chatCleared', () => {
      // Remove all inventory messages
      document.querySelectorAll('.stres-inventory-message').forEach(el => el.remove());
    });
  }

  private observeChatMessages(): void {
    // Watch for new messages in chat to detect commands
    const chatContainer = document.querySelector('#chat') || 
                         document.querySelector('.chat-container');
    
    if (!chatContainer) {
      // Retry after delay
      setTimeout(() => this.observeChatMessages(), 1000);
      return;
    }
    
    this.messageObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement && node.classList.contains('mes')) {
            this.checkMessageForCommand(node);
          }
        }
      }
    });
    
    this.messageObserver.observe(chatContainer, {
      childList: true,
      subtree: true
    });
  }

  private checkMessageForCommand(messageElement: HTMLElement): void {
    // Skip if this is our own message
    if (messageElement.hasAttribute('data-stres-message')) return;
    
    const textContent = messageElement.textContent || '';
    if (this.commandProcessor.isInventoryCommand(textContent.trim())) {
      // Hide the original message
      messageElement.style.display = 'none';
      
      // Process the command
      this.handleInventoryCommand(textContent.trim());
    }
  }

  private exposeAPI(): void {
    // Ensure STRES object exists
    if (!window.STRES) {
      window.STRES = {};
    }
    
    // Expose inventory API
    window.STRES.inventory = {
      // Command execution
      executeCommand: async (command: string) => {
        await this.handleInventoryCommand(command);
      },
      
      // Direct actions
      equip: async (itemId: string) => {
        const result = await inventoryManager.executeAction({
          type: 'equip',
          itemId
        });
        this.displayInChat(result.message, false);
      },
      
      unequip: async (itemId: string) => {
        const result = await inventoryManager.executeAction({
          type: 'unequip',
          itemId
        });
        this.displayInChat(result.message, false);
      },
      
      use: async (itemId: string) => {
        const result = await inventoryManager.executeAction({
          type: 'use',
          itemId
        });
        this.displayInChat(result.message, false);
        if (result.effects) {
          result.effects.forEach(effect => this.showEffect(effect));
        }
      },
      
      // UI controls
      refresh: async () => {
        inventoryManager.clearCache();
        await this.handleInventoryCommand('/inventory');
      },
      
      showItemInfo: async (itemId: string) => {
        const item = await inventoryManager.getItemById(itemId);
        if (item) {
          await this.handleInventoryCommand(`/iteminfo ${item.name}`);
        }
      },
      
      filterItems: async (category: string) => {
        if (category === 'all') {
          await this.handleInventoryCommand('/inventory');
        } else {
          await this.handleInventoryCommand(`/inventory ${category}`);
        }
      },
      
      toggleCompact: () => {
        const currentCompact = configManager.get('quickbar.compactMode');
        configManager.set('quickbar.compactMode', !currentCompact);
      },
      
      showFull: async () => {
        await this.handleInventoryCommand('/inventory');
      },
      
      close: () => {
        // Find and remove last inventory display
        const displays = document.querySelectorAll('.stres-inventory-display');
        if (displays.length > 0) {
          displays[displays.length - 1].closest('.stres-inventory-message')?.remove();
        }
      },
      
      // Config access
      getConfig: () => configManager.getEffectiveConfig(),
      setConfig: (path: string, value: any) => configManager.set(path, value),
      
      // Debug
      debug: () => {
        console.log('Inventory Manager:', inventoryManager);
        console.log('Config Manager:', configManager);
        console.log('Command Processor:', this.commandProcessor);
        configManager.debug();
      }
    };
    
    console.log('[STRES Inventory] API exposed at window.STRES.inventory');
  }

  destroy(): void {
    // Cleanup
    if (this.messageObserver) {
      this.messageObserver.disconnect();
    }
    
    if (this.quickbarWidget) {
      this.quickbarWidget.destroy();
    }
    
    // Remove all inventory messages
    document.querySelectorAll('.stres-inventory-message').forEach(el => el.remove());
    
    this.initialized = false;
  }
}

// Auto-initialize when loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    SillyTavernIntegration.getInstance().initialize();
  });
} else {
  // DOM already loaded
  SillyTavernIntegration.getInstance().initialize();
}