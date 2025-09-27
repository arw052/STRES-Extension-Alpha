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

    normalizeHudField(entry, origin = 'scenario') {
      if (!entry) return null;
      if (typeof entry === 'string') {
        return {
          key: String(entry),
          label: String(entry),
          value: '',
          category: 'general',
          type: 'stat',
          origin,
          tags: [],
          raw: entry
        };
      }
      if (typeof entry !== 'object') return null;

      const raw = deepClone(entry);
      const key = entry.key || entry.id || entry.slug || entry.name;
      if (!key) return null;

      const label = entry.label || entry.name || entry.key || entry.id || 'Stat';
      const tags = coerceArray(entry.tags).map((tag) => String(tag));
      const valueObj = (entry.value && typeof entry.value === 'object' && !Array.isArray(entry.value)) ? entry.value : null;
      const current = entry.current != null ? Number(entry.current) : (valueObj?.current != null ? Number(valueObj.current) : null);
      const max = entry.max != null ? Number(entry.max) : (valueObj?.max != null ? Number(valueObj.max) : null);
      const min = entry.min != null ? Number(entry.min) : (valueObj?.min != null ? Number(valueObj.min) : null);

      let value = '';
      if (entry.value != null && typeof entry.value !== 'object') {
        value = String(entry.value);
      } else if (entry.text != null) {
        value = String(entry.text);
      } else if (current != null && max != null) {
        value = `${current}/${max}`;
      } else if (current != null) {
        value = String(current);
      }

      const normalized = {
        key: String(key),
        label: String(label),
        value,
        current: Number.isFinite(current) ? current : null,
        max: Number.isFinite(max) ? max : null,
        min: Number.isFinite(min) ? min : null,
        unit: entry.unit || entry.unitSymbol || (valueObj?.unit) || null,
        category: entry.category || entry.section || entry.group || (tags.includes('resource') ? 'resources' : 'general'),
        type: entry.type || entry.kind || (tags.includes('resource') ? 'resource' : 'stat'),
        tags,
        priority: Number.isFinite(entry.priority) ? Number(entry.priority) : null,
        icon: entry.icon || entry.emoji || null,
        origin,
        variant: entry.variant || entry.timeline || entry.timelineTag || null,
        textMode: entry.textMode || entry.textPlacement || null,
        format: entry.format || entry.template || null,
        thresholds: entry.thresholds && typeof entry.thresholds === 'object' ? deepClone(entry.thresholds) : null,
        metadata: entry.metadata && typeof entry.metadata === 'object' ? deepClone(entry.metadata) : null,
        style: entry.style && typeof entry.style === 'object' ? deepClone(entry.style) : null,
        extra: entry.extra && typeof entry.extra === 'object' ? deepClone(entry.extra) : null,
        raw
      };

      if (!normalized.extra && valueObj?.extra && typeof valueObj.extra === 'object') {
        normalized.extra = deepClone(valueObj.extra);
      }

      return normalized;
    },

    buildHudOverrides(payload, scenario) {
      const fromScenario = coerceArray(scenario?.hudOverrides)
        .map((entry) => this.normalizeHudField(entry, 'scenario'))
        .filter(Boolean);
      const fromPayload = coerceArray(payload.hudOverrides)
        .map((entry) => this.normalizeHudField(entry, 'payload'))
        .filter(Boolean);
      return [...fromScenario, ...fromPayload];
    },

    buildRouting(manifest, scenario, payload) {
      const merged = {};
      const apply = (source) => {
        if (!source || typeof source !== 'object') return;
        Object.assign(merged, deepClone(source));
      };

      apply(manifest?.prompts?.routing);
      apply(manifest?.promptRouting);
      apply(manifest?.routing);
      apply(scenario?.promptRouting || scenario?.routing);
      apply(payload?.metadata?.routing);

      return Object.keys(merged).length ? merged : null;
    },

    buildNpcPlacements(scenario) {
      const placements = coerceArray(scenario?.npcPlacements || scenario?.initialState?.npcPlacements);
      return placements.map((npc) => ({
        templateId: npc.templateId || npc.template || npc.id || null,
        instanceId: npc.instanceId || npc.id || null,
        name: npc.name || npc.displayName || null,
        displayName: npc.displayName || npc.name || null,
        role: npc.role || npc.archetype || null,
        spawnState: npc.spawnState === 'offscreen' ? 'offscreen' : (npc.spawnState || 'active'),
        variantId: npc.variantId || npc.variant || null,
        tags: coerceArray(npc.tags),
        metadata: npc.metadata || null,
        timelineTag: npc.timelineTag || null
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
          customFlags: payload.customFlags,
          worldpackId: payload.worldpackId || manifest.id || null
        },
        primer: this.buildPrimer(manifest, scenario),
        sceneHeader: this.buildSceneHeader(manifest, scenario),
        npcPlacements: this.buildNpcPlacements(scenario),
        hudOverrides: this.buildHudOverrides(payload, scenario),
        cleanup: this.buildCleanup(payload, scenario),
        onboardingSummary: payload.onboardingSummary || this.composeSummary(payload, scenario),
        initialInjections: payload.initialInjections,
        metadata: payload.metadata,
        routing: this.buildRouting(manifest, scenario, payload),
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
        if (activation.routing) chatMeta.routing = deepClone(activation.routing);
        if (activation.campaign?.id) chatMeta.campaignId = activation.campaign.id;
        chatMeta.scenarioHistory.push({
          activatedAt: new Date().toISOString(),
          activation
        });
        if (!Array.isArray(chatMeta.onboardingLog)) chatMeta.onboardingLog = [];
      }

      const settings = window.extension_settings?.[extensionName];
      let campaignId = options.campaignId || settings?.campaignId || chatMeta?.campaignId || null;
      try {
        if (!campaignId && typeof crypto !== 'undefined' && crypto.randomUUID) {
          campaignId = crypto.randomUUID();
        }
      } catch {}
      activation.campaign.id = campaignId;
      if (settings) {
        settings.worldpackId = payload.worldpackId || settings.worldpackId || null;
        settings.scenarioId = activation.scenario.id;
        settings.timelineTag = activation.campaign.timelineTag;
        if (manifest?.tools && typeof manifest.tools === 'object') {
          settings.tools = settings.tools || deepClone(defaultSettings.tools);
          if (manifest.tools.spawnOptions != null) {
            settings.tools.spawn_options = !!manifest.tools.spawnOptions;
          }
        }
        if (campaignId) settings.campaignId = campaignId;
        if (ctx?.chatId) {
          settings.chatCampaigns = settings.chatCampaigns || {};
          if (campaignId) settings.chatCampaigns[ctx.chatId] = campaignId;
        }
        (ctx?.saveSettingsDebounced || window.saveSettingsDebounced || (() => {}))();
        try { (state.toolIntegration || window.STRESTools)?.refresh?.(ctx); } catch {}
      }

      try {
        await this.syncNpcActivation(activation, manifest, payload);
      } catch (error) {
        console.warn('[STRES] ScenarioReducer: NPC sync failed', error);
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

  module.syncNpcActivation = async function syncNpcActivation(activation, manifest, payload) {
    try {
      if (!state.stresClient?.syncNpcPlacements) return;
      const placements = Array.isArray(activation.npcPlacements)
        ? activation.npcPlacements.map((npc) => ({
            templateId: npc.templateId,
            instanceId: npc.instanceId || null,
            name: npc.name || null,
            displayName: npc.displayName || null,
            role: npc.role || null,
            variantId: npc.variantId || null,
            spawnState: npc.spawnState || 'active',
            tags: npc.tags || null,
            metadata: npc.metadata || null,
            timelineTag: npc.timelineTag || null
          }))
        : [];
      if (!placements.length) return;
      const settings = window.extension_settings?.[extensionName] || {};
      const campaignId = activation.campaign?.id || settings.campaignId;
      if (!campaignId) return;
      const sceneId = activation.sceneHeader?.metadata?.sceneId || activation.scenario?.id || null;
      const worldpackId = activation.campaign?.worldpackId || settings.worldpackId || payload.worldpackId || manifest.id;
      const response = await state.stresClient.syncNpcPlacements({
        campaign: {
          id: campaignId,
          label: activation.campaign?.label || payload.campaignLabel || null
        },
        worldpackId,
        timelineTag: activation.campaign?.timelineTag || payload.timelineTag || null,
        scenarioId: activation.scenario?.id || null,
        sceneId,
        placements
      });
      if (response?.success === false) {
        console.warn('[STRES] NPC sync response error', response.error);
        return;
      }
      const payloadData = response?.data || response;
      if (payloadData?.campaignId && settings) {
        settings.campaignId = payloadData.campaignId;
        try { (window.SillyTavern?.getContext?.()?.saveSettingsDebounced || window.saveSettingsDebounced)?.(); } catch {}
      }
      if (Array.isArray(payloadData?.npcs)) {
        try { STRESNPC.applyBackendDirectory?.(payloadData.npcs); } catch (error) {
          console.warn('[STRES] Failed to apply backend NPC directory', error);
        }
      }
    } catch (error) {
      console.warn('[STRES] syncNpcActivation failed', error);
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
