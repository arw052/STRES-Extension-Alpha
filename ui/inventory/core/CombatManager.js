"use strict";

class CombatManager {
    constructor(configManager, webSocketManager) {
        this.configManager = configManager;
        this.webSocketManager = webSocketManager;
        this.currentEncounter = null;
        this.currentTurn = null;
        this.isActive = false;
        this.combatLog = [];
        this.eventHandlers = new Map();

        this.setupWebSocketHandlers();
    }

    setupWebSocketHandlers() {
        // Handle combat events
        this.webSocketManager.on('combat.started', (data, envelope) => {
            this.handleCombatStarted(data, envelope);
        });

        this.webSocketManager.on('combat.turn.requested', (data, envelope) => {
            this.handleTurnRequested(data, envelope);
        });

        this.webSocketManager.on('combat.action.applied', (data, envelope) => {
            this.handleActionApplied(data, envelope);
        });

        this.webSocketManager.on('combat.action.rejected', (data, envelope) => {
            this.handleActionRejected(data, envelope);
        });

        this.webSocketManager.on('combat.turn', (data, envelope) => {
            this.handleTurn(data, envelope);
        });

        this.webSocketManager.on('combat.ended', (data, envelope) => {
            this.handleCombatEnded(data, envelope);
        });

        this.webSocketManager.on('combat.carcass.created', (data, envelope) => {
            this.handleCarcassCreated(data, envelope);
        });

        this.webSocketManager.on('combat.harvested', (data, envelope) => {
            this.handleHarvested(data, envelope);
        });
    }

    handleCombatStarted(data, envelope) {
        console.log('[STRES] Combat started:', data);
        this.isActive = true;
        this.currentEncounter = data.encounter;
        this.combatLog = [];
        this.addToLog('Combat started!', 'system');

        this.notifyHandlers('combatStarted', data);
        window.dispatchEvent(new CustomEvent('stres:combat:started', { detail: data }));
    }

    handleTurnRequested(data, envelope) {
        console.log('[STRES] Turn requested:', data);
        this.currentTurn = data;
        this.addToLog(`Turn requested for ${data.actorId} (Round ${data.round})`, 'system');

        this.notifyHandlers('turnRequested', data);
        window.dispatchEvent(new CustomEvent('stres:combat:turnRequested', { detail: data }));

        // Auto-act if enabled
        const config = this.configManager.getEffectiveConfig();
        if (config.combat.autoAct) {
            this.performAutoAction(data);
        }
    }

    handleActionApplied(data, envelope) {
        console.log('[STRES] Action applied:', data);
        this.addToLog(`${data.actorId} performed: ${data.action.type}`, 'action');

        this.notifyHandlers('actionApplied', data);
        window.dispatchEvent(new CustomEvent('stres:combat:actionApplied', { detail: data }));
    }

    handleActionRejected(data, envelope) {
        console.log('[STRES] Action rejected:', data);
        this.addToLog(`Action rejected: ${data.reason}`, 'error');

        this.notifyHandlers('actionRejected', data);
        window.dispatchEvent(new CustomEvent('stres:combat:actionRejected', { detail: data }));
    }

    handleTurn(data, envelope) {
        console.log('[STRES] Turn processed:', data);
        this.currentTurn = null;

        this.notifyHandlers('turnProcessed', data);
        window.dispatchEvent(new CustomEvent('stres:combat:turn', { detail: data }));
    }

    handleCombatEnded(data, envelope) {
        console.log('[STRES] Combat ended:', data);
        this.isActive = false;
        this.currentEncounter = null;
        this.currentTurn = null;
        this.addToLog('Combat ended!', 'system');

        this.notifyHandlers('combatEnded', data);
        window.dispatchEvent(new CustomEvent('stres:combat:ended', { detail: data }));
    }

    handleCarcassCreated(data, envelope) {
        console.log('[STRES] Carcass created:', data);
        this.addToLog(`Carcass created: ${data.carcassId}`, 'system');

        this.notifyHandlers('carcassCreated', data);
        window.dispatchEvent(new CustomEvent('stres:combat:carcassCreated', { detail: data }));
    }

    handleHarvested(data, envelope) {
        console.log('[STRES] Harvested:', data);
        this.addToLog(`${data.materialId} harvested (${data.quantity})`, 'harvest');

        this.notifyHandlers('harvested', data);
        window.dispatchEvent(new CustomEvent('stres:combat:harvested', { detail: data }));
    }

    async submitAction(encounterId, round, actorId, action) {
        const config = this.configManager.getEffectiveConfig();

        try {
            const response = await fetch(`${config.combat.apiBase}/api/combat/act`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    encounterId,
                    round,
                    actorId,
                    action
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();
            console.log('[STRES] Action submitted successfully:', result);
            return { success: true, data: result };

        } catch (error) {
            console.error('[STRES] Failed to submit action:', error);
            return { success: false, error: error.message };
        }
    }

    async performAttack(targetId) {
        if (!this.currentTurn) {
            return { success: false, error: 'No active turn' };
        }

        const action = {
            type: 'attack',
            targetId: targetId
        };

        return this.submitAction(
            this.currentTurn.encounterId,
            this.currentTurn.round,
            this.currentTurn.actorId,
            action
        );
    }

    async performAutoAction(turnData) {
        // Simple auto-action: attack first enemy
        if (turnData.enemies && turnData.enemies.length > 0) {
            const targetId = turnData.enemies[0].id;
            console.log('[STRES] Auto-acting: attacking', targetId);

            setTimeout(() => {
                this.performAttack(targetId);
            }, 1000); // Small delay to simulate thinking
        }
    }

    addToLog(message, type = 'info') {
        const entry = {
            message,
            type,
            timestamp: Date.now()
        };

        this.combatLog.push(entry);

        // Keep only last 50 entries
        if (this.combatLog.length > 50) {
            this.combatLog.shift();
        }

        window.dispatchEvent(new CustomEvent('stres:combat:log', {
            detail: { entry, fullLog: this.combatLog }
        }));
    }

    getCombatLog() {
        return [...this.combatLog];
    }

    getCurrentState() {
        return {
            isActive: this.isActive,
            currentEncounter: this.currentEncounter,
            currentTurn: this.currentTurn,
            log: this.getCombatLog()
        };
    }

    on(eventType, handler) {
        if (!this.eventHandlers.has(eventType)) {
            this.eventHandlers.set(eventType, []);
        }
        this.eventHandlers.get(eventType).push(handler);
    }

    off(eventType, handler) {
        const handlers = this.eventHandlers.get(eventType);
        if (handlers) {
            const index = handlers.indexOf(handler);
            if (index > -1) {
                handlers.splice(index, 1);
            }
        }
    }

    notifyHandlers(eventType, data) {
        const handlers = this.eventHandlers.get(eventType) || [];
        handlers.forEach(handler => {
            try {
                handler(data);
            } catch (error) {
                console.error('[STRES] Error in combat handler for', eventType, error);
            }
        });
    }
}

export { CombatManager };
