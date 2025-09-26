import { extensionName, defaultSettings } from './modules/constants.js';
import { state } from './modules/state.js';
import STRESWorld from './modules/world.js';
import { createOnboarding } from './modules/onboarding.js';

// Normalize SillyTavern language setting so i18n falls back to English
try {
  const langKey = 'language';
  const markerKey = 'stresLanguageNormalized';
  const storedLang = localStorage.getItem(langKey);
  const effective = (storedLang || navigator.language || '').toLowerCase();
  const alreadyNormalized = localStorage.getItem(markerKey) === '1';
  if (effective === 'en-us') {
    localStorage.setItem(langKey, 'en');
    if (!alreadyNormalized) {
      localStorage.setItem(markerKey, '1');
      // Reload once so SillyTavern picks up the new locale before i18n initializes
      window.location.reload();
    }
  } else if (alreadyNormalized) {
    // Clean up marker once we're stable so future language switches still work
    localStorage.removeItem(markerKey);
  }
} catch {}

// Override/extend chat helpers for Phase 7 features
try {
  // Assistant-style message injector (e.g., NPC replies)
  STRESChat.addAssistantMessage = async function(name, text) {
    try {
      const ctx = window.SillyTavern?.getContext?.();
      const message = {
        name: String(name||'NPC'),
        is_user: false,
        is_system: false,
        send_date: Date.now(),
        mes: String(text||'').trim(),
        extra: { api: 'manual', model: 'stres-npc', gen_id: Date.now() }
      };
      // Push and render
      ctx?.chat?.push?.(message);
      await ctx?.eventSource?.emit?.(ctx?.eventTypes?.MESSAGE_RECEIVED, (ctx.chat.length - 1), 'stres');
      ctx?.addOneMessage?.(message);
      await ctx?.eventSource?.emit?.(ctx?.eventTypes?.CHARACTER_MESSAGE_RENDERED, (ctx.chat.length - 1), 'stres');
      await ctx?.saveChat?.();
    } catch {}
  };
  // System-style message injector (for /stres feedback)
  STRESChat.addSystemMessage = async function(text) {
    try {
      const ctx = window.SillyTavern?.getContext?.();
      const message = {
        name: 'STRES',
        is_user: false,
        is_system: true,
        send_date: Date.now(),
        mes: String(text||'').trim(),
        extra: { api: 'stres', model: 'stres-system', gen_id: Date.now() }
      };
      ctx?.chat?.push?.(message);
      await ctx?.eventSource?.emit?.(ctx?.eventTypes?.MESSAGE_RECEIVED, (ctx.chat.length - 1), 'stres');
      ctx?.addOneMessage?.(message);
      await ctx?.eventSource?.emit?.(ctx?.eventTypes?.CHARACTER_MESSAGE_RENDERED, (ctx.chat.length - 1), 'stres');
      await ctx?.saveChat?.();
    } catch {}
  };
  // Combat status override to reflect mode and initiative
  const _showCombatStatus = STRESChat.showCombatStatus?.bind(STRESChat);
  STRESChat.showCombatStatus = function() {
    try {
      const active = (STRESCombat.getMode && STRESCombat.getMode()) === 'combat';
      const meta = (window.SillyTavern?.getContext?.().chatMetadata?.stres) || {};
      const round = meta?.combat?.round || 1;
      const order = Array.isArray(meta?.combat?.order) ? meta.combat.order.join(', ') : '—';
      this.sendToChat(`**Combat Status**\\n• Active: ${active ? 'Yes' : 'No'}\\n• Round: ${round}\\n• Init: ${order}`);
    } catch {
      try { return _showCombatStatus?.(); } catch {}
    }
    return '';
  };
} catch {}

// (moved) overrides appended after STRESChat definition


// Global STRES object references are tracked via modules/state.js
let STRESOnboarding;
// Narrator Card & Onboarding (Phase 12)
const STRESNarrator = {
  ctx: null,
  init(ctx) {
    this.ctx = ctx || window.SillyTavern?.getContext?.() || null;
    // Attempt onboarding on first load per chat
    this.applyCharacterConfig().catch(()=>{});
    this.maybeOnboard().catch(()=>{});
  },
  getMeta() {
    const ctx = this.ctx || window.SillyTavern?.getContext?.();
    const meta = ctx?.chatMetadata || (ctx.chatMetadata = {});
    meta.stres = meta.stres || {};
    return meta;
  },
  async readCharacterField(cid, key) {
    const ctx = this.ctx || window.SillyTavern?.getContext?.();
    try { if (ctx?.readExtensionField) return await ctx.readExtensionField(cid, key); } catch {}
    try { const ch = ctx?.characters?.[cid]; if (ch?.extensions && key in ch.extensions) return ch.extensions[key]; } catch {}
    try { const ch = ctx?.characters?.[cid]; if (ch && key in ch) return ch[key]; } catch {}
    return undefined;
  },
  async applyCharacterConfig() {
    try {
      const ctx = this.ctx || window.SillyTavern?.getContext?.();
      const cid = ctx?.characterId; if (!cid) return false;
      const cfg = await this.readCharacterField(cid, 'stres');
      const depth = await this.readCharacterField(cid, 'depth_prompt');
      if (!cfg && !depth) return false;
      const s = window.extension_settings || (ctx?.extensionSettings) || {};
      s[extensionName] = s[extensionName] || structuredClone(defaultSettings);
      if (cfg && typeof cfg === 'object') {
        if (cfg.worldpackId) s[extensionName].worldpackId = cfg.worldpackId;
        s[extensionName].world = s[extensionName].world || structuredClone(defaultSettings.world);
        if (cfg.regionId) s[extensionName].world.regionId = cfg.regionId;
        if (cfg.headerTemplate) {
          s[extensionName].world.header = s[extensionName].world.header || structuredClone(defaultSettings.world.header);
          s[extensionName].world.header.template = cfg.headerTemplate;
        }
        if (typeof cfg.primerEnabled === 'boolean') {
          s[extensionName].budget = s[extensionName].budget || structuredClone(defaultSettings.budget);
          s[extensionName].budget.components = s[extensionName].budget.components || {};
          s[extensionName].budget.components.primer = s[extensionName].budget.components.primer || {};
          s[extensionName].budget.components.primer.enabled = !!cfg.primerEnabled;
        }
        if (typeof cfg.ragEnabled === 'boolean') {
          s[extensionName].rag = s[extensionName].rag || structuredClone(defaultSettings.rag);
          s[extensionName].rag.enabled = !!cfg.ragEnabled;
          s[extensionName].budget = s[extensionName].budget || structuredClone(defaultSettings.budget);
          s[extensionName].budget.components = s[extensionName].budget.components || {};
          s[extensionName].budget.components.rag = s[extensionName].budget.components.rag || {};
          s[extensionName].budget.components.rag.enabled = !!cfg.ragEnabled;
        }
        if (cfg.budgetProfile) {
          s[extensionName].budget = s[extensionName].budget || structuredClone(defaultSettings.budget);
          s[extensionName].budget.profile = cfg.budgetProfile;
        }
      }
      try { (ctx?.saveSettingsDebounced || window.saveSettingsDebounced)?.(); } catch {}
      // Apply runtime effects
      try {
        if (s[extensionName].worldpackId) {
          await state.stresClient.loadWorldpackById(s[extensionName].worldpackId).catch(()=>{});
        }
        await STRESPrompts.refreshSceneHeaderInPrompt();
      } catch {}
      return true;
    } catch { return false; }
  },
  async maybeOnboard() {
    try {
      const meta = this.getMeta();
      if (meta.stres.onboarded) return false;
      await this.sendOnboarding();
      meta.stres.onboarded = Date.now();
      await (this.ctx?.saveMetadata?.());
      return true;
    } catch { return false; }
  },
  async sendOnboarding() {
    try {
      const msg = [
        '**Welcome to STRES!**',
        'Quick start:',
        '1) /stres worldpack load <id>',
        '2) /stres scenarios',
        '3) /stres start <id|index>',
        '4) /stres inject primer',
        'Optional: /stres mode combat • /stres tools • /stres settings',
      ].join('\n');
      STRESChat.sendToChat(msg);
    } catch {}
  },
  defaultDepthPrompt() {
    return 'You are the Narrator/DM. Speak in third person to describe world and outcomes. Keep secrets hidden. Never reveal private info. Stay concise, realistic, and grounded in the STRES worldpack. Use scene header data for time, weather, and location.';
  },
  buildPortableConfig() {
    try {
      const s = window.extension_settings?.[extensionName] || {};
      return {
        worldpackId: s.worldpackId || '',
        regionId: s.world?.regionId || '',
        headerTemplate: s.world?.header?.template || defaultSettings.world.header.template,
        primerEnabled: !!(s.budget?.components?.primer?.enabled ?? true),
        ragEnabled: !!(s.rag?.enabled),
        budgetProfile: s.budget?.profile || 'Balanced'
      };
    } catch { return {}; }
  },
  async bindToCurrentCharacter() {
    try {
      const ctx = this.ctx || window.SillyTavern?.getContext?.();
      const cid = ctx?.characterId;
      if (!cid || !ctx?.writeExtensionField) return { ok:false, error: 'No active character' };
      // Write portable STRES config
      const cfg = this.buildPortableConfig();
      await ctx.writeExtensionField(cid, 'stres', cfg);
      return { ok:true, characterId: cid, stres: cfg };
    } catch (e) { return { ok:false, error: String(e?.message||e) }; }
  },
  async setDepthPrompt(text) {
    try {
      const ctx = this.ctx || window.SillyTavern?.getContext?.();
      const cid = ctx?.characterId;
      if (!cid || !ctx?.writeExtensionField) return { ok:false, error: 'No active character' };
      const val = String(text || this.defaultDepthPrompt());
      await ctx.writeExtensionField(cid, 'depth_prompt', val);
      return { ok:true, characterId: cid };
    } catch (e) { return { ok:false, error: String(e?.message||e) }; }
  },
  async showStatus() {
    try {
      const ctx = this.ctx || window.SillyTavern?.getContext?.();
      const cid = ctx?.characterId;
      const name = ctx?.characters?.[cid]?.name || '(unknown)';
      STRESChat.sendToChat(`**Narrator**\n• Active Character: ${name} (${cid||'n/a'})\n• Onboarded: ${!!this.getMeta()?.stres?.onboarded}`);
      return true;
    } catch { return false; }
  }
};

// First-time setup scaffolding removed (see modules/onboarding.js)
// LLM Tool registration (Phase 10)
const STRESTools = {
  ctx: null,
  init(ctx) {
    try {
      this.ctx = ctx || window.SillyTavern?.getContext?.() || null;
      if (!this.ctx?.registerFunctionTool || !this.ctx?.isToolCallingSupported?.()) {
        console.log('[STRES] Tool calling not supported; skipping tool registration');
        return;
      }
      if (!this.getSettings().enabled) { console.log('[STRES] Tools disabled in settings'); return; }
      const TM = this.ctx.ToolManager;
      const register = this.ctx.registerFunctionTool?.bind(this.ctx) || TM?.registerFunctionTool?.bind(TM);
      if (!register) return;

      // 1) where — return current world/scene state
      const wrap = (name, params, action) => async (p) => { const res = await action(p); try { STRESTelemetry.logTool(name, p, res); } catch {}; return res; };
      if (this.isEnabled('where')) register({
        name: 'stres_where',
        displayName: 'STRES Where',
        description: 'Return current world/scene state (location, date/time, weather).',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        action: wrap('stres_where', {}, async () => {
          try {
            const meta = (this.ctx.chatMetadata?.stres) || {};
            await STRESWorld.getStateFresh();
            const st = STRESWorld.lastState || {};
            return {
              location: meta.locationLabel || meta.regionId || 'Unknown',
              dateISO: st.time?.iso || meta.timeISO || null,
              timeOfDay: st.time?.daySegment || meta.timeOfDay || null,
              weather: st.weather?.condition || meta.weather || null,
              regionId: meta.regionId || null,
            };
          } catch (e) { return { error: String(e?.message||e) }; }
        }),
        shouldRegister: async () => true,
        stealth: false,
      });

      // 2) tick — advance time in sim
      if (this.isEnabled('tick')) register({
        name: 'stres_tick',
        displayName: 'STRES Tick',
        description: 'Advance simulation time by a duration (e.g., 2h, 30m).',
        parameters: { type: 'object', properties: { advance: { type: 'string', description: 'Duration to advance, e.g., 2h or 30m' } }, required: ['advance'], additionalProperties: false },
        action: wrap('stres_tick', { advance: true }, async ({ advance }) => {
          const s = window.extension_settings?.[extensionName] || {};
          const adv = String(advance||'').trim();
          if (!adv) return { error: 'advance is required' };
          try {
            const api = (s.serverUrl || defaultSettings.serverUrl) + '/api/sim/tick?advance=' + encodeURIComponent(adv) + (s.world?.regionId ? ('&regionId='+encodeURIComponent(s.world.regionId)) : '');
            const r = await fetch(api);
            const j = await r.json();
            if (j?.success) {
              STRESWorld.lastState = j.state; STRESWorld.lastFetch = Date.now();
              try { await STRESPrompts.refreshSceneHeaderInPrompt(); } catch {}
              return { ok: true, advanced: adv, timeISO: j.state?.time?.iso, timeOfDay: j.state?.time?.daySegment };
            }
            return { ok: false, error: 'tick failed' };
          } catch (e) { return { ok:false, error: String(e?.message||e) }; }
        }),
        shouldRegister: async () => true,
        stealth: false,
      });

      // 3) update_state — extract structured story state
      if (this.isEnabled('update_state')) register({
        name: 'stres_update_state',
        displayName: 'STRES Update State',
        description: 'Extract structured story state JSON from recent messages.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        action: wrap('stres_update_state', {}, async () => {
          const ok = await STRESSummary.extractState();
          const meta = this.ctx.chatMetadata?.stres || {};
          return { ok, state: meta.state || null };
        }),
        shouldRegister: async () => !!this.ctx.generateQuietPrompt,
        stealth: true,
      });

      // 4) start_scenario — apply scenario from worldpack
      if (this.isEnabled('start_scenario')) register({
        name: 'stres_start_scenario',
        displayName: 'STRES Start Scenario',
        description: 'Start a scenario by id or index from the active worldpack.',
        parameters: { type: 'object', properties: { id: { type: 'string', description: 'Scenario id or index' } }, required: ['id'], additionalProperties: false },
        action: wrap('stres_start_scenario', { id:true }, async ({ id }) => {
          const res = await STRESWorld.scenario(String(id));
          try { await STRESWorld.refresh(res?.regionId); await STRESPrompts.refreshSceneHeaderInPrompt(); } catch {}
          return res || { ok:false };
        }),
        shouldRegister: async () => true,
        stealth: false,
      });

      // 5) npc_reply — have an NPC reply via a cheap model
      if (this.isEnabled('npc_reply')) register({
        name: 'stres_npc_reply',
        displayName: 'STRES NPC Reply',
        description: 'Compose a short NPC reply using a cheaper, separate model.',
        parameters: { type: 'object', properties: { npcId: { type: 'string' }, cue: { type: 'string' } }, required: ['npcId','cue'], additionalProperties: false },
        action: wrap('stres_npc_reply', { npcId:true, cue:true }, async ({ npcId, cue }) => {
          const txt = await STRESCombat.npcReply(String(npcId), String(cue));
          return { npcId, text: txt };
        }),
        shouldRegister: async () => !!this.ctx.ChatCompletionService,
        stealth: false,
      });

      // 6) dice — roll dice and return results
      if (this.isEnabled('dice')) register({
        name: 'stres_dice',
        displayName: 'STRES Dice',
        description: 'Roll dice using XdY+Z notation and return results.',
        parameters: { type: 'object', properties: { notation: { type: 'string' } }, required: ['notation'], additionalProperties: false },
        action: wrap('stres_dice', { notation:true }, async ({ notation }) => {
          const r = STRESCombat.rollDice(String(notation));
          return r.ok ? { ok:true, total: r.total, rolls: r.rolls, mod: r.mod, text: `${notation} -> ${r.total}` } : { ok:false, error: r.error };
        }),
        shouldRegister: async () => true,
        stealth: false,
      });

      console.log('[STRES] Function tools registered');
    } catch (e) {
      console.warn('[STRES] Failed to register tools', e);
    }
  },
  getSettings() { const s = window.extension_settings?.[extensionName] || {}; return s.tools || defaultSettings.tools; },
  isEnabled(key) { try { const t = this.getSettings(); return !!(t.enabled && t[key] !== false); } catch { return true; } },
  refresh(ctx) {
    try {
      this.ctx = ctx || this.ctx || window.SillyTavern?.getContext?.() || null;
      const TM = this.ctx?.ToolManager;
      if (!TM) return;
      const names = ['stres_where','stres_tick','stres_update_state','stres_start_scenario','stres_npc_reply','stres_dice'];
      // Unregister disabled tools
      for (const n of names) {
        const key = n.replace('stres_','');
        const should = this.isEnabled(key);
        if (!should) TM.unregisterFunctionTool?.(n);
      }
      // Register enabled tools (idempotent overwrite)
      this.init(this.ctx);
    } catch (e) { console.warn('[STRES] Tools refresh failed', e); }
  }
};
// Expose helper for debugging/inspection
try { window.STRESWorld = STRESWorld; } catch {}

// Budgeting utilities
const STRESBudget = {
  profiles: {
    Lean:   { contextTarget: 1400, cushion: 120, reserve: 150, header: 90, primer: 350 },
    Balanced:{ contextTarget: 2000, cushion: 200, reserve: 200, header: 120, primer: 600 },
    Rich:   { contextTarget: 3000, cushion: 300, reserve: 200, header: 140, primer: 800 },
  },

  getSettings() {
    const s = window.extension_settings?.[extensionName] || {};
    return s.budget || (defaultSettings.budget);
  },

  applyProfile(name) {
    const s = window.extension_settings?.[extensionName] || {};
    const prof = this.profiles[name];
    if (!s.budget || !prof) return false;
    s.budget.profile = name;
    s.budget.contextTarget = prof.contextTarget;
    s.budget.cushion = prof.cushion;
    s.budget.reserve = prof.reserve;
    s.budget.components = s.budget.components || {};
    s.budget.components.header = s.budget.components.header || {};
    s.budget.components.primer = s.budget.components.primer || {};
    s.budget.components.header.maxTokens = prof.header;
    s.budget.components.primer.maxTokens = prof.primer;
    try { const ctx = window.SillyTavern?.getContext?.(); (ctx?.saveSettingsDebounced || window.saveSettingsDebounced)?.(); } catch {}
    return true;
  },

  async predictTokens() {
    const s = this.getSettings();
    const out = { header: 0, primer: 0, summaries: 0, rag: 0, npc: 0, combat: 0, guard: 0 };
    // header
    try { out.header = await STRESWorld.tokenCount(STRESWorld.formatHeader()); } catch {}
    // primer (from cached manifest if available)
    try {
      const mf = await STRESWorld.getManifestFresh();
      if (mf) {
        const primer = STRESChat.buildWorldpackPrimer(mf);
        out.primer = await STRESWorld.tokenCount(primer);
      }
    } catch {}
    // combat header when in combat mode
    try {
      const txt = STRESCombat.formatHeader?.();
      if (txt) out.combat = await STRESWorld.tokenCount(txt);
    } catch {}
    // guardrail line
    try {
      const g = STRESGuard.formatGuard?.();
      if (g) out.guard = await STRESWorld.tokenCount(g);
    } catch {}
    // others are 0 until implemented
    return out;
  },

  // Decide allowance per component given predicted tokens
  decideAllowance(pred, opts = {}) {
    const s = this.getSettings();
    const limit = Math.max(0, (s.contextTarget || 2000) - (s.cushion || 0) - (s.reserve || 0));
    const comps = s.components || {};
    // Prepare list with caps and sticky
    const entries = [
      { name: 'guard', tokens: Math.min(pred.guard || 0, comps.guard?.maxTokens || 0), enabled: !!(comps.guard?.enabled), sticky: !!(comps.guard?.sticky) },
      { name: 'header', tokens: Math.min(pred.header || 0, comps.header?.maxTokens || 0), enabled: !!(comps.header?.enabled), sticky: !!(comps.header?.sticky) },
      { name: 'combat', tokens: Math.min(pred.combat || 0, comps.combat?.maxTokens || 0), enabled: !!(comps.combat?.enabled), sticky: !!(comps.combat?.sticky) },
      { name: 'primer', tokens: Math.min(pred.primer || 0, comps.primer?.maxTokens || 0), enabled: !!(comps.primer?.enabled), sticky: !!(comps.primer?.sticky) },
      { name: 'summaries', tokens: Math.min(pred.summaries || 0, comps.summaries?.maxTokens || 0), enabled: !!(comps.summaries?.enabled), sticky: !!(comps.summaries?.sticky) },
      { name: 'rag', tokens: Math.min(pred.rag || 0, comps.rag?.maxTokens || 0), enabled: !!(comps.rag?.enabled), sticky: !!(comps.rag?.sticky) },
      { name: 'npc', tokens: Math.min(pred.npc || 0, comps.npc?.maxTokens || 0), enabled: !!(comps.npc?.enabled), sticky: !!(comps.npc?.sticky) },
    ];
    // Sum sticky first
    let total = 0;
    const allowance = {};
    for (const e of entries) {
      if (!e.enabled) { allowance[e.name] = 0; continue; }
      if (e.sticky) {
        allowance[e.name] = e.tokens;
        total += e.tokens;
      } else {
        allowance[e.name] = 0;
      }
    }
    let remaining = Math.max(0, limit - total);
    // Degrade order for optional
    const order = Array.isArray(s.degrade?.order) ? s.degrade.order : ['rag','npc','summaries','primer'];
    for (const name of order) {
      const e = entries.find(x => x.name === name);
      if (!e || !e.enabled || e.sticky) continue;
      if (e.tokens <= remaining) {
        allowance[name] = e.tokens; remaining -= e.tokens; total += e.tokens;
      } else {
        // Partial allowance if beneficial
        if (e.tokens > 0 && remaining > 0) { allowance[name] = remaining; total += remaining; remaining = 0; }
      }
    }
    return { limit, total, remaining, allowance };
  },

  // Naive trim by characters using ~4 chars per token
  trimToTokens(text, allowedTokens) {
    if (!text) return text;
    if (!allowedTokens || allowedTokens < 1) return '';
    const s = String(text);
    // rough char cap
    const charCap = Math.max(1, Math.floor(allowedTokens * 4));
    if (s.length <= charCap) return s;
    // try to cut on line boundary
    const lines = s.split('\n');
    let out = '';
    for (const ln of lines) {
      if ((out.length + ln.length + 1) > charCap) break;
      out += (out ? '\n' : '') + ln;
    }
    if (!out) return s.slice(0, charCap);
    return out;
  },
};

