"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.combatOptimizationService = exports.CombatOptimizationService = void 0;
const BaseService_1 = require("../../services/BaseService");
const tokenCounter_1 = require("../../../shared/utils/tokenCounter");
const compressionUtils_1 = require("../../../shared/utils/compressionUtils");
const DEFAULT_COMBAT_CONFIG = {
    enabled: true,
    tokenBudget: 800,
    modelSwitching: true,
    fallbackModel: 'gpt-3.5-turbo',
    contextPreservation: true,
    autoDetectCombat: true,
    compressionLevel: 'aggressive'
};
class CombatOptimizationService extends BaseService_1.BaseService {
    constructor(config = {}) {
        super('CombatOptimizationService', { performanceBudget: 50 });
        this.contextSnapshots = new Map();
        this.combatHistory = [];
        this.config = { ...DEFAULT_COMBAT_CONFIG, ...config };
    }
    async onInitialize() {
        this.eventBus.on('combat:start', this.handleCombatStart.bind(this));
        this.eventBus.on('combat:action', this.handleCombatAction.bind(this));
        this.eventBus.on('combat:end', this.handleCombatEnd.bind(this));
        this.eventBus.on('message:received', this.handleMessageReceived.bind(this));
        console.log('[CombatOpt] Initialized with config:', this.config);
    }
    async onShutdown() {
        if (this.activeCombat) {
            await this.saveCombatContext(this.activeCombat);
        }
        console.log('[CombatOpt] Shut down gracefully');
    }
    async enterCombatMode(combatContext) {
        return this.measureOperation('enterCombatMode', async () => {
            if (this.activeCombat) {
                throw new Error('Already in combat mode');
            }
            this.activeCombat = {
                id: `combat_${Date.now()}`,
                participants: combatContext.participants || [],
                location: combatContext.location || 'unknown',
                round: 1,
                initiative: [],
                status: 'preparing',
                startTime: new Date(),
                lastAction: new Date()
            };
            const fullContext = await this.captureFullContext();
            const contextSnapshot = await this.createContextSnapshot(fullContext);
            this.contextSnapshots.set(this.activeCombat.id, contextSnapshot);
            const minimalContext = await this.buildMinimalCombatContext(this.activeCombat);
            const modelSwitched = await this.switchToCombatModel();
            const fullTokens = tokenCounter_1.TokenCounter.estimateTokens(JSON.stringify(fullContext));
            const combatTokens = tokenCounter_1.TokenCounter.estimateTokens(JSON.stringify(minimalContext));
            const tokenReduction = fullTokens > 0 ? ((fullTokens - combatTokens) / fullTokens) * 100 : 0;
            this.activeCombat.status = 'active';
            this.eventBus.emit('combat:mode_entered', {
                combatId: this.activeCombat.id,
                tokenReduction,
                modelSwitched,
                participants: this.activeCombat.participants.length
            });
            return {
                success: true,
                tokenReduction,
                modelSwitched
            };
        });
    }
    async exitCombatMode() {
        return this.measureOperation('exitCombatMode', async () => {
            if (!this.activeCombat) {
                throw new Error('Not in combat mode');
            }
            const combatSummary = await this.generateCombatSummary(this.activeCombat);
            const contextSnapshot = this.contextSnapshots.get(this.activeCombat.id);
            const contextRestored = await this.restoreFullContext(contextSnapshot);
            await this.switchToMainModel();
            this.activeCombat.status = 'ended';
            this.combatHistory.push(this.activeCombat);
            this.contextSnapshots.delete(this.activeCombat.id);
            const completedCombat = this.activeCombat;
            this.activeCombat = undefined;
            this.eventBus.emit('combat:mode_exited', {
                combatId: completedCombat.id,
                duration: Date.now() - completedCombat.startTime.getTime(),
                rounds: completedCombat.round,
                summary: combatSummary
            });
            return {
                success: true,
                combatSummary,
                contextRestored
            };
        });
    }
    async processCombatAction(action, participantId) {
        return this.measureOperation('processCombatAction', async () => {
            if (!this.activeCombat) {
                throw new Error('Not in combat mode');
            }
            const participant = this.activeCombat.participants.find(p => p.id === participantId);
            if (!participant) {
                throw new Error(`Participant not found: ${participantId}`);
            }
            participant.actions.push(action);
            this.activeCombat.lastAction = new Date();
            const result = await this.generateActionResult(action, participant);
            const combatEnded = await this.checkCombatEndConditions();
            if (combatEnded) {
                await this.exitCombatMode();
            }
            else {
                await this.advanceCombatTurn();
            }
            return result;
        });
    }
    getCombatStatus() {
        if (!this.activeCombat) {
            return {
                inCombat: false,
                activeCombat: null,
                recentCombats: this.combatHistory.slice(-5)
            };
        }
        return {
            inCombat: true,
            activeCombat: {
                id: this.activeCombat.id,
                participants: this.activeCombat.participants.length,
                round: this.activeCombat.round,
                location: this.activeCombat.location,
                duration: Date.now() - this.activeCombat.startTime.getTime()
            },
            recentCombats: this.combatHistory.slice(-5)
        };
    }
    getOptimizationStats() {
        const snapshots = Array.from(this.contextSnapshots.values());
        const combats = this.combatHistory;
        if (snapshots.length === 0 && combats.length === 0) {
            return {
                totalCombats: 0,
                avgTokenReduction: 0,
                totalTokensSaved: 0,
                compressionRatio: 0
            };
        }
        const totalFullTokens = snapshots.reduce((sum, s) => sum + s.tokenCount.full, 0) +
            combats.reduce((sum, c) => sum + (c.participants.length * 200), 0);
        const totalCombatTokens = snapshots.reduce((sum, s) => sum + s.tokenCount.combat, 0) +
            combats.reduce((sum, c) => sum + Math.min(c.round * 50, 800), 0);
        const avgTokenReduction = totalFullTokens > 0 ?
            ((totalFullTokens - totalCombatTokens) / totalFullTokens) * 100 : 0;
        const totalTokensSaved = totalFullTokens - totalCombatTokens;
        const compressionRatio = totalCombatTokens / Math.max(totalFullTokens, 1);
        return {
            totalCombats: combats.length,
            avgTokenReduction,
            totalTokensSaved,
            compressionRatio
        };
    }
    async captureFullContext() {
        return new Promise((resolve) => {
            this.eventBus.emit('context:request_full', {}, (fullContext) => {
                resolve(fullContext);
            });
        });
    }
    async createContextSnapshot(fullContext) {
        const fullTokens = tokenCounter_1.TokenCounter.estimateTokens(JSON.stringify(fullContext));
        const compressedResult = compressionUtils_1.CompressionUtils.compress(fullContext, {
            method: 'hybrid',
            targetRatio: 0.3
        });
        const snapshot = {
            id: `snapshot_${Date.now()}`,
            timestamp: new Date(),
            fullContext,
            compressedContext: compressedResult.compressed,
            tokenCount: {
                full: fullTokens,
                compressed: tokenCounter_1.TokenCounter.estimateTokens(JSON.stringify(compressedResult.compressed)),
                combat: 0
            },
            metadata: {
                participants: 0,
                location: 'unknown',
                estimatedDuration: 0
            }
        };
        return snapshot;
    }
    async buildMinimalCombatContext(combatContext) {
        const minimalContext = {
            _combat_mode: true,
            system_prompt: this.getCombatSystemPrompt(),
            combatants: combatContext.participants.map(p => ({
                id: p.id,
                name: p.name,
                type: p.type,
                hp: p.stats.hp,
                maxHp: p.stats.maxHp,
                ac: p.stats.ac,
                statusEffects: p.statusEffects,
                position: p.position
            })),
            initiative: combatContext.initiative,
            current_round: combatContext.round,
            location: combatContext.location,
            recent_actions: this.getRecentActions(combatContext, 5),
            combat_rules: this.getCombatRules(),
            available_actions: this.getAvailableActions()
        };
        const combatTokens = tokenCounter_1.TokenCounter.estimateTokens(JSON.stringify(minimalContext));
        const snapshot = this.contextSnapshots.get(combatContext.id);
        if (snapshot) {
            snapshot.tokenCount.combat = combatTokens;
            snapshot.metadata.participants = combatContext.participants.length;
            snapshot.metadata.location = combatContext.location;
        }
        if (combatTokens > this.config.tokenBudget) {
            return await this.compressCombatContext(minimalContext, combatTokens);
        }
        return minimalContext;
    }
    getCombatSystemPrompt() {
        return `You are in COMBAT MODE. This is a streamlined combat system with minimal context to optimize performance.

COMBAT RULES:
- Initiative order determines turn sequence
- Actions: Attack, Defend, Move, Use Item, Cast Spell
- Combat ends when one side has no remaining combatants
- Use concise descriptions and focus on mechanical outcomes

Keep responses focused on combat mechanics and immediate tactical decisions.`;
    }
    getRecentActions(combatContext, limit) {
        const allActions = [];
        for (const participant of combatContext.participants) {
            allActions.push(...participant.actions.slice(-limit));
        }
        return allActions
            .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
            .slice(0, limit);
    }
    getCombatRules() {
        return {
            turn_structure: 'Initiative → Action → Resolution',
            action_types: ['attack', 'defend', 'move', 'spell', 'item'],
            win_conditions: ['all_enemies_defeated', 'all_allies_defeated', 'retreat'],
            damage_types: ['physical', 'magical', 'poison', 'fire', 'cold']
        };
    }
    getAvailableActions() {
        return {
            attack: { description: 'Make a melee or ranged attack' },
            defend: { description: 'Take defensive action, gain AC bonus' },
            move: { description: 'Change position on battlefield' },
            spell: { description: 'Cast a spell if available' },
            item: { description: 'Use an item from inventory' }
        };
    }
    async compressCombatContext(context, currentTokens) {
        const targetRatio = this.config.tokenBudget / currentTokens;
        return compressionUtils_1.CompressionUtils.compress(context, {
            method: 'structural',
            targetRatio: Math.max(0.1, targetRatio),
            preserveKeys: ['_combat_mode', 'system_prompt', 'combatants', 'current_round']
        }).compressed;
    }
    async switchToCombatModel() {
        if (!this.config.modelSwitching)
            return false;
        this.eventBus.emit('model:switch', {
            targetModel: this.config.fallbackModel,
            reason: 'combat_optimization',
            temporary: true
        });
        return true;
    }
    async switchToMainModel() {
        this.eventBus.emit('model:switch_back', {
            reason: 'combat_ended'
        });
        return true;
    }
    async generateActionResult(action, participant) {
        const success = Math.random() > 0.3;
        const result = {
            success,
            description: success ?
                `${participant.name} successfully ${action.type}s!` :
                `${participant.name}'s ${action.type} fails.`
        };
        if (action.type === 'attack' && success) {
            result.damage = Math.floor(Math.random() * 10) + 1;
            result.description += ` Deals ${result.damage} damage.`;
        }
        action.results = result;
        return result;
    }
    async checkCombatEndConditions() {
        if (!this.activeCombat)
            return false;
        const participants = this.activeCombat.participants;
        const alliesAlive = participants.filter(p => p.type === 'player' && p.stats.hp > 0).length;
        const enemiesAlive = participants.filter(p => p.type === 'monster' && p.stats.hp > 0).length;
        return alliesAlive === 0 || enemiesAlive === 0;
    }
    async advanceCombatTurn() {
        if (!this.activeCombat)
            return;
        const currentIndex = this.activeCombat.initiative.findIndex(i => i.currentTurn);
        const nextIndex = (currentIndex + 1) % this.activeCombat.initiative.length;
        if (currentIndex >= 0) {
            this.activeCombat.initiative[currentIndex].currentTurn = false;
        }
        this.activeCombat.initiative[nextIndex].currentTurn = true;
        if (nextIndex === 0) {
            this.activeCombat.round++;
        }
    }
    async generateCombatSummary(combatContext) {
        const duration = Date.now() - combatContext.startTime.getTime();
        const totalActions = combatContext.participants.reduce((sum, p) => sum + p.actions.length, 0);
        return {
            combatId: combatContext.id,
            duration,
            rounds: combatContext.round,
            participants: combatContext.participants.length,
            totalActions,
            location: combatContext.location,
            winner: this.determineWinner(combatContext),
            keyEvents: this.extractKeyEvents(combatContext)
        };
    }
    determineWinner(combatContext) {
        const alliesAlive = combatContext.participants.filter(p => p.type === 'player' && p.stats.hp > 0).length;
        const enemiesAlive = combatContext.participants.filter(p => p.type === 'monster' && p.stats.hp > 0).length;
        if (alliesAlive > 0 && enemiesAlive === 0)
            return 'allies';
        if (enemiesAlive > 0 && alliesAlive === 0)
            return 'enemies';
        return 'draw';
    }
    extractKeyEvents(combatContext) {
        const keyEvents = [];
        for (const participant of combatContext.participants) {
            const criticalActions = participant.actions.filter(action => { var _a; return ((_a = action.results) === null || _a === void 0 ? void 0 : _a.damage) && action.results.damage > 10; });
            for (const action of criticalActions) {
                keyEvents.push({
                    participant: participant.name,
                    action: action.type,
                    damage: action.results.damage,
                    round: combatContext.round
                });
            }
        }
        return keyEvents.slice(0, 5);
    }
    async restoreFullContext(snapshot) {
        if (!snapshot)
            return false;
        try {
            const fullContext = compressionUtils_1.CompressionUtils.decompress(snapshot.compressedContext, 'hybrid');
            if (fullContext.success) {
                this.eventBus.emit('context:restore', {
                    fullContext: fullContext.decompressed,
                    reason: 'combat_ended'
                });
                return true;
            }
        }
        catch (error) {
            console.error('[CombatOpt] Failed to restore context:', error);
        }
        return false;
    }
    async saveCombatContext(combatContext) {
        console.log(`[CombatOpt] Saving combat context: ${combatContext.id}`);
    }
    async handleCombatStart(data) {
        try {
            await this.enterCombatMode({
                participants: data.participants,
                location: data.location
            });
        }
        catch (error) {
            console.error('[CombatOpt] Error starting combat:', error);
        }
    }
    async handleCombatAction(data) {
        try {
            const result = await this.processCombatAction(data.action, data.participantId);
            this.eventBus.emit('combat:action_processed', {
                action: data.action,
                result,
                participantId: data.participantId
            });
        }
        catch (error) {
            console.error('[CombatOpt] Error processing combat action:', error);
        }
    }
    async handleCombatEnd() {
        try {
            await this.exitCombatMode();
        }
        catch (error) {
            console.error('[CombatOpt] Error ending combat:', error);
        }
    }
    async handleMessageReceived(data) {
        if (!this.config.autoDetectCombat)
            return;
        const combatKeywords = /\b(attacks?|fights?|battles?|combats?|initiative)\b/i;
        const hasCombatKeywords = combatKeywords.test(data.message);
        if (hasCombatKeywords && !this.activeCombat) {
            console.log('[CombatOpt] Combat detected from message, but no context provided');
        }
    }
}
exports.CombatOptimizationService = CombatOptimizationService;
exports.combatOptimizationService = new CombatOptimizationService();
