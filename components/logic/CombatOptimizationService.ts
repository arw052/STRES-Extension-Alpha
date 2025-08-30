/**
 * Combat Optimization Service - 90% Token Reduction During Combat
 *
 * Critical innovation: Switches between full context (~8000 tokens) and
 * minimal combat context (~800 tokens) for massive token savings
 */

import { BaseService } from '../../services/BaseService';
import { TokenCounter } from '../../../shared/utils/tokenCounter';
import { CompressionUtils } from '../../../shared/utils/compressionUtils';

export interface CombatConfig {
  enabled: boolean;
  tokenBudget: number; // Target token budget during combat
  modelSwitching: boolean; // Switch to cheaper model during combat
  fallbackModel: string; // Model to use during combat
  contextPreservation: boolean; // Preserve full context for restoration
  autoDetectCombat: boolean; // Automatically detect combat start/end
  compressionLevel: 'minimal' | 'balanced' | 'aggressive';
}

export interface CombatContext {
  id: string;
  participants: CombatParticipant[];
  location: string;
  round: number;
  initiative: InitiativeEntry[];
  status: 'preparing' | 'active' | 'ended';
  startTime: Date;
  lastAction: Date;
}

export interface CombatParticipant {
  id: string;
  name: string;
  type: 'player' | 'npc' | 'monster';
  stats: {
    hp: number;
    maxHp: number;
    ac: number;
    initiative: number;
  };
  position?: {
    x: number;
    y: number;
  };
  statusEffects: string[];
  actions: CombatAction[];
}

export interface InitiativeEntry {
  participantId: string;
  initiative: number;
  currentTurn: boolean;
}

export interface CombatAction {
  type: 'attack' | 'defend' | 'move' | 'spell' | 'item';
  description: string;
  timestamp: Date;
  results?: CombatResult;
}

export interface CombatResult {
  success: boolean;
  damage?: number;
  healing?: number;
  statusEffect?: string;
  description: string;
}

export interface ContextSnapshot {
  id: string;
  timestamp: Date;
  fullContext: any; // The complete game state before combat
  compressedContext: any; // Compressed version for storage
  tokenCount: {
    full: number;
    compressed: number;
    combat: number;
  };
  metadata: {
    participants: number;
    location: string;
    estimatedDuration: number;
  };
}

const DEFAULT_COMBAT_CONFIG: CombatConfig = {
  enabled: true,
  tokenBudget: 800, // Target ~800 tokens during combat
  modelSwitching: true,
  fallbackModel: 'gpt-3.5-turbo',
  contextPreservation: true,
  autoDetectCombat: true,
  compressionLevel: 'aggressive'
};

export class CombatOptimizationService extends BaseService {
  private config: CombatConfig;
  private activeCombat?: CombatContext;
  private contextSnapshots = new Map<string, ContextSnapshot>();
  private combatHistory: CombatContext[] = [];

  constructor(config: Partial<CombatConfig> = {}) {
    super('CombatOptimizationService', { performanceBudget: 50 });
    this.config = { ...DEFAULT_COMBAT_CONFIG, ...config };
  }

  protected async onInitialize(): Promise<void> {
    // Register event listeners
    this.eventBus.on('combat:start', this.handleCombatStart.bind(this));
    this.eventBus.on('combat:action', this.handleCombatAction.bind(this));
    this.eventBus.on('combat:end', this.handleCombatEnd.bind(this));
    this.eventBus.on('message:received', this.handleMessageReceived.bind(this));

    console.log('[CombatOpt] Initialized with config:', this.config);
  }

  protected async onShutdown(): Promise<void> {
    // Save any active combat context
    if (this.activeCombat) {
      await this.saveCombatContext(this.activeCombat);
    }

    console.log('[CombatOpt] Shut down gracefully');
  }