// RAG adapter (Vectors or manifest fallback)
const STRESRAG = {
  ctx: null,
  init(ctx) { this.ctx = ctx || window.SillyTavern?.getContext?.() || null; },
  getSettings() { const s = window.extension_settings?.[extensionName] || {}; return s.rag || defaultSettings.rag; },

  getQueryText() {
    try {
      const ctx = this.ctx || window.SillyTavern?.getContext?.();
      const chat = Array.isArray(ctx?.chat) ? ctx.chat : [];
      const lastUser = [...chat].reverse().find(m => m?.is_user);
      const loc = window.extension_settings?.[extensionName]?.world?.locationName || window.extension_settings?.[extensionName]?.world?.regionId || '';
      return (lastUser?.mes || lastUser?.text || loc || '').slice(0, 600);
    } catch { return ''; }
  },

  async retrieve(query) {
    const cfg = this.getSettings();
    const topK = Math.max(1, Number(cfg.topK || 2));
    // Try SillyTavern Vectors extension if available
    try {
      const ctx = this.ctx || window.SillyTavern?.getContext?.();
      const vec = ctx?.Vectors || window.Vectors;
      if (vec?.search) {
        const results = await vec.search({ query, topK });
        if (Array.isArray(results) && results.length) {
          return results.slice(0, topK).map(r => ({ text: r.text || r.chunk || r.content || '', score: r.score || 0.0, source: r.source || r.meta?.source || 'vectors' }));
        }
      }
    } catch {}
    // Fallback to manifest scan
    try {
      const mfResp = await state.stresClient.getWorldpackManifest();
      const mf = mfResp?.manifest || null;
      const docs = this.buildDocsFromManifest(mf);
      const scored = this.scoreDocs(query, docs).slice(0, topK);
      return scored;
    } catch { return []; }
  },

  buildDocsFromManifest(mf) {
    const docs = [];
    if (!mf || typeof mf !== 'object') return docs;
    try {
      // Regions
      const regions = Array.isArray(mf.regions) ? mf.regions : [];
      for (const r of regions) {
        const parts = [];
        if (r.name) parts.push(`Region ${r.name}`);
        if (r.biome) parts.push(`Biome ${r.biome}`);
        if (r.factors) parts.push(Object.entries(r.factors).map(([k,v])=>`${k}:${v}`).join(', '));
        docs.push({ text: parts.join(' • '), source: `region:${r.id||r.name||''}` });
      }
      // Creatures
      const creatures = Array.isArray(mf.creatures) ? mf.creatures : [];
      for (const c of creatures) {
        const parts = [];
        parts.push(c.name || c.id || 'Creature');
        if (c.biomes?.length) parts.push(`Biomes ${c.biomes.join(', ')}`);
        if (c.levelRange) parts.push(`Levels ${Array.isArray(c.levelRange)?c.levelRange.join('-'):c.levelRange}`);
        if (c.tags?.length) parts.push(c.tags.join(', '));
        docs.push({ text: parts.join(' • '), source: `creature:${c.id||c.name||''}` });
      }
      // Crafting skills/items
      const skills = mf.crafting?.skills || [];
      for (const sk of (Array.isArray(skills)?skills:[])) {
        docs.push({ text: `Crafting Skill ${sk.name||sk.id}`, source: `skill:${sk.id||sk.name||''}` });
      }
      // Terminology
      const terms = mf.terminology || {};
      for (const [k,v] of Object.entries(terms)) {
        docs.push({ text: `Term ${k} → ${v}`, source: `term:${k}` });
      }
      // Economy prices
      const prices = mf.economy?.basePrices || {};
      const priceKeys = Object.keys(prices).slice(0, 40);
      if (priceKeys.length) docs.push({ text: `Prices: ${priceKeys.map(k=>`${k}:${prices[k]}`).join(', ')}`, source: 'economy' });
    } catch {}
    // Scene state hints
    try {
      const ctx = this.ctx || window.SillyTavern?.getContext?.();
      const st = ctx?.chatMetadata?.stres || {};
      const hints = [];
      if (st.locationLabel) hints.push(`Location ${st.locationLabel}`);
      if (st.timeOfDay) hints.push(`Time ${st.timeOfDay}`);
      if (st.weather) hints.push(`Weather ${st.weather}`);
      if (st.state?.objectives?.length) hints.push(`Objectives ${st.state.objectives.join('; ')}`);
      if (hints.length) docs.push({ text: hints.join(' • '), source: 'scene' });
    } catch {}
    return docs;
  },

  scoreDocs(query, docs) {
    const q = String(query||'').toLowerCase();
    const terms = q.split(/[^a-z0-9]+/i).filter(Boolean);
    return docs.map(d => {
      const t = String(d.text||'').toLowerCase();
      let score = 0;
      for (const w of terms) { if (w && t.includes(w)) score += 1; }
      return { text: d.text, source: d.source, score };
    }).filter(x => x.score > 0).sort((a,b)=> b.score - a.score);
  },

  formatBullets(items) {
    return items.map(it => `• ${it.text}`).join('\n');
  }
};

