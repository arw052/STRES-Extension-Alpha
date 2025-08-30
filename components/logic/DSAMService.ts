/**
 * DSAM Service - Differentially Stored Associative Memory
 *
 * Core innovation: 90% conversation compression while maintaining narrative consistency
 * Uses differential storage and associative linking for intelligent memory management
 */

import { BaseService } from '../../services/BaseService';
import { TokenCounter } from '../../../shared/utils/tokenCounter';
import { CompressionUtils } from '../../../shared/utils/compressionUtils';
import { RelevanceScorer } from '../../../shared/utils/relevanceScorer';

export interface DSAMConfig {
  enabled: boolean;
  compressionLevel: number; // 1-10
  memoryWindow: number; // Days to keep "hot"
  summaryDetail: 'minimal' | 'balanced' | 'detailed';
  associationThreshold: number; // Minimum relevance for associations
  maxAssociations: number; // Maximum associations per memory
  cleanupInterval: number; // Hours between cleanup operations
}

export interface DSAMMemory {
  id: string;
  content: any;
  timestamp: Date;
  type: 'conversation' | 'event' | 'character' | 'location' | 'relationship';
  associations: MemoryAssociation[];
  compressionLevel: number;
  relevanceScore: number;
  metadata: {
    originalTokens: number;
    compressedTokens: number;
    compressionRatio: number;
    context: string[];
    tags: string[];
  };
}

export interface MemoryAssociation {
  targetId: string;
  strength: number; // 0.0 to 1.0
  type: 'temporal' | 'spatial' | 'character' | 'thematic' | 'causal';
  reason: string;
  lastAccessed: Date;
}

export interface DSAMQuery {
  query: string;
  context?: {
    characterIds?: string[];
    locationIds?: string[];
    timeWindow?: { start: Date; end: Date };
    themes?: string[];
  };
  limit?: number;
  minRelevance?: number;
}

export interface DSAMResult {
  memories: DSAMMemory[];
  totalFound: number;
  compressionSavings: {
    originalTokens: number;
    compressedTokens: number;
    savingsPercent: number;
  };
  queryTime: number;
}

export interface ConversationContext {
  participants: string[];
  location: string;
  time: Date;
  themes: string[];
  emotionalTone: 'positive' | 'negative' | 'neutral' | 'tense';
  importance: 'minor' | 'moderate' | 'major' | 'critical';
}

const DEFAULT_DSAM_CONFIG: DSAMConfig = {
  enabled: true,
  compressionLevel: 5,
  memoryWindow: 7, // 7 days
  summaryDetail: 'balanced',
  associationThreshold: 0.3,
  maxAssociations: 10,
  cleanupInterval: 24 // 24 hours
};

export class DSAMService extends BaseService {
  private config: DSAMConfig;
  private memoryStore = new Map<string, DSAMMemory>();
  private associationIndex = new Map<string, Set<string>>();
  private cleanupTimer?: NodeJS.Timeout;

  constructor(config: Partial<DSAMConfig> = {}) {
    super('DSAMService', { performanceBudget: 100 });
    this.config = { ...DEFAULT_DSAM_CONFIG, ...config };
  }

  protected async onInitialize(): Promise<void> {
    // Register event listeners
    this.eventBus.on('conversation:new', this.handleNewConversation.bind(this));
    this.eventBus.on('character:action', this.handleCharacterAction.bind(this));
    this.eventBus.on('memory:query', this.handleMemoryQuery.bind(this));
    this.eventBus.on('dsam:cleanup', this.handleCleanupRequest.bind(this));

    // Start cleanup timer
    this.startCleanupTimer();

    console.log('[DSAM] Initialized with config:', this.config);
  }

  protected async onShutdown(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    // Save all memories
    await this.persistAllMemories();

    console.log('[DSAM] Shut down gracefully');
  }

