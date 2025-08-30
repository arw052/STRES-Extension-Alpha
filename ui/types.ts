export type ThemeMode = 'auto' | 'light' | 'dark' | 'custom';

export interface AccessibilityConfig {
  highContrast: boolean;
  reducedMotion: boolean;
  screenReaderOptimized: boolean;
}

export interface UIConfig {
  theme: ThemeMode;
  animations: boolean;
  compactMode: boolean;
  accessibility: AccessibilityConfig;
}

export type QuickbarPosition = 'top' | 'bottom' | 'floating';

export interface QuickbarConfig {
  enabled: boolean;
  position: QuickbarPosition;
  widgets: string[];
  autoHide: boolean;
}

export type ExportFormat = 'json' | 'yaml';

export interface SettingsConfig {
  showAdvanced: boolean;
  exportFormat: ExportFormat;
  backupSettings: boolean;
}

export interface CodexConfig {
  ui: UIConfig;
  quickbar: QuickbarConfig;
  settings: SettingsConfig;
}

export interface UIState {
  loading: boolean;
  error: string | null;
  tokens: number;
  config: CodexConfig;
}

export interface CharacterSummary {
  id?: string;
  name: string;
  description?: string;
  avatarUrl?: string;
}

export interface ImportResult {
  success: boolean;
  characterName?: string;
  error?: string;
}