// NPC presence, memory, and injection
const STRESNPC = {
  ctx: null,
  registry: null, // { id -> { id, name, label, role, persona, tags[] } }
  init(ctx) {
    this.ctx = ctx || window.SillyTavern?.getContext?.() || null;
    this.ensureRegistry().catch(()=>{});
    try {
      const es = this.ctx?.eventSource; const ET = this.ctx?.eventTypes || {};
      if (es && ET) {
        es.on(ET.MESSAGE_SENT, (m)=>{ this.onMessage(m).catch(()=>{}); });
        es.on(ET.MESSAGE_RECEIVED, (m)=>{ this.onMessage(m).catch(()=>{}); });
        es.on(ET.GENERATION_ENDED, ()=>{ this.onTurnEnd().catch(()=>{}); });
        es.on(ET.CHAT_CHANGED, ()=>{ this.registry=null; });
      }
    } catch {}
  },

  getSettings() {
    const s = window.extension_settings?.[extensionName] || {};
    return s.npc || defaultSettings.npc;
  },

  async ensureRegistry() {
    if (this.registry) return this.registry;
    const reg = {};
    try {
      const resp = await state.stresClient.getWorldpackManifest();
      const mf = resp?.manifest || null;
      const inst = Array.isArray(mf?.npcInstances) ? mf.npcInstances : [];
      const arch = Array.isArray(mf?.npcArchetypes) ? mf.npcArchetypes : [];
      const archById = Object.fromEntries(arch.map(a=>[a.id||a.label||a.name||'', a]));
      for (const n of inst) {
        const a = archById[n.archetypeId] || {};
        const persona = [a.speechStyle ? `Speech: ${a.speechStyle}` : '',
                         (a.likes?.length ? `Likes: ${a.likes.slice(0,3).join(', ')}`:''),
                         (a.dislikes?.length ? `Dislikes: ${a.dislikes.slice(0,3).join(', ')}`:'')
                        ].filter(Boolean).join(' • ');
        const name = n.name || n.id || 'NPC';
        reg[n.id || name] = { id: n.id || name, name, label: n.label || name, role: n.role || a.label || a.id || 'NPC', persona, tags: a.tags || [] };
      }
    } catch {}
    // Minimal fallback if none in manifest
    this.registry = reg;
    return this.registry;
  },

  getMeta() {
    const ctx = this.ctx || window.SillyTavern?.getContext?.();
    const meta = ctx?.chatMetadata || (ctx.chatMetadata = {});
    meta.stres = meta.stres || {};
    meta.stres.npc = meta.stres.npc || {};
    meta.stres.npc.presence = meta.stres.npc.presence || {}; // { id: { lastMention, inScene } }
    meta.stres.npc.facts = meta.stres.npc.facts || {};       // { id: [ {t, text} ] }
    meta.stres.npc.summaries = meta.stres.npc.summaries || {}; // { id: [ {t, text} ] }
    return meta;
  },

  listPresent() {
    const s = this.getSettings();
    const meta = this.getMeta();
    const pres = meta.stres.npc.presence || {};
    const ids = Object.keys(pres).filter(id => pres[id]?.inScene || ((Date.now() - (pres[id]?.lastMention||0)) < 10*60*1000));
    // also include state important_npcs
    try {
      const st = meta.stres.state;
      if (Array.isArray(st?.important_npcs)) {
        for (const i of st.important_npcs) {
          const nid = i?.id || i?.name; if (nid && !ids.includes(nid)) ids.push(nid);
        }
      }
    } catch {}
    // apply maxNPCs
    const max = Math.max(1, Number(s.maxNPCs || 2));
    return ids.slice(0, max);
  },

  async onMessage(message) {
    try {
      if (!this.getSettings()?.enabled) return;
      const text = (message?.mes || message?.text || '').toString();
      if (!text) return;
      const reg = await this.ensureRegistry();
      const meta = this.getMeta();
      for (const [id, npc] of Object.entries(reg)) {
        if (!npc?.name) continue;
        const re = new RegExp(`\\b${this.escapeReg(npc.name)}\\b`, 'i');
        if (re.test(text)) {
          meta.stres.npc.presence[id] = meta.stres.npc.presence[id] || {};
          meta.stres.npc.presence[id].lastMention = Date.now();
          meta.stres.npc.presence[id].inScene = true;
          // Capture a short fact
          const arr = meta.stres.npc.facts[id] = meta.stres.npc.facts[id] || [];
          arr.push({ t: Date.now(), text: text.slice(0, 240) });
        }
      }
      await (this.ctx?.saveMetadata?.());
    } catch {}
  },

  async onTurnEnd() {
    try {
      if (!this.getSettings()?.enabled) return;
      // summarize for present NPCs occasionally
      const ctx = this.ctx || window.SillyTavern?.getContext?.();
      if (!ctx?.generateQuietPrompt) return;
      const reg = await this.ensureRegistry();
      const meta = this.getMeta();
      const pres = meta.stres.npc.presence || {};
      const ids = this.listPresent();
      for (const id of ids) {
        const facts = (meta.stres.npc.facts[id] || []).slice(-8);
        if (!facts.length) continue;
        const recent = facts.map(f => `- ${f.text}`).join('\n');
        const prompt = `Summarize NPC memory for ${reg[id]?.name||id}. 2-3 compact lines, keep style/personality hints and goals. 80-120 tokens.\n${recent}`;
        const res = await ctx.generateQuietPrompt({ quietPrompt: prompt }).catch(()=>null);
        const text = String(res||'').trim(); if (!text) continue;
        const arr = meta.stres.npc.summaries[id] = meta.stres.npc.summaries[id] || [];
        arr.push({ t: Date.now(), text });
      }
      await ctx.saveMetadata?.();
      // inject after summarization
      await this.injectInPrompt();
    } catch {}
  },

  async injectInPrompt() {
    try {
      if (!this.getSettings()?.enabled) return false;
      if (!this.getSettings()?.inject) return false;
      const ctx = this.ctx || window.SillyTavern?.getContext?.();
      if (!ctx?.setExtensionPrompt) return false;
      const reg = await this.ensureRegistry();
      const meta = this.getMeta();
      const ids = this.listPresent();
      if (!ids.length) { ctx.setExtensionPrompt('STRES_NPC_CTX', '', ctx.extension_prompt_types.IN_CHAT, 1, false, ctx.extension_prompt_roles.SYSTEM); return false; }
      // build block
      const blocks = [];
      for (const id of ids) {
        const npc = reg[id] || { id, name: id };
        const summary = (meta.stres.npc.summaries[id]||[]).slice(-1)[0]?.text || '';
        const lastFacts = (meta.stres.npc.facts[id]||[]).slice(-2).map(f=>`- ${f.text}`).join('\n');
        const persona = npc.persona ? `Persona: ${npc.persona}` : '';
        const b = [`NPC: ${npc.name}${npc.role?` — ${npc.role}`:''}`, persona, (summary?`Last summary: ${summary}`:''), (lastFacts?`Recent: \n${lastFacts}`:'')].filter(Boolean).join('\n');
        blocks.push(b);
      }
      let text = blocks.join('\n\n');
      // Budgeting
      const pred = await STRESBudget.predictTokens();
      pred.npc = await STRESWorld.tokenCount(text);
      const decision = STRESBudget.decideAllowance(pred);
      const allowed = decision.allowance?.npc || 0;
      if (allowed <= 0) return false;
      text = STRESBudget.trimToTokens(text, allowed);
      ctx.setExtensionPrompt('STRES_NPC_CTX', text, ctx.extension_prompt_types.IN_CHAT, 1, false, ctx.extension_prompt_roles.SYSTEM);
      try { await STRESTelemetry.recordComponent('NPC', text, { key:'STRES_NPC_CTX', pos:'IN_CHAT', count: ids.length }); } catch {}
      return true;
    } catch { return false; }
  },

  markEnter(idOrName) {
    const meta = this.getMeta();
    const id = idOrName; // naive mapping
    meta.stres.npc.presence[id] = meta.stres.npc.presence[id] || {};
    meta.stres.npc.presence[id].inScene = true;
    meta.stres.npc.presence[id].lastMention = Date.now();
    (this.ctx?.saveMetadata?.());
  },

  markLeave(idOrName) {
    const meta = this.getMeta();
    if (meta.stres.npc.presence[idOrName]) meta.stres.npc.presence[idOrName].inScene = false;
    (this.ctx?.saveMetadata?.());
  },

  escapeReg(s) { return String(s||'').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
};

// Combat mode, header, dice, and model switching (Phase 7)
const STRESCombat = {
  ctx: null,
  T: null,
  R: null,
  init(ctx) {
    try {
      this.ctx = ctx || window.SillyTavern?.getContext?.() || null;
      this.T = this.ctx?.extension_prompt_types || window.extension_prompt_types || { IN_PROMPT: 0, IN_CHAT: 1, BEFORE_PROMPT: 2 };
      this.R = this.ctx?.extension_prompt_roles || window.extension_prompt_roles || { SYSTEM: 0, USER: 1, ASSISTANT: 2 };
      const es = this.ctx?.eventSource; const ET = this.ctx?.eventTypes || {};
      if (es && ET) {
        const refresh = () => this.refreshCombatHeaderInPrompt().catch(()=>{});
        es.on(ET.MESSAGE_SENT, refresh);
        es.on(ET.MESSAGE_RECEIVED, refresh);
        es.on(ET.GENERATION_ENDED, refresh);
        es.on(ET.CHAT_CHANGED, refresh);
      }
    } catch {}
  },
  getSettings() {
    const s = window.extension_settings?.[extensionName] || {};
    return s.combat || defaultSettings.combat;
  },
  getMeta() {
    const ctx = this.ctx || window.SillyTavern?.getContext?.();
    const meta = ctx?.chatMetadata || (ctx.chatMetadata = {});
    meta.stres = meta.stres || {};
    if (!meta.stres.mode) meta.stres.mode = 'story';
    meta.stres.combat = meta.stres.combat || { round: 1, order: [] };
    return meta;
  },
  getMode() {
    try { return (this.getMeta()?.stres?.mode) || 'story'; } catch { return 'story'; }
  },
  async setMode(mode) {
    try {
      const m = String(mode||'').toLowerCase();
      if (!['story','explore','combat'].includes(m)) return false;
      const ctx = this.ctx || window.SillyTavern?.getContext?.();
      const meta = this.getMeta();
      meta.stres.mode = m;
      await ctx?.saveMetadata?.();
      // Apply preset if configured
      try { await this.applyModePreset(m); } catch {}
      // Refresh headers
      try { await STRESPrompts.refreshSceneHeaderInPrompt(); } catch {}
      try { await this.refreshCombatHeaderInPrompt(); } catch {}
      return true;
    } catch { return false; }
  },
  async applyModePreset(mode) {
    try {
      const s = this.getSettings();
      const name = (s?.presets||{})[mode] || '';
      if (!name) return false;
      const pm = (this.ctx || window.SillyTavern?.getContext?.())?.getPresetManager?.();
      if (!pm || !pm.findPreset || !pm.selectPreset) return false;
      const value = pm.findPreset(name);
      if (!value) return false;
      pm.selectPreset(value);
      return true;
    } catch { return false; }
  },
  formatHeader() {
    try {
      const s = this.getSettings();
      if (!s?.header?.enabled) return '';
      const meta = this.getMeta();
      const mode = meta.stres.mode || 'story';
      if (mode !== 'combat') return '';
      const c = meta.stres.combat || {};
      const round = Number(c.round || 1);
      let order = Array.isArray(c.order) ? c.order : [];
      const orderStr = order.join(', ');
      const tmpl = (s.header?.template) || defaultSettings.combat.header.template;
      return (tmpl)
        .replace('{round}', String(round))
        .replace('{order}', orderStr || '—');
    } catch { return ''; }
  },
  async refreshCombatHeaderInPrompt() {
    try {
      const ctx = this.ctx || window.SillyTavern?.getContext?.();
      if (!ctx?.setExtensionPrompt) return false;
      const s = this.getSettings();
      if (!s?.enabled) return false;
      const txt = this.formatHeader();
      // Clear when not in combat
      if (!txt) { ctx.setExtensionPrompt('STRES_COMBAT_HEADER', '', this.T.IN_CHAT, 0, false, this.R.SYSTEM); return false; }
      // Budget-aware allowance
      const pred = await STRESBudget.predictTokens();
      pred.combat = await STRESWorld.tokenCount(txt);
      const decision = STRESBudget.decideAllowance(pred);
      const allowed = decision.allowance?.combat || 0;
      if (allowed <= 0) { ctx.setExtensionPrompt('STRES_COMBAT_HEADER', '', this.T.IN_CHAT, 0, false, this.R.SYSTEM); return false; }
      const text = STRESBudget.trimToTokens(txt, allowed);
      ctx.setExtensionPrompt('STRES_COMBAT_HEADER', text, this.T.IN_CHAT, 0, false, this.R.SYSTEM);
      try { await STRESTelemetry.recordComponent('Combat', text, { key:'STRES_COMBAT_HEADER', pos:'IN_CHAT' }); } catch {}
      return true;
    } catch { return false; }
  },
  // Simple dice roller: XdY+Z
  rollDice(notation) {
    try {
      const m = String(notation||'').trim().match(/^(\d+)[dD](\d+)([+\-]\d+)?$/);
      if (!m) return { ok:false, error:'Bad notation. Use XdY+Z' };
      const x = Math.max(1, parseInt(m[1]));
      const y = Math.max(2, parseInt(m[2]));
      const z = m[3] ? parseInt(m[3]) : 0;
      const rolls = Array.from({length:x}, ()=> (1 + Math.floor(Math.random()*y)) );
      const sum = rolls.reduce((a,b)=>a+b,0) + z;
      return { ok:true, total: sum, rolls, mod: z };
    } catch (e) { return { ok:false, error: String(e?.message||e) }; }
  },
  // NPC quick reply via cheaper model
  async npcReply(npcId, cue) {
    try {
      const ctx = this.ctx || window.SillyTavern?.getContext?.();
      const reg = await STRESNPC.ensureRegistry();
      const npc = reg?.[npcId] || { id: npcId, name: npcId, persona: '' };
      const scene = STRESWorld.formatHeader();
      const sys = `You are ${npc.name}. ${npc.persona||''}. Keep replies concise (1–2 sentences). Do not reveal hidden info.`.trim();
      const user1 = `Scene: ${scene}`;
      const user2 = String(cue||'').slice(0, 400);
      const messages = [
        { role: 'system', content: sys },
        { role: 'user', content: user1 },
        { role: 'user', content: user2 },
      ];
      const mcfg = this.getSettings()?.npcModel || defaultSettings.combat.npcModel;
      const req = { messages, model: mcfg.model, chat_completion_source: mcfg.chat_completion_source, max_tokens: Number(mcfg.max_tokens || 140) };
      const res = await ctx.ChatCompletionService?.processRequest?.(req, { presetName: null });
      if (!res) return '';
      if (typeof res === 'function') return '';
      const text = res?.content || res?.result || '';
      return String(text || '').trim();
    } catch { return ''; }
  }
};

// Crosstalk/Leak Guardrails (Phase 8)
const STRESGuard = {
  ctx: null,
  T: null,
  R: null,
  init(ctx) {
    try {
      this.ctx = ctx || window.SillyTavern?.getContext?.() || null;
      this.T = this.ctx?.extension_prompt_types || window.extension_prompt_types || { IN_PROMPT: 0, IN_CHAT: 1, BEFORE_PROMPT: 2 };
      this.R = this.ctx?.extension_prompt_roles || window.extension_prompt_roles || { SYSTEM: 0, USER: 1, ASSISTANT: 2 };
      const es = this.ctx?.eventSource; const ET = this.ctx?.eventTypes || {};
      if (es && ET) {
        const refresh = () => this.refreshGuardrailInPrompt().catch(()=>{});
        es.on(ET.MESSAGE_SENT, refresh);
        es.on(ET.MESSAGE_RECEIVED, refresh);
        es.on(ET.GENERATION_STARTED, refresh);
        es.on(ET.CHAT_CHANGED, refresh);
      }
    } catch {}
  },
  getSettings() { const s = window.extension_settings?.[extensionName] || {}; return s.guard || defaultSettings.guard; },
  formatGuard() {
    try {
      const s = this.getSettings();
      if (!s?.enabled) return '';
      const ctx = this.ctx || window.SillyTavern?.getContext?.();
      const chars = ctx?.characters || {};
      const chid = ctx?.characterId;
      const name = (chars?.[chid]?.name) || ctx?.name2 || 'the character';
      const tmpl = String(s.template || defaultSettings.guard.template);
      return tmpl.replace('{char}', name);
    } catch { return ''; }
  },
  async refreshGuardrailInPrompt() {
    try {
      const ctx = this.ctx || window.SillyTavern?.getContext?.();
      if (!ctx?.setExtensionPrompt) return false;
      const text0 = this.formatGuard();
      if (!text0) { ctx.setExtensionPrompt('STRES_GUARDRAIL', '', this.T.IN_CHAT, 0, false, this.R.SYSTEM); return false; }
      const pred = await STRESBudget.predictTokens();
      pred.guard = await STRESWorld.tokenCount(text0);
      const decision = STRESBudget.decideAllowance(pred);
      const allowed = decision.allowance?.guard || 0;
      if (allowed <= 0) { ctx.setExtensionPrompt('STRES_GUARDRAIL', '', this.T.IN_CHAT, 0, false, this.R.SYSTEM); return false; }
      const text = STRESBudget.trimToTokens(text0, allowed);
      ctx.setExtensionPrompt('STRES_GUARDRAIL', text, this.T.IN_CHAT, 0, false, this.R.SYSTEM);
      try { await STRESTelemetry.recordComponent('Guard', text, { key:'STRES_GUARDRAIL', pos:'IN_CHAT' }); } catch {}
      return true;
    } catch { return false; }
  }
};

// OpenRouter Balance & Cost Awareness (Phase 11)
const STRESCost = {
  ctx: null,
  timer: null,
  hasBalanceAPI: undefined,
  getSettings() { const s = window.extension_settings?.[extensionName] || {}; return s.cost || defaultSettings.cost; },
  init(ctx) {
    try {
      this.ctx = ctx || window.SillyTavern?.getContext?.() || null;
      const es = this.ctx?.eventSource; const ET = this.ctx?.eventTypes || {};
      if (es && ET) {
        es.on(ET.CHAT_CHANGED, ()=> this.refreshBadge().catch(()=>{}));
        es.on(ET.MESSAGE_SENT, ()=> this.onTurnEvent());
        es.on(ET.GENERATION_STARTED, ()=> this.onTurnEvent());
      }
      this.maybeSchedule();
      // Initial attempt
      this.refreshBadge().catch(()=>{});
    } catch {}
  },
  isOpenRouter() {
    try { return (this.ctx?.chatCompletionSettings?.chat_completion_source || '').toLowerCase() === 'openrouter'; } catch { return false; }
  },
  maybeSchedule() {
    try {
      const cfg = this.getSettings();
      if (!cfg.enabled) return;
      clearInterval(this.timer);
      if (String(cfg.mode||'poll') === 'poll') {
        this.timer = setInterval(()=>{ this.refreshBadge().catch(()=>{}); }, Math.max(60000, Number(cfg.pollMs || 300000)));
      } else {
        this.timer = null;
      }
    } catch {}
  },
  onTurnEvent() {
    try {
      const cfg = this.getSettings();
      if (!cfg.enabled) return;
      if (String(cfg.mode||'poll') === 'on_turn') {
        this.refreshBadge().catch(()=>{});
      } else {
        // Ensure timer exists for poll mode
        this.maybeSchedule();
      }
    } catch {}
  },
  async detectBalanceAPI(base) {
    // Cache presence of /api/openrouter/balance to avoid noisy 404s
    try {
      const s = window.extension_settings || (this.ctx?.extensionSettings) || {};
      s[extensionName] = s[extensionName] || {};
      s[extensionName].cost = s[extensionName].cost || structuredClone(defaultSettings.cost);
      if (typeof s[extensionName].cost.hasBalanceAPI === 'boolean') {
        this.hasBalanceAPI = s[extensionName].cost.hasBalanceAPI;
        return this.hasBalanceAPI;
      }
      const r = await fetch(base + '/api/openrouter/balance');
      const ok = r.ok;
      s[extensionName].cost.hasBalanceAPI = ok;
      this.hasBalanceAPI = ok;
      try { const c=this.ctx; (c?.saveSettingsDebounced || window.saveSettingsDebounced)?.(); } catch {}
      return ok;
    } catch {
      // Network or CORS issues: treat as absent
      try {
        const s = window.extension_settings || (this.ctx?.extensionSettings) || {};
        s[extensionName] = s[extensionName] || {};
        s[extensionName].cost = s[extensionName].cost || structuredClone(defaultSettings.cost);
        s[extensionName].cost.hasBalanceAPI = false;
        this.hasBalanceAPI = false;
        try { const c=this.ctx; (c?.saveSettingsDebounced || window.saveSettingsDebounced)?.(); } catch {}
      } catch {}
      return false;
    }
  },
  async refreshBadge() {
    try {
      const cfg = this.getSettings(); if (!cfg.enabled) return false;
      if (!this.isOpenRouter()) return false;
      const s = window.extension_settings || (this.ctx?.extensionSettings) || {};
      s[extensionName] = s[extensionName] || {};
      s[extensionName].cost = s[extensionName].cost || structuredClone(defaultSettings.cost);
      // Try backend balance
      let balance = null;
      const base = (s[extensionName].serverUrl || defaultSettings.serverUrl).replace(/\/$/, '');
      try {
        // Only probe once; then cache result and skip network if 404 was seen
        if (typeof this.hasBalanceAPI !== 'boolean') {
          await this.detectBalanceAPI(base);
        }
        if (this.hasBalanceAPI) {
          const r = await fetch(base + '/api/openrouter/balance');
          if (r.ok) { const j = await r.json(); balance = Number(j?.credits_remaining ?? j?.balance ?? j?.credits) || null; }
          else if (r.status === 404) { this.hasBalanceAPI = false; s[extensionName].cost.hasBalanceAPI = false; try { const c=this.ctx; (c?.saveSettingsDebounced || window.saveSettingsDebounced)?.(); } catch {} }
        }
        // Fallback: optional status endpoint
        if (balance == null && this.hasBalanceAPI === false) {
          try {
            const rs = await fetch(base + '/api/status/ai');
            if (rs.ok) { const j = await rs.json(); const val = Number(j?.credits); if (Number.isFinite(val)) balance = val; }
          } catch {}
        }
      } catch {}
      // Try UI estimate of max prompt cost
      let est = '';
      try { const el = document.querySelector('#openrouter_max_prompt_cost'); est = (el?.textContent || '').trim(); } catch {}
      const badge = this.composeBadge(balance, est);
      if (badge) {
        s[extensionName].cost.lastBadge = { text: badge, t: Date.now(), balance, est };
        try { const c=this.ctx; (c?.saveSettingsDebounced || window.saveSettingsDebounced)?.(); } catch {}
        // Refresh header to include badge
        try { await STRESPrompts.refreshSceneHeaderInPrompt(); } catch {}
        return true;
      }
      return false;
    } catch { return false; }
  },
  composeBadge(balance, est) {
    try {
      if (Number.isFinite(balance)) {
        const amt = balance >= 100 ? Math.round(balance) : balance >= 10 ? balance.toFixed(1) : balance.toFixed(2);
        return `💳 $${amt}`;
      }
      if (est && /^\$/.test(est)) {
        // est like "$0.123" or "$0.123 + $0.02"
        const short = est.split('+')[0].trim();
        return `💸 ${short}`;
      }
      return '';
    } catch { return ''; }
  }
};

// Telemetry & QA logging (Phase 13)
const STRESTelemetry = {
  ctx: null,
  current: null,
  getSettings() { const s = window.extension_settings?.[extensionName] || {}; return s.telemetry || defaultSettings.telemetry; },
  init(ctx) {
    try {
      this.ctx = ctx || window.SillyTavern?.getContext?.() || null;
      const es = this.ctx?.eventSource; const ET = this.ctx?.eventTypes || {};
      if (es && ET) {
        es.on(ET.GENERATION_STARTED, ()=> this.resetTurn());
        es.on(ET.GENERATION_ENDED, ()=> this.commit().catch(()=>{}));
      }
      this.resetTurn();
    } catch {}
  },
  resetTurn() {
    if (!this.getSettings().enabled) return;
    this.current = { t: Date.now(), components: [], tools: [], rag: null };
  },
  async recordComponent(name, text, meta={}) {
    try {
      if (!this.getSettings().enabled) return;
      const tokens = await STRESWorld.tokenCount(String(text||''));
      this.current = this.current || { t: Date.now(), components: [], tools: [], rag: null };
      this.current.components.push({ name, tokens, meta });
    } catch {}
  },
  logTool(name, params, result) {
    try {
      if (!this.getSettings().enabled) return;
      this.current = this.current || { t: Date.now(), components: [], tools: [], rag: null };
      const ok = !(result && result.error);
      const brief = { name, ok, params: typeof params==='object' ? Object.keys(params) : String(params).slice(0,60), t: Date.now() };
      this.current.tools.push(brief);
    } catch {}
  },
  logRAG(query, items, allowance) {
    try {
      if (!this.getSettings().enabled) return;
      this.current = this.current || { t: Date.now(), components: [], tools: [], rag: null };
      this.current.rag = { q: String(query||'').slice(0,120), k: Array.isArray(items)?items.length:0, allowance: Number(allowance||0) };
    } catch {}
  },
  async commit() {
    try {
      if (!this.getSettings().enabled) return false;
      const ctx = this.ctx || window.SillyTavern?.getContext?.();
      const meta = ctx?.chatMetadata || (ctx.chatMetadata = {});
      meta.stres = meta.stres || {};
      const rec = this.current || { t: Date.now(), components: [], tools: [], rag: null };
      // Compute totals
      const total = rec.components.reduce((a,c)=> a + (Number(c.tokens)||0), 0);
      rec.total = total;
      meta.stres.telemetry = Array.isArray(meta.stres.telemetry) ? meta.stres.telemetry : [];
      meta.stres.telemetry.push(rec);
      const keep = Math.max(1, Number(this.getSettings().keep || 20));
      meta.stres.telemetry = meta.stres.telemetry.slice(-keep);
      await ctx.saveMetadata?.();
      if (this.getSettings().logToChat) {
        const comp = rec.components.map(c=> `${c.name}:${c.tokens}`).join(' • ');
        STRESChat.sendToChat(`🧮 Tokens: ${total} (${comp})`);
      }
      return true;
    } catch { return false; }
  },
  showLast() {
    try {
      const t = (this.ctx?.chatMetadata?.stres?.telemetry||[]).slice(-1)[0];
      if (!t) { STRESChat.sendToChat('No telemetry yet.'); return; }
      const comp = t.components.map(c=> `• ${c.name}: ${c.tokens}`).join('\n');
      const rag = t.rag ? (`\n• RAG: k=${t.rag.k}, allowance=${t.rag.allowance}`) : '';
      STRESChat.sendToChat(`**Telemetry**\n• Total: ${t.total}\n${comp}${rag}`);
    } catch { STRESChat.sendToChat('Failed to show telemetry.'); }
  }
};

// Setup Wizard Listener: detects onboarding JSON in assistant messages and applies config
const STRESSetup = {
  ctx: null,
  init(ctx) {
    try {
      this.ctx = ctx || window.SillyTavern?.getContext?.() || null;
      const es = this.ctx?.eventSource; const ET = this.ctx?.eventTypes || {};
      if (es && ET) {
        es.on(ET.MESSAGE_RECEIVED, (m)=>{ this.onAssistantMessage(m).catch(()=>{}); });
      }
    } catch {}
  },
  getSettings() { const s = window.extension_settings?.[extensionName] || {}; return s.setup || defaultSettings.setup; },
  getMeta() { const ctx = this.ctx || window.SillyTavern?.getContext?.(); const meta = ctx?.chatMetadata || (ctx.chatMetadata = {}); meta.stres = meta.stres || {}; return meta; },
  isAssistantMessage(m) { try { return !!(m && m.is_user === false); } catch { return false; } },
  extractSetupJSON(text) {
    try {
      const s = String(text||'');
      // Look for fenced JSON with optional language tag
      const fenceRe = /```(?:json|stres_setup)?\s*([\s\S]*?)```/gi;
      let match;
      while ((match = fenceRe.exec(s))) {
        const body = match[1] || '';
        try {
          const obj = JSON.parse(body);
          if (obj && (obj.type === 'stres_setup' || obj.setup === 'stres')) return obj;
        } catch {}
      }
      // Fallback: try to parse any JSON-looking segment
      const braceStart = s.indexOf('{');
      const braceEnd = s.lastIndexOf('}');
      if (braceStart !== -1 && braceEnd > braceStart) {
        try { const obj = JSON.parse(s.slice(braceStart, braceEnd+1)); if (obj && (obj.type === 'stres_setup' || obj.setup === 'stres')) return obj; } catch {}
      }
    } catch {}
    return null;
  },
  async onAssistantMessage(m) {
    try {
      if (!this.getSettings().enabled) return;
      if (!this.isAssistantMessage(m)) return;
      const meta = this.getMeta();
      if (this.getSettings().oncePerChat && meta.stres.setup_complete) return;
      const text = m?.mes || m?.text || '';
      const obj = this.extractSetupJSON(text);
      if (!obj) return;
      const ok = await this.applySetup(obj);
      if (ok) {
        meta.stres.setup_complete = Date.now();
        await this.ctx?.saveMetadata?.();
      }
    } catch {}
  },
  styleToHeader(style) {
    const s = String(style||'').toLowerCase();
    if (s.includes('tactic')) return '⚔️ {timeOfDay} • {weather} • 📍 {location}';
    if (s.includes('cine')) return '📍 {location} • {date} • {timeOfDay} • {weather}';
    return null;
  },
  async applySetup(data) {
    try {
      // Expected schema (example):
      // { type: 'stres_setup', worldpackId, scenarioId?, regionId?, narratorStyle?, player? }
      const ctx = this.ctx || window.SillyTavern?.getContext?.();
      const s = window.extension_settings || (ctx?.extensionSettings) || {};
      s[extensionName] = s[extensionName] || structuredClone(defaultSettings);
      if (data.worldpackId) s[extensionName].worldpackId = String(data.worldpackId);
      s[extensionName].world = s[extensionName].world || structuredClone(defaultSettings.world);
      if (data.regionId) s[extensionName].world.regionId = String(data.regionId);
      const hdr = this.styleToHeader(data.narratorStyle);
      if (hdr) {
        s[extensionName].world.header = s[extensionName].world.header || structuredClone(defaultSettings.world.header);
        s[extensionName].world.header.template = hdr;
      }
      try { (ctx?.saveSettingsDebounced || window.saveSettingsDebounced)?.(); } catch {}
      // Load worldpack & apply scenario/region
      if (data.worldpackId) {
        try { await state.stresClient.loadWorldpackById(String(data.worldpackId)); } catch {}
      }
      if (data.scenarioId) {
        try { await STRESWorld.scenario(String(data.scenarioId)); } catch {}
      } else if (data.regionId) {
        try { await STRESWorld.refresh(String(data.regionId)); } catch {}
      }
      // Optional: set depth prompt on the active character based on style
      try {
        const style = String(data.narratorStyle||'');
        const tactical = /tactic/i.test(style);
        const prompt = tactical
          ? 'You are the Narrator/DM. Keep tactical clarity and explicit turn order in combat. Offer clear options (Attack, Maneuver, Observe, Talk, Item, Retreat) without railroading. Do not reveal secret DCs or private knowledge. Keep narration concise and grounded in the Euterra worldpack.'
          : STRESNarrator.defaultDepthPrompt();
        await STRESNarrator.setDepthPrompt(prompt);
      } catch {}
      try { await STRESPrompts.refreshSceneHeaderInPrompt(); } catch {}
      // Optional: stash player concept/state in metadata for tools
      try {
        const meta = this.getMeta();
        meta.stres.player = data.player || meta.stres.player || null;
        await ctx.saveMetadata?.();
      } catch {}
      STRESChat.sendToChat('✅ STRES setup applied. You can now begin: /stres scenarios → /stres start <index|id>');
      return true;
    } catch { return false; }
  }
};

// Rolling summaries and structured state capture
const STRESSummary = {
  ctx: null,
  init(ctx) {
    try {
      this.ctx = ctx || window.SillyTavern?.getContext?.() || null;
      const es = this.ctx?.eventSource; const ET = this.ctx?.eventTypes || {};
      if (es && ET) {
        const onEnd = () => this.onGenerationEnded().catch(()=>{});
        es.on(ET.GENERATION_ENDED, onEnd);
        es.on(ET.CHAT_CHANGED, () => this.resetCache());
      } else {
        // Best-effort: periodic check
        setInterval(()=>{ this.onGenerationEnded().catch(()=>{}); }, 8000);
      }
    } catch {}
  },

  resetCache() {
    // Placeholder for future per-chat caches
  },

  getSettings() {
    const s = window.extension_settings?.[extensionName] || {};
    return { summary: (s.summary || defaultSettings.summary), state: (s.state || defaultSettings.state) };
  },

  getChat() {
    const ctx = this.ctx || window.SillyTavern?.getContext?.();
    return Array.isArray(ctx?.chat) ? ctx.chat : [];
  },

  async onGenerationEnded() {
    const { summary, state } = this.getSettings();
    if (!summary?.enabled && !state?.enabled) return;
    const ctx = this.ctx || window.SillyTavern?.getContext?.();
    if (!ctx) return;
    const meta = ctx.chatMetadata || (ctx.chatMetadata = {});
    meta.stres = meta.stres || {};
    const chat = this.getChat();
    const userTurns = chat.filter(m => m?.is_user).length;
    const lastUserCount = Number(meta.stres.lastSummaryUserCount || 0);
    const due = summary?.enabled && (userTurns - lastUserCount) >= Math.max(1, Number(summary.everyTurns || 6));
    if (due) {
      const ok = await this.generateSummary();
      if (ok) { meta.stres.lastSummaryUserCount = userTurns; await ctx.saveMetadata?.(); }
      // Optional injection within budget
      try { await STRESPrompts.injectSummaryInPrompt(); } catch {}
      // Structured state extraction on same cadence
      try { if (state?.enabled) await this.extractState(); } catch {}
    }
  },

  async generateSummary() {
    try {
      const ctx = this.ctx || window.SillyTavern?.getContext?.();
      const s = window.extension_settings?.[extensionName] || {};
      const summaryCfg = s.summary || defaultSettings.summary;
      if (!ctx?.generateQuietPrompt) return false;
      const chat = this.getChat();
      const lastK = Math.max(4, Number(summaryCfg.windowSize || 12));
      const recent = chat.slice(-lastK).map(m => `${m?.name||''}: ${m?.mes || m?.text || ''}`).join('\n');
      const prompt = `Summarize the recent roleplay concisely for DM memory. Use 3-6 bullets, present tense, include key facts, goals, and new NPCs. 120 tokens max.\n\n${recent}`;
      const res = await ctx.generateQuietPrompt({ quietPrompt: prompt });
      const text = String(res || '').trim();
      if (!text) return false;
      const meta = ctx.chatMetadata || (ctx.chatMetadata = {});
      meta.stres = meta.stres || {};
      const arr = Array.isArray(meta.stres.summaries) ? meta.stres.summaries : [];
      arr.push({ t: Date.now(), text });
      const cap = Math.max(1, Number(summaryCfg.maxItems || 10));
      meta.stres.summaries = arr.slice(-cap);
      await ctx.saveMetadata?.();
      return true;
    } catch { return false; }
  },

  async extractState() {
    try {
      const ctx = this.ctx || window.SillyTavern?.getContext?.();
      if (!ctx?.generateQuietPrompt) return false;
      const chat = this.getChat();
      const lastK = 16;
      const recent = chat.slice(-lastK).map(m => `${m?.name||''}: ${m?.mes || m?.text || ''}`).join('\n');
      const schema = '{"location":"string","objectives":["string"],"flags":{"string":true},"important_npcs":[{"name":"string","role":"string"}]}'
      const prompt = `Extract a minimal JSON story state from the recent scene. Use this JSON schema exactly (omit unknown fields): ${schema}. Reply with JSON only.\n\n${recent}`;
      const res = await ctx.generateQuietPrompt({ quietPrompt: prompt });
      const raw = String(res || '').trim();
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch {}
      if (!parsed || typeof parsed !== 'object') return false;
      const meta = ctx.chatMetadata || (ctx.chatMetadata = {});
      meta.stres = meta.stres || {};
      meta.stres.state = parsed;
      await ctx.saveMetadata?.();
      return true;
    } catch { return false; }
  },
};

// Prompt injection utilities (primer + scene header)
const STRESPrompts = {
  T: null,
  R: null,
  ctx: null,

  init(ctx) {
    try {
      this.ctx = ctx || window.SillyTavern?.getContext?.() || null;
      this.T = this.ctx?.extension_prompt_types || window.extension_prompt_types || { IN_PROMPT: 0, IN_CHAT: 1, BEFORE_PROMPT: 2 };
      this.R = this.ctx?.extension_prompt_roles || window.extension_prompt_roles || { SYSTEM: 0, USER: 1, ASSISTANT: 2 };
    } catch {}
    this.registerMacros();
    // Initial scene header injection
    this.refreshSceneHeaderInPrompt().catch(()=>{});
    // Wire events if available
    try {
      const es = this.ctx?.eventSource; const ET = this.ctx?.eventTypes || {};
      if (es && ET) {
        const refresh = () => {
          this.refreshSceneHeaderInPrompt().catch(()=>{});
          this.injectRAGInPrompt().catch(()=>{});
          try { STRESGuard.refreshGuardrailInPrompt(); } catch {}
        };
        es.on(ET.MESSAGE_SENT, refresh);
        es.on(ET.MESSAGE_RECEIVED, refresh);
        es.on(ET.GENERATION_ENDED, refresh);
        es.on(ET.CHAT_CHANGED, refresh);
      } else {
        // Fallback: periodic refresh to keep it up-to-date
        setInterval(()=>{ this.refreshSceneHeaderInPrompt().catch(()=>{}); this.injectRAGInPrompt().catch(()=>{}); try { STRESGuard.refreshGuardrailInPrompt(); } catch {} }, 6000);
      }
    } catch {}
  },

  registerMacros() {
    try {
      const ctx = this.ctx || window.SillyTavern?.getContext?.();
      if (!ctx?.registerMacro) return;
      ctx.registerMacro('stres.location', () => {
        const s = window.extension_settings?.[extensionName] || {};
        return s.world?.locationName || s.world?.regionId || 'Unknown';
      });
      ctx.registerMacro('stres.time', () => {
        const st = STRESWorld.lastState || {};
        const md = `${st.time?.month || ''} ${st.time?.day || ''}`.trim();
        return md || st.time?.iso?.slice(0,10) || 'Unknown';
      });
      ctx.registerMacro('stres.weather', () => STRESWorld.lastState?.weather?.condition || 'clear');
    } catch {}
  },

  async injectPrimerInPrompt(force=false) {
    try {
      const ctx = this.ctx || window.SillyTavern?.getContext?.();
      if (!ctx?.setExtensionPrompt) return false;
      const s = window.extension_settings?.[extensionName] || {};
      if (!force) {
        const ai = s.autoInjection; if (!(ai?.enabled && ai?.primer)) return false;
      }
      const res = await state.stresClient.getWorldpackManifest();
      if (!res?.success) return false;
      const primer = STRESChat.buildWorldpackPrimer(res.manifest);
      // Budget-aware allowance
      const pred = await STRESBudget.predictTokens();
      pred.primer = await STRESWorld.tokenCount(primer);
      const decision = STRESBudget.decideAllowance(pred);
      const allowed = decision.allowance?.primer || 0;
      if (allowed <= 0) return false;
      const text = STRESBudget.trimToTokens(primer, allowed);
      ctx.setExtensionPrompt('STRES_WORLD_PRIMER', text, this.T.BEFORE_PROMPT, 0, false, this.R.SYSTEM);
      try { await STRESTelemetry.recordComponent('Primer', text, { key:'STRES_WORLD_PRIMER', pos:'BEFORE_PROMPT' }); } catch {}
      // Persist flag in chat metadata
      try {
        const meta = ctx.chatMetadata || (ctx.chatMetadata = {});
        meta.stres = meta.stres || {};
        meta.stres.primerInjectedAt = Date.now();
        await ctx.saveMetadata?.();
      } catch {}
      return true;
    } catch { return false; }
  },

  async refreshSceneHeaderInPrompt() {
    try {
      const ctx = this.ctx || window.SillyTavern?.getContext?.();
      if (!ctx?.setExtensionPrompt) return false;
      const s = window.extension_settings?.[extensionName] || {};
      if (!(s.world?.header?.enabled ?? true)) return false;
      await STRESWorld.getStateFresh();
      const header = STRESWorld.formatHeader();
      // Keep header within budget
      const pred = await STRESBudget.predictTokens();
      pred.header = await STRESWorld.tokenCount(header);
      const decision = STRESBudget.decideAllowance(pred);
      const allowed = decision.allowance?.header || 0;
      if (allowed <= 0) return false;
      const text = STRESBudget.trimToTokens(header, allowed);
      ctx.setExtensionPrompt('STRES_SCENE_HEADER', text, this.T.IN_CHAT, 0, false, this.R.SYSTEM);
      try { await STRESTelemetry.recordComponent('Header', text, { key:'STRES_SCENE_HEADER', pos:'IN_CHAT' }); } catch {}
      // Save to chat metadata for visibility and future tools
      try {
        const st = STRESWorld.lastState || {};
        const meta = ctx.chatMetadata || (ctx.chatMetadata = {});
        meta.stres = meta.stres || {};
        meta.stres.worldpackId = s.worldpackId || meta.stres.worldpackId || null;
        meta.stres.regionId = s.world?.regionId || meta.stres.regionId || null;
        meta.stres.locationLabel = s.world?.locationName || s.world?.regionId || meta.stres.locationLabel || null;
        meta.stres.timeISO = st.time?.iso || meta.stres.timeISO || null;
        meta.stres.timeOfDay = st.time?.daySegment || meta.stres.timeOfDay || null;
        meta.stres.weather = st.weather?.condition || meta.stres.weather || null;
        await ctx.saveMetadata?.();
      } catch {}
      return true;
    } catch { return false; }
  },

  async injectSummaryInPrompt() {
    try {
      const ctx = this.ctx || window.SillyTavern?.getContext?.();
      const s = window.extension_settings?.[extensionName] || {};
      if (!ctx?.setExtensionPrompt) return false;
      if (!s.summary?.enabled) return false;
      if (!s.summary?.inject) return false;
      const meta = ctx.chatMetadata || {};
      const last = meta?.stres?.summaries?.slice(-1)[0]?.text;
      if (!last) return false;
      const pred = await STRESBudget.predictTokens();
      pred.summaries = await STRESWorld.tokenCount(last);
      const decision = STRESBudget.decideAllowance(pred);
      const allowed = decision.allowance?.summaries || 0;
      if (allowed <= 0) return false;
      const text = STRESBudget.trimToTokens(last, allowed);
      ctx.setExtensionPrompt('STRES_ROLLING_SUMMARY', text, this.T.BEFORE_PROMPT, 0, false, this.R.SYSTEM);
      try { await STRESTelemetry.recordComponent('Summary', text, { key:'STRES_ROLLING_SUMMARY', pos:'BEFORE_PROMPT' }); } catch {}
      return true;
    } catch { return false; }
  }
  ,
  async injectRAGInPrompt() {
    try {
      const ctx = this.ctx || window.SillyTavern?.getContext?.();
      const s = window.extension_settings?.[extensionName] || {};
      if (!ctx?.setExtensionPrompt) return false;
      if (!s.rag?.enabled) return false;
      STRESRAG.init(ctx);
      const query = STRESRAG.getQueryText();
      if (!query) return false;
      const items = await STRESRAG.retrieve(query);
      if (!items?.length) return false;
      // Build candidate text and budget it
      let text = STRESRAG.formatBullets(items);
      const pred = await STRESBudget.predictTokens();
      pred.rag = await STRESWorld.tokenCount(text);
      const decision = STRESBudget.decideAllowance(pred);
      const allowed = decision.allowance?.rag || 0;
      if (allowed <= 0) return false;
      text = STRESBudget.trimToTokens(text, allowed);
      const position = (s.rag?.position === 'in_chat') ? this.T.IN_CHAT : this.T.IN_PROMPT;
      const depth = Number.isFinite(Number(s.rag?.depth)) ? Number(s.rag.depth) : 0;
      ctx.setExtensionPrompt('STRES_RAG_HINTS', text, position, depth, false, this.R.SYSTEM);
      try { STRESTelemetry.logRAG(query, items, allowed); await STRESTelemetry.recordComponent('RAG', text, { key:'STRES_RAG_HINTS', pos: (position===this.T.IN_CHAT?'IN_CHAT':'IN_PROMPT') }); } catch {}
      // Save to metadata
      try {
        const meta = ctx.chatMetadata || (ctx.chatMetadata = {});
        meta.stres = meta.stres || {};
        meta.stres.ragLast = { t: Date.now(), query: String(query).slice(0,300), items: items.slice(0, 8) };
        await ctx.saveMetadata?.();
      } catch {}
      return true;
    } catch { return false; }
  }
};

// STRES API Client
class STRESClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.apiPrefix = '/api';
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${this.apiPrefix}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.statusText}`);
    }

    return response.json();
  }

  async getHealth() {
    try {
      return await this.request('/health');
    } catch (error) {
      return { status: 'unreachable', error: error.message };
    }
  }

  async getCurrentWorldpack() {
    try {
      return await this.request('/worldpack/current');
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async loadWorldpackById(packId) {
    const qp = encodeURIComponent(packId || '');
    const url = `${this.baseUrl}${this.apiPrefix}/worldpack/load?packId=${qp}`;
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const j = await res.json().catch(()=>({}));
    if (!res.ok) throw new Error(j?.error?.message || `HTTP ${res.status}`);
    return j;
  }

  async getWorldpackManifest() {
    try {
      const res = await this.request('/worldpack/manifest');
      return res;
    } catch (error) { return { success: false, error: error.message }; }
  }
}

// STRES Chat Integration
const STRESChat = {
  processMessage(message) {
    // Check for inventory commands
    if (message.startsWith('/inventory') || message.startsWith('/inv')) {
      this.handleInventoryCommand(message);
      return true; // Prevent default handling
    }

    // Check for combat commands
    if (message.startsWith('/combat')) {
      this.handleCombatCommand(message);
      return true;
    }

    // Check for STRES commands
    if (message.startsWith('/stres')) {
      this.handleStresCommand(message);
      return true;
    }

    return false;
  },

  handleInventoryCommand(command) {
    const parts = command.split(' ');
    const action = parts[1];

    switch(action) {
      case 'show':
      case 'list':
        this.showInventory();
        return '';
      case 'add':
        this.addItem(parts.slice(2).join(' '));
        return '';
      case 'remove':
        this.removeItem(parts.slice(2).join(' '));
        return '';
      case 'use':
        this.useItem(parts.slice(2).join(' '));
        return '';
      default:
        this.showHelp();
        return '';
    }
    return '';
  },

  handleStresCommand(command) {
    try {
      const parts = command.split(' ');
      const action = parts && parts.length > 1 ? parts[1] : '';

      switch(action) {
        case 'status':
          this.showStatus();
          return '';
        case 'begin': {
          const sub = (parts[2] || '').toLowerCase();
          if (sub === 'status') { (async()=>{ await STRESOnboarding.showStatus(); })(); return ''; }
          if (sub === 'refresh') { (async()=>{ await STRESOnboarding.refresh(); })(); return ''; }
          if (sub === 'wizard') { (async()=>{ await STRESOnboarding.wizard(); })(); return ''; }
          if (sub === 'script') { (async()=>{ await STRESOnboarding.showScriptSummary(); })(); return ''; }
          (async()=>{ await STRESOnboarding.begin(); })();
          return '';
        }
        case 'onboard': {
          (async()=>{ const ok = await STRESNarrator.sendOnboarding(); this.sendToChat(ok? '✅ Onboarding sent' : '✅ Onboarding posted'); })();
          return '';
        }
        case 'narrator': {
          const sub = (parts[2]||'').toLowerCase();
          if (!sub || sub === 'status') { (async()=>{ await STRESNarrator.showStatus(); })(); return ''; }
          if (sub === 'bind') { (async()=>{ const r = await STRESNarrator.bindToCurrentCharacter(); this.sendToChat(r.ok ? '✅ Bound STRES config to current character' : ('❌ ' + (r.error||'Failed'))); })(); return ''; }
          if (sub === 'apply') { (async()=>{ const ok = await STRESNarrator.applyCharacterConfig(); this.sendToChat(ok ? '✅ Applied card config' : '❌ No card config found'); try { await STRESPrompts.refreshSceneHeaderInPrompt(); } catch {} })(); return ''; }
          if (sub === 'depth') {
            const text = parts.slice(3).join(' ').trim();
            (async()=>{ const r = await STRESNarrator.setDepthPrompt(text||STRESNarrator.defaultDepthPrompt()); this.sendToChat(r.ok ? '✅ Depth prompt saved to card' : ('❌ ' + (r.error||'Failed'))); })();
            return '';
          }
          this.sendToChat('Usage: /stres narrator [status|bind|apply|depth <text>]');
          return '';
        }
        case 'cost': {
          const sub = (parts[2]||'').toLowerCase();
          if (!sub || sub === 'status') {
            try {
              const s = window.extension_settings?.[extensionName] || {};
              const cs = s.cost || defaultSettings.cost;
              const last = cs.lastBadge?.text || '(none)';
              const src = (window.SillyTavern?.getContext?.().chatCompletionSettings?.chat_completion_source)||'(unknown)';
              const mode = cs.mode || 'poll';
              this.sendToChat(`**Cost**\n• Enabled: ${!!cs.enabled}\n• Show Badge: ${!!cs.showBadge}\n• Mode: ${mode}\n• Source: ${src}\n• Last Badge: ${last}`);
            } catch { this.sendToChat('**Cost**\n• Status unavailable'); }
            return '';
          }
          if (sub === 'on' || sub === 'off') {
            const s = window.extension_settings || (window.SillyTavern?.getContext?.().extensionSettings);
            s[extensionName] = s[extensionName] || {};
            s[extensionName].cost = s[extensionName].cost || structuredClone(defaultSettings.cost);
            s[extensionName].cost.enabled = (sub === 'on');
            try { const ctx = window.SillyTavern?.getContext?.(); (ctx?.saveSettingsDebounced || window.saveSettingsDebounced)?.(); } catch {}
            STRESCost.refreshBadge().catch(()=>{});
            this.sendToChat(`✅ Cost ${sub}`);
            return '';
          }
          if (sub === 'badge') {
            const v = (parts[3]||'').toLowerCase();
            if (!v || !['on','off'].includes(v)) { this.sendToChat('Usage: /stres cost badge <on|off>'); return ''; }
            const s = window.extension_settings || (window.SillyTavern?.getContext?.().extensionSettings);
            s[extensionName] = s[extensionName] || {};
            s[extensionName].cost = s[extensionName].cost || structuredClone(defaultSettings.cost);
            s[extensionName].cost.showBadge = (v === 'on');
            try { const ctx = window.SillyTavern?.getContext?.(); (ctx?.saveSettingsDebounced || window.saveSettingsDebounced)?.(); } catch {}
            STRESCost.refreshBadge().catch(()=>{});
            this.sendToChat(`✅ Badge ${v}`);
            return '';
          }
          if (sub === 'mode') {
            const v = (parts[3]||'').toLowerCase();
            if (!v || !['poll','on_turn'].includes(v)) { this.sendToChat('Usage: /stres cost mode <poll|on_turn>'); return ''; }
            const s = window.extension_settings || (window.SillyTavern?.getContext?.().extensionSettings);
            s[extensionName] = s[extensionName] || {};
            s[extensionName].cost = s[extensionName].cost || structuredClone(defaultSettings.cost);
            s[extensionName].cost.mode = v;
            try { const ctx = window.SillyTavern?.getContext?.(); (ctx?.saveSettingsDebounced || window.saveSettingsDebounced)?.(); } catch {}
            STRESCost.maybeSchedule();
            this.sendToChat(`✅ Cost mode set to ${v}`);
            return '';
          }
          if (sub === 'now') {
            (async()=>{ const ok = await STRESCost.refreshBadge(); this.sendToChat(ok? '✅ Refreshed cost badge' : '❌ No cost info or unsupported source'); })();
            return '';
          }
          this.sendToChat('Usage: /stres cost [status|on|off|badge on|off|mode <poll|on_turn>|now]');
          return '';
        }
        case 'tools': {
          try {
            const ctx = window.SillyTavern?.getContext?.();
            const supported = !!ctx?.isToolCallingSupported?.();
            const can = !!ctx?.canPerformToolCalls?.('chat');
            const TM = ctx?.ToolManager;
            const names = Array.isArray(TM?.tools) ? TM.tools.map(t=>t?.displayName||t?.name).join(', ') : '(unknown)';
            this.sendToChat(`**Tools**\n• Supported: ${supported}\n• Can Perform: ${can}\n• Registered: ${names}`);
          } catch { this.sendToChat('**Tools**\n• Status unavailable'); }
          return '';
        }
        case 'guard': {
          const sub = (parts[2]||'').toLowerCase();
          if (!sub || sub === 'status') {
            try {
              const s = window.extension_settings?.[extensionName]?.guard || defaultSettings.guard;
              this.sendToChat(`**Guard**\n• Enabled: ${!!s.enabled}\n• Template: ${s.template}`);
            } catch { this.sendToChat('**Guard**\n• Status unavailable'); }
            return '';
          }
          if (sub === 'on' || sub === 'off') {
            const s = window.extension_settings || (window.SillyTavern?.getContext?.().extensionSettings);
            s[extensionName] = s[extensionName] || {};
            s[extensionName].guard = s[extensionName].guard || structuredClone(defaultSettings.guard);
            s[extensionName].guard.enabled = (sub === 'on');
            try { const ctx = window.SillyTavern?.getContext?.(); (ctx?.saveSettingsDebounced || window.saveSettingsDebounced)?.(); } catch {}
            (async()=>{ try { await STRESGuard.refreshGuardrailInPrompt(); } catch {} })();
            this.sendToChat(`✅ Guard ${sub}`);
            return '';
          }
          if (sub === 'template') {
            const text = parts.slice(3).join(' ').trim();
            if (!text) { this.sendToChat('Usage: /stres guard template <text with {char} placeholder>'); return '';
            }
            const s = window.extension_settings || (window.SillyTavern?.getContext?.().extensionSettings);
            s[extensionName] = s[extensionName] || {};
            s[extensionName].guard = s[extensionName].guard || structuredClone(defaultSettings.guard);
            s[extensionName].guard.template = text;
            try { const ctx = window.SillyTavern?.getContext?.(); (ctx?.saveSettingsDebounced || window.saveSettingsDebounced)?.(); } catch {}
            (async()=>{ try { await STRESGuard.refreshGuardrailInPrompt(); } catch {} })();
            this.sendToChat('✅ Guard template updated');
            return '';
          }
          this.sendToChat('Usage: /stres guard [status|on|off|template <text>]');
          return '';
        }
        case 'wi': {
          const sub = (parts[2]||'').toLowerCase();
          if (!sub || sub === 'status') {
            this.sendToChat('**World Info Hygiene**\n• Tip: mark private entries strict and avoid recursion');
            return '';
          }
          if (sub === 'harden') {
            (async()=>{
              try {
                const ctx = window.SillyTavern?.getContext?.();
                if (!ctx?.loadWorldInfo || !ctx?.saveWorldInfo) { this.sendToChat('❌ World Info APIs not available'); return; }
                const wi = await ctx.loadWorldInfo();
                let patched = 0;
                for (const it of (Array.isArray(wi?.entries)?wi.entries:[])) {
                  try {
                    const tags = (it?.extensions?.tags || it?.tags || []).map(x=>String(x).toLowerCase());
                    const isPrivate = tags.includes('private') || tags.includes('secret') || tags.includes('npc_private');
                    if (!isPrivate) continue;
                    if ('prevent_recursion' in it) { it.prevent_recursion = true; patched++; }
                    if ('exclude_recursion' in it) { it.exclude_recursion = true; patched++; }
                  } catch {}
                }
                await ctx.saveWorldInfo(wi);
                this.sendToChat(`✅ WI hardened (flags set on ~${patched} fields)`);
              } catch (e) { this.sendToChat('❌ WI harden failed: ' + (e?.message||e)); }
            })();
            return '';
          }
          this.sendToChat('Usage: /stres wi [status|harden]');
          return '';
        }
        case 'mode': {
          const sub = (parts[2]||'').toLowerCase();
          if (!sub) {
            try { const cur = STRESCombat.getMode(); this.sendToChat(`Mode: ${cur}`); } catch { this.sendToChat('Mode: unknown'); }
            return '';
          }
          if (!['story','explore','combat'].includes(sub)) { this.sendToChat('Usage: /stres mode <story|explore|combat>'); return '';
          }
          (async()=>{ const ok = await STRESCombat.setMode(sub); this.sendToChat(ok ? `✅ Mode set to ${sub}` : '❌ Failed to set mode'); })();
          return '';
        }
        case 'dice': {
          const notation = (parts[2]||'').trim();
          if (!notation) { this.sendToChat('Usage: /stres dice <XdY+Z>'); return '';
          }
          const r = STRESCombat.rollDice(notation);
          if (!r.ok) { this.sendToChat('❌ ' + r.error); return '';
          }
          const rolls = r.rolls.join(', ');
          const mod = r.mod ? (r.mod>0?`+${r.mod}`:`${r.mod}`) : '';
          this.sendToChat(`🎲 ${notation} → [${rolls}] ${mod} = ${r.total}`);
          return '';
        }
        case 'probe': {
          (async ()=>{
            const res = await STRESWorld.probe();
            const h = res.health?.ok ? `✅ ${res.base}/health (HTTP ${res.health.status})` : `❌ ${res.base}/health (${res.health?.error||('HTTP '+res.health?.status)})`;
            const m = res.worldpack_manifest?.ok ? `✅ ${res.base}/api/worldpack/manifest` : `❌ ${res.base}/api/worldpack/manifest`;
            const c = res.worldpack_current?.ok ? `✅ ${res.base}/api/worldpack/current` : `❌ ${res.base}/api/worldpack/current`;
            const s = res.sim_state?.ok ? `✅ ${res.base}/api/sim/state` : `❌ ${res.base}/api/sim/state`;
            this.sendToChat(`**STRES Probe**\n${h}\n${m}\n${c}\n${s}`);
          })();
          return '';
        }
        case 'bindchat': {
          try {
            const ctx = window.SillyTavern?.getContext?.() || {};
            const chatMeta = ctx.chatMetadata || {};
            const cid = ctx.chatId || chatMeta.chat_id;
            if (!cid) { this.sendToChat('❌ No active chat to bind'); return ''; }
            const s = window.extension_settings || (ctx.extensionSettings);
            s[extensionName] = s[extensionName] || {};
            const camp = s[extensionName].campaignId || `chat-${cid}`;
            s[extensionName].campaignId = camp;
            s[extensionName].chatCampaigns = s[extensionName].chatCampaigns || {};
            s[extensionName].chatCampaigns[cid] = camp;
            try { (ctx?.saveSettingsDebounced || window.saveSettingsDebounced)?.(); } catch {}
            this.sendToChat(`✅ Bound chat ${cid} → campaign ${camp}`);
          } catch (e) { this.sendToChat('❌ Failed to bind chat: ' + (e?.message||e)); }
          return '';
        }
        case 'showchat': {
          try {
            const ctx = window.SillyTavern?.getContext?.() || {};
            const chatMeta = ctx.chatMetadata || {};
            const cid = ctx.chatId || chatMeta.chat_id || 'unknown';
            const cname = ctx.chatName || chatMeta.chat_name || 'unknown';
            const s = window.extension_settings?.[extensionName] || {};
            const mapped = (s.chatCampaigns||{})[cid];
            this.sendToChat(`**Chat**\n• Name: ${cname}\n• ID: ${cid}\n• Bound Campaign: ${mapped || '(none)'}\n• Current Campaign: ${s.campaignId || '(none)'} `);
          } catch (e) { this.sendToChat('❌ Failed to get chat info: ' + (e?.message||e)); }
          return '';
        }
        case 'worldpack': {
          const sub = (parts[2]||'').toLowerCase();
          if (!sub || sub === 'status') {
            this.showWorldpack();
            return '';
          }
          if (sub === 'load') {
            const id = (parts[3]||'').trim();
            if (!id) { this.sendToChat('Usage: /stres worldpack load <packId>'); return ''; }
            this.loadWorldpack(id);
            return '';
          }
          this.sendToChat('Usage: /stres worldpack [status|load <packId>]');
          return '';
        }
        case 'npc': {
          const sub = (parts[2]||'').toLowerCase();
          if (sub === 'say' || sub === 'reply') {
            const npcId = (parts[3]||'').trim();
            if (!npcId) { this.sendToChat('Usage: /stres npc say <npcId> <text>'); return '';
            }
            const cue = parts.slice(4).join(' ').trim();
            if (!cue) { this.sendToChat('Usage: /stres npc say <npcId> <text>'); return '';
            }
            (async()=>{
              try {
                const text = await STRESCombat.npcReply(npcId, cue);
                if (!text) { this.sendToChat('❌ NPC reply failed'); return; }
                const reg = await STRESNPC.ensureRegistry();
                const npc = reg?.[npcId] || { name: npcId };
                await this.addAssistantMessage(npc.name || npcId, text);
              } catch(e) { this.sendToChat('❌ NPC reply error: ' + (e?.message||e)); }
            })();
            return '';
          }
          this.sendToChat('Usage: /stres npc [say|reply] <npcId> <text>');
          return '';
        }
        case 'budget': {
          const sub = (parts[2]||'').toLowerCase();
          if (!sub) {
            (async()=>{ await this.showBudget(); })();
            return '';
          }
          if (sub === 'profile') {
            const prof = (parts[3]||'').trim();
            if (!prof) { this.sendToChat('Usage: /stres budget profile <Lean|Balanced|Rich>'); return ''; }
            const ok = STRESBudget.applyProfile(prof);
            this.sendToChat(ok ? `✅ Budget profile set to ${prof}` : '❌ Failed to set profile');
            (async()=>{ try { await STRESPrompts.refreshSceneHeaderInPrompt(); } catch {} })();
            return '';
          }
          if (sub === 'set') {
            const key = (parts[3]||'').toLowerCase();
            const val = Number(parts[4]||'');
            const s = window.extension_settings?.[extensionName];
            if (!s || !s.budget) { this.sendToChat('❌ Budget settings not available'); return ''; }
            if (!Number.isFinite(val)) { this.sendToChat('Usage: /stres budget set <context|cushion|reserve|header|primer> <number>'); return ''; }
            if (key === 'context') s.budget.contextTarget = val;
            else if (key === 'cushion') s.budget.cushion = val;
            else if (key === 'reserve') s.budget.reserve = val;
            else if (key === 'header') { s.budget.components = s.budget.components||{}; s.budget.components.header = s.budget.components.header||{}; s.budget.components.header.maxTokens = val; }
            else if (key === 'primer') { s.budget.components = s.budget.components||{}; s.budget.components.primer = s.budget.components.primer||{}; s.budget.components.primer.maxTokens = val; }
            else { this.sendToChat('Usage: /stres budget set <context|cushion|reserve|header|primer> <number>'); return ''; }
            try { const ctx = window.SillyTavern?.getContext?.(); (ctx?.saveSettingsDebounced || window.saveSettingsDebounced)?.(); } catch {}
            this.sendToChat(`✅ Updated ${key} to ${val}`);
            (async()=>{ try { await STRESPrompts.refreshSceneHeaderInPrompt(); } catch {} })();
            return '';
          }
          this.sendToChat('Usage: /stres budget | /stres budget profile <Lean|Balanced|Rich> | /stres budget set <context|cushion|reserve|header|primer> <number>');
          return '';
        }
        case 'start': {
          const sid = (parts[2]||'').trim();
          if (!sid) { this.sendToChat('Usage: /stres start <1|2|3|4|5>'); return ''; }
          STRESWorld.scenario(sid).then(async (r)=>{
            if (r.ok) {
              this.sendToChat(`✅ Scenario ${sid} set — ${r.locationName} [${r.regionId}]`);
              // Persist per-chat scenario binding
              try {
                const ctx = window.SillyTavern?.getContext?.();
                if (ctx) {
                  const meta = ctx.chatMetadata || (ctx.chatMetadata = {});
                  meta.stres = meta.stres || {};
                  meta.stres.scenarioId = r.scenarioId || sid;
                  if (r.scenarioLabel) meta.stres.scenarioLabel = r.scenarioLabel;
                  meta.stres.regionId = r.regionId;
                  meta.stres.locationLabel = r.locationName;
                  await ctx.saveMetadata?.();
                }
              } catch {}
              try { await STRESPrompts.refreshSceneHeaderInPrompt(); } catch {}
            } else {
              this.sendToChat('❌ ' + (r.message||'Failed'));
            }
          });
          return '';
        }
        case 'scenarios': {
          (async ()=>{
            const list = await STRESWorld.listScenarios();
            if (!list.length) { this.sendToChat('No scenarios found in active worldpack. Use /stres set region <id> to set manually.'); return ''; }
            const lines = list.map(s => `${s.index}. ${s.label} — ${s.locationName} [${s.regionId}] (id: ${s.id})`).join('\n');
            this.sendToChat(`**Available Scenarios**\n${lines}\n\nStart one: /stres start <index|id>`);
          })();
          return '';
        }
        case 'where': {
          (async()=>{
            await STRESWorld.refresh();
            const hdr = STRESWorld.formatHeader();
            this.sendToChat(`**Location**\n${hdr}`);
            try { await STRESPrompts.refreshSceneHeaderInPrompt(); } catch {}
          })();
          return '';
        }
        case 'tick': {
          const adv = (parts[2]||'').trim() || '2h';
          (async()=>{
            try {
              const s = window.extension_settings?.[extensionName] || {};
              const api = (s.serverUrl || defaultSettings.serverUrl) + '/api/sim/tick?advance=' + encodeURIComponent(adv) + (s.world?.regionId ? ('&regionId='+encodeURIComponent(s.world.regionId)) : '');
              const r = await fetch(api, { method: 'POST' });
              const j = await r.json();
              if (j?.success) {
                STRESWorld.lastState = j.state; STRESWorld.lastFetch = Date.now();
                this.sendToChat(`⏱️ Advanced time by ${adv}.`);
                try { await STRESPrompts.refreshSceneHeaderInPrompt(); } catch {}
              } else {
                this.sendToChat('❌ Failed to advance time');
              }
            } catch(e){ this.sendToChat('❌ Error: ' + (e?.message||e)); }
          })();
          return '';
        }
        case 'set': {
          // handled below; extend with region support
        }
        case 'join':
          this.rejoinWebSocket();
          return '';
        case 'campaign':
          this.showCampaign();
          return '';
        case 'inject': {
          const sub = (parts[2]||'').toLowerCase();
          if (sub === 'primer') {
            this.injectWorldpackPrimer(true);
            return '';
          }
          this.sendToChat('Usage: /stres inject primer');
          return '';
        }
        case 'summary': {
          const sub = (parts[2]||'').toLowerCase();
          if (!sub || sub === 'show') {
            try {
              const ctx = window.SillyTavern?.getContext?.();
              const last = ctx?.chatMetadata?.stres?.summaries?.slice(-1)[0];
              this.sendToChat(last ? (`**Latest Summary**\n${last.text}`) : 'No summaries yet.');
            } catch { this.sendToChat('No summaries available.'); }
            return '';
          }
          if (sub === 'now') { (async()=>{ const ok = await STRESSummary.generateSummary(); this.sendToChat(ok ? '✅ Generated summary' : '❌ Failed to generate summary'); await STRESPrompts.injectSummaryInPrompt(); })(); return ''; }
          if (sub === 'inject') {
            const val = (parts[3]||'').toLowerCase();
            const s = window.extension_settings?.[extensionName] || {};
            s.summary = s.summary || structuredClone(defaultSettings.summary);
            s.summary.inject = (val === 'on' || val === 'true' || val === '1');
            try { const ctx = window.SillyTavern?.getContext?.(); (ctx?.saveSettingsDebounced || window.saveSettingsDebounced)?.(); } catch {}
            this.sendToChat(`✅ Summary injection ${s.summary.inject ? 'ON' : 'OFF'}`);
            return '';
          }
          this.sendToChat('Usage: /stres summary [show|now|inject on|off]');
          return '';
        }
        case 'state': {
          const sub = (parts[2]||'').toLowerCase();
          if (!sub || sub === 'show') {
            try { const ctx = window.SillyTavern?.getContext?.(); const js = ctx?.chatMetadata?.stres?.state; this.sendToChat(js ? ('```json\n'+JSON.stringify(js,null,2)+'\n```') : 'No state yet.'); } catch { this.sendToChat('No state yet.'); }
            return '';
          }
          if (sub === 'now') { (async()=>{ const ok = await STRESSummary.extractState(); this.sendToChat(ok ? '✅ Extracted state' : '❌ Failed to extract state'); })(); return ''; }
          this.sendToChat('Usage: /stres state [show|now]');
          return '';
        }
        case 'settings':
          try { window.STRES?.toggleSettings?.(); } catch {}
          this.sendToChat('⚙️ Opened STRES settings panel');
          return '';
        case 'rag': {
          const sub = (parts[2]||'').toLowerCase();
          const s = window.extension_settings?.[extensionName] || {};
          s.rag = s.rag || structuredClone(defaultSettings.rag);
          if (!sub || sub === 'status' || sub === 'show') {
            const meta = (window.SillyTavern?.getContext?.()?.chatMetadata) || {};
            const last = meta?.stres?.ragLast;
            const on = !!s.rag.enabled;
            this.sendToChat(`**RAG**\n• Enabled: ${on}\n• topK: ${s.rag.topK} • maxTokens: ${s.rag.maxTokens}\n• position: ${s.rag.position} • depth: ${s.rag.depth}\n${last ? ('• Last query: ' + (last.query||'') + '\n• Last hits: ' + (last.items?.length||0)) : ''}`);
            return '';
          }
          if (sub === 'on' || sub === 'off') {
            s.rag.enabled = (sub === 'on');
            const b = s.budget = s.budget || structuredClone(defaultSettings.budget);
            b.components = b.components || {}; b.components.rag = b.components.rag || {};
            b.components.rag.enabled = s.rag.enabled;
            try { const ctx = window.SillyTavern?.getContext?.(); (ctx?.saveSettingsDebounced || window.saveSettingsDebounced)?.(); } catch {}
            this.sendToChat(`✅ RAG ${s.rag.enabled ? 'enabled' : 'disabled'}`);
            return '';
          }
          if (sub === 'topk') {
            const v = Number(parts[3]||'2'); s.rag.topK = Math.max(1, Math.min(6, v||2));
            try { const ctx = window.SillyTavern?.getContext?.(); (ctx?.saveSettingsDebounced || window.saveSettingsDebounced)?.(); } catch {}
            this.sendToChat(`✅ RAG topK set to ${s.rag.topK}`);
            return '';
          }
          if (sub === 'max') {
            const v = Number(parts[3]||'300'); s.rag.maxTokens = Math.max(50, Math.min(800, v||300));
            // also update budget cap
            const b = s.budget = s.budget || structuredClone(defaultSettings.budget);
            b.components = b.components || {}; b.components.rag = b.components.rag || {}; b.components.rag.maxTokens = s.rag.maxTokens;
            try { const ctx = window.SillyTavern?.getContext?.(); (ctx?.saveSettingsDebounced || window.saveSettingsDebounced)?.(); } catch {}
            this.sendToChat(`✅ RAG max tokens set to ${s.rag.maxTokens}`);
            return '';
          }
          if (sub === 'pos' || sub === 'position') {
            const v = (parts[3]||'').toLowerCase();
            if (v === 'in_chat' || v === 'in_prompt') { s.rag.position = v; this.sendToChat(`✅ RAG position ${v}`); }
            else this.sendToChat('Usage: /stres rag position <in_prompt|in_chat>');
            return '';
          }
          if (sub === 'depth') {
            const v = Number(parts[3]||'0'); s.rag.depth = Number.isFinite(v)? v : 0; this.sendToChat(`✅ RAG depth ${s.rag.depth}`); return '';
          }
          this.sendToChat('Usage: /stres rag [status|on|off|topk N|max N|position <in_prompt|in_chat>|depth N]');
          return '';
        }
        case 'npc': {
          const sub = (parts[2]||'').toLowerCase();
          const s = window.extension_settings?.[extensionName] || {};
          s.npc = s.npc || structuredClone(defaultSettings.npc);
          if (!sub || sub === 'status' || sub === 'show') {
            const present = Object.keys((window.SillyTavern?.getContext?.()?.chatMetadata?.stres?.npc?.presence)||{}).filter(k => (window.SillyTavern?.getContext?.()?.chatMetadata?.stres?.npc?.presence?.[k]?.inScene));
            this.sendToChat(`**NPC Memory**\n• Enabled: ${s.npc.enabled}\n• Inject: ${s.npc.inject}\n• topK: ${s.npc.topK} • maxTokens: ${s.npc.maxTokens} • maxNPCs: ${s.npc.maxNPCs}\n• Activation: ${s.npc.activation}\n• Present: ${present.join(', ')||'(none)'}`);
            return '';
          }
          if (sub === 'on' || sub === 'off') {
            s.npc.enabled = (sub === 'on');
            const b = s.budget = s.budget || structuredClone(defaultSettings.budget);
            b.components = b.components || {}; b.components.npc = b.components.npc || {};
            b.components.npc.enabled = s.npc.enabled;
            try { const ctx = window.SillyTavern?.getContext?.(); (ctx?.saveSettingsDebounced || window.saveSettingsDebounced)?.(); } catch {}
            this.sendToChat(`✅ NPC memory ${s.npc.enabled ? 'enabled' : 'disabled'}`);
            return '';
          }
          if (sub === 'inject') {
            const v = (parts[3]||'').toLowerCase();
            s.npc.inject = (v === 'on' || v === 'true' || v === '1');
            try { const ctx = window.SillyTavern?.getContext?.(); (ctx?.saveSettingsDebounced || window.saveSettingsDebounced)?.(); } catch {}
            this.sendToChat(`✅ NPC injection ${s.npc.inject ? 'ON' : 'OFF'}`);
            return '';
          }
          if (sub === 'topk') {
            const v = Number(parts[3]||'2'); s.npc.topK = Math.max(1, Math.min(6, v||2));
            try { const ctx = window.SillyTavern?.getContext?.(); (ctx?.saveSettingsDebounced || window.saveSettingsDebounced)?.(); } catch {}
            this.sendToChat(`✅ NPC topK set to ${s.npc.topK}`);
            return '';
          }
          if (sub === 'max') {
            const v = Number(parts[3]||'400'); s.npc.maxTokens = Math.max(80, Math.min(800, v||400));
            const b = s.budget = s.budget || structuredClone(defaultSettings.budget);
            b.components = b.components || {}; b.components.npc = b.components.npc || {}; b.components.npc.maxTokens = s.npc.maxTokens;
            try { const ctx = window.SillyTavern?.getContext?.(); (ctx?.saveSettingsDebounced || window.saveSettingsDebounced)?.(); } catch {}
            this.sendToChat(`✅ NPC max tokens set to ${s.npc.maxTokens}`);
            return '';
          }
          if (sub === 'maxnpcs') {
            const v = Number(parts[3]||'2'); s.npc.maxNPCs = Math.max(1, Math.min(6, v||2));
            try { const ctx = window.SillyTavern?.getContext?.(); (ctx?.saveSettingsDebounced || window.saveSettingsDebounced)?.(); } catch {}
            this.sendToChat(`✅ NPC max count set to ${s.npc.maxNPCs}`);
            return '';
          }
          if (sub === 'enter') { const id = parts.slice(3).join(' ').trim(); if (!id) { this.sendToChat('Usage: /stres npc enter <name|id>'); return ''; } STRESNPC.markEnter(id); this.sendToChat(`🚪 ${id} entered scene.`); return ''; }
          if (sub === 'leave') { const id = parts.slice(3).join(' ').trim(); if (!id) { this.sendToChat('Usage: /stres npc leave <name|id>'); return ''; } STRESNPC.markLeave(id); this.sendToChat(`🚪 ${id} left scene.`); return ''; }
          this.sendToChat('Usage: /stres npc [status|on|off|inject on|off|topk N|max N|maxnpcs N|enter ID|leave ID]');
          return '';
        }
        case 'setapi': {
          const url = (parts[2] || '').trim();
          if (!url) {
            this.sendToChat('Usage: /stres setapi http://host:port');
            return '';
          }
          const s = window.extension_settings || (window.SillyTavern?.getContext?.().extensionSettings);
          s[extensionName] = s[extensionName] || {};
          s[extensionName].serverUrl = url.replace(/\/$/, '');
          try { if (state.stresClient) state.stresClient.baseUrl = s[extensionName].serverUrl; } catch {}
          try { const ctx = window.SillyTavern?.getContext?.(); (ctx?.saveSettingsDebounced || window.saveSettingsDebounced)?.(); } catch {}
          try { window.STRES?.refreshSettingsUI?.(); } catch {}
          this.sendToChat(`✅ API URL set to ${s[extensionName].serverUrl}`);
          return '';
        }
        case 'set': {
          const key = (parts[2] || '').toLowerCase();
          const value = (parts.slice(3).join(' ') || '').trim();
          const s = window.extension_settings || (window.SillyTavern?.getContext?.().extensionSettings);
          s[extensionName] = s[extensionName] || {};
          if (key === 'campaign') {
            s[extensionName].campaignId = value || null;
            this.sendToChat(`✅ Campaign ID set to ${s[extensionName].campaignId || 'None'}`);
          } else if (key === 'worldpack') {
            s[extensionName].worldpackId = value || null;
            try { const ctx = window.SillyTavern?.getContext?.(); (ctx?.saveSettingsDebounced || window.saveSettingsDebounced)?.(); } catch {}
            try { window.STRES?.refreshSettingsUI?.(); } catch {}
            this.sendToChat(`✅ Worldpack ID set to ${s[extensionName].worldpackId || 'None'}`);
          } else if (key === 'region') {
            s[extensionName].world = s[extensionName].world || structuredClone(defaultSettings.world);
            s[extensionName].world.regionId = value || null;
            try { const ctx = window.SillyTavern?.getContext?.(); (ctx?.saveSettingsDebounced || window.saveSettingsDebounced)?.(); } catch {}
            STRESWorld.refresh(value).then(async()=>{
              this.sendToChat(`✅ Region set to ${value}`);
              try { await STRESPrompts.refreshSceneHeaderInPrompt(); } catch {}
            });
          } else if (key === 'char' || key === 'character') {
            s[extensionName].characterId = value || null;
            this.sendToChat(`✅ Character ID set to ${s[extensionName].characterId || 'None'}`);
          } else {
            this.sendToChat('Usage: /stres set campaign <id> | /stres set worldpack <id> | /stres set region <id> | /stres set character <id>');
            return '';
          }
          try { const ctx = window.SillyTavern?.getContext?.(); (ctx?.saveSettingsDebounced || window.saveSettingsDebounced)?.(); } catch {}
          try { window.STRES?.refreshSettingsUI?.(); } catch {}
          return '';
        }
        case 'reset':
          this.resetSettings();
          return '';
        case 'debug': {
          const sub = (parts[2]||'').toLowerCase();
          if (!sub || sub === 'show') { this.showDebugInfo(); return ''; }
          if (sub === 'on' || sub === 'off') {
            const s = window.extension_settings || (window.SillyTavern?.getContext?.().extensionSettings);
            s[extensionName] = s[extensionName] || {};
            s[extensionName].telemetry = s[extensionName].telemetry || structuredClone(defaultSettings.telemetry);
            s[extensionName].telemetry.enabled = (sub === 'on');
            try { const ctx = window.SillyTavern?.getContext?.(); (ctx?.saveSettingsDebounced || window.saveSettingsDebounced)?.(); } catch {}
            this.sendToChat(`✅ Telemetry ${sub}`);
            return '';
          }
          if (sub === 'log') {
            const v = (parts[3]||'').toLowerCase();
            if (!['on','off'].includes(v)) { this.sendToChat('Usage: /stres debug log <on|off>'); return ''; }
            const s = window.extension_settings || (window.SillyTavern?.getContext?.().extensionSettings);
            s[extensionName] = s[extensionName] || {};
            s[extensionName].telemetry = s[extensionName].telemetry || structuredClone(defaultSettings.telemetry);
            s[extensionName].telemetry.logToChat = (v === 'on');
            try { const ctx = window.SillyTavern?.getContext?.(); (ctx?.saveSettingsDebounced || window.saveSettingsDebounced)?.(); } catch {}
            this.sendToChat(`✅ Telemetry log ${v}`);
            return '';
          }
          if (sub === 'turn') { STRESTelemetry.showLast(); return ''; }
          this.sendToChat('Usage: /stres debug [show|on|off|log on|off|turn]');
          return '';
        }
        case 'fixport':
          this.fixPortConfiguration();
          return '';
        default:
          this.showHelp();
          return '';
      }
    } catch (error) {
      console.error('[STRES] Error in handleStresCommand:', error);
      this.sendToChat('❌ Error processing STRES command: ' + error.message);
      return '';
    }
  },

  async showStatus() {
    const settings = window.extension_settings?.[extensionName] || {};
    const apiBase = settings.serverUrl || defaultSettings.serverUrl;
    let apiStatus = 'checking...';
    let wpStatus = 'checking...';

    try {
      const health = await fetch(`${apiBase}/health`);
      if (health.ok) {
        const data = await health.json();
        apiStatus = `healthy (${data.version || 'unknown'})`;
      } else {
        apiStatus = `error: ${health.status}`;
      }
    } catch (error) {
      apiStatus = `unreachable (${error.message})`;
    }

    try {
      const cur = await state.stresClient.getCurrentWorldpack();
      if (cur && cur.success) {
        wpStatus = `${cur.id}@${cur.version}`;
      } else {
        wpStatus = 'none';
      }
    } catch {
      wpStatus = 'error';
    }

    const message = `
