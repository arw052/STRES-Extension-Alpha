import { defaultSettings, extensionName } from './constants.js';
import { state } from './state.js';

function deepClone(value) {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}

function coerceBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(lower)) return true;
    if (['false', '0', 'no', 'off'].includes(lower)) return false;
  }
  return fallback;
}

function coerceArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

const DEFAULT_CLEANUP = Object.freeze({
  archiveWizard: true,
  pruneMessages: true,
  retainCount: 0
});

export function createScenarioReducer({ STRESWorld }) {
  const module = {
    ctx: null,

    getContext() {
      if (!this.ctx) this.ctx = window.SillyTavern?.getContext?.() || null;
      return this.ctx;
    },

    getChatMeta() {
      const ctx = this.getContext();
      if (!ctx) return null;
      const meta = ctx.chatMetadata || (ctx.chatMetadata = {});
      if (!meta.stres) meta.stres = {};
      if (!meta.stres.scenarioHistory) meta.stres.scenarioHistory = [];
      return meta.stres;
    },

    normalizeArchitectPayload(raw) {
      if (!raw) return null;
      let payload = raw;
      if (typeof raw === 'string') {
        try {
          payload = JSON.parse(raw);
        } catch (error) {
          console.warn('[STRES] ScenarioReducer: failed to parse payload', error);
          return null;
        }
      }
      if (typeof payload !== 'object') return null;

      const out = {
        worldpackId: payload.worldpackId || payload.worldPackId || payload.packId || null,
        campaignLabel: payload.campaignLabel || payload.campaignName || null,
        timelineTag: payload.timelineTag || payload.timeline || null,
        scenarioId: payload.scenarioId || payload.scenario || null,
        playerCharacters: Array.isArray(payload.playerCharacters) ? payload.playerCharacters : [],
        customFlags: payload.customFlags && typeof payload.customFlags === 'object' ? { ...payload.customFlags } : {},
        initialInjections: Array.isArray(payload.initialInjections) ? payload.initialInjections : [],
        hudOverrides: Array.isArray(payload.hudOverrides) ? payload.hudOverrides : [],
        cleanup: payload.cleanup && typeof payload.cleanup === 'object' ? { ...payload.cleanup } : null,
        onboardingSummary: payload.onboardingSummary || payload.summary || null,
        metadata: payload.metadata && typeof payload.metadata === 'object' ? { ...payload.metadata } : {}
      };

      // Accept legacy camelCase flags
      if (!out.cleanup) {
        const archiveWizard = coerceBoolean(payload.archiveWizard ?? payload.cleanupArchiveWizard, DEFAULT_CLEANUP.archiveWizard);
        const pruneMessages = coerceBoolean(payload.pruneMessages ?? payload.cleanupPruneMessages, DEFAULT_CLEANUP.pruneMessages);
        const retainCount = Number.isFinite(payload.retainCount) ? Number(payload.retainCount) : DEFAULT_CLEANUP.retainCount;
        out.cleanup = { archiveWizard, pruneMessages, retainCount };
      }

      return out;
    },

    resolveScenario(manifest, scenarioId) {
      if (!manifest) return null;
      const scenarios = Array.isArray(manifest.scenarios) ? manifest.scenarios : [];
      if (!scenarios.length) return null;
      if (!scenarioId) return scenarios[0] || null;
      const exact = scenarios.find((s) => s.id === scenarioId);
      if (exact) return exact;
      const bySlug = scenarios.find((s) => s.slug === scenarioId || s.label === scenarioId);
      if (bySlug) return bySlug;
      return scenarios[Number(scenarioId) - 1] || null;
    },

    buildPrimer(manifest, scenario) {
      const primer = scenario?.primer || manifest?.prompts?.primer || manifest?.primer;
      if (!primer) return null;
      const text = typeof primer === 'string' ? primer : primer.text || primer.content;
      if (!text) return null;
      const depth = Number.isFinite(primer.depth) ? primer.depth : 0;
      const role = primer.role === 'user' ? 'user' : 'system';
      return {
        promptId: scenario?.primerId || 'STRES_WORLD_PRIMER',
        text,
        depth,
        role,
        budgetHint: Number.isFinite(primer.budgetHint) ? primer.budgetHint : null
      };
    },

    buildSceneHeader(manifest, scenario) {
      const base = deepClone(scenario?.sceneHeader || scenario?.initialState?.sceneHeader || manifest?.defaults?.sceneHeader) || null;
      if (!base) return null;
      const header = {
        template: base.template || base.text || '',
        badges: coerceArray(base.badges || base.tags || []),
        metadata: base.metadata && typeof base.metadata === 'object' ? { ...base.metadata } : {}
      };
      return header;
    },

    buildHudOverrides(payload, scenario) {
      const combined = [...coerceArray(scenario?.hudOverrides), ...coerceArray(payload.hudOverrides)];
      return combined
        .map((entry) => {
          if (!entry) return null;
          if (typeof entry === 'string') {
            return { key: entry, label: entry, value: '' };
          }
          const key = entry.key || entry.id;
          if (!key) return null;
          return {
            key,
            label: entry.label || entry.name || key,
            value: entry.value != null ? String(entry.value) : ''
          };
        })
        .filter(Boolean);
    },

    buildNpcPlacements(scenario) {
      const placements = coerceArray(scenario?.npcPlacements || scenario?.initialState?.npcPlacements);
      return placements.map((npc) => ({
        templateId: npc.templateId || npc.id || npc.template || null,
        spawnState: npc.spawnState === 'offscreen' ? 'offscreen' : 'active',
        variantId: npc.variantId || npc.variant || null
      })).filter((npc) => npc.templateId);
    },

    buildCleanup(payload, scenario) {
      const cleanup = {
        archiveWizard: DEFAULT_CLEANUP.archiveWizard,
        pruneMessages: DEFAULT_CLEANUP.pruneMessages,
        retainCount: DEFAULT_CLEANUP.retainCount
      };
      const applySource = (source) => {
        if (!source || typeof source !== 'object') return;
        if (source.archiveWizard != null) cleanup.archiveWizard = coerceBoolean(source.archiveWizard, cleanup.archiveWizard);
        if (source.pruneMessages != null) cleanup.pruneMessages = coerceBoolean(source.pruneMessages, cleanup.pruneMessages);
        if (Number.isFinite(source.retainCount)) cleanup.retainCount = Math.max(0, Number(source.retainCount));
      };
      applySource(scenario?.cleanup);
      applySource(payload.cleanup);
      return cleanup;
    },

    composeSummary(payload, scenario) {
      const lines = [];
      if (payload.campaignLabel) lines.push(`Campaign: **${payload.campaignLabel}**`);
      if (scenario?.label) lines.push(`Scenario: **${scenario.label}**`);
      if (payload.timelineTag || scenario?.timelineTag) {
        lines.push(`Timeline: ${payload.timelineTag || scenario.timelineTag}`);
      }
      if (payload.playerCharacters?.length) {
        const pcs = payload.playerCharacters.map((pc) => pc.name || pc.id || 'Unknown').join(', ');
        lines.push(`Player Characters: ${pcs}`);
      }
      if (scenario?.openingNarration) {
        const snippet = String(scenario.openingNarration).split('\n')[0];
        lines.push(`Opening: ${snippet}`);
      }
      return lines.join('\n');
    },

    async apply(rawPayload, options = {}) {
      const payload = this.normalizeArchitectPayload(rawPayload);
      if (!payload) {
        return { success: false, error: 'Invalid architect payload' };
      }

      const manifest = await STRESWorld.getManifestFresh();
      if (!manifest) {
        return { success: false, error: 'Worldpack manifest unavailable' };
      }

      const scenario = this.resolveScenario(manifest, payload.scenarioId);
      if (!scenario) {
        return { success: false, error: 'Scenario not found in manifest' };
      }

      const activation = {
        campaign: {
          id: options.campaignId || null,
          label: payload.campaignLabel || scenario.label || manifest?.title || 'STRES Campaign',
          timelineTag: payload.timelineTag || scenario.timelineTag || manifest?.defaultTimeline || null,
          customFlags: payload.customFlags
        },
        primer: this.buildPrimer(manifest, scenario),
        sceneHeader: this.buildSceneHeader(manifest, scenario),
        npcPlacements: this.buildNpcPlacements(scenario),
        hudOverrides: this.buildHudOverrides(payload, scenario),
        cleanup: this.buildCleanup(payload, scenario),
        onboardingSummary: payload.onboardingSummary || this.composeSummary(payload, scenario),
        initialInjections: payload.initialInjections,
        metadata: payload.metadata,
        scenario: {
          id: scenario.id || payload.scenarioId || null,
          label: scenario.label || scenario.name || payload.scenarioId || 'Scenario',
          openingNarration: scenario.openingNarration || null,
          initialState: scenario.initialState || null
        }
      };

      const ctx = this.getContext();
      const chatMeta = this.getChatMeta();
      if (chatMeta) {
        chatMeta.latestScenario = deepClone(activation);
        chatMeta.scenarioHistory.push({
          activatedAt: new Date().toISOString(),
          activation
        });
        if (!Array.isArray(chatMeta.onboardingLog)) chatMeta.onboardingLog = [];
      }

      const settings = window.extension_settings?.[extensionName];
      if (settings) {
        settings.worldpackId = payload.worldpackId || settings.worldpackId || null;
        settings.scenarioId = activation.scenario.id;
        settings.timelineTag = activation.campaign.timelineTag;
        if (ctx?.chatId) {
          settings.chatCampaigns = settings.chatCampaigns || {};
          if (options.campaignId) settings.chatCampaigns[ctx.chatId] = options.campaignId;
        }
        (ctx?.saveSettingsDebounced || window.saveSettingsDebounced || (() => {}))();
      }

      // Emit lightweight notification for future hooks
      try {
        const detail = { activation, payload, options };
        window.dispatchEvent(new CustomEvent('stres:scenarioActivated', { detail }));
      } catch (error) {
        console.warn('[STRES] ScenarioReducer: failed to emit activation event', error);
      }

      return { success: true, activation };
    }
  };

  // Expose helpers for debugging/testing
  module.describe = async function describe(scenarioId) {
    const manifest = await STRESWorld.getManifestFresh();
    const scenario = this.resolveScenario(manifest, scenarioId);
    if (!scenario) return null;
    return {
      scenario,
      primer: this.buildPrimer(manifest, scenario),
      hudOverrides: this.buildHudOverrides({}, scenario),
      cleanup: this.buildCleanup({}, scenario)
    };
  };

  return module;
}

export default createScenarioReducer;
