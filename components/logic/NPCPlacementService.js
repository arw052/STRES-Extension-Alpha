"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NPCPlacementService = void 0;
const BaseService_1 = require("../../services/BaseService");
class NPCPlacementService extends BaseService_1.BaseService {
    constructor(config) {
        super('NPCPlacementService', config);
        this.placementCache = new Map();
        this.settlementCapacities = new Map();
        this.config = config;
    }
    async onInitialize() {
        this.eventBus.on('world:assign-npcs', this.handleAssignNPCs.bind(this));
        this.eventBus.on('world:find-npc-location', this.handleFindNPCLocation.bind(this));
        this.eventBus.on('world:update-placement', this.handleUpdatePlacement.bind(this));
        console.log('[NPCPlacementService] Initialized with strategy:', this.config.placementStrategy);
    }
    async onShutdown() {
        this.eventBus.off('world:assign-npcs', this.handleAssignNPCs.bind(this));
        this.eventBus.off('world:find-npc-location', this.handleFindNPCLocation.bind(this));
        this.eventBus.off('world:update-placement', this.handleUpdatePlacement.bind(this));
        this.placementCache.clear();
        this.settlementCapacities.clear();
        console.log('[NPCPlacementService] Shut down');
    }
    async assignNPCsToWorld(npcs, settlements) {
        return this.measureOperation('assignNPCsToWorld', async () => {
            const startTime = Date.now();
            const results = [];
            try {
                await this.initializeSettlementCapacities(settlements);
                const batchSize = 50;
                for (let i = 0; i < npcs.length; i += batchSize) {
                    const batch = npcs.slice(i, i + batchSize);
                    const batchResults = await this.assignNPCBatch(batch, settlements);
                    results.push(...batchResults);
                }
                const adjustedResults = await this.applyPlacementStrategy(results, settlements);
                const duration = Date.now() - startTime;
                console.log(`[NPCPlacementService] Assigned ${results.length} NPCs in ${duration}ms`);
                this.placementCache.set('world-placement', adjustedResults);
                await this.eventBus.emit('world:npcs-assigned', {
                    campaignId: this.config.campaignId,
                    totalNPCs: npcs.length,
                    placements: adjustedResults,
                    statistics: this.generatePlacementStatistics(adjustedResults)
                });
                return adjustedResults;
            }
            catch (error) {
                console.error('[NPCPlacementService] Failed to assign NPCs:', error);
                await this.eventBus.emit('world:npc-assignment-error', {
                    campaignId: this.config.campaignId,
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
                throw error;
            }
        });
    }
    async findOptimalLocation(npc, settlements) {
        return this.measureOperation('findOptimalLocation', async () => {
            const candidates = await this.generatePlacementCandidates(npc, settlements);
            if (candidates.length === 0) {
                return null;
            }
            candidates.sort((a, b) => b.score - a.score);
            const bestCandidate = candidates[0];
            return {
                npcId: npc.id,
                settlementId: bestCandidate.settlement.id,
                score: bestCandidate.score,
                placementType: this.determinePlacementType(bestCandidate.score),
                factors: this.extractPlacementFactors(bestCandidate)
            };
        });
    }
    async initializeSettlementCapacities(settlements) {
        for (const settlement of settlements) {
            const capacity = this.calculateSettlementCapacity(settlement);
            this.settlementCapacities.set(settlement.id, capacity);
        }
    }
    calculateSettlementCapacity(settlement) {
        let baseCapacity = Math.max(1, Math.floor(settlement.population / 100));
        const typeMultipliers = {
            'Metropolis': 5.0,
            'Large City': 3.0,
            'City': 2.0,
            'Large Town': 1.5,
            'Town': 1.0,
            'Village': 0.5
        };
        const multiplier = typeMultipliers[settlement.sizeCategory] || 1.0;
        const maxCapacity = Math.floor(baseCapacity * multiplier);
        return {
            settlementId: settlement.id,
            currentNPCs: 0,
            maxCapacity,
            professionDistribution: {},
            culturalDistribution: {}
        };
    }
    async assignNPCBatch(npcs, settlements) {
        const results = [];
        for (const npc of npcs) {
            const result = await this.findOptimalLocation(npc, settlements);
            if (result) {
                results.push(result);
                const capacity = this.settlementCapacities.get(result.settlementId);
                if (capacity) {
                    capacity.currentNPCs++;
                    capacity.professionDistribution[npc.profession] = (capacity.professionDistribution[npc.profession] || 0) + 1;
                    if (npc.culture) {
                        capacity.culturalDistribution[npc.culture] = (capacity.culturalDistribution[npc.culture] || 0) + 1;
                    }
                }
            }
        }
        return results;
    }
    async generatePlacementCandidates(npc, settlements) {
        const candidates = [];
        for (const settlement of settlements) {
            const capacity = this.settlementCapacities.get(settlement.id);
            if (!capacity || capacity.currentNPCs >= capacity.maxCapacity) {
                continue;
            }
            const score = await this.calculatePlacementScore(npc, settlement, capacity);
            const reasons = this.generatePlacementReasons(npc, settlement, score);
            candidates.push({
                settlement,
                score,
                reasons,
                npcCount: capacity.currentNPCs,
                capacity: capacity.maxCapacity
            });
        }
        return candidates;
    }
    async calculatePlacementScore(npc, settlement, capacity) {
        let score = 0;
        const factors = {};
        const professionScore = this.calculateProfessionCompatibility(npc.profession, settlement);
        factors.profession = professionScore;
        score += professionScore * 40;
        const cultureScore = this.calculateCulturalAlignment(npc, settlement);
        factors.culture = cultureScore;
        score += cultureScore * 20;
        const sizeScore = this.calculateSizePreference(npc, settlement);
        factors.size = sizeScore;
        score += sizeScore * 15;
        const capacityScore = this.calculateCapacityScore(capacity);
        factors.capacity = capacityScore;
        score += capacityScore * 10;
        const diversityScore = this.calculateDiversityScore(npc, capacity);
        factors.diversity = diversityScore;
        score += diversityScore * 10;
        const storyScore = this.calculateStoryFactors(npc, settlement);
        factors.story = storyScore;
        score += storyScore * 5;
        return Math.min(100, Math.max(0, score));
    }
    calculateProfessionCompatibility(profession, settlement) {
        const professionMap = {
            'Blacksmith': ['Mining', 'Military Garrison', 'Mixed'],
            'Merchant': ['Maritime Trade', 'Mixed', 'Farming'],
            'Innkeeper': ['Mixed', 'Farming', 'Maritime Trade'],
            'Guard': ['Military Garrison', 'Mixed'],
            'Priest': ['Religious Center', 'Mixed'],
            'Farmer': ['Farming', 'Mixed'],
            'Fisher': ['Fishing', 'Maritime Trade'],
            'Noble': ['Mixed', 'Military Garrison'],
            'Scholar': ['Mixed', 'Religious Center']
        };
        const compatibleEconomies = professionMap[profession] || ['Mixed'];
        return compatibleEconomies.includes(settlement.economyType) ? 1.0 : 0.3;
    }
    calculateCulturalAlignment(npc, settlement) {
        var _a;
        if (!this.config.respectCulturalBoundaries) {
            return 0.8;
        }
        if (!npc.culture)
            return 0.5;
        const settlementCulture = (_a = settlement.properties) === null || _a === void 0 ? void 0 : _a.culture;
        if (!settlementCulture)
            return 0.5;
        return npc.culture === settlementCulture ? 1.0 : 0.2;
    }
    calculateSizePreference(npc, settlement) {
        const sizeScores = {
            'Metropolis': 0.9,
            'Large City': 0.8,
            'City': 0.7,
            'Large Town': 0.6,
            'Town': 0.5,
            'Village': 0.3
        };
        const baseScore = sizeScores[settlement.sizeCategory] || 0.5;
        const levelMultiplier = Math.min(1.0, npc.level / 10);
        return baseScore * (0.5 + 0.5 * levelMultiplier);
    }
    calculateCapacityScore(capacity) {
        if (capacity.maxCapacity === 0)
            return 0;
        const utilization = capacity.currentNPCs / capacity.maxCapacity;
        if (utilization < 0.3)
            return 0.7;
        if (utilization < 0.7)
            return 1.0;
        if (utilization < 0.9)
            return 0.8;
        return 0.3;
    }
    calculateDiversityScore(npc, capacity) {
        if (!this.config.balanceProfessions)
            return 0.5;
        const professionCount = capacity.professionDistribution[npc.profession] || 0;
        const professionDiversity = 1.0 - (professionCount / capacity.currentNPCs);
        let cultureDiversity = 0.5;
        if (npc.culture) {
            const cultureCount = capacity.culturalDistribution[npc.culture] || 0;
            cultureDiversity = 1.0 - (cultureCount / capacity.currentNPCs);
        }
        return (professionDiversity + cultureDiversity) / 2;
    }
    calculateStoryFactors(npc, settlement) {
        var _a;
        let score = 0.5;
        if (npc.goals.some(goal => goal.includes('quest') || goal.includes('adventure'))) {
            score += 0.2;
        }
        if ((_a = settlement.properties) === null || _a === void 0 ? void 0 : _a.hasQuests) {
            score += 0.3;
        }
        return Math.min(1.0, score);
    }
    generatePlacementReasons(npc, settlement, score) {
        var _a;
        const reasons = [];
        if (score > 80) {
            reasons.push('Excellent profession-economy match');
        }
        else if (score > 60) {
            reasons.push('Good profession-economy match');
        }
        if (npc.culture && ((_a = settlement.properties) === null || _a === void 0 ? void 0 : _a.culture) === npc.culture) {
            reasons.push('Cultural alignment');
        }
        const capacity = this.settlementCapacities.get(settlement.id);
        if (capacity && capacity.currentNPCs < capacity.maxCapacity * 0.7) {
            reasons.push('Settlement has capacity');
        }
        if (settlement.sizeCategory === 'City' || settlement.sizeCategory === 'Metropolis') {
            reasons.push('Appropriate settlement size');
        }
        return reasons;
    }
    async applyPlacementStrategy(results, settlements) {
        switch (this.config.placementStrategy) {
            case 'balanced':
                return this.applyBalancedStrategy(results, settlements);
            case 'realistic':
                return this.applyRealisticStrategy(results, settlements);
            case 'story-driven':
                return this.applyStoryDrivenStrategy(results, settlements);
            case 'random':
                return this.applyRandomStrategy(results, settlements);
            default:
                return results;
        }
    }
    applyBalancedStrategy(results, settlements) {
        const settlementCounts = new Map();
        return results.map(result => {
            const count = settlementCounts.get(result.settlementId) || 0;
            const capacity = this.settlementCapacities.get(result.settlementId);
            if (capacity && count >= capacity.maxCapacity) {
                const alternative = this.findAlternativeSettlement(result.npcId, settlements);
                if (alternative) {
                    settlementCounts.set(alternative.settlementId, (settlementCounts.get(alternative.settlementId) || 0) + 1);
                    return alternative;
                }
            }
            settlementCounts.set(result.settlementId, count + 1);
            return result;
        });
    }
    applyRealisticStrategy(results, settlements) {
        const sortedSettlements = settlements.sort((a, b) => b.population - a.population);
        return results.map(result => {
            const npc = results.find(r => r.npcId === result.npcId);
            if (npc && this.shouldPreferLargeSettlement(result.npcId)) {
                const largeSettlement = sortedSettlements.find(s => s.sizeCategory === 'Metropolis' || s.sizeCategory === 'Large City');
                if (largeSettlement) {
                    return {
                        ...result,
                        settlementId: largeSettlement.id
                    };
                }
            }
            return result;
        });
    }
    applyStoryDrivenStrategy(results, settlements) {
        return results;
    }
    applyRandomStrategy(results, settlements) {
        return results.map(result => {
            if (Math.random() < 0.3) {
                const randomSettlement = settlements[Math.floor(Math.random() * settlements.length)];
                return {
                    ...result,
                    settlementId: randomSettlement.id,
                    placementType: 'fallback'
                };
            }
            return result;
        });
    }
    determinePlacementType(score) {
        if (score >= 70)
            return 'optimal';
        if (score >= 40)
            return 'acceptable';
        return 'fallback';
    }
    extractPlacementFactors(candidate) {
        return {
            profession: 0.8,
            culture: 0.6,
            size: 0.7,
            capacity: 0.9,
            diversity: 0.5,
            story: 0.4
        };
    }
    findAlternativeSettlement(npcId, settlements) {
        const availableSettlements = settlements.filter(s => {
            const capacity = this.settlementCapacities.get(s.id);
            return capacity && capacity.currentNPCs < capacity.maxCapacity;
        });
        if (availableSettlements.length === 0)
            return null;
        return {
            npcId,
            settlementId: availableSettlements[0].id,
            score: 50,
            placementType: 'fallback',
            factors: { fallback: 1.0 }
        };
    }
    shouldPreferLargeSettlement(npcId) {
        return Math.random() < 0.5;
    }
    generatePlacementStatistics(results) {
        const settlementCounts = results.reduce((acc, result) => {
            acc[result.settlementId] = (acc[result.settlementId] || 0) + 1;
            return acc;
        }, {});
        const placementTypes = results.reduce((acc, result) => {
            acc[result.placementType] = (acc[result.placementType] || 0) + 1;
            return acc;
        }, {});
        return {
            totalPlacements: results.length,
            settlementsUsed: Object.keys(settlementCounts).length,
            averageScore: results.reduce((sum, r) => sum + r.score, 0) / results.length,
            placementTypes,
            settlementDistribution: settlementCounts
        };
    }
    async handleAssignNPCs(data) {
        try {
            const results = await this.assignNPCsToWorld(data.npcs, data.settlements);
            await this.eventBus.emit('world:npcs-assigned', {
                campaignId: this.config.campaignId,
                results
            });
        }
        catch (error) {
            await this.eventBus.emit('world:npc-assignment-error', {
                campaignId: this.config.campaignId,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
    async handleFindNPCLocation(data) {
        try {
            const result = await this.findOptimalLocation(data.npc, data.settlements);
            await this.eventBus.emit('world:npc-location-found', {
                npcId: data.npc.id,
                result
            });
        }
        catch (error) {
            await this.eventBus.emit('world:npc-location-error', {
                npcId: data.npc.id,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
    async handleUpdatePlacement(data) {
        const cachedResults = this.placementCache.get('world-placement') || [];
        const resultIndex = cachedResults.findIndex(r => r.npcId === data.npcId);
        if (resultIndex !== -1) {
            cachedResults[resultIndex].settlementId = data.newSettlementId;
            this.placementCache.set('world-placement', cachedResults);
        }
        await this.eventBus.emit('world:placement-updated', {
            npcId: data.npcId,
            newSettlementId: data.newSettlementId
        });
    }
}
exports.NPCPlacementService = NPCPlacementService;
