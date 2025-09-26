import { defaultSettings, extensionName } from './constants.js';
import { state } from './state.js';

export const STRESWorld = {
  lastState: null,
  lastFetch: 0,
  fetchCooldownMs: 8000,
  observer: null,
  manifestCache: null,
  manifestFetchedAt: 0,
  manifestTtlMs: 15000,

  async tokenCount(text) {
    try {
      const ctx = window.SillyTavern?.getContext?.();
      if (ctx?.getTokenCountAsync) return await ctx.getTokenCountAsync(String(text || ''));
    } catch {}
    const s = String(text || '');
    return Math.ceil(s.length / 4) || 0;
  },

  async refresh(regionHint) {
    const settings = window.extension_settings?.[extensionName] || {};
    const regionId = (regionHint || settings.world?.regionId || '').trim() || undefined;
    try {
      const qp = regionId ? `?regionId=${encodeURIComponent(regionId)}` : '';
      const api = (settings.serverUrl || defaultSettings.serverUrl) + '/api/sim/state' + qp;
      const res = await fetch(api);
      const j = await res.json();
      if (j?.success) {
        this.lastState = j.data;
        this.lastFetch = Date.now();
      }
    } catch {}
    return this.lastState;
  },

  async getStateFresh() {
    if (!this.lastState || (Date.now() - this.lastFetch) > this.fetchCooldownMs) {
      await this.refresh();
    }
    return this.lastState;
  },

  async getManifestFresh() {
    const now = Date.now();
    if (!this.manifestCache || (now - this.manifestFetchedAt) > this.manifestTtlMs) {
      try {
        const res = await state.stresClient?.getWorldpackManifest?.();
        if (res?.success && res.manifest) {
          this.manifestCache = res.manifest;
          this.manifestFetchedAt = now;
        }
      } catch {}
    }
    return this.manifestCache;
  },

  async probe() {
    const settings = window.extension_settings?.[extensionName] || {};
    const base = (settings.serverUrl || defaultSettings.serverUrl || '').replace(/\/$/, '');
    const out = { base, health: null, worldpack_manifest: null, worldpack_current: null, sim_state: null };
    try {
      const r = await fetch(base + '/health');
      out.health = { ok: r.ok, status: r.status };
    } catch (e) {
      out.health = { ok: false, error: String(e?.message || e) };
    }
    try {
      const r = await fetch(base + '/api/worldpack/manifest');
      let j = null;
      try { j = await r.json(); } catch {}
      out.worldpack_manifest = { ok: r.ok && !!(j?.success), status: r.status, success: j?.success === true };
    } catch (e) {
      out.worldpack_manifest = { ok: false, error: String(e?.message || e) };
    }
    try {
      const r = await fetch(base + '/api/worldpack/current');
      let j = null;
      try { j = await r.json(); } catch {}
      out.worldpack_current = { ok: r.ok && !!(j?.success), status: r.status, success: j?.success === true };
    } catch (e) {
      out.worldpack_current = { ok: false, error: String(e?.message || e) };
    }
    try {
      const qp = settings.world?.regionId ? ('?regionId=' + encodeURIComponent(settings.world.regionId)) : '';
      const r = await fetch(base + '/api/sim/state' + qp);
      out.sim_state = { ok: r.ok, status: r.status };
    } catch (e) {
      out.sim_state = { ok: false, error: String(e?.message || e) };
    }
    return out;
  },

  formatHeader() {
    const ctx = window.SillyTavern?.getContext?.() || null;
    const settings = window.extension_settings?.[extensionName] || {};
    const meta = ctx?.chatMetadata?.stres || {};
    const scenarioHeader = meta?.latestScenario?.sceneHeader || null;
    const hdr = settings.world?.header || defaultSettings.world.header;
    const st = this.lastState;

    const metadata = scenarioHeader?.metadata || {};
    const loc = (metadata.locationName || metadata.location || settings.world?.locationName || settings.world?.regionId || 'Unknown').trim() || 'Unknown';
    const rawDate = metadata.date || metadata.dateLabel;
    const rawTime = metadata.timeOfDay || metadata.timeSegment;
    const rawWeather = metadata.weather || metadata.conditions;

    const baseHeader = (template) => {
      const tpl = template || defaultSettings.world.header.template;
      const dateCandidate = rawDate || (() => {
        if (!st) return 'Date?';
        const md = `${st.time?.month || ''} ${st.time?.day || ''}`.trim();
        return md || st.time?.iso?.slice(0, 10) || 'Date?';
      })();
      const timeCandidate = rawTime || (st?.time?.daySegment || 'time?');
      const weatherCandidate = rawWeather || (st?.weather?.condition || 'clear');
      return tpl
        .replace('{location}', loc)
        .replace('{date}', dateCandidate)
        .replace('{timeOfDay}', timeCandidate)
        .replace('{weather}', weatherCandidate);
    };

    const prefixParts = [];
    try {
      const cs = settings.cost || defaultSettings.cost;
      if (cs.enabled && cs.showBadge) {
        const t = settings.cost?.lastBadge?.text || '';
        if (t) prefixParts.push(t);
      }
    } catch {}

    if (Array.isArray(scenarioHeader?.badges)) {
      for (const badge of scenarioHeader.badges) {
        const text = String(badge || '').trim();
        if (text) prefixParts.push(text);
      }
    }

    const templateToUse = scenarioHeader?.template || hdr.template || defaultSettings.world.header.template;
    const inner = baseHeader(templateToUse);
    if (!prefixParts.length) return inner;
    return `${prefixParts.join(' • ')} • ${inner}`;
  },

  async ensureHeaderForElement(mesEl) {
    try {
      const settings = window.extension_settings?.[extensionName] || {};
      if (!settings.world?.header?.enabled) return;
      if (!mesEl || mesEl.dataset?.stresHeaderApplied === '1') return;
      const isUser = mesEl.classList?.contains('right') || mesEl.classList?.contains('mes-user');
      if (isUser) return;
      const textEl = mesEl.querySelector('.mes_text') || mesEl.querySelector('.mes_text p') || mesEl;
      if (!textEl) return;
      const raw = textEl.innerHTML || '';
      if (/^\s*📍/.test(raw)) {
        mesEl.dataset.stresHeaderApplied = '1';
        return;
      }
      await this.getStateFresh();
      const header = this.formatHeader();
      textEl.innerHTML = `${header}\n\n${raw}`;
      mesEl.dataset.stresHeaderApplied = '1';
    } catch {}
  },

  observeChat() {
    try {
      const container = document.getElementById('chat') || document.body;
      if (!container || this.observer) return;
      this.observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type !== 'childList') continue;
          m.addedNodes?.forEach((node) => {
            try {
              if (!(node instanceof HTMLElement)) return;
              if (node.classList?.contains('mes')) this.ensureHeaderForElement(node);
              node.querySelectorAll?.('.mes').forEach((el) => this.ensureHeaderForElement(el));
            } catch {}
          });
        }
      });
      this.observer.observe(container, { childList: true, subtree: true });
    } catch {}
  },

  async scenario(idOrIndex) {
    const settings = window.extension_settings?.[extensionName] || {};
    settings.world = settings.world || structuredClone(defaultSettings.world);
    let sel = null;
    let selectedScenario = null;
    try {
      const mf = await this.getManifestFresh();
      const scenarios = Array.isArray(mf?.scenarios) ? mf.scenarios : [];
      if (scenarios.length) {
        const byIndex = scenarios[Number(idOrIndex) - 1];
        const sc = scenarios.find((s) => s.id === idOrIndex) || byIndex || null;
        if (sc) {
          selectedScenario = sc;
          const region = (Array.isArray(mf.regions) ? mf.regions : []).find((r) => r.id === sc.regionId);
          sel = {
            regionId: sc.regionId,
            locationName: sc.locationName || region?.name || sc.regionId,
            factors: sc.factors || region?.factors || { biome: region?.biome },
          };
        }
      }
    } catch {}

    if (!sel) {
      const fallback = {
        '1': { regionId: 'veyra-capital', locationName: 'Veyrion Citadel', factors: { biome: 'urban', distanceToCoast: 30, elevation: 120, aridity: 0.4 } },
        '2': { regionId: 'calvessia-capital', locationName: 'Calvess, Sea-Kings’ Hall', factors: { biome: 'coastal', distanceToCoast: 2, elevation: 15, aridity: 0.5 } },
        '3': { regionId: 'veyra-capital', locationName: 'Veyrion Grand Market', factors: { biome: 'urban', distanceToCoast: 30, elevation: 120, aridity: 0.4 } },
        '4': { regionId: 'greenwood-edge', locationName: 'Hamlet at Greenwood Edge', factors: { biome: 'forest', distanceToCoast: 80, elevation: 300, aridity: 0.3 } },
        '5': { regionId: 'veyra-capital', locationName: 'Veyrion City (Inn Loft)', factors: { biome: 'urban', distanceToCoast: 30, elevation: 120, aridity: 0.4 } },
      };
      sel = fallback[String(idOrIndex)];
    }

    if (!sel) return { ok: false, message: 'Unknown scenario id' };

    settings.world.regionId = sel.regionId;
    settings.world.locationName = sel.locationName;

    try {
      const apiBase = settings.serverUrl || defaultSettings.serverUrl;
      await fetch(`${apiBase}/api/sim/region`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regionId: sel.regionId, factors: sel.factors }),
      });
    } catch {}

    try {
      const ctx = window.SillyTavern?.getContext?.();
      (ctx?.saveSettingsDebounced || window.saveSettingsDebounced)?.();
    } catch {}

    await this.refresh(sel.regionId);
    return {
      ok: true,
      regionId: sel.regionId,
      locationName: sel.locationName,
      scenarioId: (selectedScenario && selectedScenario.id) || String(idOrIndex),
      scenarioLabel: selectedScenario?.label,
    };
  },

  async listScenarios() {
    try {
      const mf = await this.getManifestFresh();
      const scs = Array.isArray(mf?.scenarios) ? mf.scenarios : [];
      return scs.map((s, i) => ({
        index: i + 1,
        id: s.id,
        label: s.label,
        regionId: s.regionId,
        locationName: s.locationName,
      }));
    } catch {
      return [];
    }
  },
};

export default STRESWorld;