**STRES Status**
• Version: 0.1.2
• API: ${apiBase} (${apiStatus})
• Default API: ${defaultSettings.serverUrl}
• Settings API: ${settings.serverUrl || 'not set'}
• Campaign ID: ${settings.campaignId || 'None'}
• Worldpack ID: ${settings.worldpackId || 'None'}
• Active Worldpack: ${wpStatus}
• Mode: ${(window.SillyTavern?.getContext?.().chatMetadata?.stres?.mode) || 'story'}
• Character ID: ${settings.characterId || 'None'}
• Extension: Loaded ✅
    `.trim();

    this.sendToChat(message);
    return '';
  },

  async showWorldpack() {
    try {
      const cur = await state.stresClient.getCurrentWorldpack();
      if (cur && cur.success) {
        this.sendToChat(`**Worldpack**\n• Active: ${cur.id}@${cur.version}\n• Loaded At: ${cur.loadedAt || 'unknown'}`);
      } else {
        this.sendToChat('**Worldpack**\n• Active: None');
      }
    } catch (e) {
      this.sendToChat(`**Worldpack**\n• Error: ${e?.message || e}`);
    }
    return '';
  },

  async loadWorldpack(id) {
    try {
      const res = await state.stresClient.loadWorldpackById(id);
      const s = window.extension_settings || (window.SillyTavern?.getContext?.().extensionSettings);
      s[extensionName] = s[extensionName] || {};
      s[extensionName].worldpackId = id;
      try { const ctx = window.SillyTavern?.getContext?.(); (ctx?.saveSettingsDebounced || window.saveSettingsDebounced)?.(); } catch {}
      try { window.STRES?.refreshSettingsUI?.(); } catch {}
      this.sendToChat(`✅ Loaded worldpack ${res.id}@${res.version}`);
      try { const ai = s[extensionName].autoInjection; if (ai?.enabled && ai?.primer) { await this.injectWorldpackPrimer(); } } catch {}
    } catch (e) {
      this.sendToChat(`❌ Failed to load worldpack: ${e?.message || e}`);
    }
    return '';
  },

  async injectWorldpackPrimer(force=false) {
    try {
      const ok = await STRESPrompts.injectPrimerInPrompt(!!force);
      if (ok) this.sendToChat('✅ Injected World Primer into prompt');
      else this.sendToChat('❌ Failed to inject primer (check backend or settings)');
      return '';
    } catch (e) { this.sendToChat('❌ Failed to inject primer: ' + (e?.message||e)); return ''; }
  },

  buildWorldpackPrimer(manifest) {
    try {
      const lines = [];
      lines.push(`• Setting: ${manifest.metadata?.setting || 'fantasy'}; Genre: ${manifest.metadata?.genre || 'fantasy'}`);
      if (manifest.races?.length) {
        const raceList = manifest.races.map(r=>r.name||r.id).slice(0,6).join(', ');
        lines.push(`• Races: ${raceList}`);
      }
      if (manifest.naming) {
        const cultures = Object.keys(manifest.naming).slice(0,6);
        lines.push(`• Naming cultures: ${cultures.join(', ')}`);
      }
      if (manifest.crafting?.skills?.length) {
        lines.push(`• Crafting: ${manifest.crafting.skills.map(s=>s.name||s.id).join(', ')}`);
      }
      const biomes = Object.keys(manifest.spawns?.biomes||{});
      if (biomes.length) lines.push(`• Biomes: ${biomes.join(', ')}`);
      if (manifest.creatures?.length) {
        const keyCreatures = manifest.creatures.map(c=>c.name||c.id).slice(0,8).join(', ');
        lines.push(`• Creatures: ${keyCreatures}`);
      }
      if (manifest.economy?.basePrices) {
        const items = Object.keys(manifest.economy.basePrices).slice(0,6).map(k=>`${k}:${manifest.economy.basePrices[k]}`).join(', ');
        lines.push(`• Prices (sample): ${items}`);
      }
      if (manifest.combat?.initiative?.formula) lines.push(`• Initiative: ${manifest.combat.initiative.formula}`);
      if (manifest.terminology && Object.keys(manifest.terminology).length) lines.push(`• Terms: ${Object.entries(manifest.terminology).map(([k,v])=>`${k}→${v}`).slice(0,6).join(', ')}`);
      lines.push('• Style: grounded, realistic harvests; wildlife seldom drops weapons. Weather/time/season/region affect encounters.');
      return lines.join('\n');
    } catch { return '• Summary unavailable'; }
  },

  resetSettings() {
    if (window.extension_settings) {
      window.extension_settings[extensionName] = structuredClone(defaultSettings);
      // Persist via SillyTavern if available
      try {
        const ctx = window.SillyTavern?.getContext?.();
        (ctx?.saveSettingsDebounced || window.saveSettingsDebounced)?.();
      } catch {}
      this.sendToChat('✅ STRES settings reset to defaults');
    } else {
      this.sendToChat('❌ Cannot reset settings - extension_settings not available');
    }
    return '';
  },

  showDebugInfo() {
    const settings = window.extension_settings?.[extensionName] || {};
    const debugMessage = `
