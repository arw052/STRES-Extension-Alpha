"use strict";
class ConfigManager {
    constructor() {
        this.changeListeners = new Set();
        this.config = this.loadUserConfig();
        this.attachStorageListener();
    }
    attachStorageListener() {
        window.addEventListener('storage', (event) => {
            if (event.key === ConfigManager.STORAGE_KEY && event.newValue) {
                try {
                    this.config = JSON.parse(event.newValue);
                    this.notifyListeners();
                }
                catch (error) {
                    console.error('Failed to parse config from storage event:', error);
                }
            }
        });
    }
    loadUserConfig() {
        try {
            const stored = localStorage.getItem(ConfigManager.STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                return this.mergeWithDefaults(parsed);
            }
        }
        catch (error) {
            console.error('Failed to load user config:', error);
        }
        return { ...ConfigManager.DEFAULT_CONFIG };
    }
    mergeWithDefaults(userConfig) {
        const merged = JSON.parse(JSON.stringify(ConfigManager.DEFAULT_CONFIG));
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
    saveUserConfig(updates) {
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
        try {
            localStorage.setItem(ConfigManager.STORAGE_KEY, JSON.stringify(this.config));
            this.notifyListeners();
        }
        catch (error) {
            console.error('Failed to save user config:', error);
        }
    }
    getEffectiveConfig() {
        return { ...this.config };
    }
    get(path) {
        const parts = path.split('.');
        let value = this.config;
        for (const part of parts) {
            if (value && typeof value === 'object' && part in value) {
                value = value[part];
            }
            else {
                return undefined;
            }
        }
        return value;
    }
    set(path, value) {
        const parts = path.split('.');
        const updates = {};
        let current = updates;
        for (let i = 0; i < parts.length - 1; i++) {
            current[parts[i]] = {};
            current = current[parts[i]];
        }
        current[parts[parts.length - 1]] = value;
        this.saveUserConfig(updates);
    }
    resetToDefaults() {
        this.config = { ...ConfigManager.DEFAULT_CONFIG };
        localStorage.setItem(ConfigManager.STORAGE_KEY, JSON.stringify(this.config));
        this.notifyListeners();
    }
    exportConfig() {
        return JSON.stringify(this.config, null, 2);
    }
    importConfig(configJson) {
        try {
            const parsed = JSON.parse(configJson);
            const validated = this.validateConfig(parsed);
            if (validated) {
                this.config = this.mergeWithDefaults(parsed);
                this.saveUserConfig(this.config);
                return true;
            }
        }
        catch (error) {
            console.error('Failed to import config:', error);
        }
        return false;
    }
    validateConfig(config) {
        if (!config || typeof config !== 'object')
            return false;
        const requiredSections = ['quickbar', 'chatCommands', 'fullPanel', 'global'];
        for (const section of requiredSections) {
            if (!(section in config) || typeof config[section] !== 'object') {
                return false;
            }
        }
        return true;
    }
    onChange(callback) {
        this.changeListeners.add(callback);
        return () => this.changeListeners.delete(callback);
    }
    notifyListeners() {
        const config = this.getEffectiveConfig();
        this.changeListeners.forEach(callback => callback(config));
    }
    isQuickbarEnabled() {
        return this.config.quickbar.enabled;
    }
    isChatCommandsEnabled() {
        return this.config.chatCommands.enabled;
    }
    isFullPanelEnabled() {
        return this.config.fullPanel.enabled;
    }
    getQuickbarPosition() {
        return this.config.quickbar.position;
    }
    getTheme() {
        var _a;
        if (this.config.global.theme === 'auto') {
            const isDark = (_a = window.matchMedia) === null || _a === void 0 ? void 0 : _a.call(window, '(prefers-color-scheme: dark)').matches;
            return isDark ? 'dark' : 'light';
        }
        return this.config.global.theme;
    }
    debug() {
        console.log('Current Inventory UI Config:', this.config);
    }
    getConfigSummary() {
        const enabled = [];
        if (this.config.quickbar.enabled)
            enabled.push('Quickbar');
        if (this.config.chatCommands.enabled)
            enabled.push('Chat Commands');
        if (this.config.fullPanel.enabled)
            enabled.push('Full Panel');
        return `Inventory UI: ${enabled.join(', ') || 'None enabled'}`;
    }
}

ConfigManager.STORAGE_KEY = 'stres-inventory-config';
ConfigManager.DEFAULT_CONFIG = {
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
    combat: {
        enabled: true,
        apiBase: 'http://localhost:3001',
        campaignId: 'default-campaign',
        characterId: '22222222-2222-2222-2222-222222222222',
        showPanel: true,
        autoAct: false
    },
    global: {
        theme: 'auto',
        animations: true,
        soundEffects: false
    }
};
export { ConfigManager };
export const configManager = new ConfigManager();
