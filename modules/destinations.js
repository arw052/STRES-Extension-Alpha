import { extensionName, defaultSettings } from './constants.js';
import { state } from './state.js';

function randomId(prefix = 'dest') {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  } catch {}
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function coerceText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.join('\n');
  if (typeof value === 'object') {
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value);
}

const STRESDestinationsPrototype = {
  ctx: null,

  init(ctx) {
    this.ctx = ctx || window.SillyTavern?.getContext?.() || null;
    this.ensureSettings();
    try { state.destinations = this; } catch {}
  },

  ensureSettings() {
    const settingsRoot = window.extension_settings || (window.extension_settings = {});
    settingsRoot[extensionName] = settingsRoot[extensionName] || structuredClone(defaultSettings);
    const root = settingsRoot[extensionName];
    root.destinations = root.destinations || structuredClone(defaultSettings.destinations);
    root.destinations.entries = root.destinations.entries || structuredClone(defaultSettings.destinations.entries);
    if (!root.destinations.defaultKey || !(root.destinations.defaultKey in root.destinations.entries)) {
      root.destinations.defaultKey = 'orchestrator';
    }
    return root.destinations;
  },

  getSettings() {
    try {
      const settingsRoot = window.extension_settings?.[extensionName];
      return (settingsRoot && settingsRoot.destinations) || this.ensureSettings();
    } catch {
      return structuredClone(defaultSettings.destinations);
    }
  },

  list() {
    const cfg = this.getSettings();
    return Object.entries(cfg.entries || {}).map(([key, value]) => ({ key, ...(value || {}) }));
  },

  has(key) {
    if (!key) return false;
    const cfg = this.getSettings();
    return !!cfg.entries?.[key];
  },

  get(key) {
    if (!key) return null;
    const cfg = this.getSettings();
    return cfg.entries?.[key] || null;
  },

  getDefaultKey() {
    const cfg = this.getSettings();
    return cfg.defaultKey || 'orchestrator';
  },

  setDefault(key) {
    if (!this.has(key)) return false;
    const cfg = this.getSettings();
    cfg.defaultKey = key;
    try {
      const ctx = window.SillyTavern?.getContext?.();
      (ctx?.saveSettingsDebounced || window.saveSettingsDebounced)?.();
    } catch {}
    return true;
  },

  annotate(text, meta = {}) {
    try {
      const trimmed = String(text || '').trim();
      const parts = [trimmed];
      const commentBits = [];
      if (meta.destinationKey) commentBits.push(`destination=${meta.destinationKey}`);
      if (meta.targetModel) commentBits.push(`target=${meta.targetModel}`);
      if (meta.source) commentBits.push(`source=${meta.source}`);
      if (meta.dispatchId) commentBits.push(`dispatch=${meta.dispatchId}`);
      if (commentBits.length) {
        parts.push(`<!-- stres:${commentBits.join(' ')} -->`);
      }
      return parts.join('\n');
    } catch {
      return text;
    }
  },

  async send(options = {}) {
    const key = options.key || this.getDefaultKey();
    const prompt = coerceText(options.prompt || '');
    if (!prompt.trim()) {
      throw new Error('Prompt text required');
    }
    const dest = this.get(key);
    if (!dest) {
      throw new Error(`Unknown destination: ${key}`);
    }
    if (dest.mode === 'direct') {
      return this.sendViaDirect(key, dest, prompt, options);
    }
    return this.sendViaPlan(key, dest, prompt, options);
  },

  async sendViaPlan(key, dest, prompt, options) {
    if (!state.routingManager?.dispatch) {
      throw new Error('Routing manager unavailable');
    }
    const intent = dest.intent || options.intent || 'story';
    const routingOverrides = Object.assign({}, dest.routingOverrides || {}, options.routingOverrides || {});
    const metadata = Object.assign({}, options.metadata || {}, { destinationKey: key });
    const payload = {
      intent,
      userPrompt: prompt,
      routingOverrides,
      metadata
    };
    if (options.targetModel || dest.targetModel) {
      payload.routingOverrides = Object.assign({}, routingOverrides, { targetModel: options.targetModel || dest.targetModel });
    }
    const result = await state.routingManager.dispatch(payload);
    return Object.assign({}, result, {
      destinationKey: key,
      source: 'orchestrator',
      targetModel: result?.route?.targetModel || dest.targetModel || null
    });
  },

  async sendViaDirect(key, dest, prompt, options) {
    const fn = window.sendCustomCompletion
      || window.SillyTavern?.sendCustomCompletion
      || this.ctx?.sendCustomCompletion;
    if (typeof fn !== 'function') {
      throw new Error('sendCustomCompletion is not available in this SillyTavern build.');
    }
    const settings = Object.assign({}, dest.settings || {}, options.settings || {});
    const request = {
      prompt,
      settings,
      metadata: Object.assign({}, dest.metadata || {}, options.metadata || {}, { destinationKey: key })
    };
    let response;
    try {
      response = await fn(request);
    } catch (error) {
      return {
        ok: false,
        error: error?.message || String(error),
        destinationKey: key,
        source: 'direct',
        targetModel: dest.targetModel || null,
        raw: null
      };
    }
    let text = '';
    if (typeof response === 'string') {
      text = response;
    } else if (response && typeof response === 'object') {
      text = response.content
        || response.text
        || response.result
        || response?.choices?.[0]?.message?.content
        || response?.choices?.[0]?.text
        || response?.message
        || '';
    }
    text = this.annotate(text, {
      destinationKey: key,
      targetModel: dest.targetModel || null,
      source: 'direct',
      dispatchId: response?.dispatchId || randomId('direct')
    });
    const targetModel = dest.targetModel || response?.model || null;
    return {
      ok: !!text,
      text,
      segments: [{ slot: 'primary', text }],
      destinationKey: key,
      source: 'direct',
      targetModel,
      dispatchId: response?.dispatchId || randomId('direct'),
      usage: response?.usage || null,
      raw: response
    };
  }
};

export default function createDestinationsManager() {
  return Object.assign({}, STRESDestinationsPrototype);
}
