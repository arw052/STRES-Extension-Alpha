import { defaultSettings, extensionName } from './constants.js';
import STRESWorld from './world.js';

export function createOnboarding({ STRESNarrator, STRESChat }) {
  const module = {
    ctx: null,
    cache: null,
    cacheScript: null,
    init(ctx) {
      this.ctx = ctx || window.SillyTavern?.getContext?.() || null;
      this.ensureSeeded().catch(() => {});
    },
    getContext() {
      this.ctx = this.ctx || window.SillyTavern?.getContext?.() || null;
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
      const characterId = ctx.characterId || ctx.selectedCharacterId;
      if (!characterId) {
        this.cache = null;
        return null;
      }
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
  };

  return module;
}
