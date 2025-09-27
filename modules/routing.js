import { extensionName, defaultSettings } from './constants.js';
import { state } from './state.js';

function clone(value) {
  try {
    return structuredClone(value);
  } catch {
    return value ? JSON.parse(JSON.stringify(value)) : value;
  }
}

function estimateTokens(text) {
  if (!text) return 0;
  return Math.max(1, Math.ceil(String(text).length / 4));
}

function randomId(prefix = 'local') {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return `${prefix}-${crypto.randomUUID()}`;
    }
  } catch {}
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatContextRows(context) {
  try {
    if (!context || typeof context !== 'object') return '';
    const rows = [];
    for (const [key, value] of Object.entries(context)) {
      if (value == null) continue;
      if (typeof value === 'object') {
        rows.push(`${key}: ${JSON.stringify(value, null, 2)}`);
      } else {
        rows.push(`${key}: ${value}`);
      }
    }
    return rows.join('\n');
  } catch {
    return '';
  }
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function isNonEmptyObject(value) {
  return value && typeof value === 'object' && Object.keys(value).length > 0;
}

const RoutingManagerPrototype = {
  ctx: null,
  lastDispatch: null,

  init(ctx) {
    this.ctx = ctx || window.SillyTavern?.getContext?.() || null;
    state.routingManager = this;
  },

  getSettings() {
    const settings = window.extension_settings?.[extensionName] || {};
    return Object.assign({}, defaultSettings, settings);
  },

  getChatMeta() {
    const context = this.ctx || window.SillyTavern?.getContext?.();
    if (!context) return null;
    const meta = context.chatMetadata || (context.chatMetadata = {});
    meta.stres = meta.stres || {};
    return meta.stres;
  },

  async buildPayload(options = {}) {
    const settings = this.getSettings();
    const ctx = this.ctx || window.SillyTavern?.getContext?.();
    const meta = this.getChatMeta() || {};
    const scenario = meta.latestScenario || null;

    let npcProfile = null;
    if (options.actorId && window.STRESNPC?.ensureRegistry) {
      try {
        const registry = await window.STRESNPC.ensureRegistry();
        npcProfile = registry?.[options.actorId] || null;
      } catch {}
    }

    const worldState = clone(window.STRESWorld?.lastState || {});
    const hud = clone(meta.hud || meta.hudOverrides || null);
    const summary = Array.isArray(meta.summaries) ? meta.summaries : [];

    const routingConfig = scenario?.metadata?.routing || meta.routing || null;
    const intent = String(options.intent || 'story').toLowerCase();

    const overrides = this.mergeRoutingOverrides(intent, options, routingConfig, npcProfile);
    const actorTags = Array.isArray(options.actorTags) && options.actorTags.length
      ? options.actorTags
      : (toArray(npcProfile?.tags));

    const payload = {
      intent,
      role: options.role || null,
      prompt: options.userPrompt || options.prompt || '',
      campaignId: settings.campaignId || null,
      chatId: ctx?.chatId || null,
      actorId: options.actorId || npcProfile?.id || null,
      actorName: options.actorName || npcProfile?.name || null,
      actorVariant: options.actorVariant || null,
      actorTags,
      routingOverrides: overrides,
      context: {
        scenario,
        world: worldState,
        hud,
        summary,
        npc: npcProfile,
        mode: meta.mode || 'story'
      },
      metadata: Object.assign({
        sceneHeader: typeof window.STRESWorld?.formatHeader === 'function' ? window.STRESWorld.formatHeader() : null,
        source: 'STRES-Extension',
        requestedAt: new Date().toISOString()
      }, options.metadata || {})
    };

    return { payload, npcProfile, routingConfig };
  },

  mergeRoutingOverrides(intent, options, scenarioRouting, npcProfile) {
    const merged = {};
    const layers = [];

    if (scenarioRouting) {
      if (intent === 'npc' && scenarioRouting.npc) {
        const npcConfig = scenarioRouting.npc;
        if (options.actorId && npcConfig.ids?.[options.actorId]) layers.push(npcConfig.ids[options.actorId]);
        if (options.actorVariant && npcConfig.variants?.[options.actorVariant]) layers.push(npcConfig.variants[options.actorVariant]);
        const tags = toArray(options.actorTags || npcProfile?.tags || []);
        for (const tag of tags) {
          if (npcConfig.tags?.[tag]) layers.push(npcConfig.tags[tag]);
        }
        if (npcConfig.default) layers.push(npcConfig.default);
      }
      if (scenarioRouting[intent]) layers.push(scenarioRouting[intent]);
      if (scenarioRouting.default) layers.push(scenarioRouting.default);
    }

    if (isNonEmptyObject(options.routingOverrides)) layers.push(options.routingOverrides);

    for (const layer of layers) {
      if (isNonEmptyObject(layer)) Object.assign(merged, layer);
    }

    return merged;
  },

  async fetchServerPlan(payload) {
    if (!state.stresClient?.dispatchPrompt) return null;
    try {
      const response = await state.stresClient.dispatchPrompt(payload);
      if (response?.success && response.data) {
        return {
          source: 'server',
          dispatchId: response.data.dispatchId,
          route: response.data.route,
          assembly: response.data.assembly || [],
          gatedContext: response.data.gatedContext || {},
          audit: response.data.audit || null,
          budget: response.data.budget || null,
          requestEcho: response.data.requestEcho || null,
          timestamp: response.data.timestamp || new Date().toISOString()
        };
      }
      return { source: 'server', error: response?.error || 'Unknown dispatch response', raw: response };
    } catch (error) {
      return { source: 'server', error: error?.message || String(error) };
    }
  },

  buildFallbackPlan(payload, options, npcProfile) {
    const intent = payload.intent || 'story';
    const settings = this.getSettings();
    const assembly = [];
    let route;

    if (intent === 'npc') {
      const npcModel = settings.combat?.npcModel || defaultSettings.combat.npcModel;
      route = {
        intent,
        role: payload.role || 'NPC',
        targetModel: npcModel.model,
        chatCompletionSource: npcModel.chat_completion_source || npcModel.source || 'openrouter',
        maxTokens: Number(npcModel.max_tokens || npcModel.maxTokens || 160),
        temperature: Number(npcModel.temperature || 0.75),
        reason: 'fallback',
        actorId: payload.actorId || npcProfile?.id || null,
        actorName: payload.actorName || npcProfile?.name || null,
        actorTags: payload.actorTags || [],
        actorVariant: payload.actorVariant || null
      };
      assembly.push({
        slot: 'npc-primary',
        actorId: route.actorId,
        actorName: route.actorName || route.actorId || 'NPC',
        order: 1,
        channel: 'assistant'
      });
    } else if (intent === 'tool') {
      route = {
        intent,
        role: payload.role || 'System',
        targetModel: 'openrouter/gpt-4o-mini',
        chatCompletionSource: 'openrouter',
        maxTokens: 200,
        temperature: 0.2,
        reason: 'fallback',
        actorId: payload.actorId || null,
        actorName: payload.actorName || null,
        actorTags: payload.actorTags || [],
        actorVariant: payload.actorVariant || null
      };
      assembly.push({ slot: 'tool-output', order: 1, channel: 'assistant' });
    } else {
      const cs = this.ctx?.chatCompletionSettings || {};
      route = {
        intent,
        role: payload.role || 'DM',
        targetModel: cs.model || cs.api || 'default-model',
        chatCompletionSource: cs.chat_completion_source || 'openrouter',
        maxTokens: Number(cs.max_tokens || 512),
        temperature: Number(cs.temperature || 0.7),
        reason: 'fallback',
        actorId: payload.actorId || null,
        actorName: payload.actorName || null,
        actorTags: payload.actorTags || [],
        actorVariant: payload.actorVariant || null
      };
      assembly.push({ slot: 'story-primary', actorId: 'narrator', actorName: 'Narrator', order: 1, channel: 'assistant' });
    }

    return {
      source: 'fallback',
      dispatchId: randomId('fallback'),
      route,
      assembly,
      gatedContext: payload.context || {},
      audit: null,
      budget: {
        budgetTokens: null,
        usedTokens: 0,
        remainingTokens: null,
        predictedPromptTokens: estimateTokens(payload.prompt)
      },
      requestEcho: {
        promptPreview: (payload.prompt || '').slice(0, 280),
        metadata: payload.metadata || null
      },
      timestamp: new Date().toISOString()
    };
  },

  buildMessages(plan, payload, options, npcProfile) {
    if (Array.isArray(options.messages) && options.messages.length) {
      return options.messages;
    }

    const messages = [];
    const intent = payload.intent || 'story';
    let systemPrompt = options.systemPrompt || '';

    const contextLines = formatContextRows(plan.gatedContext);

    if (!systemPrompt) {
      if (intent === 'npc') {
        const persona = npcProfile?.persona ? ` Persona: ${npcProfile.persona}.` : '';
        systemPrompt = `You are ${payload.actorName || npcProfile?.name || 'the NPC'}. Stay in character and speak in first person.${persona}`;
      } else if (intent === 'tool') {
        systemPrompt = 'You are a deterministic adjudication engine. Reply with concise JSON describing the resolved action.';
      } else {
        systemPrompt = 'You are the world narrator guiding a rich tabletop roleplay experience. Balance description, pacing, and player agency.';
      }
      if (contextLines) {
        systemPrompt += `\n\nContext:\n${contextLines}`;
      }
    }

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    const userBlocks = [];
    if (options.userContext) userBlocks.push(String(options.userContext));
    if (plan.requestEcho?.promptPreview && !options.omitContextPreview) {
      userBlocks.push(`Recent prompt preview:\n${plan.requestEcho.promptPreview}`);
    }
    userBlocks.push(options.userPrompt || payload.prompt || '');

    messages.push({ role: 'user', content: userBlocks.filter(Boolean).join('\n\n') });
    return messages;
  },

  async executePlan(plan, payload, options, npcProfile) {
    const ctx = this.ctx || window.SillyTavern?.getContext?.();
    if (!ctx?.ChatCompletionService?.processRequest) {
      return { ok: false, error: 'ChatCompletionService unavailable', messages: [] };
    }

    const messages = this.buildMessages(plan, payload, options, npcProfile);
    const request = {
      messages,
      model: plan.route?.targetModel,
      chat_completion_source: plan.route?.chatCompletionSource,
      max_tokens: plan.route?.maxTokens,
      temperature: plan.route?.temperature
    };
    if (plan.route?.topP != null) request.top_p = plan.route.topP;
    if (plan.route?.presencePenalty != null) request.presence_penalty = plan.route.presencePenalty;
    if (plan.route?.frequencyPenalty != null) request.frequency_penalty = plan.route.frequencyPenalty;

    try {
      const response = await ctx.ChatCompletionService.processRequest(request, { presetName: null });
      if (!response || typeof response === 'function') {
        return { ok: false, error: 'Empty response', messages, request };
      }
      const text = String(response.content || response.result || response.text || '').trim();
      const segments = Array.isArray(plan.assembly) && plan.assembly.length
        ? plan.assembly.map((entry, index) => ({ ...entry, text: index === 0 ? text : '' }))
        : [{ slot: 'primary', text }];
      return {
        ok: !!text,
        text,
        usage: response.usage || null,
        segments,
        messages,
        request
      };
    } catch (error) {
      return { ok: false, error: error?.message || String(error), messages, request };
    }
  },

  async dispatch(options = {}) {
    const payloadInfo = await this.buildPayload(options);
    const payload = payloadInfo.payload;

    const serverPlan = await this.fetchServerPlan(payload);
    let plan = null;
    let source = 'server';

    if (serverPlan && serverPlan.route && !serverPlan.error) {
      plan = serverPlan;
    } else {
      source = 'fallback';
      plan = this.buildFallbackPlan(payload, options, payloadInfo.npcProfile);
    }

    try {
      const meta = this.getChatMeta();
      const ctx = this.ctx || window.SillyTavern?.getContext?.();
      if (meta) {
        meta.lastDispatch = {
          intent: payload.intent || 'story',
          route: plan?.route || null,
          audit: plan?.audit || null,
          dispatchId: plan?.dispatchId || null,
          timestamp: plan?.timestamp || new Date().toISOString(),
          actorId: plan?.route?.actorId || payload.actorId || null,
          participants: Array.isArray(plan?.gatedContext?.participants) ? plan.gatedContext.participants : [],
          scene: plan?.gatedContext?.scene || null
        };
        ctx?.saveMetadata?.();
      }
    } catch {}

    const execution = await this.executePlan(plan, payload, options, payloadInfo.npcProfile);

    const result = {
      ok: execution.ok,
      text: execution.text || '',
      segments: execution.segments || [],
      route: plan.route,
      dispatchId: plan.dispatchId,
      source,
      usage: execution.usage || null,
      audit: plan.audit || null,
      diagnostics: {
        plan,
        payload,
        serverPlan,
        messages: execution.messages,
        request: execution.request,
        audit: plan.audit || null,
        error: execution.error || null
      }
    };

    this.lastDispatch = result;
    try {
      if (plan.audit && window.STRESTelemetry?.recordAudit) {
        window.STRESTelemetry.recordAudit(plan.audit);
      }
    } catch {}
    try {
      if (result.ok && window.STRESTelemetry?.recordComponent) {
        const destination = (payload.metadata && payload.metadata.destinationKey) || 'orchestrator';
        await window.STRESTelemetry.recordComponent('Prompt', result.text, {
          key: 'STRES_PROMPT_RESULT',
          targetModel: result.route?.targetModel || null,
          destination,
          source
        });
      }
    } catch {}
    return result;
  }
};

export default function createRoutingManager() {
    return Object.assign({}, RoutingManagerPrototype);
}
