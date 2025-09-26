// Mutable references shared across STRES modules

export const state = {
  stresClient: null,
  characterPanel: null,
  autoInjector: null,
  commandProcessor: null,
  toolIntegration: null,
  lorebookManager: null,
  characterCardManager: null,
  worldMapViewer: null,
};

export const setState = (key, value) => {
  state[key] = value;
  return state[key];
};
