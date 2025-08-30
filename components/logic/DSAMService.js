"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dsamService = exports.DSAMService = void 0;
const BaseService_1 = require("../../services/BaseService");
const tokenCounter_1 = require("../../shared/utils/tokenCounter");
const compressionUtils_1 = require("../../shared/utils/compressionUtils");
const relevanceScorer_1 = require("../../shared/utils/relevanceScorer");
const DEFAULT_DSAM_CONFIG = {
    enabled: true,
    compressionLevel: 5,
    memoryWindow: 7,
    summaryDetail: 'balanced',
    associationThreshold: 0.3,
    maxAssociations: 10,
    cleanupInterval: 24
};
class DSAMService extends BaseService_1.BaseService {
    constructor(config = {}) {
        super('DSAMService', { performanceBudget: 100 });
        this.memoryStore = new Map();
        this.associationIndex = new Map();
        this.config = { ...DEFAULT_DSAM_CONFIG, ...config };
    }
    async onInitialize() {
        this.eventBus.on('conversation:new', this.handleNewConversation.bind(this));
        this.eventBus.on('character:action', this.handleCharacterAction.bind(this));
        this.eventBus.on('memory:query', this.handleMemoryQuery.bind(this));
        this.eventBus.on('dsam:cleanup', this.handleCleanupRequest.bind(this));
        this.startCleanupTimer();
        console.log('[DSAM] Initialized with config:', this.config);
    }
    async onShutdown() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
        }
        await this.persistAllMemories();
        console.log('[DSAM] Shut down gracefully');
    }
    async storeConversation(conversation, context) {
        return this.measureOperation('storeConversation', async () => {
            const memoryId = this.generateMemoryId();
            const analysis = await this.analyzeConversation(conversation, context);
            const associations = await this.createAssociations(analysis, context);
            const compressed = this.compressConversation(conversation, analysis);
            const relevanceScore = await this.calculateMemoryRelevance(analysis, context);
            const memory = {
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
            this.memoryStore.set(memoryId, memory);
            this.updateAssociationIndex(memory);
            this.eventBus.emit('dsam:memory_stored', {
                memoryId,
                compressionSavings: memory.metadata.compressionRatio,
                associationsCount: associations.length
            });
            return memory;
        });
    }
    async queryMemories(query) {
        return this.measureOperation('queryMemories', async () => {
            const startTime = performance.now();
            const relevantMemories = await this.findRelevantMemories(query);
            relevantMemories.sort((a, b) => b.relevanceScore - a.relevanceScore);
            const memories = relevantMemories.slice(0, query.limit || 10);
            const totalOriginalTokens = memories.reduce((sum, m) => sum + m.metadata.originalTokens, 0);
            const totalCompressedTokens = memories.reduce((sum, m) => sum + m.metadata.compressedTokens, 0);
            const savingsPercent = totalOriginalTokens > 0 ?
                ((totalOriginalTokens - totalCompressedTokens) / totalOriginalTokens) * 100 : 0;
            const result = {
                memories,
                totalFound: relevantMemories.length,
                compressionSavings: {
                    originalTokens: totalOriginalTokens,
                    compressedTokens: totalCompressedTokens,
                    savingsPercent
                },
                queryTime: performance.now() - startTime
            };
            this.eventBus.emit('dsam:query_completed', {
                query: query.query,
                resultsFound: result.totalFound,
                tokensSaved: result.compressionSavings.originalTokens - result.compressionSavings.compressedTokens
            });
            return result;
        });
    }
    async expandMemory(memoryId, targetDetail = 'balanced') {
        return this.measureOperation('expandMemory', async () => {
            const memory = this.memoryStore.get(memoryId);
            if (!memory) {
                throw new Error(`Memory not found: ${memoryId}`);
            }
            const associatedMemories = await this.getAssociatedMemories(memoryId);
            const expanded = await this.expandCompressedContent(memory, associatedMemories, targetDetail);
            memory.associations.forEach(assoc => {
                assoc.lastAccessed = new Date();
            });
            return expanded;
        });
    }
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
        }, {});
        const totalTokensSaved = totalOriginalTokens - totalCompressedTokens;
        return {
            totalMemories,
            compressionRatio: avgCompressionRatio,
            avgAssociations,
            memoryTypes,
            totalTokensSaved
        };
    }
    async analyzeConversation(conversation, context) {
        const contentStr = JSON.stringify(conversation);
        const tokenCount = tokenCounter_1.TokenCounter.estimateTokens(contentStr);
        const themes = this.extractThemes(conversation, context);
        const tags = this.generateTags(conversation, context);
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
    async createAssociations(analysis, context) {
        const associations = [];
        associations.push({
            targetId: `time:${context.time.toISOString().split('T')[0]}`,
            strength: 0.8,
            type: 'temporal',
            reason: 'Same day conversation',
            lastAccessed: new Date()
        });
        for (const participant of context.participants) {
            associations.push({
                targetId: participant,
                strength: 0.9,
                type: 'character',
                reason: 'Direct participant',
                lastAccessed: new Date()
            });
        }
        if (context.location) {
            associations.push({
                targetId: context.location,
                strength: 0.7,
                type: 'spatial',
                reason: 'Conversation location',
                lastAccessed: new Date()
            });
        }
        for (const theme of analysis.themes) {
            associations.push({
                targetId: `theme:${theme}`,
                strength: 0.6,
                type: 'thematic',
                reason: `Theme: ${theme}`,
                lastAccessed: new Date()
            });
        }
        return associations
            .sort((a, b) => b.strength - a.strength)
            .slice(0, this.config.maxAssociations);
    }
    compressConversation(conversation, analysis) {
        const method = compressionUtils_1.CompressionUtils.chooseBestMethod(conversation, 0.1);
        const result = compressionUtils_1.CompressionUtils.compress(conversation, {
            method,
            targetRatio: 0.1,
            preserveKeys: ['participants', 'timestamp', 'location', 'key_points']
        });
        return {
            ...result,
            tokenCount: tokenCounter_1.TokenCounter.estimateTokens(JSON.stringify(result.compressed))
        };
    }
    async calculateMemoryRelevance(analysis, context) {
        const contentAnalysis = {
            content: analysis,
            contentType: 'conversation',
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
            interactionType: 'social',
            importance: context.importance,
            userQuery: context.themes.join(' ')
        };
        const score = relevanceScorer_1.RelevanceScorer.calculateRelevance(contentAnalysis, scoringContext);
        return score.overall;
    }
    async findRelevantMemories(query) {
        const relevantMemories = [];
        for (const memory of this.memoryStore.values()) {
            let relevance = 0;
            const contentStr = JSON.stringify(memory.content).toLowerCase();
            const queryStr = query.query.toLowerCase();
            if (contentStr.includes(queryStr)) {
                relevance += 0.5;
            }
            if (query.context) {
                if (query.context.characterIds) {
                    const hasCharacterMatch = query.context.characterIds.some(id => memory.associations.some(assoc => assoc.targetId === id));
                    if (hasCharacterMatch)
                        relevance += 0.3;
                }
                if (query.context.themes) {
                    const themeMatches = query.context.themes.filter(theme => memory.metadata.context.includes(theme)).length;
                    relevance += (themeMatches / query.context.themes.length) * 0.2;
                }
            }
            const tagMatches = memory.metadata.tags.filter(tag => query.query.toLowerCase().includes(tag.toLowerCase())).length;
            relevance += (tagMatches / memory.metadata.tags.length) * 0.2;
            if (relevance >= (query.minRelevance || 0.1)) {
                const memoryWithRelevance = { ...memory, relevanceScore: relevance };
                relevantMemories.push(memoryWithRelevance);
            }
        }
        return relevantMemories;
    }
    async getAssociatedMemories(memoryId) {
        const memory = this.memoryStore.get(memoryId);
        if (!memory)
            return [];
        const associatedIds = memory.associations.map(assoc => assoc.targetId);
        const associatedMemories = [];
        for (const id of associatedIds) {
            const associatedMemory = this.memoryStore.get(id);
            if (associatedMemory) {
                associatedMemories.push(associatedMemory);
            }
        }
        return associatedMemories;
    }
    async expandCompressedContent(memory, associatedMemories, targetDetail) {
        const decompressed = compressionUtils_1.CompressionUtils.decompress(memory.content, 'semantic');
        if (!decompressed.success) {
            console.warn('[DSAM] Decompression failed, returning compressed content');
            return memory.content;
        }
        let expanded = decompressed.decompressed;
        if (targetDetail === 'detailed') {
            expanded = await this.enhanceWithAssociations(expanded, associatedMemories, 'full');
        }
        else if (targetDetail === 'balanced') {
            expanded = await this.enhanceWithAssociations(expanded, associatedMemories, 'partial');
        }
        return expanded;
    }
    async enhanceWithAssociations(content, associatedMemories, enhancementLevel) {
        const enhancements = {};
        for (const assocMemory of associatedMemories) {
            if (enhancementLevel === 'full') {
                const expandedAssoc = await this.expandMemory(assocMemory.id, 'minimal');
                enhancements[assocMemory.type] = expandedAssoc;
            }
            else {
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
    extractThemes(conversation, context) {
        const themes = [...context.themes];
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
            if (matches >= 2) {
                themes.push(theme);
            }
        }
        return [...new Set(themes)];
    }
    generateTags(conversation, context) {
        const tags = [];
        tags.push(...context.participants.map(p => `participant:${p}`));
        if (context.location) {
            tags.push(`location:${context.location}`);
        }
        tags.push(`tone:${context.emotionalTone}`);
        tags.push(`importance:${context.importance}`);
        const hour = context.time.getHours();
        if (hour < 6)
            tags.push('time:dawn');
        else if (hour < 12)
            tags.push('time:morning');
        else if (hour < 18)
            tags.push('time:afternoon');
        else
            tags.push('time:evening');
        return tags;
    }
    assessImportance(conversation, context) {
        let score = 0;
        if (context.participants.includes('player'))
            score += 3;
        if (context.participants.some(p => p.includes('king') || p.includes('queen')))
            score += 2;
        if (context.emotionalTone === 'tense')
            score += 2;
        if (context.emotionalTone === 'negative')
            score += 1;
        if (context.themes.includes('romance'))
            score += 1;
        if (context.themes.includes('combat'))
            score += 2;
        if (context.themes.includes('politics'))
            score += 2;
        if (score >= 6)
            return 'critical';
        if (score >= 4)
            return 'major';
        if (score >= 2)
            return 'moderate';
        return 'minor';
    }
    updateAssociationIndex(memory) {
        for (const association of memory.associations) {
            if (!this.associationIndex.has(association.targetId)) {
                this.associationIndex.set(association.targetId, new Set());
            }
            this.associationIndex.get(association.targetId).add(memory.id);
        }
    }
    generateMemoryId() {
        return `dsam_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    startCleanupTimer() {
        this.cleanupTimer = setInterval(() => {
            this.performCleanup();
        }, this.config.cleanupInterval * 60 * 60 * 1000);
    }
    async performCleanup() {
        const now = new Date();
        const cutoffDate = new Date(now.getTime() - (this.config.memoryWindow * 24 * 60 * 60 * 1000));
        const memoriesToRemove = [];
        for (const [id, memory] of this.memoryStore) {
            if (memory.timestamp < cutoffDate && memory.relevanceScore < 0.5) {
                memoriesToRemove.push(id);
            }
        }
        for (const id of memoriesToRemove) {
            this.memoryStore.delete(id);
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
    async persistAllMemories() {
        console.log(`[DSAM] Persisting ${this.memoryStore.size} memories`);
    }
    async handleNewConversation(data) {
        try {
            await this.storeConversation(data.conversation, data.context);
        }
        catch (error) {
            console.error('[DSAM] Error storing conversation:', error);
        }
    }
    async handleCharacterAction(data) {
    }
    async handleMemoryQuery(data) {
        try {
            const result = await this.queryMemories(data.query);
            this.eventBus.emit('dsam:query_result', result);
        }
        catch (error) {
            console.error('[DSAM] Error processing memory query:', error);
        }
    }
    async handleCleanupRequest() {
        await this.performCleanup();
    }
}
exports.DSAMService = DSAMService;
exports.dsamService = new DSAMService();