  /**
   * Store conversation with DSAM compression
   */
  async storeConversation(
    conversation: any,
    context: ConversationContext
  ): Promise<DSAMMemory> {
    return this.measureOperation('storeConversation', async () => {
      const memoryId = this.generateMemoryId();

      // Analyze conversation content
      const analysis = await this.analyzeConversation(conversation, context);

      // Create associations
      const associations = await this.createAssociations(analysis, context);

      // Compress conversation
      const compressed = this.compressConversation(conversation, analysis);

      // Calculate relevance score
      const relevanceScore = await this.calculateMemoryRelevance(analysis, context);

      // Create DSAM memory
      const memory: DSAMMemory = {
        id: memoryId,
        content: compressed,
        timestamp: new Date(),
        type: 'conversation',
        associations,
        compressionLevel: this.config.compressionLevel,
        relevanceScore,
        metadata: {
          originalTokens: analysis.tokenCount,
          compressedTokens: compressed.tokenCount || 0,
          compressionRatio: compressed.compressionRatio || 1.0,
          context: context.themes,
          tags: analysis.tags
        }
      };

      // Store memory
      this.memoryStore.set(memoryId, memory);

      // Update association index
      this.updateAssociationIndex(memory);

      // Emit storage event
      this.eventBus.emit('dsam:memory_stored', {
        memoryId,
        compressionSavings: memory.metadata.compressionRatio,
        associationsCount: associations.length
      });

      return memory;
    });
  }

  /**
   * Query memories with associative recall
   */
  async queryMemories(query: DSAMQuery): Promise<DSAMResult> {
    return this.measureOperation('queryMemories', async () => {
      const startTime = performance.now();

      // Find relevant memories
      const relevantMemories = await this.findRelevantMemories(query);

      // Sort by relevance
      relevantMemories.sort((a, b) => b.relevanceScore - a.relevanceScore);

      // Limit results
      const memories = relevantMemories.slice(0, query.limit || 10);

      // Calculate compression savings
      const totalOriginalTokens = memories.reduce((sum, m) => sum + m.metadata.originalTokens, 0);
      const totalCompressedTokens = memories.reduce((sum, m) => sum + m.metadata.compressedTokens, 0);
      const savingsPercent = totalOriginalTokens > 0 ?
        ((totalOriginalTokens - totalCompressedTokens) / totalOriginalTokens) * 100 : 0;

      const result: DSAMResult = {
        memories,
        totalFound: relevantMemories.length,
        compressionSavings: {
          originalTokens: totalOriginalTokens,
          compressedTokens: totalCompressedTokens,
          savingsPercent
        },
        queryTime: performance.now() - startTime
      };

      // Emit query event
      this.eventBus.emit('dsam:query_completed', {
        query: query.query,
        resultsFound: result.totalFound,
        tokensSaved: result.compressionSavings.originalTokens - result.compressionSavings.compressedTokens
      });

      return result;
    });
  }

  /**
   * Expand compressed memory back to usable form
   */
  async expandMemory(memoryId: string, targetDetail: 'minimal' | 'balanced' | 'detailed' = 'balanced'): Promise<any> {
    return this.measureOperation('expandMemory', async () => {
      const memory = this.memoryStore.get(memoryId);
      if (!memory) {
        throw new Error(`Memory not found: ${memoryId}`);
      }

      // Get associated memories for context
      const associatedMemories = await this.getAssociatedMemories(memoryId);

      // Expand based on detail level
      const expanded = await this.expandCompressedContent(memory, associatedMemories, targetDetail);

      // Update access time
      memory.associations.forEach(assoc => {
        assoc.lastAccessed = new Date();
      });

      return expanded;
    });
  }

