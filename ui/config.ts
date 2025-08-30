import type { CodexConfig } from './types';

export const defaultConfig: CodexConfig = {
  ui: {
    theme: 'auto',
    animations: true,
    compactMode: false,
    accessibility: {
      highContrast: false,
      reducedMotion: false,
      screenReaderOptimized: true,
    },
  },
  quickbar: {
    enabled: true,
    position: 'bottom',
    widgets: ['tokens', 'settings'],
    autoHide: false,
  },
  settings: {
    showAdvanced: false,
    exportFormat: 'json',
    backupSettings: true,
  },
};