**STRES Debug Info**
• Extension Name: ${extensionName}
• Window.STRES: ${typeof window.STRES}
• Extension Settings: ${typeof window.extension_settings}
• STRES Settings: ${typeof settings}
• Current API URL: ${settings.serverUrl || 'not set'}
• Default API URL: ${defaultSettings.serverUrl}
• Settings Keys: ${Object.keys(settings).join(', ')}
    `.trim();

    this.sendToChat(debugMessage);
    return '';
  },

  async showBudget() {
    const s = window.extension_settings?.[extensionName] || {};
    const b = s.budget || defaultSettings.budget;
    const pred = await STRESBudget.predictTokens();
    // Try to predict RAG tokens based on last hits
    try {
      const ctx = window.SillyTavern?.getContext?.();
      const last = ctx?.chatMetadata?.stres?.ragLast;
      if (last?.items?.length) {
        const text = last.items.map(it=>`• ${it.text}`).join('\n');
        pred.rag = await STRESWorld.tokenCount(text);
      }
    } catch {}
    const decision = STRESBudget.decideAllowance(pred);
    const lines = [];
    lines.push(`Profile: ${b.profile || 'Custom'}`);
    lines.push(`Context target: ${b.contextTarget}, cushion: ${b.cushion}, reserve: ${b.reserve}`);
    lines.push(`Predicted tokens — guard:${pred.guard||0}, header:${pred.header||0}, primer:${pred.primer||0}, rag:${pred.rag||0}`);
    lines.push(`Allowance — guard:${decision.allowance.guard||0}, header:${decision.allowance.header||0}, primer:${decision.allowance.primer||0}, rag:${decision.allowance.rag||0} (limit ${decision.limit}, remaining ${decision.remaining})`);
    this.sendToChat('**Token Budget**\n' + lines.join('\n'));
    return '';
  },

  fixPortConfiguration() {
    if (window.extension_settings) {
      if (!window.extension_settings[extensionName]) {
        window.extension_settings[extensionName] = {};
      }
      window.extension_settings[extensionName].serverUrl = "http://localhost:3001";
      try {
        // Update live client base if already created
        if (state.stresClient && typeof state.stresClient === 'object') {
          state.stresClient.baseUrl = window.extension_settings[extensionName].serverUrl;
        }
        const ctx = window.SillyTavern?.getContext?.();
        (ctx?.saveSettingsDebounced || window.saveSettingsDebounced)?.();
        try { window.STRES?.refreshSettingsUI?.(); } catch {}
      } catch {}
      this.sendToChat('✅ STRES API URL fixed to http://localhost:3001');
      this.sendToChat('🔄 Try /stres status again to test the connection');
    } else {
      this.sendToChat('❌ Cannot fix port - extension_settings not available');
    }
    return '';
  },

  showHelp() {
    const message = `
