"use strict";

class CombatPanel {
    constructor(combatManager, configManager) {
        this.combatManager = combatManager;
        this.configManager = configManager;
        this.container = null;
        this.isVisible = false;

        this.setupEventListeners();
    }

    createPanel() {
        if (this.container) return this.container;

        this.container = document.createElement('div');
        this.container.id = 'stres-combat-panel';
        this.container.className = 'stres-combat-panel';
        this.container.innerHTML = `
            <div class="stres-combat-header">
                <h3>Combat</h3>
                <button class="stres-combat-toggle" id="stres-combat-toggle">▼</button>
            </div>
            <div class="stres-combat-content" id="stres-combat-content">
                <div class="stres-combat-status">
                    <div class="stres-combat-round">Round: <span id="combat-round">-</span></div>
                    <div class="stres-combat-turn">Current Turn: <span id="combat-actor">-</span></div>
                </div>
                <div class="stres-combat-actions">
                    <button class="stres-combat-btn" id="combat-attack-btn" disabled>
                        ⚔️ Attack
                    </button>
                </div>
                <div class="stres-combat-log" id="combat-log">
                    <div class="stres-combat-log-entry system">Waiting for combat...</div>
                </div>
            </div>
        `;

        // Setup event listeners
        const toggleBtn = this.container.querySelector('#stres-combat-toggle');
        const attackBtn = this.container.querySelector('#combat-attack-btn');

        toggleBtn.addEventListener('click', () => this.toggle());
        attackBtn.addEventListener('click', () => this.performAttack());

        return this.container;
    }

    mount(selector) {
        const target = document.querySelector(selector);
        if (!target) {
            console.error('[STRES] Combat panel mount target not found:', selector);
            return;
        }

        const panel = this.createPanel();
        target.appendChild(panel);
        this.updateVisibility();
    }

    toggle() {
        this.isVisible = !this.isVisible;
        this.updateVisibility();
    }

    updateVisibility() {
        if (!this.container) return;

        const content = this.container.querySelector('#stres-combat-content');
        const toggle = this.container.querySelector('#stres-combat-toggle');

        if (this.isVisible) {
            content.style.display = 'block';
            toggle.textContent = '▼';
        } else {
            content.style.display = 'none';
            toggle.textContent = '▶';
        }
    }

    setupEventListeners() {
        // Listen to combat events
        window.addEventListener('stres:combat:started', (e) => {
            this.onCombatStarted(e.detail);
        });

        window.addEventListener('stres:combat:turnRequested', (e) => {
            this.onTurnRequested(e.detail);
        });

        window.addEventListener('stres:combat:actionApplied', (e) => {
            this.onActionApplied(e.detail);
        });

        window.addEventListener('stres:combat:actionRejected', (e) => {
            this.onActionRejected(e.detail);
        });

        window.addEventListener('stres:combat:ended', (e) => {
            this.onCombatEnded(e.detail);
        });

        window.addEventListener('stres:combat:log', (e) => {
            this.onLogEntry(e.detail.entry);
        });
    }

    onCombatStarted(data) {
        this.updateRound(data.round || 1);
        this.updateActor('Combat Started');
        this.addLogEntry('Combat started!', 'system');
    }

    onTurnRequested(data) {
        this.updateRound(data.round);
        this.updateActor(data.actorId);

        const attackBtn = this.container?.querySelector('#combat-attack-btn');
        if (attackBtn) {
            attackBtn.disabled = false;
            attackBtn.textContent = `⚔️ Attack ${data.enemies?.[0]?.name || 'Enemy'}`;
        }

        this.addLogEntry(`Turn: ${data.actorId} (Round ${data.round})`, 'system');
    }

    onActionApplied(data) {
        const attackBtn = this.container?.querySelector('#combat-attack-btn');
        if (attackBtn) {
            attackBtn.disabled = true;
            attackBtn.textContent = '⚔️ Attack';
        }

        this.addLogEntry(`${data.actorId}: ${data.action.type}`, 'action');
    }

    onActionRejected(data) {
        this.addLogEntry(`Action rejected: ${data.reason}`, 'error');
    }

    onCombatEnded(data) {
        this.updateRound('-');
        this.updateActor('Combat Ended');

        const attackBtn = this.container?.querySelector('#combat-attack-btn');
        if (attackBtn) {
            attackBtn.disabled = true;
            attackBtn.textContent = '⚔️ Attack';
        }

        this.addLogEntry('Combat ended!', 'system');
    }

    onLogEntry(entry) {
        this.addLogEntry(entry.message, entry.type);
    }

    updateRound(round) {
        const roundEl = this.container?.querySelector('#combat-round');
        if (roundEl) {
            roundEl.textContent = round.toString();
        }
    }

    updateActor(actor) {
        const actorEl = this.container?.querySelector('#combat-actor');
        if (actorEl) {
            actorEl.textContent = actor;
        }
    }

    addLogEntry(message, type = 'info') {
        const logEl = this.container?.querySelector('#combat-log');
        if (!logEl) return;

        const entry = document.createElement('div');
        entry.className = `stres-combat-log-entry ${type}`;
        entry.textContent = message;

        logEl.appendChild(entry);
        logEl.scrollTop = logEl.scrollHeight;

        // Keep only last 20 entries
        while (logEl.children.length > 20) {
            logEl.removeChild(logEl.firstChild);
        }
    }

    async performAttack() {
        const state = this.combatManager.getCurrentState();
        if (!state.currentTurn || !state.currentTurn.enemies || state.currentTurn.enemies.length === 0) {
            this.addLogEntry('No enemies to attack', 'error');
            return;
        }

        const targetId = state.currentTurn.enemies[0].id;
        const result = await this.combatManager.performAttack(targetId);

        if (!result.success) {
            this.addLogEntry(`Attack failed: ${result.error}`, 'error');
        }
    }

    show() {
        this.isVisible = true;
        this.updateVisibility();
    }

    hide() {
        this.isVisible = false;
        this.updateVisibility();
    }
}

export { CombatPanel };
