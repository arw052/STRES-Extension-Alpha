/**
 * NPCPlacementService - Intelligent NPC placement in world locations
 *
 * Uses various factors to determine optimal NPC placement:
 * - Profession matching with settlement economy
 * - Cultural and religious alignment
 * - Population density and settlement size
 * - Trade routes and connectivity
 * - Quest and story requirements
 */

import { BaseService } from '../../services/BaseService';
import { ParsedSettlement, ParsedCulture, ParsedReligion } from './AzgaarParserService';

export interface NPCPlacementConfig {
  campaignId: string;
  placementStrategy: 'balanced' | 'realistic' | 'story-driven' | 'random';
  maxNPCsPerSettlement: number;
  minNPCsPerSettlement: number;
  respectCulturalBoundaries: boolean;
  balanceProfessions: boolean;
  considerTradeRoutes: boolean;
}

export interface NPCProfile {
  id: string;
  name: string;
  level: number;
  profession: string;
  culture?: string;
  religion?: string;
  faction?: string;
  personality: string[];
  goals: string[];
  relationships: string[];
  questFlags: string[];
  interactionPriority: number;
  currentLocation?: string;
  homeLocation?: string;
}

export interface PlacementCandidate {
  settlement: ParsedSettlement;
  score: number;
  reasons: string[];
  npcCount: number;
  capacity: number;
}

export interface PlacementResult {
  npcId: string;
  settlementId: string;
  score: number;
  placementType: 'optimal' | 'acceptable' | 'fallback';
  factors: Record<string, number>;
}

export interface SettlementCapacity {
  settlementId: string;
  currentNPCs: number;
  maxCapacity: number;
  professionDistribution: Record<string, number>;
  culturalDistribution: Record<string, number>;
}

export class NPCPlacementService extends BaseService {
  private config: NPCPlacementConfig;
  private placementCache = new Map<string, PlacementResult[]>();
  private settlementCapacities = new Map<string, SettlementCapacity>();

  constructor(config: NPCPlacementConfig) {
    super('NPCPlacementService', config);
    this.config = config;
  }

  protected async onInitialize(): Promise<void> {
    // Register event listeners
    this.eventBus.on('world:assign-npcs', this.handleAssignNPCs.bind(this));
    this.eventBus.on('world:find-npc-location', this.handleFindNPCLocation.bind(this));
    this.eventBus.on('world:update-placement', this.handleUpdatePlacement.bind(this));

    console.log('[NPCPlacementService] Initialized with strategy:', this.config.placementStrategy);
  }

  protected async onShutdown(): Promise<void> {
    this.eventBus.off('world:assign-npcs', this.handleAssignNPCs.bind(this));
    this.eventBus.off('world:find-npc-location', this.handleFindNPCLocation.bind(this));
    this.eventBus.off('world:update-placement', this.handleUpdatePlacement.bind(this));

    this.placementCache.clear();
    this.settlementCapacities.clear();

    console.log('[NPCPlacementService] Shut down');
  }