**STRES Commands**
• /inventory show - Display inventory
• /inventory add [item] - Add item
• /inventory remove [item] - Remove item
• /inventory use [item] - Use item
• /stres status - Show STRES status
• /stres begin [status|refresh|wizard|script] - Detect card metadata and prep campaign setup
• /stres worldpack - Show active worldpack
• /stres worldpack load <id> - Load worldpack by ID
• /stres scenarios - List worldpack-provided scenarios
• /stres start <id|index> - Set scenario and region
• /stres where - Show current location/time/weather
• /stres tick <duration> - Advance sim time (e.g., 2h, 30m)
• /stres onboard - Post quick onboarding steps
• /stres narrator [status|bind|apply|depth <text>] - Apply/bind portable config; set depth prompt
• /stres probe - Probe API endpoints (health, worldpack, sim)
• /stres join - Reconnect WebSocket
• /stres campaign - Show campaign info
• /stres showchat - Show current chat and bound campaign
• /stres bindchat - Bind current chat → current campaign
• /stres settings - Toggle settings panel
• /stres setapi <url> - Set API base URL
• /stres set campaign <id> - Set campaign ID
• /stres set worldpack <id> - Set worldpack ID
• /stres set region <id> - Set region ID for sim
• /stres set character <id> - Set character ID
• /stres inject primer - Inject worldpack primer
• /stres budget - Show token budgets and predicted use
• /stres budget profile <Lean|Balanced|Rich> - Apply budget profile
• /stres budget set <context|cushion|reserve|header|primer> <number> - Adjust limits
• /stres summary [show|now|inject on|off] - Rolling summary controls
• /stres state [show|now] - Show or refresh structured state
• /stres rag [status|on|off|topk N|max N|position in_prompt|in_chat|depth N] - RAG controls
• /stres npc [status|on|off|inject on|off|topk N|max N|maxnpcs N|enter ID|leave ID] - NPC memory controls
• /stres mode <story|explore|combat> - Switch interaction mode
• /stres dice <XdY+Z> - Roll dice
• /stres npc say <npcId> <text> - NPC quick reply (cheap model)
• /stres guard [status|on|off|template <text>] - Crosstalk guardrail controls
• /stres wi [status|harden] - Optional WI hardening
• /stres tools - Show function tool status and list
• /stres cost [status|on|off|badge on|off|now] - Cost/balance badge controls
• /stres debug [show|on|off|log on|off|turn] - Telemetry controls
• /stres reset - Reset settings to defaults
• /stres debug - Show debug information
• /stres fixport - Fix API port configuration
    `.trim();

    this.sendToChat(message);
    return '';
  },

  rejoinWebSocket() {
    this.sendToChat('🔄 WebSocket reconnection requested');
    return '';
  },

  showCampaign() {
    const settings = window.extension_settings?.[extensionName] || {};
    const message = `
**Campaign Info**
• Campaign ID: ${settings.campaignId || 'None'}
• Server URL: ${settings.serverUrl || defaultSettings.serverUrl}
    `.trim();

    this.sendToChat(message);
    return '';
  },

  async addItem(argStr) {
    const parts = argStr.trim().split(/\s+/);
    const itemId = parts[0];
    const quantity = parts[1] ? parseInt(parts[1], 10) : 1;
    if (!itemId) {
      this.sendToChat('Usage: /inventory add <itemId> <quantity?>');
      return;
    }
    this.sendToChat(`✅ Added ${quantity} ${itemId} (simulated)`);
    return '';
  },

  async removeItem(argStr) {
    const parts = argStr.trim().split(/\s+/);
    const itemId = parts[0];
    const quantity = parts[1] ? parseInt(parts[1], 10) : 1;
    if (!itemId) {
      this.sendToChat('Usage: /inventory remove <itemId> <quantity?>');
      return;
    }
    this.sendToChat(`✅ Removed ${quantity} ${itemId} (simulated)`);
    return '';
  },

  async useItem(argStr) {
    const itemId = argStr.trim();
    if (!itemId) {
      this.sendToChat('Usage: /inventory use <itemId>');
      return;
    }
    this.sendToChat(`⚔️ Used ${itemId} (simulated)`);
    return '';
  },

  showInventory() {
    const message = `
