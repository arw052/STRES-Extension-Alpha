/**
 * Social Systems Service - Relationships, Romance, and Faction Management
 *
 * Manages complex social dynamics, romantic relationships, and faction standings
 * Provides rich social gameplay mechanics for immersive RPG experiences
 */

import { BaseService } from '../../services/BaseService';
import { DetectedTask } from './TaskDetectionService';

export interface SocialConfig {
  enabled: boolean;
  relationshipTracking: boolean;
  romanceSystem: boolean;
  factionSystem: boolean;
  maxRelationships: number;
  relationshipDecayRate: number; // Points lost per day without interaction
  romanceThreshold: number; // Minimum relationship for romance
  debugMode: boolean;
}

export interface Relationship {
  id: string;
  sourceCharacter: string;
  targetCharacter: string;
  level: RelationshipLevel;
  points: number; // -100 to 100
  type: RelationshipType;
  lastInteraction: Date;
  history: RelationshipEvent[];
  metadata: {
    firstMeeting?: Date;
    significantEvents: string[];
    sharedQuests: string[];
    gifts: string[];
  };
}

export interface RelationshipEvent {
  id: string;
  type: 'positive' | 'negative' | 'neutral';
  description: string;
  pointsChange: number;
  timestamp: Date;
  context?: string;
}

export interface Romance {
  id: string;
  partners: [string, string]; // Character IDs
  stage: RomanceStage;
  startDate: Date;
  lastInteraction: Date;
  affection: number; // 0-100
  compatibility: number; // 0-100
  events: RomanceEvent[];
  status: 'active' | 'paused' | 'ended';
}

export interface RomanceEvent {
  id: string;
  type: 'date' | 'gift' | 'conflict' | 'milestone' | 'breakup';
  description: string;
  affectionChange: number;
  timestamp: Date;
}

export interface Faction {
  id: string;
  name: string;
  description: string;
  standing: FactionStanding;
  points: number; // -100 to 100
  reputation: number; // 0-100
  members: string[]; // Character IDs
  territories: string[];
  allies: string[]; // Other faction IDs
  enemies: string[]; // Other faction IDs
  quests: string[];
  lastInteraction: Date;
}

export interface FactionStanding {
  level: 'exalted' | 'honored' | 'friendly' | 'neutral' | 'hostile' | 'hated';
  description: string;
  benefits: string[];
  penalties: string[];
}

export type RelationshipLevel =
  | 'hated'
  | 'hostile'
  | 'unfriendly'
  | 'neutral'
  | 'friendly'
  | 'close'
  | 'intimate';

export type RelationshipType =
  | 'family'
  | 'friend'
  | 'mentor'
  | 'rival'
  | 'romantic'
  | 'professional'
  | 'acquaintance';

export type RomanceStage =
  | 'interest'
  | 'dating'
  | 'relationship'
  | 'committed'
  | 'married'
  | 'separated'
  | 'broken';

const DEFAULT_SOCIAL_CONFIG: SocialConfig = {
  enabled: true,
  relationshipTracking: true,
  romanceSystem: true,
  factionSystem: true,
  maxRelationships: 50,
  relationshipDecayRate: 2,
  romanceThreshold: 60,
  debugMode: false
};

export class SocialSystemsService extends BaseService {
  private config: SocialConfig;
  private relationships = new Map<string, Relationship>();
  private romances = new Map<string, Romance>();
  private factions = new Map<string, Faction>();
  private characterRelationships = new Map<string, Set<string>>(); // Character -> Relationship IDs

  constructor(config: Partial<SocialConfig> = {}) {
    super('SocialSystemsService', { performanceBudget: 20 });
    this.config = { ...DEFAULT_SOCIAL_CONFIG, ...config };
  }

  protected async onInitialize(): Promise<void> {
    // Register event listeners
    this.eventBus.on('task:detected', this.handleTaskDetected.bind(this));
    this.eventBus.on('character:interaction', this.handleCharacterInteraction.bind(this));
    this.eventBus.on('quest:completed', this.handleQuestCompleted.bind(this));
    this.eventBus.on('social:action', this.handleSocialAction.bind(this));

    // Start relationship decay timer
    this.startRelationshipDecayTimer();

    console.log('[Social] Initialized with config:', this.config);
  }

