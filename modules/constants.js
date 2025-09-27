// Shared constants for the STRES extension

export const extensionName = 'stres';

export const defaultSettings = {
  serverUrl: 'http://localhost:3001',
  campaignId: null,
  worldpackId: null,
  chatCampaigns: {},
  autoBindCampaignToChat: true,
  budget: {
    profile: 'Balanced',
    contextTarget: 2000,
    cushion: 200,
    reserve: 200,
    components: {
      guard: { enabled: true, maxTokens: 60, sticky: true },
      primer: { enabled: true, maxTokens: 600, sticky: false },
      header: { enabled: true, maxTokens: 120, sticky: true },
      summaries: { enabled: false, maxTokens: 250, sticky: false },
      rag: { enabled: false, maxTokens: 300, topK: 2, sticky: false },
      npc: { enabled: false, maxTokens: 400, sticky: false },
      hud: { enabled: false, maxTokens: 200, sticky: true },
      combat: { enabled: true, maxTokens: 220, sticky: true },
    },
    degrade: { order: ['rag', 'npc', 'summaries', 'primer', 'hud', 'header', 'combat'] },
  },
  rag: {
    enabled: false,
    topK: 2,
    maxTokens: 300,
    position: 'in_prompt',
    depth: 0,
  },
  npc: {
    enabled: true,
    inject: true,
    topK: 2,
    maxTokens: 400,
    maxNPCs: 2,
    activation: 'mention_or_state',
  },
  summary: {
    enabled: true,
    everyTurns: 6,
    windowSize: 12,
    maxItems: 10,
    inject: false,
  },
  state: {
    enabled: true,
    everyTurns: 6,
  },
  world: {
    regionId: null,
    locationName: '',
    locationType: '',
    header: { enabled: true, template: '📍 {location} • {date} • {timeOfDay} • {weather}' },
  },
  autoInjection: {
    enabled: true,
    mode: 'basic',
    frequency: 'every_message',
    primer: true,
  },
  ui: {
    theme: 'fantasy',
    showHUD: true,
    panelPosition: 'right',
    hudPanelCollapsed: false,
  },
  hud: {
    panel: {
      enabled: true,
      position: 'right',
      collapsed: false,
    },
    prompt: {
      enabled: true,
    },
    text: {
      enabled: false,
      mode: 'on_change', // off | on_change | each_message
      prefix: '📊 Player Sheet',
    },
    alerts: {
      enabled: true,
      notifyIncrease: false,
      notifyDecrease: true,
      absoluteThreshold: 5,
      relativeThreshold: 0.15,
      showInChat: true,
    },
  },
  guard: {
    enabled: true,
    template: "🔒 Speak only as {char}. Do not reveal others' private knowledge. Use only scene/world context and your own memory.",
  },
  cost: {
    enabled: true,
    showBadge: true,
    pollMs: 300000,
    mode: 'poll',
    lastBadge: null,
  },
  telemetry: {
    enabled: true,
    logToChat: false,
    keep: 20,
  },
  destinations: {
    defaultKey: 'orchestrator',
    entries: {
      orchestrator: {
        label: 'STRES Orchestrator',
        mode: 'plan',
        intent: 'story',
        routingOverrides: {}
      },
      tavern: {
        label: 'SillyTavern Direct',
        mode: 'direct',
        targetModel: 'sillytavern/custom',
        settings: {
          stream: false
        }
      }
    }
  },
  setup: {
    enabled: true,
    oncePerChat: true,
  },
  tools: {
    enabled: true,
    where: true,
    tick: true,
    update_state: true,
    start_scenario: true,
    npc_reply: true,
    dice: true,
    spawn_options: false,
  },
  combat: {
    enabled: true,
    presets: {
      story: '',
      explore: '',
      combat: '',
    },
    npcModel: {
      chat_completion_source: 'openrouter',
      model: 'gpt-4o-mini',
      max_tokens: 140,
    },
    header: {
      enabled: true,
      template: '⚔️ Round {round} • Init: {order}',
    },
  },
};

// Keep historical default of localhost backend
defaultSettings.serverUrl = 'http://localhost:3001';
