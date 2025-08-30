/**
 * Theft Service - Manages Theft Mechanics and Security Systems
 *
 * Critical innovation: Realistic theft system with detection mechanics,
 * security countermeasures, and meaningful consequences that create
 * strategic gameplay around guild resource protection.
 */

import { BaseService } from './BaseService';
import { EventBus } from './EventBus';
import { TokenCounter } from '../../shared/utils/tokenCounter';
import {
  TheftAttempt,
  TheftConsequence,
  GuildStorage,
  Item,
  InventoryTransaction,
  TransactionType
} from '../../src/types';

export interface TheftConfig {
  enabled: boolean;
  baseDetectionChance: number; // Base chance to detect theft
  securityMultiplier: number; // How much security affects detection
  skillImportance: number; // How much thief skill affects success
  alarmCooldown: number; // Minutes before alarm can trigger again
  bountySystemEnabled: boolean;
  reputationImpactEnabled: boolean;
}

export interface SecurityMeasure {
  id: string;
  name: string;
  type: 'alarm' | 'trap' | 'guard' | 'magical' | 'mechanical';
  detectionChance: number;
  triggerChance: number;
  severity: number; // 1-10
  cost: number;
  description: string;
  effects: TheftConsequence[];
}

export interface TheftResult {
  success: boolean;
  detected: boolean;
  stolenItems: Array<{
    itemId: string;
    quantity: number;
  }>;
  consequences: TheftConsequence[];
  detectionMethod?: string;
  stolenValue: number;
}

export interface Bounty {
  id: string;
  thiefId: string;
  storageId: string;
  amount: number;
  reason: string;
  postedBy: string;
  expiresAt: Date;
  claimed: boolean;
}

const DEFAULT_THEFT_CONFIG: TheftConfig = {
  enabled: true,
  baseDetectionChance: 0.2, // 20% base detection chance
  securityMultiplier: 0.1, // 10% per security level
  skillImportance: 0.3, // 30% weight on thief skill
  alarmCooldown: 30, // 30 minutes
  bountySystemEnabled: true,
  reputationImpactEnabled: true
};

export class TheftService extends BaseService {
  private config: TheftConfig;
  private securityMeasures = new Map<string, SecurityMeasure[]>();
  private activeAlarms = new Map<string, Date>();
  private bounties = new Map<string, Bounty>();

  constructor(config: Partial<TheftConfig> = {}) {
    super('TheftService', { performanceBudget: 100 });
    this.config = { ...DEFAULT_THEFT_CONFIG, ...config };
    this.initializeSecurityMeasures();
  }

  protected async onInitialize(): Promise<void> {
    // Register event listeners
    this.eventBus.on('theft:attempt', this.handleTheftAttempt.bind(this));
    this.eventBus.on('security:alarm_triggered', this.handleAlarmTriggered.bind(this));
    this.eventBus.on('bounty:posted', this.handleBountyPosted.bind(this));
    this.eventBus.on('bounty:claimed', this.handleBountyClaimed.bind(this));

    console.log('[Theft] Initialized with config:', this.config);
  }

  protected async onShutdown(): Promise<void> {
    // Clean up active alarms and bounties
    this.activeAlarms.clear();
    this.bounties.clear();
    console.log('[Theft] Shut down gracefully');
  }

  /**
   * Attempt theft from guild storage
   */
  async attemptTheft(
    thiefId: string,
    storageId: string,
    targetItems: Array<{
      itemId: string;
      quantity: number;
    }>,
    thiefSkill: number = 1
  ): Promise<TheftResult> {
    return this.measureOperation('attemptTheft', async () => {
      const storage = await this.getGuildStorage(storageId);

      // Check if alarm is on cooldown
      if (this.isAlarmOnCooldown(storageId)) {
        return {
          success: false,
          detected: true,
          stolenItems: [],
          consequences: [{
            type: 'alarm',
            severity: 5,
            description: 'Recent alarm prevents theft attempt'
          }],
          stolenValue: 0
        };
      }

      // Calculate theft success chance
      const theftChance = this.calculateTheftSuccessChance(storage, thiefSkill);
      const success = Math.random() < theftChance;

      // Calculate detection chance
      const detectionChance = this.calculateDetectionChance(storage, thiefSkill);
      const detected = Math.random() < detectionChance;

      const result: TheftResult = {
        success: success && !detected,
        detected,
        stolenItems: [],
        consequences: [],
        stolenValue: 0
      };

      if (success && !detected) {
        // Successful theft
        result.stolenItems = await this.processSuccessfulTheft(storageId, targetItems, thiefId);
        result.stolenValue = await this.calculateStolenValue(result.stolenItems);

        // Create transaction record
        await this.createTheftTransaction(storageId, thiefId, result.stolenItems);
      }

      // Generate consequences
      result.consequences = await this.generateTheftConsequences(storage, detected, success);

      // Trigger security measures if detected
      if (detected) {
        const detectionMethod = await this.triggerSecurityMeasures(storage);
        result.detectionMethod = detectionMethod;

        // Set alarm cooldown
        this.setAlarmCooldown(storageId);
      }

      // Emit theft result event
      this.eventBus.emit('theft:result', {
        thiefId,
        storageId,
        result
      });

      return result;
    });
  }