  /**
   * Enter combat mode with minimal context
   */
  async enterCombatMode(combatContext: Partial<CombatContext>): Promise<{
    success: boolean;
    tokenReduction: number;
    modelSwitched: boolean;
  }> {
    return this.measureOperation('enterCombatMode', async () => {
      if (this.activeCombat) {
        throw new Error('Already in combat mode');
      }

      // Create combat context
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

      // Take full context snapshot
      const fullContext = await this.captureFullContext();
      const contextSnapshot = await this.createContextSnapshot(fullContext);

      // Store snapshot
      this.contextSnapshots.set(this.activeCombat.id, contextSnapshot);

      // Switch to minimal combat context
      const minimalContext = await this.buildMinimalCombatContext(this.activeCombat);

      // Switch model if configured
      const modelSwitched = await this.switchToCombatModel();

      // Calculate token reduction
      const fullTokens = TokenCounter.estimateTokens(JSON.stringify(fullContext));
      const combatTokens = TokenCounter.estimateTokens(JSON.stringify(minimalContext));
      const tokenReduction = fullTokens > 0 ? ((fullTokens - combatTokens) / fullTokens) * 100 : 0;

      // Update combat status
      this.activeCombat.status = 'active';

      // Emit combat start event
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

  /**
   * Exit combat mode and restore full context
   */
  async exitCombatMode(): Promise<{
    success: boolean;
    combatSummary: any;
    contextRestored: boolean;
  }> {
    return this.measureOperation('exitCombatMode', async () => {
      if (!this.activeCombat) {
        throw new Error('Not in combat mode');
      }

      // Generate combat summary
      const combatSummary = await this.generateCombatSummary(this.activeCombat);

      // Restore full context
      const contextSnapshot = this.contextSnapshots.get(this.activeCombat.id);
      const contextRestored = await this.restoreFullContext(contextSnapshot);

      // Switch back to main model
      await this.switchToMainModel();

      // Save combat to history
      this.activeCombat.status = 'ended';
      this.combatHistory.push(this.activeCombat);

      // Clean up
      this.contextSnapshots.delete(this.activeCombat.id);
      const completedCombat = this.activeCombat;
      this.activeCombat = undefined;

      // Emit combat end event
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

  /**
   * Process combat action with optimized context
   */
  async processCombatAction(action: CombatAction, participantId: string): Promise<CombatResult> {
    return this.measureOperation('processCombatAction', async () => {
      if (!this.activeCombat) {
        throw new Error('Not in combat mode');
      }

      // Validate action
      const participant = this.activeCombat.participants.find(p => p.id === participantId);
      if (!participant) {
        throw new Error(`Participant not found: ${participantId}`);
      }

      // Add action to participant history
      participant.actions.push(action);

      // Update combat state
      this.activeCombat.lastAction = new Date();

      // Generate result (simplified - would integrate with LLM)
      const result = await this.generateActionResult(action, participant);

      // Check for combat end conditions
      const combatEnded = await this.checkCombatEndConditions();

      if (combatEnded) {
        await this.exitCombatMode();
      } else {
        // Advance to next turn
        await this.advanceCombatTurn();
      }

      return result;
    });
  }

  /**
   * Get current combat status
   */
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

  /**
   * Get token optimization stats
   */
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
                           combats.reduce((sum, c) => sum + (c.participants.length * 200), 0); // Estimate

    const totalCombatTokens = snapshots.reduce((sum, s) => sum + s.tokenCount.combat, 0) +
                             combats.reduce((sum, c) => sum + Math.min(c.round * 50, 800), 0); // Estimate

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

  // Private methods

  private async captureFullContext(): Promise<any> {
    // Request full context from other services
    // This would integrate with the main game state management
    return new Promise((resolve) => {
      this.eventBus.emit('context:request_full', {}, (fullContext: any) => {
        resolve(fullContext);
      });
    });
  }

  private async createContextSnapshot(fullContext: any): Promise<ContextSnapshot> {
    const fullTokens = TokenCounter.estimateTokens(JSON.stringify(fullContext));

    // Compress full context for storage
    const compressedResult = CompressionUtils.compress(fullContext, {
      method: 'hybrid',
      targetRatio: 0.3 // 70% compression for storage
    });

    const snapshot: ContextSnapshot = {
      id: `snapshot_${Date.now()}`,
      timestamp: new Date(),
      fullContext,
      compressedContext: compressedResult.compressed,
      tokenCount: {
        full: fullTokens,
        compressed: TokenCounter.estimateTokens(JSON.stringify(compressedResult.compressed)),
        combat: 0 // Will be set when combat context is built
      },
      metadata: {
        participants: 0, // Will be updated
        location: 'unknown',
        estimatedDuration: 0
      }
    };

    return snapshot;
  }

  private async buildMinimalCombatContext(combatContext: CombatContext): Promise<any> {
    // Build minimal context with only combat-essential information
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

    // Calculate combat context tokens
    const combatTokens = TokenCounter.estimateTokens(JSON.stringify(minimalContext));

    // Update snapshot with combat token count
    const snapshot = this.contextSnapshots.get(combatContext.id);
    if (snapshot) {
      snapshot.tokenCount.combat = combatTokens;
      snapshot.metadata.participants = combatContext.participants.length;
      snapshot.metadata.location = combatContext.location;
    }

    // Ensure we stay within token budget
    if (combatTokens > this.config.tokenBudget) {
      return await this.compressCombatContext(minimalContext, combatTokens);
    }

    return minimalContext;
  }

  private getCombatSystemPrompt(): string {
    return `You are in COMBAT MODE. This is a streamlined combat system with minimal context to optimize performance.

COMBAT RULES:
- Initiative order determines turn sequence
- Actions: Attack, Defend, Move, Use Item, Cast Spell
- Combat ends when one side has no remaining combatants
- Use concise descriptions and focus on mechanical outcomes

Keep responses focused on combat mechanics and immediate tactical decisions.`;
  }

  private getRecentActions(combatContext: CombatContext, limit: number): any[] {
    const allActions: any[] = [];

    for (const participant of combatContext.participants) {
      allActions.push(...participant.actions.slice(-limit));
    }

    // Sort by timestamp and take most recent
    return allActions
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  private getCombatRules(): any {
    return {
      turn_structure: 'Initiative → Action → Resolution',
      action_types: ['attack', 'defend', 'move', 'spell', 'item'],
      win_conditions: ['all_enemies_defeated', 'all_allies_defeated', 'retreat'],
      damage_types: ['physical', 'magical', 'poison', 'fire', 'cold']
    };
  }

  private getAvailableActions(): any {
    return {
      attack: { description: 'Make a melee or ranged attack' },
      defend: { description: 'Take defensive action, gain AC bonus' },
      move: { description: 'Change position on battlefield' },
      spell: { description: 'Cast a spell if available' },
      item: { description: 'Use an item from inventory' }
    };
  }

  private async compressCombatContext(context: any, currentTokens: number): Promise<any> {
    // Compress to fit within token budget
    const targetRatio = this.config.tokenBudget / currentTokens;

    return CompressionUtils.compress(context, {
      method: 'structural',
      targetRatio: Math.max(0.1, targetRatio), // Minimum 10% of original
      preserveKeys: ['_combat_mode', 'system_prompt', 'combatants', 'current_round']
    }).compressed;
  }

  private async switchToCombatModel(): Promise<boolean> {
    if (!this.config.modelSwitching) return false;

    // Emit model switch request
    this.eventBus.emit('model:switch', {
      targetModel: this.config.fallbackModel,
      reason: 'combat_optimization',
      temporary: true
    });

    return true;
  }

  private async switchToMainModel(): Promise<boolean> {
    // Emit model switch back request
    this.eventBus.emit('model:switch_back', {
      reason: 'combat_ended'
    });

    return true;
  }

  private async generateActionResult(action: CombatAction, participant: CombatParticipant): Promise<CombatResult> {
    // This would integrate with the LLM to generate actual results
    // For now, return a mock result
    const success = Math.random() > 0.3; // 70% success rate

    const result: CombatResult = {
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

  private async checkCombatEndConditions(): Promise<boolean> {
    if (!this.activeCombat) return false;

    const participants = this.activeCombat.participants;
    const alliesAlive = participants.filter(p => p.type === 'player' && p.stats.hp > 0).length;
    const enemiesAlive = participants.filter(p => p.type === 'monster' && p.stats.hp > 0).length;

    return alliesAlive === 0 || enemiesAlive === 0;
  }

  private async advanceCombatTurn(): Promise<void> {
    if (!this.activeCombat) return;

    // Simple initiative system - rotate through participants
    const currentIndex = this.activeCombat.initiative.findIndex(i => i.currentTurn);
    const nextIndex = (currentIndex + 1) % this.activeCombat.initiative.length;

    if (currentIndex >= 0) {
      this.activeCombat.initiative[currentIndex].currentTurn = false;
    }
    this.activeCombat.initiative[nextIndex].currentTurn = true;

    // Increment round if we completed a full cycle
    if (nextIndex === 0) {
      this.activeCombat.round++;
    }
  }

  private async generateCombatSummary(combatContext: CombatContext): Promise<any> {
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

  private determineWinner(combatContext: CombatContext): string {
    const alliesAlive = combatContext.participants.filter(p => p.type === 'player' && p.stats.hp > 0).length;
    const enemiesAlive = combatContext.participants.filter(p => p.type === 'monster' && p.stats.hp > 0).length;

    if (alliesAlive > 0 && enemiesAlive === 0) return 'allies';
    if (enemiesAlive > 0 && alliesAlive === 0) return 'enemies';
    return 'draw';
  }

  private extractKeyEvents(combatContext: CombatContext): any[] {
    const keyEvents: any[] = [];

    for (const participant of combatContext.participants) {
      const criticalActions = participant.actions.filter(action =>
        action.results?.damage && action.results.damage > 10
      );

      for (const action of criticalActions) {
        keyEvents.push({
          participant: participant.name,
          action: action.type,
          damage: action.results!.damage,
          round: combatContext.round
        });
      }
    }

    return keyEvents.slice(0, 5); // Top 5 key events
  }

  private async restoreFullContext(snapshot?: ContextSnapshot): Promise<boolean> {
    if (!snapshot) return false;

    try {
      // Decompress and restore full context
      const fullContext = CompressionUtils.decompress(snapshot.compressedContext, 'hybrid');

      if (fullContext.success) {
        // Emit context restoration
        this.eventBus.emit('context:restore', {
          fullContext: fullContext.decompressed,
          reason: 'combat_ended'
        });

        return true;
      }
    } catch (error) {
      console.error('[CombatOpt] Failed to restore context:', error);
    }

    return false;
  }

  private async saveCombatContext(combatContext: CombatContext): Promise<void> {
    // Implementation would save to database
    console.log(`[CombatOpt] Saving combat context: ${combatContext.id}`);
  }

  // Event handlers

  private async handleCombatStart(data: { participants: CombatParticipant[]; location: string }): Promise<void> {
    try {
      await this.enterCombatMode({
        participants: data.participants,
        location: data.location
      });
    } catch (error) {
      console.error('[CombatOpt] Error starting combat:', error);
    }
  }

  private async handleCombatAction(data: { action: CombatAction; participantId: string }): Promise<void> {
    try {
      const result = await this.processCombatAction(data.action, data.participantId);
      this.eventBus.emit('combat:action_processed', {
        action: data.action,
        result,
        participantId: data.participantId
      });
    } catch (error) {
      console.error('[CombatOpt] Error processing combat action:', error);
    }
  }

  private async handleCombatEnd(): Promise<void> {
    try {
      await this.exitCombatMode();
    } catch (error) {
      console.error('[CombatOpt] Error ending combat:', error);
    }
  }

  private async handleMessageReceived(data: { message: string }): Promise<void> {
    if (!this.config.autoDetectCombat) return;

    // Simple combat detection from messages
    const combatKeywords = /\b(attacks?|fights?|battles?|combats?|initiative)\b/i;
    const hasCombatKeywords = combatKeywords.test(data.message);

    if (hasCombatKeywords && !this.activeCombat) {
      console.log('[CombatOpt] Combat detected from message, but no context provided');
      // Could emit combat detection event for manual handling
    }
  }
}

// Global instance
export const combatOptimizationService = new CombatOptimizationService();