  protected async onShutdown(): Promise<void> {
    // Save all social data
    await this.persistAllSocialData();

    console.log('[Social] Shut down gracefully');
  }

  /**
   * Create or update a relationship between characters
   */
  async updateRelationship(
    sourceId: string,
    targetId: string,
    points: number,
    reason: string,
    context?: string
  ): Promise<Relationship> {
    return this.measureOperation('updateRelationship', async () => {
      const relationshipId = this.getRelationshipId(sourceId, targetId);
      let relationship = this.relationships.get(relationshipId);

      if (!relationship) {
        relationship = this.createNewRelationship(sourceId, targetId);
      }

      // Update points
      relationship.points = Math.max(-100, Math.min(100, relationship.points + points));
      relationship.lastInteraction = new Date();

      // Create relationship event
      const event: RelationshipEvent = {
        id: `event_${Date.now()}`,
        type: points > 0 ? 'positive' : points < 0 ? 'negative' : 'neutral',
        description: reason,
        pointsChange: points,
        timestamp: new Date(),
        context
      };

      relationship.history.push(event);

      // Update relationship level
      relationship.level = this.calculateRelationshipLevel(relationship.points);

      // Add to character relationship index
      this.addToCharacterIndex(sourceId, relationshipId);
      this.addToCharacterIndex(targetId, relationshipId);

      // Check for romance potential
      if (this.config.romanceSystem && relationship.points >= this.config.romanceThreshold) {
        await this.checkRomancePotential(relationship);
      }

      // Emit relationship update
      this.eventBus.emit('relationship:updated', {
        relationship,
        pointsChange: points,
        newLevel: relationship.level
      });

      return relationship;
    });
  }

  /**
   * Get relationship between two characters
   */
  getRelationship(sourceId: string, targetId: string): Relationship | null {
    const relationshipId = this.getRelationshipId(sourceId, targetId);
    return this.relationships.get(relationshipId) || null;
  }

  /**
   * Get all relationships for a character
   */
  getCharacterRelationships(characterId: string): Relationship[] {
    const relationshipIds = this.characterRelationships.get(characterId);
    if (!relationshipIds) return [];

    return Array.from(relationshipIds)
      .map(id => this.relationships.get(id))
      .filter(rel => rel !== undefined) as Relationship[];
  }

  /**
   * Start a romance between characters
   */
  async startRomance(partner1Id: string, partner2Id: string): Promise<Romance | null> {
    return this.measureOperation('startRomance', async () => {
      if (!this.config.romanceSystem) return null;

      const relationship = this.getRelationship(partner1Id, partner2Id);
      if (!relationship || relationship.points < this.config.romanceThreshold) {
        return null; // Not eligible for romance
      }

      const romanceId = this.getRomanceId(partner1Id, partner2Id);
      if (this.romances.has(romanceId)) {
        return this.romances.get(romanceId)!; // Already exists
      }

      // Check compatibility
      const compatibility = this.calculateCompatibility(partner1Id, partner2Id);

      const romance: Romance = {
        id: romanceId,
        partners: [partner1Id, partner2Id],
        stage: 'interest',
        startDate: new Date(),
        lastInteraction: new Date(),
        affection: relationship.points,
        compatibility,
        events: [{
          id: `romance_start_${Date.now()}`,
          type: 'milestone',
          description: 'Romance begins',
          affectionChange: 10,
          timestamp: new Date()
        }],
        status: 'active'
      };

      this.romances.set(romanceId, romance);

      // Emit romance start event
      this.eventBus.emit('romance:started', {
        romance,
        compatibility,
        initialAffection: romance.affection
      });

      return romance;
    });
  }