  /**
   * Install security measure on storage
   */
  async installSecurityMeasure(
    storageId: string,
    measureId: string,
    installerId: string
  ): Promise<{
    success: boolean;
    measure: SecurityMeasure;
    cost: number;
  }> {
    return this.measureOperation('installSecurityMeasure', async () => {
      const measure = this.getSecurityMeasure(measureId);
      if (!measure) {
        throw new Error(`Unknown security measure: ${measureId}`);
      }

      // Check if storage can afford the measure
      const storage = await this.getGuildStorage(storageId);
      // Implementation would check guild funds

      // Install measure
      if (!this.securityMeasures.has(storageId)) {
        this.securityMeasures.set(storageId, []);
      }

      this.securityMeasures.get(storageId)!.push(measure);

      // Emit installation event
      this.eventBus.emit('security:measure_installed', {
        storageId,
        measure,
        installerId
      });

      return {
        success: true,
        measure,
        cost: measure.cost
      };
    });
  }

  /**
   * Post bounty for thief
   */
  async postBounty(
    thiefId: string,
    storageId: string,
    amount: number,
    posterId: string,
    reason: string
  ): Promise<Bounty> {
    return this.measureOperation('postBounty', async () => {
      if (!this.config.bountySystemEnabled) {
        throw new Error('Bounty system is disabled');
      }

      const bounty: Bounty = {
        id: `bounty_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        thiefId,
        storageId,
        amount,
        reason,
        postedBy: posterId,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        claimed: false
      };

      this.bounties.set(bounty.id, bounty);

      // Emit bounty posted event
      this.eventBus.emit('bounty:posted', bounty);

      return bounty;
    });
  }

  /**
   * Claim bounty
   */
  async claimBounty(
    bountyId: string,
    claimantId: string
  ): Promise<{
    success: boolean;
    amount: number;
    bounty: Bounty;
  }> {
    return this.measureOperation('claimBounty', async () => {
      const bounty = this.bounties.get(bountyId);
      if (!bounty) {
        throw new Error('Bounty not found');
      }

      if (bounty.claimed) {
        throw new Error('Bounty already claimed');
      }

      if (bounty.expiresAt < new Date()) {
        throw new Error('Bounty has expired');
      }

      // Mark as claimed
      bounty.claimed = true;

      // Emit bounty claimed event
      this.eventBus.emit('bounty:claimed', {
        bounty,
        claimantId
      });

      return {
        success: true,
        amount: bounty.amount,
        bounty
      };
    });
  }

  /**
   * Get security status for storage
   */
  async getSecurityStatus(storageId: string): Promise<{
    securityLevel: number;
    activeMeasures: SecurityMeasure[];
    recentBreaches: number;
    alarmCooldownRemaining: number;
    vulnerabilityScore: number;
  }> {
    const storage = await this.getGuildStorage(storageId);
    const measures = this.securityMeasures.get(storageId) || [];
    const cooldownRemaining = this.getAlarmCooldownRemaining(storageId);

    // Calculate vulnerability score (lower is better)
    const vulnerabilityScore = Math.max(0, 10 - storage.securityLevel - (measures.length * 0.5));

    return {
      securityLevel: storage.securityLevel,
      activeMeasures: measures,
      recentBreaches: 0, // Would track from database
      alarmCooldownRemaining: cooldownRemaining,
      vulnerabilityScore
    };
  }

  /**
   * Get available security measures
   */
  getAvailableSecurityMeasures(): SecurityMeasure[] {
    return Array.from(this.securityMeasures.values()).flat();
  }

  /**
   * Get active bounties
   */
  getActiveBounties(storageId?: string): Bounty[] {
    const allBounties = Array.from(this.bounties.values());
    const activeBounties = allBounties.filter(b =>
      !b.claimed && b.expiresAt > new Date()
    );

    if (storageId) {
      return activeBounties.filter(b => b.storageId === storageId);
    }

    return activeBounties;
  }

  // Private methods

  private calculateTheftSuccessChance(storage: GuildStorage, thiefSkill: number): number {
    // Base success chance
    let chance = 0.4; // 40% base success

    // Thief skill modifier
    chance += (thiefSkill - 1) * this.config.skillImportance;

    // Security level penalty
    chance -= storage.securityLevel * 0.05;

    // Clamp between 5% and 95%
    return Math.max(0.05, Math.min(0.95, chance));
  }

  private calculateDetectionChance(storage: GuildStorage, thiefSkill: number): number {
    // Base detection chance
    let chance = this.config.baseDetectionChance;

    // Security level bonus
    chance += storage.securityLevel * this.config.securityMultiplier;

    // Thief skill penalty reduction
    chance -= (thiefSkill - 1) * (this.config.skillImportance * 0.5);

    // Active security measures bonus
    const measures = this.securityMeasures.get(storage.id) || [];
    chance += measures.length * 0.05;

    // Clamp between 5% and 95%
    return Math.max(0.05, Math.min(0.95, chance));
  }

  private async processSuccessfulTheft(
    storageId: string,
    targetItems: Array<{ itemId: string; quantity: number }>,
    thiefId: string
  ): Promise<Array<{ itemId: string; quantity: number }>> {
    // Process successful theft (would update inventory)
    const stolenItems: Array<{ itemId: string; quantity: number }> = [];

    for (const target of targetItems) {
      // In reality, this would check if items exist and remove them
      // For now, assume all items are stolen
      stolenItems.push({
        itemId: target.itemId,
        quantity: target.quantity
      });
    }

    return stolenItems;
  }

  private async calculateStolenValue(
    stolenItems: Array<{ itemId: string; quantity: number }>
  ): Promise<number> {
    let totalValue = 0;

    for (const item of stolenItems) {
      // Would look up item value from database
      // For now, use placeholder value
      totalValue += 100 * item.quantity; // Assume 100 gold per item
    }

    return totalValue;
  }

  private async generateTheftConsequences(
    storage: GuildStorage,
    detected: boolean,
    success: boolean
  ): Promise<TheftConsequence[]> {
    const consequences: TheftConsequence[] = [];

    if (detected) {
      // Always add alarm consequence for detection
      consequences.push({
        type: 'alarm',
        severity: Math.floor(storage.securityLevel / 2) + 3,
        description: 'Security system detected unauthorized access'
      });

      // Add reputation consequence if enabled
      if (this.config.reputationImpactEnabled) {
        consequences.push({
          type: 'reputation_loss',
          severity: success ? 2 : 4,
          description: 'Guild reputation damaged by security breach'
        });
      }
    }

    if (success && !detected) {
      // Hidden theft consequences
      consequences.push({
        type: 'reputation_loss',
        severity: 1,
        description: 'Subtle suspicion of theft activity'
      });
    }

    // Add security-specific consequences
    if (storage.securityLevel >= 5) {
      consequences.push({
        type: 'damage',
        severity: Math.floor(storage.securityLevel / 3),
        description: 'Security countermeasures caused damage'
      });
    }

    return consequences;
  }

  private async triggerSecurityMeasures(storage: GuildStorage): Promise<string> {
    const measures = this.securityMeasures.get(storage.id) || [];
    const triggeredMeasure = measures[Math.floor(Math.random() * measures.length)];

    if (triggeredMeasure) {
      // Emit security trigger event
      this.eventBus.emit('security:measure_triggered', {
        storageId: storage.id,
        measure: triggeredMeasure
      });

      return triggeredMeasure.type;
    }

    return 'basic_alarm';
  }

  private async createTheftTransaction(
    storageId: string,
    thiefId: string,
    stolenItems: Array<{ itemId: string; quantity: number }>
  ): Promise<void> {
    // Create transaction records for stolen items
    for (const item of stolenItems) {
      const transaction: InventoryTransaction = {
        id: `theft_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        itemId: item.itemId,
        characterId: thiefId,
        transactionType: 'acquire',
        fromLocation: `guild_storage:${storageId}`,
        toLocation: 'inventory',
        quantity: item.quantity,
        value: 0, // Would calculate
        durabilityChange: 0,
        notes: 'Acquired through theft',
        transactionAt: new Date(),
        campaignId: 'mock_campaign', // Would get from storage
        performedBy: thiefId,
        metadata: {
          theft: true,
          originalStorage: storageId
        }
      };

      // Emit transaction event
      this.eventBus.emit('inventory:transaction', transaction);
    }
  }

  private isAlarmOnCooldown(storageId: string): boolean {
    const lastAlarm = this.activeAlarms.get(storageId);
    if (!lastAlarm) return false;

    const cooldownMs = this.config.alarmCooldown * 60 * 1000;
    return Date.now() - lastAlarm.getTime() < cooldownMs;
  }

  private setAlarmCooldown(storageId: string): void {
    this.activeAlarms.set(storageId, new Date());
  }

  private getAlarmCooldownRemaining(storageId: string): number {
    const lastAlarm = this.activeAlarms.get(storageId);
    if (!lastAlarm) return 0;

    const cooldownMs = this.config.alarmCooldown * 60 * 1000;
    const elapsed = Date.now() - lastAlarm.getTime();
    const remaining = Math.max(0, cooldownMs - elapsed);

    return Math.floor(remaining / (60 * 1000)); // Return minutes
  }

  private async getGuildStorage(storageId: string): Promise<GuildStorage> {
    // This would query the database
    // For now, return a mock storage
    return {
      id: storageId,
      campaignId: 'mock_campaign',
      name: 'Mock Storage',
      capacity: 100,
      usedCapacity: 50,
      securityLevel: 3,
      accessLevel: 'member',
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }

  private getSecurityMeasure(measureId: string): SecurityMeasure | undefined {
    // Return measure from initialized list
    for (const measures of this.securityMeasures.values()) {
      const measure = measures.find(m => m.id === measureId);
      if (measure) return measure;
    }
    return undefined;
  }

  private initializeSecurityMeasures(): void {
    // Initialize available security measures
    const measures: SecurityMeasure[] = [
      {
        id: 'alarm_system',
        name: 'Alarm System',
        type: 'alarm',
        detectionChance: 0.8,
        triggerChance: 0.9,
        severity: 3,
        cost: 500,
        description: 'Triggers alarm when unauthorized access detected',
        effects: [{
          type: 'alarm',
          severity: 3,
          description: 'Loud alarm alerts nearby guards'
        }]
      },
      {
        id: 'trap_mechanism',
        name: 'Trap Mechanism',
        type: 'trap',
        detectionChance: 0.3,
        triggerChance: 0.6,
        severity: 6,
        cost: 1000,
        description: 'Physical traps that damage intruders',
        effects: [{
          type: 'damage',
          severity: 6,
          description: 'Trap causes significant damage to intruder'
        }]
      },
      {
        id: 'guard_patrol',
        name: 'Guard Patrol',
        type: 'guard',
        detectionChance: 0.9,
        triggerChance: 0.7,
        severity: 4,
        cost: 750,
        description: 'Guards patrol the area regularly',
        effects: [{
          type: 'alarm',
          severity: 4,
          description: 'Guards immediately respond to disturbance'
        }]
      },
      {
        id: 'magic_ward',
        name: 'Magic Ward',
        type: 'magical',
        detectionChance: 0.7,
        triggerChance: 0.8,
        severity: 5,
        cost: 1500,
        description: 'Magical wards detect and counter intruders',
        effects: [
          {
            type: 'alarm',
            severity: 5,
            description: 'Magical alarm alerts spellcasters'
          },
          {
            type: 'curse',
            severity: 3,
            description: 'Temporary curse affects the intruder'
          }
        ]
      },
      {
        id: 'lock_mechanism',
        name: 'Advanced Lock',
        type: 'mechanical',
        detectionChance: 0.6,
        triggerChance: 0.4,
        severity: 2,
        cost: 300,
        description: 'Complex mechanical locks resist tampering',
        effects: [{
          type: 'alarm',
          severity: 2,
          description: 'Failed lock attempt triggers silent alarm'
        }]
      }
    ];

    // Store measures (using a dummy key since measures are global)
    this.securityMeasures.set('global_measures', measures);
  }

  // Event handlers

  private async handleTheftAttempt(data: {
    thiefId: string;
    storageId: string;
    targetItems: Array<{ itemId: string; quantity: number }>;
    thiefSkill?: number;
  }): Promise<void> {
    try {
      await this.attemptTheft(
        data.thiefId,
        data.storageId,
        data.targetItems,
        data.thiefSkill || 1
      );
    } catch (error) {
      console.error('[Theft] Error handling theft attempt:', error);
    }
  }

  private async handleAlarmTriggered(data: { storageId: string; severity: number }): Promise<void> {
    // Handle alarm triggering (would notify guild members, etc.)
    console.log(`[Theft] Alarm triggered for storage ${data.storageId} with severity ${data.severity}`);
  }

  private async handleBountyPosted(data: Bounty): Promise<void> {
    // Handle bounty posting (would notify adventurers, etc.)
    console.log(`[Theft] Bounty posted for ${data.amount} gold on thief ${data.thiefId}`);
  }

  private async handleBountyClaimed(data: { bounty: Bounty; claimantId: string }): Promise<void> {
    // Handle bounty claiming (would process payment, etc.)
    console.log(`[Theft] Bounty claimed by ${data.claimantId} for ${data.bounty.amount} gold`);
  }
}

// Global instance
export const theftService = new TheftService();