**Inventory**
• Sample Item 1 (5)
• Sample Item 2 (2)
• Sample Item 3 (1)
*Note: Connect to STRES backend for real inventory*
    `.trim();

    this.sendToChat(message);
    return '';
  },

  handleCombatCommand(command) {
    const parts = command.split(' ');
    const subcommand = parts[1];

    switch(subcommand) {
      case 'act':
        this.handleCombatAct(parts.slice(2));
        return '';
      case 'init':
      case 'initiative': {
        const args = parts.slice(2).join(' ').trim();
        if (!args) { this.sendToChat('Usage: /combat initiative <Name:+2, Goblin:+1, Wolf:0>'); return '';
        }
        try {
          const ctx = window.SillyTavern?.getContext?.();
          const tokens = args.split(/[\s,]+/).filter(Boolean);
          const rolls = [];
          for (const tok of tokens) {
            const m = tok.match(/^(.*?)(?::|\+)?([+\-]?\d+)?$/);
            const name = (m?.[1]||'').replace(/[+\-]\d+$/,'').trim() || tok;
            const mod = Number(m?.[2]||0);
            const r = STRESCombat.rollDice(`1d20${mod>=0?`+${mod}`:mod}`);
            if (r.ok) rolls.push({ name, total: r.total, detail: `${r.rolls[0]}${mod? (mod>0?`+${mod}`:mod):''}` });
          }
          rolls.sort((a,b)=> b.total - a.total);
          const order = rolls.map(r => `${r.name}(${r.total})`);
          const meta = ctx.chatMetadata || (ctx.chatMetadata = {});
          meta.stres = meta.stres || {};
          meta.stres.combat = meta.stres.combat || {};
          meta.stres.combat.order = rolls.map(r => r.name);
          meta.stres.combat.round = Number(meta.stres.combat.round||1);
          meta.stres.mode = meta.stres.mode || 'combat';
          try { ctx.saveMetadata?.(); } catch {}
          try { STRESCombat.refreshCombatHeaderInPrompt(); } catch {}
          const lines = rolls.map(r => `• ${r.name}: ${r.total} [${r.detail}]`);
          this.sendToChat(`Initiative order set (highest first):\n${lines.join('\n')}`);
        } catch (e) { this.sendToChat('❌ Initiative error: ' + (e?.message||e)); }
        return '';
      }
      case 'status':
        this.showCombatStatus();
        return '';
      default:
        this.sendToChat('**Combat Commands:**\n• /combat act attack <targetId> - Submit attack action\n• /combat status - Show current combat state\n• /combat initiative <Name:+2, Goblin:+1> - Roll and set order');
        return '';
    }
    return '';
  },

  handleCombatAct(args) {
    if (args.length < 2 || args[0] !== 'attack') {
      this.sendToChat('Usage: /combat act attack <targetId>');
      return;
    }

    const targetId = args[1];
    this.sendToChat(`⚔️ Combat action: Attack ${targetId} (simulated)`);
    return '';
  },

  showCombatStatus() {
    this.sendToChat('**Combat Status**\n• Active: No\n• Current Turn: None\n*Note: Connect to STRES backend for real combat*');
    return '';
  },

  sendToChat(message) {
    try {
      if (typeof STRESChat.addSystemMessage === 'function') {
        STRESChat.addSystemMessage(String(message||''));
        return;
      }
    } catch {}
    // Fallback to console and manual insert if context API missing
    console.log('[STRES]', message);
    const chatContainer = document.querySelector('#chat');
    if (chatContainer) {
      const messageElement = document.createElement('div');
      messageElement.className = 'mes stres-message';
      messageElement.innerHTML = `<div class="mes_text">${String(message||'').replace(/\n/g, '<br>')}</div>`;
      chatContainer.appendChild(messageElement);
    }
  }
};

// Instantiate onboarding module with runtime dependencies
STRESOnboarding = createOnboarding({ STRESNarrator, STRESChat });
try { window.STRESOnboarding = STRESOnboarding; } catch {}

// Main initialization function
async function initializeExtension() {
  console.log("[STRES] Extension starting...");

  // Wait for SillyTavern to be ready
  if (typeof window.SillyTavern === 'undefined') {
    console.warn('[STRES] SillyTavern not found. Extension may not work properly.');
  }

  // Initialize settings
  const context = window.SillyTavern?.getContext?.() || {};
  const extensionSettings = context.extensionSettings || window.extension_settings || {};

  if (!extensionSettings[extensionName]) {
    extensionSettings[extensionName] = structuredClone(defaultSettings);
    if (context.saveSettingsDebounced) {
      context.saveSettingsDebounced();
    }
  }

  // Initialize STRES client
  state.stresClient = new STRESClient(extensionSettings[extensionName].serverUrl);

  // Make settings globally accessible
  window.extension_settings = extensionSettings;

  // Auto-bind campaign to current chat, if possible
  try {
    const s = window.extension_settings[extensionName];
    if (s.autoBindCampaignToChat) {
      const chatMetadata = context.chatMetadata || {};
      const currentChatId = context.chatId || chatMetadata.chat_id;
      if (currentChatId) {
        s.chatCampaigns = s.chatCampaigns || {};
        if (s.chatCampaigns[currentChatId]) {
          s.campaignId = s.chatCampaigns[currentChatId];
        } else if (!s.campaignId) {
          // Derive a campaign ID from chat id
          s.campaignId = `chat-${currentChatId}`;
          s.chatCampaigns[currentChatId] = s.campaignId;
        } else {
          s.chatCampaigns[currentChatId] = s.campaignId;
        }
        try { (context?.saveSettingsDebounced || window.saveSettingsDebounced)?.(); } catch {}
      }
    }
  } catch {}

  // If a worldpack is configured, try to ensure it is loaded
  try {
    const s = window.extension_settings[extensionName];
    if (s.worldpackId) {
      state.stresClient.loadWorldpackById(s.worldpackId).catch(()=>{});
      try { const ai = s.autoInjection; if (ai?.enabled && ai?.primer) { setTimeout(()=>{ STRESChat.injectWorldpackPrimer().catch(()=>{}); }, 200); } } catch {}
    }
  } catch {}

  // Register slash commands
  registerSlashCommands(context);

  // Initialize UI components
  initializeUI();

  // Initialize prompt injections (macros + dynamic scene header; optional primer)
  try { STRESPrompts.init(context); } catch {}

  // Initialize rolling summaries & structured state capture
  try { STRESSummary.init(context); } catch {}

  // Initialize NPC presence/memory
  try { STRESNPC.init(context); } catch {}

  // Initialize combat mode & header
  try { STRESCombat.init(context); } catch {}

  // Initialize crosstalk/leak guardrails
  try { STRESGuard.init(context); } catch {}

  // Register function tools for LLMs
  try { STRESTools.init(context); } catch {}

  // Initialize OpenRouter cost awareness
  try { STRESCost.init(context); } catch {}

  // Initialize Narrator & Onboarding
  try { STRESNarrator.init(context); } catch {}
  try { STRESOnboarding.init(context); } catch {}

  // Initialize Setup Wizard listener
  try { STRESSetup.init(context); } catch {}

  // Initialize Telemetry
  try { STRESTelemetry.init(context); } catch {}

  console.log("[STRES] Extension initialized successfully");
}

// Register slash commands with SillyTavern
function registerSlashCommands(context) {
  const registerSlashCommand = context.registerSlashCommand || window.registerSlashCommand;
  const SlashCommandParser = context.SlashCommandParser || window.SlashCommandParser;
  const SlashCommand = context.SlashCommand || window.SlashCommand;

  if (typeof SlashCommandParser !== 'undefined' && typeof SlashCommand !== 'undefined') {
    console.log("[STRES] Using modern SlashCommandParser method");

    // Register all STRES commands
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
      name: 'stres',
      callback: (args) => {
        const argString = args && args.length > 0 ? args.join(' ') : '';
        return STRESChat.handleStresCommand('/stres ' + argString);
      },
      helpString: 'STRES main commands - status, join, campaign, settings, reset, debug, fixport'
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
      name: 'stres_status',
      callback: () => STRESChat.showStatus(),
      helpString: 'Show STRES status and current campaign info'
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
      name: 'inventory',
      callback: (args) => STRESChat.handleInventoryCommand('/inventory ' + args.join(' ')),
      helpString: 'Inventory management - show, add, remove, use'
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
      name: 'combat',
      callback: (args) => STRESChat.handleCombatCommand('/combat ' + args.join(' ')),
      helpString: 'Combat commands - act, status'
    }));

    console.log("[STRES] Slash commands registered successfully using SlashCommandParser");
  } else if (typeof registerSlashCommand === 'function') {
    console.log("[STRES] Using legacy registerSlashCommand function");

    registerSlashCommand('stres', (args) => {
      const argString = args && args.length > 0 ? args.join(' ') : '';
      return STRESChat.handleStresCommand('/stres ' + argString);
    }, [], 'STRES main commands - status, join, campaign, settings, reset, debug, fixport', true, true);
    registerSlashCommand('stres_status', () => STRESChat.showStatus(), [], 'Show STRES status', true, true);
    registerSlashCommand('inventory', (args) => {
      const argString = args && args.length > 0 ? args.join(' ') : '';
      return STRESChat.handleInventoryCommand('/inventory ' + argString);
    }, [], 'Inventory management', true, true);
    registerSlashCommand('combat', (args) => {
      const argString = args && args.length > 0 ? args.join(' ') : '';
      return STRESChat.handleCombatCommand('/combat ' + argString);
    }, [], 'Combat commands', true, true);

    console.log("[STRES] Slash commands registered successfully using registerSlashCommand");
  } else {
    console.error("[STRES] No slash command registration method found");
  }
}

// Initialize UI components
function initializeUI() {
  const doc = document;
  const rootId = 'stres-extension-root';

  if (doc.getElementById(rootId)) return; // already mounted

  const root = doc.createElement('div');
  root.id = rootId;
  root.setAttribute('data-theme', 'auto');
  root.style.position = 'relative';
  doc.body.appendChild(root);

  // Simple mounting of components in DOM containers
  const quickBarHost = doc.createElement('div');
  quickBarHost.id = 'stres-quickbar-host';
  root.appendChild(quickBarHost);

  const settingsHost = doc.createElement('div');
  settingsHost.id = 'stres-settings-host';
  root.appendChild(settingsHost);

  const combatHost = doc.createElement('div');
  combatHost.id = 'stres-combat-host';
  root.appendChild(combatHost);

  // Expose a minimal API to toggle settings (prefers tabbed panel)
  window.STRES = window.STRES || {};
  const setSettingsVisibility = (panel, show) => {
    try {
      panel.setAttribute('aria-hidden', show ? 'false' : 'true');
      // Tabbed panel uses flex; hide/show consistently for both variants
      const displayMode = panel.classList.contains('stres-settings-panel--tabs') ? 'flex' : 'block';
      panel.style.display = show ? displayMode : 'none';
    } catch {}
  };
  window.STRES.toggleSettings = () => {
    const tabs = doc.querySelector('#stres-settings-tabs-panel');
    const panel = tabs || doc.querySelector('#stres-settings-host .stres-settings-panel');
    if (!panel) return;
    const hidden = panel.getAttribute('aria-hidden') === 'true';
    setSettingsVisibility(panel, hidden);
  };

  // Real Settings UI
  (function renderSettingsPanel() {
    const settings = (window.extension_settings?.[extensionName]) || structuredClone(defaultSettings);

    const panel = doc.createElement('div');
    panel.className = 'stres-settings-panel';
    panel.setAttribute('aria-hidden', 'true');
    panel.style.display = 'none';

    // Header
    const header = doc.createElement('div');
    header.className = 'stres-settings__header';
    const title = doc.createElement('strong');
    title.textContent = 'STRES Settings';
    const btnClose = doc.createElement('button');
    btnClose.className = 'stres-btn stres-btn--icon';
    btnClose.setAttribute('aria-label', 'Close');
    btnClose.textContent = '✕';
    btnClose.addEventListener('click', () => setSettingsVisibility(panel, false));
    header.appendChild(title); header.appendChild(btnClose);

    // Content
    const content = doc.createElement('div');
    content.className = 'stres-settings__content';

    const secConn = doc.createElement('div');
    secConn.className = 'stres-settings__section';
    const hConn = doc.createElement('h3'); hConn.textContent = 'Connection';
    const fldApi = doc.createElement('div'); fldApi.className = 'stres-field';
    const lblApi = doc.createElement('label'); lblApi.setAttribute('for','stres-api-url'); lblApi.textContent = 'API Base URL';
    const inpApi = doc.createElement('input'); inpApi.type = 'text'; inpApi.id = 'stres-api-url'; inpApi.placeholder = 'http://localhost:3001'; inpApi.value = settings.serverUrl || defaultSettings.serverUrl;
    fldApi.appendChild(lblApi); fldApi.appendChild(inpApi);

    const fldCampaign = doc.createElement('div'); fldCampaign.className = 'stres-field';
    const lblCamp = doc.createElement('label'); lblCamp.setAttribute('for','stres-campaign-id'); lblCamp.textContent = 'Campaign ID';
    const inpCamp = doc.createElement('input'); inpCamp.type = 'text'; inpCamp.id = 'stres-campaign-id'; inpCamp.placeholder = 'default-campaign'; inpCamp.value = settings.campaignId || '';
    fldCampaign.appendChild(lblCamp); fldCampaign.appendChild(inpCamp);

    const fldWp = doc.createElement('div'); fldWp.className = 'stres-field';
    const lblWp = doc.createElement('label'); lblWp.setAttribute('for','stres-worldpack-id'); lblWp.textContent = 'Worldpack ID';
    const inpWp = doc.createElement('input'); inpWp.type = 'text'; inpWp.id = 'stres-worldpack-id'; inpWp.placeholder = 'euterra-test-0.35.2'; inpWp.value = settings.worldpackId || '';
    fldWp.appendChild(lblWp); fldWp.appendChild(inpWp);

    const fldRegion = doc.createElement('div'); fldRegion.className = 'stres-field';
    const lblRegion = doc.createElement('label'); lblRegion.setAttribute('for','stres-region-id'); lblRegion.textContent = 'Region ID';
    const inpRegion = doc.createElement('input'); inpRegion.type = 'text'; inpRegion.id = 'stres-region-id'; inpRegion.placeholder = 'veyra-capital / greenwood-edge'; inpRegion.value = (settings.world?.regionId) || '';
    fldRegion.appendChild(lblRegion); fldRegion.appendChild(inpRegion);

    const fldLoc = doc.createElement('div'); fldLoc.className = 'stres-field';
    const lblLoc = doc.createElement('label'); lblLoc.setAttribute('for','stres-location-name'); lblLoc.textContent = 'Location Label';
    const inpLoc = doc.createElement('input'); inpLoc.type = 'text'; inpLoc.id = 'stres-location-name'; inpLoc.placeholder = 'Veyrion Citadel'; inpLoc.value = (settings.world?.locationName) || '';
    fldLoc.appendChild(lblLoc); fldLoc.appendChild(inpLoc);

    const fldChar = doc.createElement('div'); fldChar.className = 'stres-field';
    const lblChar = doc.createElement('label'); lblChar.setAttribute('for','stres-character-id'); lblChar.textContent = 'Character ID';
    const inpChar = doc.createElement('input'); inpChar.type = 'text'; inpChar.id = 'stres-character-id'; inpChar.placeholder = '0000-...'; inpChar.value = settings.characterId || '';
    fldChar.appendChild(lblChar); fldChar.appendChild(inpChar);

    const fldHdr = doc.createElement('div'); fldHdr.className = 'stres-field';
    const lblHdr = doc.createElement('label'); lblHdr.textContent = 'Scene Header';
    const cbHdr = doc.createElement('input'); cbHdr.type = 'checkbox'; cbHdr.id = 'stres-header-enabled'; cbHdr.checked = !!(settings.world?.header?.enabled ?? true);
    const hdrWrap = doc.createElement('div'); hdrWrap.style.display='flex'; hdrWrap.style.alignItems='center'; hdrWrap.style.gap='8px';
    const hdrTmpl = doc.createElement('input'); hdrTmpl.type = 'text'; hdrTmpl.id = 'stres-header-tmpl'; hdrTmpl.placeholder = '📍 {location} • {date} • {timeOfDay} • {weather}'; hdrTmpl.style.flex='1'; hdrTmpl.value = (settings.world?.header?.template) || defaultSettings.world.header.template;
    hdrWrap.append(cbHdr, hdrTmpl);
    fldHdr.appendChild(lblHdr); fldHdr.appendChild(hdrWrap);

    secConn.appendChild(hConn); secConn.appendChild(fldApi); secConn.appendChild(fldCampaign); secConn.appendChild(fldWp); secConn.appendChild(fldRegion); secConn.appendChild(fldLoc); secConn.appendChild(fldChar); secConn.appendChild(fldHdr);
    content.appendChild(secConn);

    // Token Budgets section (simple controls)
    const secBud = doc.createElement('div'); secBud.className = 'stres-settings__section';
    const hBud = doc.createElement('h3'); hBud.textContent = 'Token Budgets';
    const fldProf = doc.createElement('div'); fldProf.className = 'stres-field';
    const lblProf = doc.createElement('label'); lblProf.textContent = 'Profile';
    const selProf = doc.createElement('select'); selProf.id = 'stres-budget-profile';
    ;['Lean','Balanced','Rich','Custom'].forEach(p=>{ const o = doc.createElement('option'); o.value = p; o.textContent = p; selProf.appendChild(o); });
    fldProf.append(lblProf, selProf);

    const fldTarget = doc.createElement('div'); fldTarget.className = 'stres-field';
    const lblTarget = doc.createElement('label'); lblTarget.textContent = 'Context Target';
    const inpTarget = doc.createElement('input'); inpTarget.type='number'; inpTarget.min='200'; inpTarget.step='50';
    fldTarget.append(lblTarget, inpTarget);

    const fldCush = doc.createElement('div'); fldCush.className = 'stres-field';
    const lblCush = doc.createElement('label'); lblCush.textContent = 'Cushion';
    const inpCush = doc.createElement('input'); inpCush.type='number'; inpCush.min='0'; inpCush.step='10';
    fldCush.append(lblCush, inpCush);

    const fldRes = doc.createElement('div'); fldRes.className = 'stres-field';
    const lblRes = doc.createElement('label'); lblRes.textContent = 'Reserve';
    const inpRes = doc.createElement('input'); inpRes.type='number'; inpRes.min='0'; inpRes.step='10';
    fldRes.append(lblRes, inpRes);

    const fldHdrMax = doc.createElement('div'); fldHdrMax.className = 'stres-field';
    const lblHdrMax = doc.createElement('label'); lblHdrMax.textContent = 'Header max tokens';
    const inpHdrMax = doc.createElement('input'); inpHdrMax.type='number'; inpHdrMax.min='20'; inpHdrMax.step='10';
    fldHdrMax.append(lblHdrMax, inpHdrMax);

    const fldPriMax = doc.createElement('div'); fldPriMax.className = 'stres-field';
    const lblPriMax = doc.createElement('label'); lblPriMax.textContent = 'Primer max tokens';
    const inpPriMax = doc.createElement('input'); inpPriMax.type='number'; inpPriMax.min='50'; inpPriMax.step='50';
    fldPriMax.append(lblPriMax, inpPriMax);

    const fldPriEn = doc.createElement('div'); fldPriEn.className = 'stres-field';
    const lblPriEn = doc.createElement('label'); lblPriEn.textContent = 'Enable Primer';
    const cbPriEn = doc.createElement('input'); cbPriEn.type='checkbox';
    fldPriEn.append(lblPriEn, cbPriEn);

    // RAG controls
    const fldRagEn = doc.createElement('div'); fldRagEn.className = 'stres-field';
    const lblRagEn = doc.createElement('label'); lblRagEn.textContent = 'Enable RAG';
    const cbRagEn = doc.createElement('input'); cbRagEn.type='checkbox';
    fldRagEn.append(lblRagEn, cbRagEn);

    const fldRagTopK = doc.createElement('div'); fldRagTopK.className = 'stres-field';
    const labRagTopK = doc.createElement('label'); labRagTopK.textContent = 'RAG topK';
    const inpRagTopK = doc.createElement('input'); inpRagTopK.type='number'; inpRagTopK.min='1'; inpRagTopK.max='6'; inpRagTopK.step='1';
    fldRagTopK.append(labRagTopK, inpRagTopK);

    const fldRagMax = doc.createElement('div'); fldRagMax.className = 'stres-field';
    const labRagMax = doc.createElement('label'); labRagMax.textContent = 'RAG max tokens';
    const inpRagMax = doc.createElement('input'); inpRagMax.type='number'; inpRagMax.min='50'; inpRagMax.max='800'; inpRagMax.step='10';
    fldRagMax.append(labRagMax, inpRagMax);

    secBud.append(hBud, fldProf, fldTarget, fldCush, fldRes, fldHdrMax, fldPriMax, fldPriEn, fldRagEn, fldRagTopK, fldRagMax);
    content.appendChild(secBud);

    // Footer
    const footer = doc.createElement('div'); footer.className = 'stres-settings__footer';
    const notice = doc.createElement('div'); notice.className = 'stres-notice'; notice.id = 'stres-settings-notice'; notice.dataset.visible = 'false'; notice.textContent = '';

    const btnTest = doc.createElement('button'); btnTest.className = 'stres-btn stres-btn--ghost'; btnTest.textContent = 'Test Connection';
    const btnReset = doc.createElement('button'); btnReset.className = 'stres-btn stres-btn--danger'; btnReset.textContent = 'Reset';
    const btnLoadWp = doc.createElement('button'); btnLoadWp.className = 'stres-btn stres-btn--ghost'; btnLoadWp.textContent = 'Load Worldpack';
    const btnSave = doc.createElement('button'); btnSave.className = 'stres-btn'; btnSave.textContent = 'Save';

    // Wire handlers
    async function testConnection(url) {
      let ok = false, msg = '';
      try {
        const u = (url || '').replace(/\/$/, '') || 'http://localhost:3001';
        const res = await fetch(u + '/health', { method: 'GET' });
        if (res.ok) {
          const j = await res.json().catch(()=>({}));
          ok = true; msg = `Healthy (${j.version || 'unknown'})`;
        } else {
          msg = `HTTP ${res.status}`;
        }
      } catch (e) {
        msg = String(e?.message || e);
      }
      notice.textContent = ok ? `✅ ${msg}` : `❌ ${msg}`;
      notice.dataset.visible = 'true';
      setTimeout(()=>{ notice.dataset.visible = 'false'; }, 3500);
      return ok;
    }

    btnTest.addEventListener('click', () => {
      testConnection(inpApi.value);
    });

    btnLoadWp.addEventListener('click', async () => {
      const id = (inpWp.value || '').trim();
      if (!id) { notice.textContent = 'Enter a Worldpack ID first'; notice.dataset.visible = 'true'; setTimeout(()=>{ notice.dataset.visible = 'false'; }, 2000); return; }
      try {
        const res = await state.stresClient.loadWorldpackById(id);
        notice.textContent = `Loaded ${res.id}@${res.version}`;
        // Attempt auto-primer injection into prompt after load
        try { await STRESPrompts.injectPrimerInPrompt(true); } catch {}
      } catch (e) { notice.textContent = `Error: ${e?.message || e}`; }
      notice.dataset.visible = 'true'; setTimeout(()=>{ notice.dataset.visible = 'false'; }, 2500);
    });

    btnReset.addEventListener('click', () => {
      inpApi.value = defaultSettings.serverUrl;
      inpCamp.value = '';
      inpChar.value = '';
      notice.textContent = 'Defaults restored (not saved)';
      notice.dataset.visible = 'true'; setTimeout(()=>{ notice.dataset.visible = 'false'; }, 2500);
    });

    btnSave.addEventListener('click', async () => {
      const url = inpApi.value.trim().replace(/\/$/, '');
      const s = window.extension_settings || (window.SillyTavern?.getContext?.().extensionSettings);
      s[extensionName] = s[extensionName] || {};
      s[extensionName].serverUrl = url || defaultSettings.serverUrl;
      s[extensionName].campaignId = inpCamp.value.trim() || null;
      s[extensionName].worldpackId = inpWp.value.trim() || null;
      s[extensionName].characterId = inpChar.value.trim() || null;
      s[extensionName].world = s[extensionName].world || structuredClone(defaultSettings.world);
      s[extensionName].world.regionId = inpRegion.value.trim() || null;
      s[extensionName].world.locationName = inpLoc.value.trim() || '';
      s[extensionName].world.header = s[extensionName].world.header || structuredClone(defaultSettings.world.header);
      s[extensionName].world.header.enabled = !!cbHdr.checked;
      s[extensionName].world.header.template = hdrTmpl.value || defaultSettings.world.header.template;
      // Save budget settings
      s[extensionName].budget = s[extensionName].budget || structuredClone(defaultSettings.budget);
      s[extensionName].budget.profile = selProf.value || 'Custom';
      s[extensionName].budget.contextTarget = Number(inpTarget.value || s[extensionName].budget.contextTarget || 2000);
      s[extensionName].budget.cushion = Number(inpCush.value || s[extensionName].budget.cushion || 0);
      s[extensionName].budget.reserve = Number(inpRes.value || s[extensionName].budget.reserve || 0);
      s[extensionName].budget.components = s[extensionName].budget.components || {};
      s[extensionName].budget.components.header = s[extensionName].budget.components.header || {};
      s[extensionName].budget.components.header.maxTokens = Number(inpHdrMax.value || s[extensionName].budget.components.header.maxTokens || 120);
      s[extensionName].budget.components.primer = s[extensionName].budget.components.primer || {};
      s[extensionName].budget.components.primer.maxTokens = Number(inpPriMax.value || s[extensionName].budget.components.primer.maxTokens || 600);
      s[extensionName].budget.components.primer.enabled = !!cbPriEn.checked;
      s[extensionName].budget.components.rag = s[extensionName].budget.components.rag || {};
      s[extensionName].budget.components.rag.maxTokens = Number(inpRagMax.value || s[extensionName].budget.components.rag.maxTokens || 300);
      // RAG simple
      s[extensionName].rag = s[extensionName].rag || structuredClone(defaultSettings.rag);
      s[extensionName].rag.enabled = !!cbRagEn.checked;
      s[extensionName].budget.components.rag.enabled = !!cbRagEn.checked;
      s[extensionName].rag.topK = Number(inpRagTopK.value || s[extensionName].rag.topK || 2);
      s[extensionName].rag.maxTokens = Number(inpRagMax.value || s[extensionName].rag.maxTokens || 300);
      try {
        const ctx = window.SillyTavern?.getContext?.();
        (ctx?.saveSettingsDebounced || window.saveSettingsDebounced)?.();
      } catch {}
      try { if (state.stresClient) state.stresClient.baseUrl = s[extensionName].serverUrl; } catch {}
      notice.textContent = 'Settings saved';
      notice.dataset.visible = 'true'; setTimeout(()=>{ notice.dataset.visible = 'false'; }, 2000);
      // Optional: quick probe
      setTimeout(()=>{ testConnection(url); }, 100);
      try { await STRESPrompts.refreshSceneHeaderInPrompt(); } catch {}
    });

    footer.appendChild(btnTest);
    footer.appendChild(btnLoadWp);
    footer.appendChild(btnReset);
    footer.appendChild(btnSave);

    panel.appendChild(header);
    panel.appendChild(content);
    panel.appendChild(footer);
    settingsHost.appendChild(panel);

    // Notice placement under footer
    settingsHost.appendChild(notice);

    // Public helpers to sync UI with settings
    window.STRES.refreshSettingsUI = () => {
      const cur = (window.extension_settings?.[extensionName]) || {};
      inpApi.value = cur.serverUrl || defaultSettings.serverUrl;
      inpCamp.value = cur.campaignId || '';
      inpChar.value = cur.characterId || '';
      const b = cur.budget || defaultSettings.budget;
      selProf.value = b.profile || 'Custom';
      inpTarget.value = b.contextTarget ?? 2000;
      inpCush.value = b.cushion ?? 0;
      inpRes.value = b.reserve ?? 0;
      inpHdrMax.value = (b.components?.header?.maxTokens) ?? 120;
      inpPriMax.value = (b.components?.primer?.maxTokens) ?? 600;
      cbPriEn.checked = !!(b.components?.primer?.enabled ?? true);
      const r = cur.rag || defaultSettings.rag;
      cbRagEn.checked = !!r.enabled;
      inpRagTopK.value = r.topK ?? 2;
      inpRagMax.value = r.maxTokens ?? 300;
    };
    // Initialize fields from persisted settings
    try { window.STRES.refreshSettingsUI(); } catch {}
  })();

  // Tabbed Settings UI (Phase 9)
  (function renderTabbedSettingsPanel(){
    const ctx = window.SillyTavern?.getContext?.();
    const s = (window.extension_settings?.[extensionName]) || structuredClone(defaultSettings);
    const t = (key) => (ctx?.t ? ctx.t(key) : key);

    const panel = doc.createElement('div');
    panel.id = 'stres-settings-tabs-panel';
    panel.className = 'stres-settings-panel stres-settings-panel--tabs';
    panel.setAttribute('aria-hidden', 'true');
    panel.style.display = 'none';
    panel.style.maxWidth = '780px';
    panel.style.background = 'var(--stres-surface)';
    panel.style.border = '1px solid var(--stres-border)';
    panel.style.borderRadius = '10px';
    panel.style.position = 'fixed';
    panel.style.right = '12px';
    panel.style.bottom = '56px';
    panel.style.zIndex = '62';
    panel.style.boxShadow = '0 6px 20px rgba(0,0,0,0.35)';
    panel.style.display = 'flex';
    panel.style.flexDirection = 'column';
    panel.style.maxHeight = '70vh';
    panel.style.overflow = 'hidden';

    // Header with Popout
    const header = doc.createElement('div'); header.className = 'stres-settings__header'; header.style.display='flex'; header.style.alignItems='center'; header.style.justifyContent='space-between'; header.style.padding='10px 12px'; header.style.borderBottom='1px solid var(--stres-border)';
    const title = doc.createElement('strong'); title.textContent = 'STRES Settings';
    const actions = doc.createElement('div'); actions.style.display='flex'; actions.style.gap='6px';
    const btnPop = doc.createElement('button'); btnPop.className='stres-btn'; btnPop.textContent='Pop out'; btnPop.title='Pop out';
    const btnClose = doc.createElement('button'); btnClose.className='stres-btn stres-btn--icon'; btnClose.textContent='✕'; btnClose.title='Close';
    btnClose.addEventListener('click', ()=> setSettingsVisibility(panel, false));
    let popped = false;
    btnPop.addEventListener('click', ()=>{
      popped = !popped;
      panel.style.maxHeight = popped ? '85vh' : '70vh';
      panel.style.width = popped ? '780px' : '';
      panel.style.right = popped ? '12px' : '12px';
      panel.style.bottom = popped ? '12px' : '56px';
    });
    actions.append(btnPop, btnClose); header.append(title, actions);

    // Tabs bar
    const tabs = doc.createElement('div'); tabs.style.display='flex'; tabs.style.gap='4px'; tabs.style.padding='8px 8px 0 8px'; tabs.style.flexWrap='wrap';
    const tabBtn = (id, label) => { const b = doc.createElement('button'); b.className='stres-btn'; b.dataset.tab=id; b.textContent=label; b.style.padding='6px 10px'; return b; };
    const categories = [
      ['general','General'],
      ['budgets','Budgets'],
      ['primer','Primer'],
      ['header','Header'],
      ['rag','RAG'],
      ['summaries','Summaries'],
      ['npc','NPC'],
      ['combat','Combat'],
      ['tools','Tools'],
      ['advanced','Advanced']
    ];
    const btns = categories.map(([id,label]) => tabBtn(id,label)); btns.forEach(b=>tabs.appendChild(b));

    // Panels container
    const body = doc.createElement('div'); body.style.display='grid'; body.style.gridTemplateColumns='1fr'; body.style.gap='8px'; body.style.padding='8px'; body.style.overflow='auto'; body.style.flex='1';

    // Helpers for get/set
    const get = (obj, path, dflt) => { try { return path.split('.').reduce((o,k)=> (o&&k in o)?o[k]:undefined, obj) ?? dflt; } catch { return dflt; } };
    const set = (obj, path, val) => { const ks = path.split('.'); let o = obj; for (let i=0;i<ks.length-1;i++){ if(!o[ks[i]] || typeof o[ks[i]]!=='object') o[ks[i]] = {}; o=o[ks[i]]; } o[ks[ks.length-1]] = val; };
    const save = () => { try { const c=window.SillyTavern?.getContext?.(); (c?.saveSettingsDebounced||window.saveSettingsDebounced)?.(); } catch {} };
    const onChange = async (path, transform=(x)=>x, refresh=()=>{}) => (ev)=>{ const v = transform(ev.target?.type==='checkbox' ? ev.target.checked : ev.target.value); set(window.extension_settings[extensionName], path, v); save(); try{ refresh(); }catch{} };
    const row = (label, input, help) => { const wrap = doc.createElement('div'); wrap.style.display='grid'; wrap.style.gridTemplateColumns='200px 1fr'; wrap.style.alignItems='center'; wrap.style.gap='8px'; wrap.style.padding='2px 0'; const lab = doc.createElement('label'); lab.textContent=label; const r = doc.createElement('div'); r.appendChild(input); if (help){ const small=doc.createElement('div'); small.style.opacity='0.7'; small.style.fontSize='12px'; small.textContent=help; r.appendChild(small);} wrap.append(lab,r); return wrap; };
    const mkInput = (type, value, attrs={})=>{ const el=doc.createElement('input'); el.type=type; el.value=value ?? ''; Object.assign(el, attrs); return el; };
    const mkCheck = (checked)=>{ const el=doc.createElement('input'); el.type='checkbox'; el.checked=!!checked; return el; };
    const mkSelect = (value, opts)=>{ const el=doc.createElement('select'); (opts||[]).forEach(([v,l])=>{const o=doc.createElement('option'); o.value=v; o.textContent=l; el.appendChild(o);}); el.value=value; return el; };

    // Category builders
    const buildGeneral = ()=>{
      body.innerHTML='';
      const api = mkInput('text', get(s,'serverUrl',''), { placeholder:'http://localhost:3001' }); api.addEventListener('change', onChange('serverUrl', (v)=>String(v).trim().replace(/\/$/, ''), ()=>{ try{ if(state.stresClient) state.stresClient.baseUrl = window.extension_settings[extensionName].serverUrl; }catch{} }));
      const camp = mkInput('text', get(s,'campaignId','')); camp.addEventListener('change', onChange('campaignId'));
      const wp = mkInput('text', get(s,'worldpackId','')); wp.addEventListener('change', onChange('worldpackId'));
      const region = mkInput('text', get(s,'world.regionId','')); region.addEventListener('change', onChange('world.regionId'));
      const loc = mkInput('text', get(s,'world.locationName','')); loc.addEventListener('change', onChange('world.locationName'));
      const primerOn = mkCheck(get(s,'autoInjection.primer',true)); primerOn.addEventListener('change', onChange('autoInjection.primer'));
      const hud = mkCheck(get(s,'ui.showHUD',true)); hud.addEventListener('change', onChange('ui.showHUD'));
      body.append(
        row('API Base URL', api),
        row('Campaign ID', camp),
        row('Worldpack ID', wp),
        row('Region ID', region),
        row('Location Label', loc),
        row('Auto-inject Primer', primerOn, 'Send World Primer automatically after worldpack load'),
        row('Show HUD', hud)
      );
    };
    const buildBudgets = ()=>{
      body.innerHTML='';
      const profile = mkSelect(get(s,'budget.profile','Balanced'), [['Lean','Lean'],['Balanced','Balanced'],['Rich','Rich'],['Custom','Custom']]);
      profile.addEventListener('change', (e)=>{ const v=e.target.value; if (['Lean','Balanced','Rich'].includes(v)) STRESBudget.applyProfile(v); else { set(window.extension_settings[extensionName],'budget.profile',v); save(); } });
      const ctxT = mkInput('number', get(s,'budget.contextTarget',2000), { min:200, step:50 }); ctxT.addEventListener('change', onChange('budget.contextTarget', Number));
      const cushion = mkInput('number', get(s,'budget.cushion',200), { min:0, step:10 }); cushion.addEventListener('change', onChange('budget.cushion', Number));
      const reserve = mkInput('number', get(s,'budget.reserve',200), { min:0, step:10 }); reserve.addEventListener('change', onChange('budget.reserve', Number));
      const guardMax = mkInput('number', get(s,'budget.components.guard.maxTokens',60), { min:20, step:5 }); guardMax.addEventListener('change', onChange('budget.components.guard.maxTokens', Number, ()=>STRESGuard.refreshGuardrailInPrompt()));
      const headerMax = mkInput('number', get(s,'budget.components.header.maxTokens',120), { min:30, step:10 }); headerMax.addEventListener('change', onChange('budget.components.header.maxTokens', Number, ()=>STRESPrompts.refreshSceneHeaderInPrompt()));
      const primerMax = mkInput('number', get(s,'budget.components.primer.maxTokens',600), { min:50, step:50 }); primerMax.addEventListener('change', onChange('budget.components.primer.maxTokens', Number));
      const ragMax = mkInput('number', get(s,'budget.components.rag.maxTokens',300), { min:50, step:10 }); ragMax.addEventListener('change', onChange('budget.components.rag.maxTokens', Number));
      body.append(
        row('Profile', profile),
        row('Context Target', ctxT,'Approximate total prompt budget for context items'),
        row('Cushion', cushion),
        row('Reserve', reserve),
        row('Guard max tokens', guardMax),
        row('Header max tokens', headerMax),
        row('Primer max tokens', primerMax),
        row('RAG max tokens', ragMax)
      );
    };
    const buildPrimer = ()=>{
      body.innerHTML='';
      const enabled = mkCheck(get(s,'budget.components.primer.enabled',true)); enabled.addEventListener('change', onChange('budget.components.primer.enabled'));
      body.append(row('Enable Primer', enabled, 'Allow sending World Primer when budget permits'));
    };
    const buildHeader = ()=>{
      body.innerHTML='';
      const enabled = mkCheck(get(s,'world.header.enabled',true)); enabled.addEventListener('change', onChange('world.header.enabled', x=>!!x, ()=>STRESPrompts.refreshSceneHeaderInPrompt()));
      const tmpl = mkInput('text', get(s,'world.header.template', defaultSettings.world.header.template)); tmpl.style.width='100%'; tmpl.addEventListener('change', onChange('world.header.template', v=>String(v||defaultSettings.world.header.template), ()=>STRESPrompts.refreshSceneHeaderInPrompt()));
      body.append(
        row('Enable Header', enabled),
        row('Header Template', tmpl, 'Placeholders: {location}, {date}, {timeOfDay}, {weather}')
      );
    };
    const buildRag = ()=>{
      body.innerHTML='';
      const enabled = mkCheck(get(s,'rag.enabled',false)); enabled.addEventListener('change', (e)=>{ set(window.extension_settings[extensionName],'rag.enabled',e.target.checked); set(window.extension_settings[extensionName],'budget.components.rag.enabled',e.target.checked); save(); STRESPrompts.injectRAGInPrompt(); });
      const topK = mkInput('number', get(s,'rag.topK',2), { min:1, max:6, step:1 }); topK.addEventListener('change', onChange('rag.topK', Number));
      const maxT = mkInput('number', get(s,'rag.maxTokens',300), { min:50, step:10 }); maxT.addEventListener('change', onChange('rag.maxTokens', Number));
      const pos = mkSelect(get(s,'rag.position','in_prompt'), [['in_prompt','In Prompt'],['in_chat','In Chat']]); pos.addEventListener('change', onChange('rag.position', String, ()=>STRESPrompts.injectRAGInPrompt()));
      const depth = mkInput('number', get(s,'rag.depth',0), { min:0, step:1 }); depth.addEventListener('change', onChange('rag.depth', Number, ()=>STRESPrompts.injectRAGInPrompt()));
      body.append(
        row('Enable RAG', enabled),
        row('TopK', topK),
        row('Max Tokens', maxT),
        row('Position', pos),
        row('Depth', depth)
      );
    };
    const buildSummaries = ()=>{
      body.innerHTML='';
      const enabled = mkCheck(get(s,'summary.enabled',true)); enabled.addEventListener('change', onChange('summary.enabled'));
      const inject = mkCheck(get(s,'summary.inject',false)); inject.addEventListener('change', onChange('summary.inject'));
      const every = mkInput('number', get(s,'summary.everyTurns',6), { min:1, step:1 }); every.addEventListener('change', onChange('summary.everyTurns', Number));
      const windowSize = mkInput('number', get(s,'summary.windowSize',12), { min:4, step:1 }); windowSize.addEventListener('change', onChange('summary.windowSize', Number));
      const maxItems = mkInput('number', get(s,'summary.maxItems',10), { min:1, step:1 }); maxItems.addEventListener('change', onChange('summary.maxItems', Number));
      body.append(
        row('Enable Summaries', enabled),
        row('Inject into Prompt', inject),
        row('Every N Turns', every),
        row('Window Size', windowSize),
        row('Max Items', maxItems)
      );
    };
    const buildNPC = ()=>{
      body.innerHTML='';
      const enabled = mkCheck(get(s,'npc.enabled',true)); enabled.addEventListener('change', onChange('npc.enabled'));
      const inject = mkCheck(get(s,'npc.inject',true)); inject.addEventListener('change', onChange('npc.inject'));
      const topK = mkInput('number', get(s,'npc.topK',2), { min:1, step:1 }); topK.addEventListener('change', onChange('npc.topK', Number));
      const maxT = mkInput('number', get(s,'npc.maxTokens',400), { min:50, step:10 }); maxT.addEventListener('change', onChange('npc.maxTokens', Number));
      const maxNPCs = mkInput('number', get(s,'npc.maxNPCs',2), { min:1, step:1 }); maxNPCs.addEventListener('change', onChange('npc.maxNPCs', Number));
      body.append(
        row('Enable NPC Memory', enabled),
        row('Inject Persona/Memory', inject),
        row('TopK', topK),
        row('Max Tokens', maxT),
        row('Max NPCs', maxNPCs)
      );
    };
    const buildCombat = ()=>{
      body.innerHTML='';
      const modeSel = mkSelect(window.SillyTavern?.getContext?.().chatMetadata?.stres?.mode || 'story', [['story','Story'],['explore','Explore'],['combat','Combat']]);
      modeSel.addEventListener('change', async (e)=>{ await STRESCombat.setMode(e.target.value); });
      const hdrOn = mkCheck(get(s,'combat.header.enabled',true)); hdrOn.addEventListener('change', onChange('combat.header.enabled', x=>!!x, ()=>STRESCombat.refreshCombatHeaderInPrompt()));
      const tmpl = mkInput('text', get(s,'combat.header.template', defaultSettings.combat.header.template)); tmpl.style.width='100%'; tmpl.addEventListener('change', onChange('combat.header.template', String, ()=>STRESCombat.refreshCombatHeaderInPrompt()));
      const src = mkInput('text', get(s,'combat.npcModel.chat_completion_source','openrouter')); src.addEventListener('change', onChange('combat.npcModel.chat_completion_source', String));
      const model = mkInput('text', get(s,'combat.npcModel.model','gpt-4o-mini')); model.addEventListener('change', onChange('combat.npcModel.model', String));
      const maxTok = mkInput('number', get(s,'combat.npcModel.max_tokens',140), { min:32, step:4 }); maxTok.addEventListener('change', onChange('combat.npcModel.max_tokens', Number));
      body.append(
        row('Mode', modeSel),
        row('Combat Header', hdrOn),
        row('Header Template', tmpl),
        row('NPC Reply Source', src),
        row('NPC Reply Model', model),
        row('NPC Reply Max Tokens', maxTok)
      );
    };
    const buildTools = ()=>{
      body.innerHTML='';
      const supported = !!ctx?.isToolCallingSupported?.();
      const can = !!ctx?.canPerformToolCalls?.('chat');
      const TM = ctx?.ToolManager;
      const registered = Array.isArray(TM?.tools) ? TM.tools.map(t=>t?.displayName||t?.name).join(', ') : '(unknown)';

      const en = mkCheck(get(s,'tools.enabled',true)); en.addEventListener('change', (e)=>{ set(window.extension_settings[extensionName],'tools.enabled', e.target.checked); save(); STRESTools.refresh(ctx); });
      const tWhere = mkCheck(get(s,'tools.where',true)); tWhere.addEventListener('change', (e)=>{ set(window.extension_settings[extensionName],'tools.where', e.target.checked); save(); STRESTools.refresh(ctx); });
      const tTick = mkCheck(get(s,'tools.tick',true)); tTick.addEventListener('change', (e)=>{ set(window.extension_settings[extensionName],'tools.tick', e.target.checked); save(); STRESTools.refresh(ctx); });
      const tState = mkCheck(get(s,'tools.update_state',true)); tState.addEventListener('change', (e)=>{ set(window.extension_settings[extensionName],'tools.update_state', e.target.checked); save(); STRESTools.refresh(ctx); });
      const tStart = mkCheck(get(s,'tools.start_scenario',true)); tStart.addEventListener('change', (e)=>{ set(window.extension_settings[extensionName],'tools.start_scenario', e.target.checked); save(); STRESTools.refresh(ctx); });
      const tNpc = mkCheck(get(s,'tools.npc_reply',true)); tNpc.addEventListener('change', (e)=>{ set(window.extension_settings[extensionName],'tools.npc_reply', e.target.checked); save(); STRESTools.refresh(ctx); });
      const tDice = mkCheck(get(s,'tools.dice',true)); tDice.addEventListener('change', (e)=>{ set(window.extension_settings[extensionName],'tools.dice', e.target.checked); save(); STRESTools.refresh(ctx); });

      // Status rows
      const status = doc.createElement('div'); status.style.opacity='0.8'; status.style.fontSize='12px'; status.textContent = `Supported: ${supported} • Can Perform: ${can} • Registered: ${registered}`;

      body.append(
        row('Enable Tools', en, 'Globally enable STRES function tools'),
        row('Where', tWhere, 'Return current world/scene state to the model'),
        row('Tick', tTick, 'Advance sim time by a duration'),
        row('Update State', tState, 'Extract structured story state JSON'),
        row('Start Scenario', tStart, 'Start scenario by id/index'),
        row('NPC Reply', tNpc, 'Generate NPC reply with a cheap model'),
        row('Dice', tDice, 'Roll dice and return results'),
        status
      );
    };
    const buildAdvanced = ()=>{
      body.innerHTML='';
      const guardOn = mkCheck(get(s,'guard.enabled',true)); guardOn.addEventListener('change', onChange('guard.enabled', x=>!!x, ()=>STRESGuard.refreshGuardrailInPrompt()));
      const guardT = mkInput('text', get(s,'guard.template', defaultSettings.guard.template)); guardT.style.width='100%'; guardT.addEventListener('change', onChange('guard.template', String, ()=>STRESGuard.refreshGuardrailInPrompt()));
      const costOn = mkCheck(get(s,'cost.enabled',true)); costOn.addEventListener('change', (e)=>{ set(window.extension_settings[extensionName],'cost.enabled',e.target.checked); save(); STRESCost.refreshBadge(); });
      const costBadge = mkCheck(get(s,'cost.showBadge',true)); costBadge.addEventListener('change', (e)=>{ set(window.extension_settings[extensionName],'cost.showBadge',e.target.checked); save(); STRESPrompts.refreshSceneHeaderInPrompt(); });
      const costMode = (()=>{ const sel = mkSelect(['poll','on_turn'], get(s,'cost.mode','poll')); sel.addEventListener('change', (e)=>{ set(window.extension_settings[extensionName],'cost.mode', e.target.value); save(); STRESCost.maybeSchedule(); }); return sel; })();
      body.append(
        row('Crosstalk Guard', guardOn),
        row('Guard Template', guardT),
        row('Cost Awareness', costOn, 'Enable OpenRouter cost/balance awareness'),
        row('Show Cost in Header', costBadge),
        row('Cost Update Mode', costMode, 'poll = background; on_turn = after you send a message')
      );
    };

    // Tab switcher
    const mapping = { general: buildGeneral, budgets: buildBudgets, primer: buildPrimer, header: buildHeader, rag: buildRag, summaries: buildSummaries, npc: buildNPC, combat: buildCombat, tools: buildTools, advanced: buildAdvanced };
    let active = 'general';
    const selectTab = (id)=>{ active = id; btns.forEach(b=>{ b.classList.toggle('active', b.dataset.tab===id); }); (mapping[id]||buildGeneral)(); };
    btns.forEach(b=> b.addEventListener('click', ()=> selectTab(b.dataset.tab)));
    selectTab('general');

    panel.append(header, tabs, body);
    settingsHost.appendChild(panel);
  })();

  // Small floating toggle button (in case user can’t find the panel)
  (function addSettingsToggleButton(){
    try {
      const btnId = 'stres-settings-toggle';
      if (doc.getElementById(btnId)) return;
      const btn = doc.createElement('button');
      btn.id = btnId;
      btn.className = 'stres-btn stres-btn--icon';
      btn.title = 'STRES Settings';
      btn.textContent = '⚙';
      btn.style.position = 'fixed';
      btn.style.right = '1rem';
      btn.style.bottom = '1rem';
      btn.style.zIndex = '61';
      btn.style.background = 'var(--stres-surface)';
      btn.style.border = '1px solid var(--stres-border)';
      btn.style.borderRadius = '999px';
      btn.style.width = '36px';
      btn.style.height = '36px';
      btn.style.lineHeight = '34px';
      btn.addEventListener('click', () => window.STRES?.toggleSettings?.());
      root.appendChild(btn);
    } catch {}
  })();

  console.log("[STRES] UI components initialized");
  // Start observing chat to preface LLM messages with header
  try { STRESWorld.observeChat(); } catch {}
}

// Hook into chat input for additional processing
function hookChatInput() {
  const chatForm = document.querySelector('#send_form');
  if (chatForm) {
    const originalSubmit = chatForm.onsubmit;
    chatForm.onsubmit = function(e) {
      const input = document.querySelector('#send_textarea');
      if (input && STRESChat.processMessage(input.value)) {
        e.preventDefault();
        input.value = '';
        return false;
      }
      if (originalSubmit) {
        return originalSubmit.call(this, e);
      }
    };
    console.log("[STRES] Chat input hooked successfully");
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initializeExtension().then(() => {
      setTimeout(hookChatInput, 1000); // Delay to ensure SillyTavern is fully loaded
      try { integrateWithExtensionsManager(); } catch {}
    });
  });
} else {
  initializeExtension().then(() => {
    setTimeout(hookChatInput, 1000);
    try { integrateWithExtensionsManager(); } catch {}
  });
}

// Register settings panel in SillyTavern's Extensions manager
function integrateWithExtensionsManager() {
  const doc = document;
  const settingsKey = `${extensionName}`;
  const drawerId = `${settingsKey}-settings-drawer`;

  function render() {
    if (doc.getElementById(drawerId)) return; // already added
    const container = doc.getElementById(`${settingsKey}-container`) || doc.getElementById('extensions_settings2');
    if (!container) return;

    // Drawer structure mirrors ST style
    const drawer = doc.createElement('div');
    drawer.id = drawerId;
    drawer.classList.add('inline-drawer');

    const toggle = doc.createElement('div');
    toggle.classList.add('inline-drawer-toggle','inline-drawer-header');
    const title = doc.createElement('b'); title.textContent = 'STRES';
    const icon = doc.createElement('div'); icon.classList.add('inline-drawer-icon','fa-solid','fa-circle-chevron-down','down');
    toggle.append(title, icon);

    const content = doc.createElement('div');
    content.classList.add('inline-drawer-content');

    // Form fields
    const fld = (labelText, inputEl) => {
      const wrap = doc.createElement('div'); wrap.style.margin = '6px 0';
      const label = doc.createElement('label'); label.textContent = labelText; label.style.display='block'; label.style.fontSize='12px'; label.style.opacity='0.8';
      wrap.append(label, inputEl); return wrap;
    };
    const api = doc.createElement('input'); api.type = 'text'; api.id = 'stres-em-api-url'; api.placeholder = 'http://localhost:3001'; api.style.width='100%';
    const camp = doc.createElement('input'); camp.type = 'text'; camp.id = 'stres-em-campaign-id'; camp.placeholder = 'default-campaign'; camp.style.width='100%';
    const wp = doc.createElement('input'); wp.type = 'text'; wp.id = 'stres-em-worldpack-id'; wp.placeholder = 'euterra-test-0.35.2'; wp.style.width='100%';
    const region = doc.createElement('input'); region.type = 'text'; region.id = 'stres-em-region-id'; region.placeholder = 'veyra-capital / greenwood-edge'; region.style.width='100%';
    const loc = doc.createElement('input'); loc.type = 'text'; loc.id = 'stres-em-location-name'; loc.placeholder = 'Veyrion Citadel'; loc.style.width='100%';
    const hdrOn = doc.createElement('input'); hdrOn.type = 'checkbox'; hdrOn.id = 'stres-em-hdr-on';
    const hdrT = doc.createElement('input'); hdrT.type = 'text'; hdrT.id = 'stres-em-hdr-tmpl'; hdrT.placeholder = '📍 {location} • {date} • {timeOfDay} • {weather}'; hdrT.style.width='100%';

    // Buttons
    const actions = doc.createElement('div'); actions.style.display='flex'; actions.style.gap='8px'; actions.style.marginTop='8px';
    const btnTest = doc.createElement('button'); btnTest.className='menu_button'; btnTest.textContent='Test Connection';
    const btnSave = doc.createElement('button'); btnSave.className='menu_button'; btnSave.textContent='Save';
    const btnReset = doc.createElement('button'); btnReset.className='menu_button'; btnReset.textContent='Reset';
    const btnLoadWp2 = doc.createElement('button'); btnLoadWp2.className='menu_button'; btnLoadWp2.textContent='Load Worldpack';
    actions.append(btnTest, btnLoadWp2, btnReset, btnSave);

    const note = doc.createElement('div'); note.id='stres-em-note'; note.style.fontSize='12px'; note.style.opacity='0.8'; note.style.marginTop='6px';

    content.append(
      fld('API Base URL', api),
      fld('Campaign ID', camp),
      fld('Worldpack ID', wp),
      fld('Region ID', region),
      fld('Location Label', loc),
      (function(){ const wrap = doc.createElement('div'); wrap.style.margin='6px 0'; const lab = doc.createElement('label'); lab.textContent = 'Scene Header'; lab.style.display='block'; lab.style.fontSize='12px'; lab.style.opacity='0.8'; const row = doc.createElement('div'); row.style.display='flex'; row.style.alignItems='center'; row.style.gap='8px'; const tlabel = doc.createElement('span'); tlabel.textContent='Enabled'; row.append(hdrOn, tlabel, hdrT); wrap.append(lab, row); return wrap; })(),
      fld('Character ID', chr),
      actions,
      note
    );

    drawer.append(toggle, content);
    container.append(drawer);

    // Toggle handling
    toggle.addEventListener('click', function(){
      this.classList.toggle('open');
      icon.classList.toggle('down');
      icon.classList.toggle('up');
      content.classList.toggle('open');
    });

    // Load current settings
    function refresh() {
      const s = (window.extension_settings?.[extensionName]) || {};
      api.value = s.serverUrl || defaultSettings.serverUrl;
      camp.value = s.campaignId || '';
      wp.value = s.worldpackId || '';
      region.value = s.world?.regionId || '';
      loc.value = s.world?.locationName || '';
      hdrOn.checked = !!(s.world?.header?.enabled ?? true);
      hdrT.value = s.world?.header?.template || defaultSettings.world.header.template;
      chr.value = s.characterId || '';
    }
    refresh();

    // Actions
    btnReset.addEventListener('click', () => { refresh(); note.textContent = 'Defaults restored (not saved).'; });
    btnSave.addEventListener('click', () => {
      const s = window.extension_settings || (window.SillyTavern?.getContext?.().extensionSettings);
      s[extensionName] = s[extensionName] || {};
      s[extensionName].serverUrl = (api.value || '').trim().replace(/\/$/, '') || defaultSettings.serverUrl;
      s[extensionName].campaignId = (camp.value || '').trim() || null;
      s[extensionName].worldpackId = (wp.value || '').trim() || null;
      s[extensionName].world = s[extensionName].world || structuredClone(defaultSettings.world);
      s[extensionName].world.regionId = (region.value || '').trim() || null;
      s[extensionName].world.locationName = (loc.value || '').trim() || '';
      s[extensionName].world.header = s[extensionName].world.header || structuredClone(defaultSettings.world.header);
      s[extensionName].world.header.enabled = !!hdrOn.checked;
      s[extensionName].world.header.template = (hdrT.value || '').trim() || defaultSettings.world.header.template;
      s[extensionName].characterId = (chr.value || '').trim() || null;
      try { if (state.stresClient) state.stresClient.baseUrl = s[extensionName].serverUrl; } catch {}
      try { const ctx = window.SillyTavern?.getContext?.(); (ctx?.saveSettingsDebounced || window.saveSettingsDebounced)?.(); } catch {}
      try { window.STRES?.refreshSettingsUI?.(); } catch {}
      note.textContent = 'Settings saved.';
    });
    btnTest.addEventListener('click', async () => {
      const url = (api.value || '').trim().replace(/\/$/, '');
      try {
        const res = await fetch((url||'http://localhost:3001') + '/health');
        note.textContent = res.ok ? 'Healthy' : `HTTP ${res.status}`;
      } catch (e) { note.textContent = String(e?.message || e); }
    });
    btnLoadWp2.addEventListener('click', async () => {
      const id = (wp.value || '').trim();
      if (!id) { note.textContent = 'Enter a Worldpack ID first'; return; }
      try {
        const r = await state.stresClient.loadWorldpackById(id);
        note.textContent = `Loaded ${r.id}@${r.version}`;
        try { await STRESPrompts.injectPrimerInPrompt(true); } catch {}
      }
      catch(e){ note.textContent = String(e?.message || e); }
    });
  }

  // Try now and observe DOM for when settings panel mounts
  render();
  if (!document.getElementById('extensions_settings2')) {
    const obs = new MutationObserver(() => {
      if (document.getElementById('extensions_settings2')) { try { render(); } catch {} obs.disconnect(); }
    });
    obs.observe(document.body, { childList:true, subtree:true });
  }
}