  /**
   * Update romance progress
   */
  async updateRomance(
    partner1Id: string,
    partner2Id: string,
    affectionChange: number,
    reason: string
  ): Promise<Romance | null> {
    const romanceId = this.getRomanceId(partner1Id, partner2Id);
    const romance = this.romances.get(romanceId);

    if (!romance || romance.status !== 'active') return null;

    romance.affection = Math.max(0, Math.min(100, romance.affection + affectionChange));
    romance.lastInteraction = new Date();

    // Add romance event
    const event: RomanceEvent = {
      id: `romance_event_${Date.now()}`,
      type: affectionChange > 0 ? 'date' : affectionChange < 0 ? 'conflict' : 'milestone',
      description: reason,
      affectionChange,
      timestamp: new Date()
    };

    romance.events.push(event);

    // Check for stage progression
    const newStage = this.calculateRomanceStage(romance.affection);
    if (newStage !== romance.stage) {
      const oldStage = romance.stage;
      romance.stage = newStage;

      // Emit stage change event
      this.eventBus.emit('romance:stage_changed', {
        romance,
        oldStage,
        newStage,
        affectionChange,
        reason
      });
    }

    // Emit romance update
    this.eventBus.emit('romance:updated', {
      romance,
      affectionChange,
      newAffection: romance.affection
    });

    return romance;
  }

  /**
   * Update faction standing
   */
  async updateFactionStanding(
    factionId: string,
    pointsChange: number,
    reason: string
  ): Promise<Faction> {
    return this.measureOperation('updateFactionStanding', async () => {
      const faction = this.factions.get(factionId);
      if (!faction) {
        throw new Error(`Faction not found: ${factionId}`);
      }

      faction.points = Math.max(-100, Math.min(100, faction.points + pointsChange));
      faction.lastInteraction = new Date();

      // Update standing level
      faction.standing = this.calculateFactionStanding(faction.points);

      // Update reputation
      faction.reputation = Math.max(0, Math.min(100, faction.reputation + (pointsChange * 0.5)));

      // Emit faction update
      this.eventBus.emit('faction:standing_changed', {
        faction,
        pointsChange,
        newStanding: faction.standing.level,
        reason
      });

      return faction;
    });
  }

  /**
   * Get social status summary for a character
   */
  getSocialStatus(characterId: string) {
    const relationships = this.getCharacterRelationships(characterId);
    const romances = this.getCharacterRomances(characterId);

    return {
      characterId,
      relationshipCount: relationships.length,
      romanceCount: romances.length,
      bestFriends: relationships
        .filter(r => r.level === 'close' || r.level === 'intimate')
        .slice(0, 5),
      rivals: relationships
        .filter(r => r.level === 'hostile' || r.level === 'hated')
        .slice(0, 3),
      activeRomances: romances.filter(r => r.status === 'active'),
      socialScore: this.calculateSocialScore(relationships, romances)
    };
  }

  /**
   * Get social system statistics
   */
  getSocialStats() {
    return {
      totalRelationships: this.relationships.size,
      totalRomances: this.romances.size,
      totalFactions: this.factions.size,
      avgRelationshipPoints: this.calculateAverageRelationshipPoints(),
      romanceSuccessRate: this.calculateRomanceSuccessRate(),
      factionDistribution: this.getFactionStandingDistribution()
    };
  }

  // Private methods

  private createNewRelationship(sourceId: string, targetId: string): Relationship {
    return {
      id: this.getRelationshipId(sourceId, targetId),
      sourceCharacter: sourceId,
      targetCharacter: targetId,
      level: 'neutral',
      points: 0,
      type: 'acquaintance',
      lastInteraction: new Date(),
      history: [],
      metadata: {
        firstMeeting: new Date(),
        significantEvents: [],
        sharedQuests: [],
        gifts: []
      }
    };
  }

  private calculateRelationshipLevel(points: number): RelationshipLevel {
    if (points >= 80) return 'intimate';
    if (points >= 60) return 'close';
    if (points >= 20) return 'friendly';
    if (points >= -19) return 'neutral';
    if (points >= -59) return 'unfriendly';
    if (points >= -79) return 'hostile';
    return 'hated';
  }

  private async checkRomancePotential(relationship: Relationship): Promise<void> {
    const existingRomance = this.getRomanceId(relationship.sourceCharacter, relationship.targetCharacter);
    if (this.romances.has(existingRomance)) return;

    // Check if characters are eligible for romance
    if (await this.charactersEligibleForRomance(relationship.sourceCharacter, relationship.targetCharacter)) {
      // Emit potential romance event
      this.eventBus.emit('romance:potential', {
        sourceCharacter: relationship.sourceCharacter,
        targetCharacter: relationship.targetCharacter,
        relationshipPoints: relationship.points
      });
    }
  }

