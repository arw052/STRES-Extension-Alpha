// Configuration Manager for Inventory UI
// Manages user preferences and settings persistence

export interface InventoryUIConfig {
  quickbar: {
    enabled: boolean;
    position: 'top' | 'bottom' | 'left' | 'right';
    showWeight: boolean;
    showItemCount: boolean;
    showEquippedGear: boolean;
    compactMode: boolean;
  };
  chatCommands: {
    enabled: boolean;
    richFormatting: boolean;
    interactiveButtons: boolean;
    autoCollapse: boolean;
    pageSize: number;
  };
  fullPanel: {
    enabled: boolean;
    defaultView: 'grid' | 'list' | 'equipment';
    showAdvanced: boolean;
    enableDragDrop: boolean;
  };
  global: {
    theme: 'auto' | 'light' | 'dark';
    animations: boolean;
    soundEffects: boolean;
  };
}

export class ConfigManager {
  private static readonly STORAGE_KEY = 'stres-inventory-config';
  private static readonly DEFAULT_CONFIG: InventoryUIConfig = {
    quickbar: {
      enabled: true,
      position: 'bottom',
      showWeight: true,
      showItemCount: true,
      showEquippedGear: false,
      compactMode: false
    },
    chatCommands: {
      enabled: true,
      richFormatting: true,
      interactiveButtons: true,
      autoCollapse: false,
      pageSize: 10
    },
    fullPanel: {
      enabled: false,
      defaultView: 'grid',
      showAdvanced: false,
      enableDragDrop: true
    },
    global: {
      theme: 'auto',
      animations: true,
      soundEffects: false
    }
  };

  private config: InventoryUIConfig;
  private changeListeners: Set<(config: InventoryUIConfig) => void> = new Set();

  constructor() {
    this.config = this.loadUserConfig();
    this.attachStorageListener();
  }

  private attachStorageListener(): void {
    // Listen for changes from other tabs/windows
    window.addEventListener('storage', (event) => {
      if (event.key === ConfigManager.STORAGE_KEY && event.newValue) {
        try {
          this.config = JSON.parse(event.newValue);
          this.notifyListeners();
        } catch (error) {
          console.error('Failed to parse config from storage event:', error);
        }
      }
    });
  }

  loadUserConfig(): InventoryUIConfig {
    try {
      const stored = localStorage.getItem(ConfigManager.STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return this.mergeWithDefaults(parsed);
      }
    } catch (error) {
      console.error('Failed to load user config:', error);
    }
    
    return { ...ConfigManager.DEFAULT_CONFIG };
  }

  private mergeWithDefaults(userConfig: Partial<InventoryUIConfig>): InventoryUIConfig {
    // Deep merge user config with defaults
    const merged: InventoryUIConfig = JSON.parse(JSON.stringify(ConfigManager.DEFAULT_CONFIG));
    
    if (userConfig.quickbar) {
      Object.assign(merged.quickbar, userConfig.quickbar);
    }
    if (userConfig.chatCommands) {
      Object.assign(merged.chatCommands, userConfig.chatCommands);
    }
    if (userConfig.fullPanel) {
      Object.assign(merged.fullPanel, userConfig.fullPanel);
    }
    if (userConfig.global) {
      Object.assign(merged.global, userConfig.global);
    }
    
    return merged;
  }

  saveUserConfig(updates: Partial<InventoryUIConfig>): void {
    // Merge updates with current config
    if (updates.quickbar) {
      Object.assign(this.config.quickbar, updates.quickbar);
    }
    if (updates.chatCommands) {
      Object.assign(this.config.chatCommands, updates.chatCommands);
    }
    if (updates.fullPanel) {
      Object.assign(this.config.fullPanel, updates.fullPanel);
    }
    if (updates.global) {
      Object.assign(this.config.global, updates.global);
    }
    
    // Save to localStorage
    try {
      localStorage.setItem(ConfigManager.STORAGE_KEY, JSON.stringify(this.config));
      this.notifyListeners();
    } catch (error) {
      console.error('Failed to save user config:', error);
    }
  }

  getEffectiveConfig(): InventoryUIConfig {
    return { ...this.config };
  }

  get(path: string): any {
    const parts = path.split('.');
    let value: any = this.config;
    
    for (const part of parts) {
      if (value && typeof value === 'object' && part in value) {
        value = value[part];
      } else {
        return undefined;
      }
    }
    
    return value;
  }

  set(path: string, value: any): void {
    const parts = path.split('.');
    const updates: any = {};
    let current = updates;
    
    for (let i = 0; i < parts.length - 1; i++) {
      current[parts[i]] = {};
      current = current[parts[i]];
    }
    
    current[parts[parts.length - 1]] = value;
    this.saveUserConfig(updates);
  }

  resetToDefaults(): void {
    this.config = { ...ConfigManager.DEFAULT_CONFIG };
    localStorage.setItem(ConfigManager.STORAGE_KEY, JSON.stringify(this.config));
    this.notifyListeners();
  }

  exportConfig(): string {
    return JSON.stringify(this.config, null, 2);
  }

  importConfig(configJson: string): boolean {
    try {
      const parsed = JSON.parse(configJson);
      const validated = this.validateConfig(parsed);
      if (validated) {
        this.config = this.mergeWithDefaults(parsed);
        this.saveUserConfig(this.config);
        return true;
      }
    } catch (error) {
      console.error('Failed to import config:', error);
    }
    return false;
  }

  private validateConfig(config: any): boolean {
    // Basic validation
    if (!config || typeof config !== 'object') return false;
    
    // Check for required sections
    const requiredSections = ['quickbar', 'chatCommands', 'fullPanel', 'global'];
    for (const section of requiredSections) {
      if (!(section in config) || typeof config[section] !== 'object') {
        return false;
      }
    }
    
    return true;
  }

  onChange(callback: (config: InventoryUIConfig) => void): () => void {
    this.changeListeners.add(callback);
    return () => this.changeListeners.delete(callback);
  }

  private notifyListeners(): void {
    const config = this.getEffectiveConfig();
    this.changeListeners.forEach(callback => callback(config));
  }

  // Convenience methods
  isQuickbarEnabled(): boolean {
    return this.config.quickbar.enabled;
  }

  isChatCommandsEnabled(): boolean {
    return this.config.chatCommands.enabled;
  }

  isFullPanelEnabled(): boolean {
    return this.config.fullPanel.enabled;
  }

  getQuickbarPosition(): string {
    return this.config.quickbar.position;
  }

  getTheme(): string {
    if (this.config.global.theme === 'auto') {
      // Check SillyTavern's theme or system preference
      const isDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
      return isDark ? 'dark' : 'light';
    }
    return this.config.global.theme;
  }

  // Debug helpers
  debug(): void {
    console.log('Current Inventory UI Config:', this.config);
  }

  getConfigSummary(): string {
    const enabled = [];
    if (this.config.quickbar.enabled) enabled.push('Quickbar');
    if (this.config.chatCommands.enabled) enabled.push('Chat Commands');
    if (this.config.fullPanel.enabled) enabled.push('Full Panel');
    
    return `Inventory UI: ${enabled.join(', ') || 'None enabled'}`;
  }
}

// Export singleton instance
export const configManager = new ConfigManager();