  /**
   * Assign NPCs to optimal world locations
   */
  async assignNPCsToWorld(npcs: NPCProfile[], settlements: ParsedSettlement[]): Promise<PlacementResult[]> {
    return this.measureOperation('assignNPCsToWorld', async () => {
      const startTime = Date.now();
      const results: PlacementResult[] = [];

      try {
        // Initialize settlement capacities
        await this.initializeSettlementCapacities(settlements);

        // Process NPCs in batches for performance
        const batchSize = 50;
        for (let i = 0; i < npcs.length; i += batchSize) {
          const batch = npcs.slice(i, i + batchSize);
          const batchResults = await this.assignNPCBatch(batch, settlements);
          results.push(...batchResults);
        }

        // Apply placement strategy adjustments
        const adjustedResults = await this.applyPlacementStrategy(results, settlements);

        const duration = Date.now() - startTime;
        console.log(`[NPCPlacementService] Assigned ${results.length} NPCs in ${duration}ms`);

        // Cache results
        this.placementCache.set('world-placement', adjustedResults);

        // Emit completion event
        await this.eventBus.emit('world:npcs-assigned', {
          campaignId: this.config.campaignId,
          totalNPCs: npcs.length,
          placements: adjustedResults,
          statistics: this.generatePlacementStatistics(adjustedResults)
        });

        return adjustedResults;

      } catch (error) {
        console.error('[NPCPlacementService] Failed to assign NPCs:', error);
        await this.eventBus.emit('world:npc-assignment-error', {
          campaignId: this.config.campaignId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        throw error;
      }
    });
  }

  /**
   * Find optimal location for a specific NPC
   */
  async findOptimalLocation(npc: NPCProfile, settlements: ParsedSettlement[]): Promise<PlacementResult | null> {
    return this.measureOperation('findOptimalLocation', async () => {
      const candidates = await this.generatePlacementCandidates(npc, settlements);

      if (candidates.length === 0) {
        return null;
      }

      // Sort by score and return best candidate
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

  /**
   * Initialize settlement capacity tracking
   */
  private async initializeSettlementCapacities(settlements: ParsedSettlement[]): Promise<void> {
    for (const settlement of settlements) {
      const capacity = this.calculateSettlementCapacity(settlement);
      this.settlementCapacities.set(settlement.id, capacity);
    }
  }

  /**
   * Calculate settlement capacity for NPC placement
   */
  private calculateSettlementCapacity(settlement: ParsedSettlement): SettlementCapacity {
    // Base capacity on population size
    let baseCapacity = Math.max(1, Math.floor(settlement.population / 100));

    // Adjust based on settlement type
    const typeMultipliers: Record<string, number> = {
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

  /**
   * Assign a batch of NPCs to settlements
   */
  private async assignNPCBatch(npcs: NPCProfile[], settlements: ParsedSettlement[]): Promise<PlacementResult[]> {
    const results: PlacementResult[] = [];

    for (const npc of npcs) {
      const result = await this.findOptimalLocation(npc, settlements);
      if (result) {
        results.push(result);

        // Update settlement capacity
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

  /**
   * Generate placement candidates for an NPC
   */
  private async generatePlacementCandidates(npc: NPCProfile, settlements: ParsedSettlement[]): Promise<PlacementCandidate[]> {
    const candidates: PlacementCandidate[] = [];

    for (const settlement of settlements) {
      const capacity = this.settlementCapacities.get(settlement.id);
      if (!capacity || capacity.currentNPCs >= capacity.maxCapacity) {
        continue; // Settlement is at capacity
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

  /**
   * Calculate placement score based on multiple factors
   */
  private async calculatePlacementScore(npc: NPCProfile, settlement: ParsedSettlement, capacity: SettlementCapacity): Promise<number> {
    let score = 0;
    const factors: Record<string, number> = {};

    // Profession compatibility (0-40 points)
    const professionScore = this.calculateProfessionCompatibility(npc.profession, settlement);
    factors.profession = professionScore;
    score += professionScore * 40;

    // Cultural alignment (0-20 points)
    const cultureScore = this.calculateCulturalAlignment(npc, settlement);
    factors.culture = cultureScore;
    score += cultureScore * 20;

    // Settlement size preference (0-15 points)
    const sizeScore = this.calculateSizePreference(npc, settlement);
    factors.size = sizeScore;
    score += sizeScore * 15;

    // Capacity utilization (0-10 points)
    const capacityScore = this.calculateCapacityScore(capacity);
    factors.capacity = capacityScore;
    score += capacityScore * 10;

    // Diversity bonus (0-10 points)
    const diversityScore = this.calculateDiversityScore(npc, capacity);
    factors.diversity = diversityScore;
    score += diversityScore * 10;

    // Story-driven factors (0-5 points)
    const storyScore = this.calculateStoryFactors(npc, settlement);
    factors.story = storyScore;
    score += storyScore * 5;

    return Math.min(100, Math.max(0, score));
  }

  /**
   * Calculate profession compatibility with settlement economy
   */
  private calculateProfessionCompatibility(profession: string, settlement: ParsedSettlement): number {
    const professionMap: Record<string, string[]> = {
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

  /**
   * Calculate cultural alignment
   */
  private calculateCulturalAlignment(npc: NPCProfile, settlement: ParsedSettlement): number {
    if (!this.config.respectCulturalBoundaries) {
      return 0.8; // Neutral score when not respecting boundaries
    }

    if (!npc.culture) return 0.5;

    // Check if settlement properties contain cultural information
    const settlementCulture = settlement.properties?.culture;
    if (!settlementCulture) return 0.5;

    return npc.culture === settlementCulture ? 1.0 : 0.2;
  }

  /**
   * Calculate size preference based on NPC level and type
   */
  private calculateSizePreference(npc: NPCProfile, settlement: ParsedSettlement): number {
    const sizeScores: Record<string, number> = {
      'Metropolis': 0.9,
      'Large City': 0.8,
      'City': 0.7,
      'Large Town': 0.6,
      'Town': 0.5,
      'Village': 0.3
    };

    const baseScore = sizeScores[settlement.sizeCategory] || 0.5;

    // Higher level NPCs prefer larger settlements
    const levelMultiplier = Math.min(1.0, npc.level / 10);

    return baseScore * (0.5 + 0.5 * levelMultiplier);
  }

  /**
   * Calculate capacity utilization score
   */
  private calculateCapacityScore(capacity: SettlementCapacity): number {
    if (capacity.maxCapacity === 0) return 0;

    const utilization = capacity.currentNPCs / capacity.maxCapacity;

    // Prefer settlements that are 30-70% full
    if (utilization < 0.3) return 0.7;
    if (utilization < 0.7) return 1.0;
    if (utilization < 0.9) return 0.8;
    return 0.3; // Over capacity
  }

  /**
   * Calculate diversity bonus
   */
  private calculateDiversityScore(npc: NPCProfile, capacity: SettlementCapacity): number {
    if (!this.config.balanceProfessions) return 0.5;

    // Check profession diversity
    const professionCount = capacity.professionDistribution[npc.profession] || 0;
    const professionDiversity = 1.0 - (professionCount / capacity.currentNPCs);

    // Check cultural diversity
    let cultureDiversity = 0.5;
    if (npc.culture) {
      const cultureCount = capacity.culturalDistribution[npc.culture] || 0;
      cultureDiversity = 1.0 - (cultureCount / capacity.currentNPCs);
    }

    return (professionDiversity + cultureDiversity) / 2;
  }

  /**
   * Calculate story-driven factors
   */
  private calculateStoryFactors(npc: NPCProfile, settlement: ParsedSettlement): number {
    let score = 0.5; // Base score

    // Check if NPC has quest-related goals
    if (npc.goals.some(goal => goal.includes('quest') || goal.includes('adventure'))) {
      score += 0.2;
    }

    // Check if settlement has story-relevant properties
    if (settlement.properties?.hasQuests) {
      score += 0.3;
    }

    return Math.min(1.0, score);
  }

  /**
   * Generate reasons for placement decision
   */
  private generatePlacementReasons(npc: NPCProfile, settlement: ParsedSettlement, score: number): string[] {
    const reasons: string[] = [];

    if (score > 80) {
      reasons.push('Excellent profession-economy match');
    } else if (score > 60) {
      reasons.push('Good profession-economy match');
    }

    if (npc.culture && settlement.properties?.culture === npc.culture) {
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

  /**
   * Apply placement strategy adjustments
   */
  private async applyPlacementStrategy(results: PlacementResult[], settlements: ParsedSettlement[]): Promise<PlacementResult[]> {
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

  /**
   * Balanced strategy: maintain good distribution
   */
  private applyBalancedStrategy(results: PlacementResult[], settlements: ParsedSettlement[]): PlacementResult[] {
    // Ensure no settlement gets overloaded
    const settlementCounts = new Map<string, number>();

    return results.map(result => {
      const count = settlementCounts.get(result.settlementId) || 0;
      const capacity = this.settlementCapacities.get(result.settlementId);

      if (capacity && count >= capacity.maxCapacity) {
        // Find alternative settlement
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

  /**
   * Realistic strategy: follow real-world population distribution patterns
   */
  private applyRealisticStrategy(results: PlacementResult[], settlements: ParsedSettlement[]): PlacementResult[] {
    // Sort settlements by population and prefer larger ones for important NPCs
    const sortedSettlements = settlements.sort((a, b) => b.population - a.population);

    return results.map(result => {
      // For high-level NPCs, prefer larger settlements
      const npc = results.find(r => r.npcId === result.npcId);
      if (npc && this.shouldPreferLargeSettlement(result.npcId)) {
        const largeSettlement = sortedSettlements.find(s =>
          s.sizeCategory === 'Metropolis' || s.sizeCategory === 'Large City'
        );
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

  /**
   * Story-driven strategy: place NPCs based on narrative requirements
   */
  private applyStoryDrivenStrategy(results: PlacementResult[], settlements: ParsedSettlement[]): PlacementResult[] {
    // This would integrate with quest system to place story-critical NPCs
    // For now, just return results as-is
    return results;
  }

  /**
   * Random strategy: randomize placements within acceptable ranges
   */
  private applyRandomStrategy(results: PlacementResult[], settlements: ParsedSettlement[]): PlacementResult[] {
    return results.map(result => {
      if (Math.random() < 0.3) { // 30% chance to reassign
        const randomSettlement = settlements[Math.floor(Math.random() * settlements.length)];
        return {
          ...result,
          settlementId: randomSettlement.id,
          placementType: 'fallback' as const
        };
      }
      return result;
    });
  }

  /**
   * Helper methods
   */
  private determinePlacementType(score: number): 'optimal' | 'acceptable' | 'fallback' {
    if (score >= 70) return 'optimal';
    if (score >= 40) return 'acceptable';
    return 'fallback';
  }

  private extractPlacementFactors(candidate: PlacementCandidate): Record<string, number> {
    // This would extract the actual factor scores used in calculation
    return {
      profession: 0.8, // Placeholder
      culture: 0.6,
      size: 0.7,
      capacity: 0.9,
      diversity: 0.5,
      story: 0.4
    };
  }

  private findAlternativeSettlement(npcId: string, settlements: ParsedSettlement[]): PlacementResult | null {
    // Find next best settlement
    const availableSettlements = settlements.filter(s => {
      const capacity = this.settlementCapacities.get(s.id);
      return capacity && capacity.currentNPCs < capacity.maxCapacity;
    });

    if (availableSettlements.length === 0) return null;

    return {
      npcId,
      settlementId: availableSettlements[0].id,
      score: 50,
      placementType: 'fallback',
      factors: { fallback: 1.0 }
    };
  }

  private shouldPreferLargeSettlement(npcId: string): boolean {
    // Placeholder logic - would check NPC level/importance
    return Math.random() < 0.5;
  }

  private generatePlacementStatistics(results: PlacementResult[]): any {
    const settlementCounts = results.reduce((acc, result) => {
      acc[result.settlementId] = (acc[result.settlementId] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const placementTypes = results.reduce((acc, result) => {
      acc[result.placementType] = (acc[result.placementType] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      totalPlacements: results.length,
      settlementsUsed: Object.keys(settlementCounts).length,
      averageScore: results.reduce((sum, r) => sum + r.score, 0) / results.length,
      placementTypes,
      settlementDistribution: settlementCounts
    };
  }

  /**
   * Event handlers
   */
  private async handleAssignNPCs(data: { npcs: NPCProfile[]; settlements: ParsedSettlement[] }): Promise<void> {
    try {
      const results = await this.assignNPCsToWorld(data.npcs, data.settlements);
      await this.eventBus.emit('world:npcs-assigned', {
        campaignId: this.config.campaignId,
        results
      });
    } catch (error) {
      await this.eventBus.emit('world:npc-assignment-error', {
        campaignId: this.config.campaignId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  private async handleFindNPCLocation(data: { npc: NPCProfile; settlements: ParsedSettlement[] }): Promise<void> {
    try {
      const result = await this.findOptimalLocation(data.npc, data.settlements);
      await this.eventBus.emit('world:npc-location-found', {
        npcId: data.npc.id,
        result
      });
    } catch (error) {
      await this.eventBus.emit('world:npc-location-error', {
        npcId: data.npc.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  private async handleUpdatePlacement(data: { npcId: string; newSettlementId: string }): Promise<void> {
    // Update placement cache and settlement capacities
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
