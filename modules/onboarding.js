import { defaultSettings, extensionName } from './constants.js';
import STRESWorld from './world.js';
import { state } from './state.js';

export function createOnboarding({ STRESNarrator, STRESChat }) {
  const module = {
    ctx: null,
    cache: null,
    cacheScript: null,
    init(ctx) {
      this.ctx = ctx || window.SillyTavern?.getContext?.() || null;
      this.ensureSeeded().catch(() => {});
    },
    tryParseJson(text) {
      if (!text) return null;
      const candidate = String(text);
      try { return JSON.parse(candidate); } catch {}
      return null;
    },
    parseArchitectJson(raw) {
      if (!raw) return null;
      let text = String(raw).trim();
      if (!text) return null;
      const codeMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
      if (codeMatch) {
        text = codeMatch[1].trim();
      }
      const braceStart = text.indexOf('{');
      const braceEnd = text.lastIndexOf('}');
      if (braceStart >= 0 && braceEnd > braceStart) {
        const sliced = text.slice(braceStart, braceEnd + 1);
        const parsed = this.tryParseJson(sliced);
        if (parsed) return parsed;
      }
      return this.tryParseJson(text);
    },
    isArchitectShape(obj) {
      if (!obj || typeof obj !== 'object') return false;
      return !!(obj.scenarioId || obj.worldpackId || obj.worldPackId || obj.campaignLabel || (Array.isArray(obj.playerCharacters) && obj.playerCharacters.length));
    },
    findRecentArchitectPayload(limit = 40) {
      const ctx = this.getContext();
      const chat = Array.isArray(ctx?.chat) ? ctx.chat : [];
      const result = { payload: null, raw: null, source: null };
      for (let i = chat.length - 1, searched = 0; i >= 0 && searched < limit; i--, searched++) {
        const message = chat[i];
        if (!message || !message.mes) continue;
        const parsed = this.parseArchitectJson(message.mes);
        if (parsed && this.isArchitectShape(parsed)) {
          result.payload = parsed;
          result.raw = message.mes;
          result.source = `chat:${i}`;
          return result;
        }
      }
      return null;
    },
    getContext() {
      const live = window.SillyTavern?.getContext?.();
      if (live) {
        this.ctx = live;
        return live;
      }
      return this.ctx;
    },
    getChatMeta() {
      const ctx = this.getContext();
      const meta = ctx?.chatMetadata || (ctx ? (ctx.chatMetadata = ctx.chatMetadata || {}) : {});
      if (!meta.stres) meta.stres = {};
      return meta.stres;
    },
    normalizePayload(raw) {
      if (!raw) return {};
      let value = raw;
      if (typeof value === 'string') {
        try {
          const parsed = JSON.parse(value);
          if (parsed && typeof parsed === 'object') value = parsed;
        } catch {
          return { starterCommand: value };
        }
      }
      if (typeof value !== 'object') return {};
      const out = {};
      const pick = (target, ...keys) => {
        if (out[target] != null) return;
        for (const key of keys) {
          if (value[key] != null && value[key] !== '') {
            out[target] = value[key];
            break;
          }
        }
      };
      pick('worldpackId', 'worldpackId', 'worldPackId', 'worldpack', 'packId');
      pick('campaignTemplateId', 'campaignTemplateId', 'templateId', 'campaignTemplate');
      pick('starterCommand', 'starterCommand', 'startCommand', 'starter', 'command');
      pick('recommendedModel', 'recommendedModel', 'model', 'llm');
      pick('onboardingPrompt', 'creationPrompt', 'onboardingPrompt', 'prompt', 'promptId');
      pick('dataRequirements', 'dataRequirements', 'requirements');
      pick('timelineTag', 'timelineTag', 'era', 'timeline');
      pick('scenarioId', 'scenarioId', 'defaultScenario');
      return out;
    },
    async collectContext(force = false) {
      if (!force && this.cache) return this.cache;
      const ctx = this.getContext();
      if (!ctx) {
        this.cache = null;
        return null;
      }
      const rawId = ctx.characterId ?? ctx.selectedCharacterId;
      if (rawId == null) {
        this.cache = null;
        return null;
      }
      const characterId = rawId;
      const character = ctx.characters?.[characterId] || {};
      const sources = [];
      const normalizedPieces = [];
      const keyList = (value) => (value && typeof value === 'object') ? Object.keys(value) : [];

      if (typeof STRESNarrator?.readCharacterField === 'function') {
        try {
          const field = await STRESNarrator.readCharacterField(characterId, 'stres');
          if (field) {
            normalizedPieces.push(this.normalizePayload(field));
            sources.push({ source: 'card.extensionField.stres', keys: keyList(field) });
          }
        } catch (error) {
          console.warn('[STRES] Onboarding: failed to read extension field', error);
        }
      }

      const cardExtensions = character.extensions?.stres;
      if (cardExtensions) {
        const normalized = this.normalizePayload(cardExtensions);
        if (Object.keys(normalized).length) normalizedPieces.push(normalized);
        sources.push({ source: 'card.extensions.stres', keys: keyList(cardExtensions) });
      }

      const dataExtensions = character.data?.extensions?.stres;
      if (dataExtensions) {
        const normalized = this.normalizePayload(dataExtensions);
        if (Object.keys(normalized).length) normalizedPieces.push(normalized);
        sources.push({ source: 'card.data.extensions.stres', keys: keyList(dataExtensions) });
      }

      const aggregated = {
        characterId,
        characterName: character.name || '(unknown)',
        chatId: ctx.chatId || ctx.chat_id || null,
        sources,
      };

      for (const piece of normalizedPieces) {
        for (const [key, value] of Object.entries(piece)) {
          if (value == null || value === '') continue;
          if (aggregated[key] == null) aggregated[key] = value;
        }
      }

      const settings = window.extension_settings?.[extensionName] || {};
      if (aggregated.worldpackId == null && settings.worldpackId) aggregated.worldpackId = settings.worldpackId;
      if (settings.campaignId && aggregated.campaignId == null) aggregated.campaignId = settings.campaignId;

      aggregated.sourceSignature = JSON.stringify({
        characterId,
        sources: sources.map((entry) => ({ source: entry.source, keys: entry.keys || [] })),
        worldpackId: aggregated.worldpackId || null,
        starterCommand: aggregated.starterCommand || null,
        campaignTemplateId: aggregated.campaignTemplateId || null,
        recommendedModel: aggregated.recommendedModel || null,
      });

      this.cache = aggregated;
      return aggregated;
    },
    normalizeScript(raw) {
      if (!raw) return null;
      if (typeof raw === 'string') {
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') return parsed;
        } catch {
          return {
            version: '1.0',
            prelude: raw,
            questions: [],
          };
        }
        return null;
      }
      if (Array.isArray(raw)) {
        return {
          version: '1.0',
          questions: raw,
        };
      }
      if (typeof raw === 'object') {
        return { ...raw };
      }
      return null;
    },
    defaultScript() {
      return {
        version: '1.0',
        title: 'STRES Campaign Architect (Fallback)',
        modelHint: 'gpt-4o-mini',
        prelude: 'You are STRES Campaign Architect. Interview the user to configure a tabletop-style campaign for SillyTavern. Ask concise questions, one at a time, and capture structured answers.',
        questions: [
          { id: 'campaign.name', text: 'What is the campaign or scenario title you would like to run?', required: true },
          { id: 'player.character', text: 'Who is the player character? Describe name, archetype, and any important motivation.', required: true },
          { id: 'timeline', text: 'Which timeline or era should we start in? (e.g., canon, alternate, custom).', required: true },
          { id: 'startingScenario', text: 'Describe the opening setting or scenario you would like to begin with.', required: true },
          { id: 'objectives', text: 'List 2-3 short term goals or hooks to explore first.', required: false },
          { id: 'tone', text: 'What tone should the adventure maintain (grim, heroic, light-hearted, etc.)?', required: false },
        ],
        output: {
          type: 'json',
          schema: {
            campaignLabel: 'string',
            timelineTag: 'string',
            scenarioId: 'string',
            starterSynopsis: 'string',
            objectives: 'string[]',
            playerCharacter: {
              name: 'string',
              concept: 'string',
            },
          },
          example: {
            campaignLabel: 'Team 7 Trials',
            timelineTag: 'canon-genin',
            scenarioId: 'wave-arc',
            starterSynopsis: 'Naruto and friends escort Tazuna while rogue shinobi plot an ambush.',
            objectives: ['Protect the bridge builder', 'Investigate rumors of Zabuza', 'Strengthen team cohesion'],
            playerCharacter: {
              name: 'Naruto Uzumaki',
              concept: 'Energetic genin eager to prove himself.',
            },
          },
        },
      };
    },
    async getCreationScript(force = false) {
      if (!force && this.cacheScript) return this.cacheScript;
      let script = null;
      try {
        const manifest = await STRESWorld.getManifestFresh();
        const candidate = manifest?.onboarding?.creationScript || manifest?.creationScript || manifest?.onboardingFlow;
        script = this.normalizeScript(candidate);
      } catch (error) {
        console.warn('[STRES] Onboarding: manifest creation script lookup failed', error);
      }
      if (!script) script = this.defaultScript();
      this.cacheScript = script;
      return script;
    },
    buildWizardPrompt(info, script) {
      const lines = [];
      lines.push('**Campaign Architect Setup**');
      if (script.title) lines.push(`Title: ${script.title}`);
      if (info?.worldpackId) lines.push(`Worldpack: ${info.worldpackId}`);
      if (info?.starterCommand) lines.push(`Starter command (card hint): ${info.starterCommand}`);
      if (script.modelHint || info?.recommendedModel) {
        lines.push(`Suggested model: ${info?.recommendedModel || script.modelHint}`);
      }
      lines.push('');
      lines.push('### Instructions');
      lines.push('1. Open your preferred high-reasoning model (e.g., GPT-5, Gemini 2.5 Pro).');
      lines.push('2. Paste the following prompt to run the questionnaire.');
      lines.push('');
      const prompt = {
        role: 'system',
        prelude: script.prelude,
        questions: script.questions || [],
        output: script.output || {},
        worldpackId: info?.worldpackId || null,
        timelineTag: info?.timelineTag || null,
        recommendations: {
          model: info?.recommendedModel || script.modelHint || null,
          starterScenario: info?.scenarioId || null,
        },
      };
      lines.push('```json');
      lines.push(JSON.stringify(prompt, null, 2));
      lines.push('```');
      lines.push('');
      lines.push('When the architect returns the JSON payload, provide it to `/stres begin complete` (coming soon) or paste it into the STRES console to finalize campaign creation.');
      return lines.join('\n');
    },
    async ensureSeeded() {
      try {
        const info = await this.collectContext();
        if (!info) return false;
        const meta = this.getChatMeta();
        if (!meta.onboarding || meta.onboarding.sourceSignature !== info.sourceSignature) {
          meta.onboarding = {
            phase: 'detected',
            updatedAt: new Date().toISOString(),
            characterId: info.characterId,
            characterName: info.characterName,
            worldpackId: info.worldpackId || null,
            starterCommand: info.starterCommand || null,
            campaignTemplateId: info.campaignTemplateId || null,
            recommendedModel: info.recommendedModel || null,
            sourceSignature: info.sourceSignature,
          };
          await this.saveMetadata();
        }
        return true;
      } catch (error) {
        console.warn('[STRES] Onboarding seed failed', error);
        return false;
      }
    },
    async saveMetadata() {
      try {
        await this.getContext()?.saveMetadata?.();
      } catch {}
    },
    formatSummary(info, meta) {
      if (!info) return '❌ No active character detected. Open a SillyTavern chat and select a character card.';
      const lines = [];
      lines.push(`• Character: ${info.characterName || '(unknown)'}`);
      lines.push(`• Chat ID: ${info.chatId || 'n/a'}`);
      lines.push(`• Card worldpack: ${info.worldpackId || 'not provided'}`);
      lines.push(`• Starter command: ${info.starterCommand || 'not provided'}`);
      if (info.campaignTemplateId) lines.push(`• Campaign template: ${info.campaignTemplateId}`);
      if (info.recommendedModel) lines.push(`• Recommended model: ${info.recommendedModel}`);
      if (info.onboardingPrompt) lines.push(`• Creation prompt hint: ${info.onboardingPrompt.slice(0, 160)}…`);
      if (meta?.phase) lines.push(`• Onboarding phase: ${meta.phase}`);
      return lines.join('\n');
    },
    async begin() {
      const info = await this.collectContext(true);
      if (!info) {
        STRESChat.sendToChat('❌ No active character card detected. Load a character card and try `/stres begin` again.');
        return { ok: false };
      }
      const meta = this.getChatMeta();
      meta.onboarding = {
        phase: 'card_detected',
        updatedAt: new Date().toISOString(),
        characterId: info.characterId,
        characterName: info.characterName,
        worldpackId: info.worldpackId || null,
        starterCommand: info.starterCommand || null,
        campaignTemplateId: info.campaignTemplateId || null,
        recommendedModel: info.recommendedModel || null,
        sourceSignature: info.sourceSignature,
      };
      await this.saveMetadata();

      const lines = ['**STRES Onboarding**'];
      lines.push(this.formatSummary(info, meta));
      lines.push('\nNext steps:');
      lines.push('1) Review detected data.');
      lines.push('2) Use `/stres begin wizard` to generate a questionnaire prompt (or follow your worldpack-specific instructions).');
      lines.push('3) Use `/stres begin status` anytime to review this snapshot.');
      lines.push('4) After the architect returns JSON, run `/stres begin apply last` to activate the chosen scenario.');

      STRESChat.sendToChat(lines.join('\n'));
      return { ok: true, info };
    },
    async showStatus() {
      const info = await this.collectContext();
      const meta = this.getChatMeta();
      const message = ['**STRES Onboarding Status**', this.formatSummary(info, meta)];
      if (meta?.updatedAt) message.push(`• Last update: ${meta.updatedAt}`);
      STRESChat.sendToChat(message.join('\n'));
      return { ok: !!info };
    },
    async refresh() {
      await this.collectContext(true);
      await this.ensureSeeded();
      await this.showStatus();
    },
    async wizard(force = false) {
      const info = await this.collectContext(force);
      if (!info) {
        STRESChat.sendToChat('❌ Cannot build wizard prompt without an active character card.');
        return { ok: false };
      }
      const script = await this.getCreationScript(force);
      const meta = this.getChatMeta();
      meta.onboarding = meta.onboarding || {};
      meta.onboarding.phase = 'wizard_ready';
      meta.onboarding.updatedAt = new Date().toISOString();
      meta.onboarding.scriptInfo = {
        title: script.title || 'STRES Campaign Architect',
        version: script.version || '1.0',
        modelHint: script.modelHint || null,
      };
      try {
        const ctx = this.getContext();
        meta.onboarding.wizardStartIndex = Array.isArray(ctx?.chat) ? ctx.chat.length : 0;
        meta.onboarding.wizardStartedAt = new Date().toISOString();
      } catch {}
      await this.saveMetadata();
      const message = this.buildWizardPrompt(info, script);
      STRESChat.sendToChat(message);
      return { ok: true };
    },
    async showScriptSummary() {
      const script = await this.getCreationScript();
      if (!script) {
        STRESChat.sendToChat('❌ No creation script available.');
        return { ok: false };
      }
      const lines = [];
      lines.push('**Creation Script Summary**');
      if (script.title) lines.push(`• Title: ${script.title}`);
      if (script.version) lines.push(`• Version: ${script.version}`);
      if (script.modelHint) lines.push(`• Suggested model: ${script.modelHint}`);
      const questionCount = Array.isArray(script.questions) ? script.questions.length : 0;
      lines.push(`• Questions: ${questionCount}`);
      if (questionCount) {
        const preview = script.questions.slice(0, 3).map((q) => `  - ${q.id || '(unnamed)'}: ${q.text || '(no prompt)'}`).join('\n');
        lines.push('• Preview:\n' + preview + (questionCount > 3 ? '\n  - …' : ''));
      }
      STRESChat.sendToChat(lines.join('\n'));
      return { ok: true };
    },
    cloneMessage(message) {
      try {
        return structuredClone(message);
      } catch {
        return JSON.parse(JSON.stringify(message));
      }
    },
    ensureArchiveBucket(meta) {
      if (!meta.onboarding) meta.onboarding = {};
      if (!Array.isArray(meta.onboarding.archivedMessages)) meta.onboarding.archivedMessages = [];
      return meta.onboarding.archivedMessages;
    },
    async performCleanup(cleanup, meta, activation) {
      const info = { archivedCount: 0, pruned: false };
      const cfg = cleanup && typeof cleanup === 'object' ? cleanup : { archiveWizard: true, pruneMessages: true, retainCount: 0 };
      const archiveWizard = cfg.archiveWizard !== false;
      const pruneMessages = cfg.pruneMessages !== false;
      const retainCount = Math.max(0, Number(cfg.retainCount || 0));

      const ctx = this.getContext();
      const chat = Array.isArray(ctx?.chat) ? ctx.chat : null;
      if (!chat) return info;

      const startIndex = Number.isInteger(meta?.onboarding?.wizardStartIndex) ? meta.onboarding.wizardStartIndex : null;
      if (startIndex == null || startIndex < 0 || startIndex >= chat.length) return info;

      const pruneEnd = Math.max(startIndex, chat.length - retainCount);
      const messagesToArchive = archiveWizard ? chat.slice(startIndex, pruneEnd).map((m) => this.cloneMessage(m)) : [];

      if (messagesToArchive.length) {
        const bucket = this.ensureArchiveBucket(meta);
        bucket.push({
          id: `archive-${Date.now()}`,
          createdAt: new Date().toISOString(),
          startIndex,
          retainCount,
          notes: {
            scenarioId: activation?.scenario?.id || meta.onboarding?.scenarioId || null,
            timelineTag: activation?.campaign?.timelineTag || null,
            label: activation?.campaign?.label || null
          },
          messages: messagesToArchive
        });
        if (Array.isArray(meta.onboardingLog)) {
          meta.onboardingLog.push({
            type: 'scenario_archive',
            at: new Date().toISOString(),
            count: messagesToArchive.length
          });
        }
        info.archivedCount = messagesToArchive.length;
      }

      if (pruneMessages && pruneEnd > startIndex) {
        chat.splice(startIndex, pruneEnd - startIndex);
        info.pruned = true;
        try {
          ctx.eventSource?.emit?.(ctx.eventTypes?.CHAT_CHANGED, { reason: 'stresCleanup' });
          if (typeof window.renderChatHistory === 'function') window.renderChatHistory();
        } catch {}
      }

      try { await ctx.saveChat?.(); } catch {}
      meta.onboarding = meta.onboarding || {};
      meta.onboarding.lastCleanup = {
        at: new Date().toISOString(),
        archivedCount: info.archivedCount,
        pruned: info.pruned,
        retainCount,
        startIndex
      };
      return info;
    },
    async undoScenarioCleanup() {
      const ctx = this.getContext();
      const chat = Array.isArray(ctx?.chat) ? ctx.chat : null;
      if (!chat) {
        STRESChat.sendToChat('❌ Unable to access chat history for undo.');
        return { ok: false };
      }
      const meta = this.getChatMeta();
      const bucket = this.ensureArchiveBucket(meta);
      if (!bucket.length) {
        STRESChat.sendToChat('ℹ️ No archived onboarding messages to restore.');
        return { ok: false };
      }
      const entry = bucket.pop();
      if (!entry?.messages?.length) {
        STRESChat.sendToChat('ℹ️ Archive empty. Nothing to restore.');
        return { ok: false };
      }
      const insertAt = Math.min(entry.startIndex ?? chat.length, chat.length);
      chat.splice(insertAt, 0, ...entry.messages.map((m) => this.cloneMessage(m)));
      meta.onboarding = meta.onboarding || {};
      meta.onboarding.phase = 'wizard_ready';
      meta.onboarding.updatedAt = new Date().toISOString();
      meta.onboarding.undoAt = meta.onboarding.updatedAt;
      meta.onboarding.lastUndoSource = entry.id;
      if (!Array.isArray(meta.onboardingLog)) meta.onboardingLog = [];
      meta.onboardingLog.push({ type: 'scenario_undo', at: meta.onboarding.updatedAt, restored: entry.messages.length });
      try {
        ctx.eventSource?.emit?.(ctx.eventTypes?.CHAT_CHANGED, { reason: 'stresUndo' });
        if (typeof window.renderChatHistory === 'function') window.renderChatHistory();
        await ctx.saveChat?.();
        await ctx.saveMetadata?.();
      } catch {}
      STRESChat.sendToChat('↩️ Restored onboarding conversation. You can rerun `/stres begin apply` when ready.');
      return { ok: true };
    },
    async applyScenario(rawInput = '') {
      const reducer = state.scenarioReducer;
      if (!reducer || typeof reducer.apply !== 'function') {
        STRESChat.sendToChat('❌ Scenario reducer not available. Please ensure the STRES extension is up to date.');
        return { ok: false, error: 'Reducer missing' };
      }

      const info = await this.collectContext();
      if (!info) {
        STRESChat.sendToChat('❌ No active character card detected. Load a character card before applying a scenario.');
        return { ok: false, error: 'No character context' };
      }

      let text = String(rawInput || '').trim();
      let source = 'command';
      if (!text || text.toLowerCase() === 'last') {
        const candidate = this.findRecentArchitectPayload();
        if (!candidate) {
          STRESChat.sendToChat('❌ Could not find a recent architect JSON payload. Paste the JSON after `/stres begin apply` or use `/stres begin apply last` immediately after the architect replies.');
          return { ok: false, error: 'No payload detected' };
        }
        text = candidate.raw;
        source = candidate.source;
      }

      const payload = this.parseArchitectJson(text);
      if (!payload || !this.isArchitectShape(payload)) {
        STRESChat.sendToChat('❌ Unable to parse the scenario payload. Ensure you paste valid JSON containing `scenarioId` or `worldpackId`.');
        return { ok: false, error: 'Parse failed' };
      }

      const meta = this.getChatMeta();
      meta.onboarding = meta.onboarding || {};
      meta.onboarding.phase = 'scenario_applying';
      meta.onboarding.updatedAt = new Date().toISOString();
      meta.onboarding.lastArchitectSource = source;
      meta.onboarding.lastArchitectRaw = text;
      await this.saveMetadata();

      let result;
      try {
        result = await reducer.apply(payload, {});
      } catch (error) {
        console.error('[STRES] Scenario apply failed', error);
        STRESChat.sendToChat('❌ Scenario application threw an error. See console for details.');
        meta.onboarding.phase = 'wizard_ready';
        await this.saveMetadata();
        return { ok: false, error: error?.message || 'Exception' };
      }

      if (!result?.success) {
        STRESChat.sendToChat(`❌ Scenario application failed: ${result?.error || 'Unknown error'}`);
        meta.onboarding.phase = 'wizard_ready';
        meta.onboarding.updatedAt = new Date().toISOString();
        await this.saveMetadata();
        return { ok: false, error: result?.error || 'Reducer failure' };
      }

      const nowIso = new Date().toISOString();
      meta.onboarding.phase = 'scenario_applied';
      meta.onboarding.updatedAt = nowIso;
      meta.onboarding.lastScenarioAt = nowIso;
      meta.onboarding.scenarioId = result.activation?.scenario?.id || payload.scenarioId || meta.onboarding.scenarioId || null;
      meta.onboarding.timelineTag = result.activation?.campaign?.timelineTag || payload.timelineTag || meta.onboarding.timelineTag || null;
      meta.onboarding.campaignLabel = result.activation?.campaign?.label || payload.campaignLabel || meta.onboarding.campaignLabel || null;
      meta.onboarding.worldpackId = meta.onboarding.worldpackId || payload.worldpackId || info.worldpackId || null;
      meta.onboarding.architectPayload = payload;
      if (!Array.isArray(meta.onboardingLog)) meta.onboardingLog = [];
      meta.onboardingLog.push({
        type: 'scenario_applied',
        at: nowIso,
        source,
        payload
      });
      const cleanupInfo = await this.performCleanup(result.activation?.cleanup, meta, result.activation);
      if (result.activation?.scenario?.openingNarration) {
        try { await STRESChat.addAssistantMessage?.('Narrator', result.activation.scenario.openingNarration); } catch {}
      }
      await this.saveMetadata();

      const scenarioLabel = result.activation?.scenario?.label || payload.scenarioId || 'scenario';
      const summaryLines = [`✅ Scenario **${scenarioLabel}** applied.`];
      if (cleanupInfo?.archivedCount) summaryLines.push(`• Archived onboarding messages: ${cleanupInfo.archivedCount}`);
      if (cleanupInfo?.pruned) summaryLines.push('• Chat cleaned for fresh campaign start.');
      summaryLines.push('\nNext steps:');
      summaryLines.push('• /stres scenarios — browse available scenes');
      summaryLines.push('• /stres npc list — review active NPCs');
      summaryLines.push('• /stres inject primer — reapply world primer if needed');
      summaryLines.push('• /stres begin undo — restore the onboarding Q&A if you need to rerun apply');
      STRESChat.sendToChat(summaryLines.join('\n'));
      return { ok: true, activation: result.activation };
    }
  };

  return module;
}