  private async charactersEligibleForRomance(char1: string, char2: string): Promise<boolean> {
    // Check various criteria for romance eligibility
    // This would integrate with character data to check gender, species, etc.
    return true; // Simplified for now
  }

  private calculateCompatibility(char1: string, char2: string): number {
    // Calculate romantic compatibility based on various factors
    // This would use character traits, backgrounds, etc.
    return Math.floor(Math.random() * 40) + 60; // 60-100 for now
  }

  private calculateRomanceStage(affection: number): RomanceStage {
    if (affection >= 90) return 'married';
    if (affection >= 80) return 'committed';
    if (affection >= 70) return 'relationship';
    if (affection >= 60) return 'dating';
    return 'interest';
  }

  private calculateFactionStanding(points: number): FactionStanding {
    let level: FactionStanding['level'];
    let description: string;
    let benefits: string[] = [];
    let penalties: string[] = [];

    if (points >= 80) {
      level = 'exalted';
      description = 'Revered and trusted';
      benefits = ['Access to exclusive quests', 'Discounts on services', 'Special titles'];
    } else if (points >= 60) {
      level = 'honored';
      description = 'Highly respected';
      benefits = ['Access to special items', 'Priority services'];
    } else if (points >= 20) {
      level = 'friendly';
      description = 'Well-liked';
      benefits = ['Discounts on goods'];
    } else if (points >= -19) {
      level = 'neutral';
      description = 'Neither liked nor disliked';
    } else if (points >= -59) {
      level = 'hostile';
      description = 'Distrusted';
      penalties = ['Higher prices', 'Limited access'];
    } else {
      level = 'hated';
      description = 'Actively despised';
      penalties = ['Attack on sight', 'Banned from territories'];
    }

    return { level, description, benefits, penalties };
  }

  private getRelationshipId(char1: string, char2: string): string {
    // Create consistent ID regardless of order
    const [first, second] = [char1, char2].sort();
    return `rel_${first}_${second}`;
  }

  private getRomanceId(char1: string, char2: string): string {
    const [first, second] = [char1, char2].sort();
    return `rom_${first}_${second}`;
  }

  private addToCharacterIndex(characterId: string, relationshipId: string): void {
    if (!this.characterRelationships.has(characterId)) {
      this.characterRelationships.set(characterId, new Set());
    }
    this.characterRelationships.get(characterId)!.add(relationshipId);
  }

  private getCharacterRomances(characterId: string): Romance[] {
    return Array.from(this.romances.values())
      .filter(romance => romance.partners.includes(characterId));
  }

  private calculateSocialScore(relationships: Relationship[], romances: Romance[]): number {
    let score = 0;

    // Points from relationships
    for (const rel of relationships) {
      score += rel.points;
    }

    // Bonus points from romances
    for (const romance of romances) {
      if (romance.status === 'active') {
        score += romance.affection * 2;
      }
    }

    return Math.max(0, score);
  }

  private calculateAverageRelationshipPoints(): number {
    if (this.relationships.size === 0) return 0;

    const totalPoints = Array.from(this.relationships.values())
      .reduce((sum, rel) => sum + rel.points, 0);

    return totalPoints / this.relationships.size;
  }

  private calculateRomanceSuccessRate(): number {
    if (this.romances.size === 0) return 0;

    const successfulRomances = Array.from(this.romances.values())
      .filter(romance => romance.stage === 'married' || romance.stage === 'committed')
      .length;

    return (successfulRomances / this.romances.size) * 100;
  }

  private getFactionStandingDistribution(): Record<string, number> {
    const distribution: Record<string, number> = {
      exalted: 0,
      honored: 0,
      friendly: 0,
      neutral: 0,
      hostile: 0,
      hated: 0
    };

    for (const faction of this.factions.values()) {
      distribution[faction.standing.level]++;
    }

    return distribution;
  }

  private startRelationshipDecayTimer(): void {
    // Run relationship decay every 24 hours
    setInterval(() => {
      this.performRelationshipDecay();
    }, 24 * 60 * 60 * 1000);
  }