  /**
   * Get memory statistics
   */
  getMemoryStats() {
    const memories = Array.from(this.memoryStore.values());
    const totalMemories = memories.length;

    if (totalMemories === 0) {
      return {
        totalMemories: 0,
        compressionRatio: 0,
        avgAssociations: 0,
        memoryTypes: {},
        totalTokensSaved: 0
      };
    }

    const totalOriginalTokens = memories.reduce((sum, m) => sum + m.metadata.originalTokens, 0);
    const totalCompressedTokens = memories.reduce((sum, m) => sum + m.metadata.compressedTokens, 0);
    const avgCompressionRatio = memories.reduce((sum, m) => sum + m.metadata.compressionRatio, 0) / totalMemories;
    const avgAssociations = memories.reduce((sum, m) => sum + m.associations.length, 0) / totalMemories;

    const memoryTypes = memories.reduce((acc, memory) => {
      acc[memory.type] = (acc[memory.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const totalTokensSaved = totalOriginalTokens - totalCompressedTokens;

    return {
      totalMemories,
      compressionRatio: avgCompressionRatio,
      avgAssociations,
      memoryTypes,
      totalTokensSaved
    };
  }

  // Private methods

  private async analyzeConversation(conversation: any, context: ConversationContext) {
    // Analyze conversation content for key elements
    const contentStr = JSON.stringify(conversation);
    const tokenCount = TokenCounter.estimateTokens(contentStr);

    // Extract themes and tags
    const themes = this.extractThemes(conversation, context);
    const tags = this.generateTags(conversation, context);

    // Assess importance
    const importance = this.assessImportance(conversation, context);

    return {
      tokenCount,
      themes,
      tags,
      importance,
      participants: context.participants,
      location: context.location
    };
  }

  private async createAssociations(analysis: any, context: ConversationContext): Promise<MemoryAssociation[]> {
    const associations: MemoryAssociation[] = [];

    // Temporal associations (time-based)
    associations.push({
      targetId: `time:${context.time.toISOString().split('T')[0]}`, // Date-based
      strength: 0.8,
      type: 'temporal',
      reason: 'Same day conversation',
      lastAccessed: new Date()
    });

    // Character associations
    for (const participant of context.participants) {
      associations.push({
        targetId: participant,
        strength: 0.9,
        type: 'character',
        reason: 'Direct participant',
        lastAccessed: new Date()
      });
    }

    // Location associations
    if (context.location) {
      associations.push({
        targetId: context.location,
        strength: 0.7,
        type: 'spatial',
        reason: 'Conversation location',
        lastAccessed: new Date()
      });
    }

    // Thematic associations
    for (const theme of analysis.themes) {
      associations.push({
        targetId: `theme:${theme}`,
        strength: 0.6,
        type: 'thematic',
        reason: `Theme: ${theme}`,
        lastAccessed: new Date()
      });
    }

    // Limit associations and sort by strength
    return associations
      .sort((a, b) => b.strength - a.strength)
      .slice(0, this.config.maxAssociations);
  }

  private compressConversation(conversation: any, analysis: any) {
    // Choose compression method based on content type
    const method = CompressionUtils.chooseBestMethod(conversation, 0.1); // 90% compression target

    const result = CompressionUtils.compress(conversation, {
      method,
      targetRatio: 0.1, // 90% reduction
      preserveKeys: ['participants', 'timestamp', 'location', 'key_points']
    });

    return {
      ...result,
      tokenCount: TokenCounter.estimateTokens(JSON.stringify(result.compressed))
    };
  }

  private async calculateMemoryRelevance(analysis: any, context: ConversationContext): Promise<number> {
    // Use RelevanceScorer to calculate importance
    const contentAnalysis = {
      content: analysis,
      contentType: 'conversation' as const,
      lastAccessed: new Date(),
      accessCount: 1,
      relationships: [...context.participants, context.location].filter(Boolean),
      tags: analysis.tags,
      metadata: {
        importance: analysis.importance,
        themes: analysis.themes
      }
    };

    const scoringContext = {
      interactionType: 'social' as const,
      importance: context.importance as 'critical' | 'high' | 'medium' | 'low',
      userQuery: context.themes.join(' ')
    };

    const score = RelevanceScorer.calculateRelevance(contentAnalysis, scoringContext);
    return score.overall;
  }

  private async findRelevantMemories(query: DSAMQuery): Promise<DSAMMemory[]> {
    const relevantMemories: DSAMMemory[] = [];

    // Direct text matching
    for (const memory of this.memoryStore.values()) {
      let relevance = 0;

      // Text content matching
      const contentStr = JSON.stringify(memory.content).toLowerCase();
      const queryStr = query.query.toLowerCase();

      if (contentStr.includes(queryStr)) {
        relevance += 0.5;
      }

      // Context matching
      if (query.context) {
        if (query.context.characterIds) {
          const hasCharacterMatch = query.context.characterIds.some(id =>
            memory.associations.some(assoc => assoc.targetId === id)
          );
          if (hasCharacterMatch) relevance += 0.3;
        }

        if (query.context.themes) {
          const themeMatches = query.context.themes.filter(theme =>
            memory.metadata.context.includes(theme)
          ).length;
          relevance += (themeMatches / query.context.themes.length) * 0.2;
        }
      }

      // Tag matching
      const tagMatches = memory.metadata.tags.filter(tag =>
        query.query.toLowerCase().includes(tag.toLowerCase())
      ).length;
      relevance += (tagMatches / memory.metadata.tags.length) * 0.2;

      if (relevance >= (query.minRelevance || 0.1)) {
        // Update memory with calculated relevance
        const memoryWithRelevance = { ...memory, relevanceScore: relevance };
        relevantMemories.push(memoryWithRelevance);
      }
    }

    return relevantMemories;
  }

  private async getAssociatedMemories(memoryId: string): Promise<DSAMMemory[]> {
    const memory = this.memoryStore.get(memoryId);
    if (!memory) return [];

    const associatedIds = memory.associations.map(assoc => assoc.targetId);
    const associatedMemories: DSAMMemory[] = [];

    for (const id of associatedIds) {
      const associatedMemory = this.memoryStore.get(id);
      if (associatedMemory) {
        associatedMemories.push(associatedMemory);
      }
    }

    return associatedMemories;
  }

  private async expandCompressedContent(
    memory: DSAMMemory,
    associatedMemories: DSAMMemory[],
    targetDetail: 'minimal' | 'balanced' | 'detailed'
  ): Promise<any> {
    // Decompress the main content
    const decompressed = CompressionUtils.decompress(memory.content, 'semantic');

    if (!decompressed.success) {
      console.warn('[DSAM] Decompression failed, returning compressed content');
      return memory.content;
    }

    let expanded = decompressed.decompressed;

    // Enhance with associated memories based on detail level
    if (targetDetail === 'detailed') {
      expanded = await this.enhanceWithAssociations(expanded, associatedMemories, 'full');
    } else if (targetDetail === 'balanced') {
      expanded = await this.enhanceWithAssociations(expanded, associatedMemories, 'partial');
    }
    // For minimal, return just the decompressed content

    return expanded;
  }

  private async enhanceWithAssociations(
    content: any,
    associatedMemories: DSAMMemory[],
    enhancementLevel: 'partial' | 'full'
  ): Promise<any> {
    // Add context from associated memories
    const enhancements: Record<string, any> = {};

    for (const assocMemory of associatedMemories) {
      if (enhancementLevel === 'full') {
        // Fully expand associated memories
        const expandedAssoc = await this.expandMemory(assocMemory.id, 'minimal');
        enhancements[assocMemory.type] = expandedAssoc;
      } else {
        // Just add summary from associated memory
        enhancements[assocMemory.type] = {
          summary: assocMemory.content,
          relevance: assocMemory.relevanceScore
        };
      }
    }

    return {
      ...content,
      _dsam_enhancements: enhancements,
      _dsam_expanded_at: new Date().toISOString()
    };
  }

  private extractThemes(conversation: any, context: ConversationContext): string[] {
    const themes: string[] = [...context.themes];

    // Extract themes from conversation content
    const contentStr = JSON.stringify(conversation).toLowerCase();

    const themeKeywords = {
      romance: ['love', 'romantic', 'relationship', 'feelings', 'attraction'],
      combat: ['fight', 'battle', 'combat', 'attack', 'defend', 'weapon'],
      mystery: ['secret', 'mystery', 'investigation', 'clue', 'hidden'],
      adventure: ['explore', 'journey', 'quest', 'discovery', 'travel'],
      politics: ['power', 'alliance', 'kingdom', 'ruler', 'diplomacy'],
      magic: ['spell', 'magic', 'enchantment', 'wizard', 'sorcerer']
    };

    for (const [theme, keywords] of Object.entries(themeKeywords)) {
      const matches = keywords.filter(keyword => contentStr.includes(keyword)).length;
      if (matches >= 2) { // At least 2 keyword matches
        themes.push(theme);
      }
    }

    return [...new Set(themes)]; // Remove duplicates
  }

  private generateTags(conversation: any, context: ConversationContext): string[] {
    const tags: string[] = [];

    // Add participant tags
    tags.push(...context.participants.map(p => `participant:${p}`));

    // Add location tag
    if (context.location) {
      tags.push(`location:${context.location}`);
    }

    // Add emotional tone tag
    tags.push(`tone:${context.emotionalTone}`);

    // Add importance tag
    tags.push(`importance:${context.importance}`);

    // Add time-based tags
    const hour = context.time.getHours();
    if (hour < 6) tags.push('time:dawn');
    else if (hour < 12) tags.push('time:morning');
    else if (hour < 18) tags.push('time:afternoon');
    else tags.push('time:evening');

    return tags;
  }

  private assessImportance(conversation: any, context: ConversationContext): 'minor' | 'moderate' | 'major' | 'critical' {
    let score = 0;

    // Importance based on participants (more important characters = higher score)
    if (context.participants.includes('player')) score += 3;
    if (context.participants.some(p => p.includes('king') || p.includes('queen'))) score += 2;

    // Importance based on emotional tone
    if (context.emotionalTone === 'tense') score += 2;
    if (context.emotionalTone === 'negative') score += 1;

    // Importance based on themes
    if (context.themes.includes('romance')) score += 1;
    if (context.themes.includes('combat')) score += 2;
    if (context.themes.includes('politics')) score += 2;

    if (score >= 6) return 'critical';
    if (score >= 4) return 'major';
    if (score >= 2) return 'moderate';
    return 'minor';
  }

  private updateAssociationIndex(memory: DSAMMemory): void {
    for (const association of memory.associations) {
      if (!this.associationIndex.has(association.targetId)) {
        this.associationIndex.set(association.targetId, new Set());
      }
      this.associationIndex.get(association.targetId)!.add(memory.id);
    }
  }

  private generateMemoryId(): string {
    return `dsam_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.performCleanup();
    }, this.config.cleanupInterval * 60 * 60 * 1000); // Convert hours to milliseconds
  }

  private async performCleanup(): Promise<void> {
    const now = new Date();
    const cutoffDate = new Date(now.getTime() - (this.config.memoryWindow * 24 * 60 * 60 * 1000));

    const memoriesToRemove: string[] = [];

    for (const [id, memory] of this.memoryStore) {
      if (memory.timestamp < cutoffDate && memory.relevanceScore < 0.5) {
        memoriesToRemove.push(id);
      }
    }

    for (const id of memoriesToRemove) {
      this.memoryStore.delete(id);
      // Also clean up association index
      for (const [targetId, memoryIds] of this.associationIndex) {
        memoryIds.delete(id);
        if (memoryIds.size === 0) {
          this.associationIndex.delete(targetId);
        }
      }
    }

    if (memoriesToRemove.length > 0) {
      console.log(`[DSAM] Cleaned up ${memoriesToRemove.length} old memories`);
    }
  }

  private async persistAllMemories(): Promise<void> {
    // Implementation would save to database
    // For now, just log
    console.log(`[DSAM] Persisting ${this.memoryStore.size} memories`);
  }

  // Event handlers

  private async handleNewConversation(data: { conversation: any; context: ConversationContext }): Promise<void> {
    try {
      await this.storeConversation(data.conversation, data.context);
    } catch (error) {
      console.error('[DSAM] Error storing conversation:', error);
    }
  }

  private async handleCharacterAction(data: { characterId: string; action: any }): Promise<void> {
    // Could create memory for character actions
    // Implementation depends on action format
  }

  private async handleMemoryQuery(data: { query: DSAMQuery }): Promise<void> {
    try {
      const result = await this.queryMemories(data.query);
      this.eventBus.emit('dsam:query_result', result);
    } catch (error) {
      console.error('[DSAM] Error processing memory query:', error);
    }
  }

  private async handleCleanupRequest(): Promise<void> {
    await this.performCleanup();
  }
}

// Global instance
export const dsamService = new DSAMService();