  private async performRelationshipDecay(): Promise<void> {
    const now = new Date();
    const decayThreshold = 7 * 24 * 60 * 60 * 1000; // 7 days

    for (const relationship of this.relationships.values()) {
      const daysSinceInteraction = (now.getTime() - relationship.lastInteraction.getTime()) / (24 * 60 * 60 * 1000);

      if (daysSinceInteraction > 7) {
        const decayAmount = Math.floor(daysSinceInteraction / 7) * this.config.relationshipDecayRate;
        relationship.points = Math.max(-100, relationship.points - decayAmount);

        relationship.level = this.calculateRelationshipLevel(relationship.points);

        // Emit decay event
        this.eventBus.emit('relationship:decayed', {
          relationship,
          decayAmount,
          daysSinceInteraction
        });
      }
    }
  }

  private async persistAllSocialData(): Promise<void> {
    // Implementation would save to database
    console.log(`[Social] Persisting ${this.relationships.size} relationships, ${this.romances.size} romances, ${this.factions.size} factions`);
  }

  // Event handlers

  private async handleTaskDetected(data: { task: DetectedTask; characterId?: string }): Promise<void> {
    if (!data.characterId || !this.config.relationshipTracking) return;

    const task = data.task;

    // Update relationships based on task type
    if (task.type === 'social') {
      const targetId = task.details.target;
      if (targetId) {
        let points = 0;
        const reason = `Social interaction: ${task.details.action || task.type}`;

        if (task.details.socialContext?.tone === 'friendly') {
          points = 5;
        } else if (task.details.socialContext?.tone === 'hostile') {
          points = -5;
        } else if (task.details.socialContext?.tone === 'romantic') {
          points = 8;
        }

        if (points !== 0) {
          await this.updateRelationship(data.characterId, targetId, points, reason);
        }
      }
    }
  }

  private async handleCharacterInteraction(data: { sourceId: string; targetId: string; type: string; context?: string }): Promise<void> {
    if (!this.config.relationshipTracking) return;

    let points = 0;
    let reason = `Character interaction: ${data.type}`;

    // Assign points based on interaction type
    switch (data.type) {
      case 'conversation':
        points = 2;
        break;
      case 'help':
        points = 5;
        break;
      case 'gift':
        points = 8;
        break;
      case 'betrayal':
        points = -20;
        break;
      case 'combat_ally':
        points = 10;
        break;
      case 'combat_enemy':
        points = -15;
        break;
    }

    if (points !== 0) {
      await this.updateRelationship(data.sourceId, data.targetId, points, reason, data.context);
    }
  }

  private async handleQuestCompleted(data: { questId: string; participants: string[]; success: boolean }): Promise<void> {
    if (!data.success) return;

    // Boost relationships between quest participants
    for (let i = 0; i < data.participants.length; i++) {
      for (let j = i + 1; j < data.participants.length; j++) {
        const char1 = data.participants[i];
        const char2 = data.participants[j];

        await this.updateRelationship(char1, char2, 5, 'Completed quest together');
      }
    }
  }

  private async handleSocialAction(data: { action: string; sourceId: string; targetId?: string; context?: any }): Promise<void> {
    // Handle specific social actions
    switch (data.action) {
      case 'propose_romance':
        if (data.targetId) {
          await this.startRomance(data.sourceId, data.targetId);
        }
        break;

      case 'break_up':
        if (data.targetId) {
          const romance = this.getCharacterRomances(data.sourceId)
            .find(r => r.partners.includes(data.targetId!) && r.status === 'active');
          if (romance) {
            romance.status = 'ended';
            this.eventBus.emit('romance:ended', { romance, reason: data.context?.reason });
          }
        }
        break;

      case 'join_faction':
        if (data.context?.factionId) {
          // Add character to faction
          const faction = this.factions.get(data.context.factionId);
          if (faction && !faction.members.includes(data.sourceId)) {
            faction.members.push(data.sourceId);
            await this.updateFactionStanding(data.context.factionId, 10, 'New member joined');
          }
        }
        break;
    }
  }
}

// Global instance
export const socialSystemsService = new SocialSystemsService();
