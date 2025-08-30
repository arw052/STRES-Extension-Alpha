/**
 * Durability Service - Manages Item Degradation, Repair, and Break Conditions
 *
 * Critical innovation: Realistic item degradation with strategic repair mechanics
 * that create meaningful gameplay decisions around equipment maintenance.
 */

import { BaseService } from './BaseService';
import { EventBus } from './EventBus';
import { TokenCounter } from '../../shared/utils/tokenCounter';
import {
  Item,
  ItemCondition,
  ItemRepair,
  InventoryTransaction,
  TransactionType
} from '../../src/types';

export interface DurabilityConfig {
  enabled: boolean;
  degradationMultiplier: number; // Global multiplier for degradation
  repairCostMultiplier: number; // Cost multiplier for repairs
  autoBreakEnabled: boolean; // Enable automatic breaking
  breakNotificationThreshold: number; // Durability % to warn at
  repairSkillRequired: boolean; // Require repair skill for complex repairs
}

export interface DurabilityEvent {
  type: 'degraded' | 'broken' | 'repaired' | 'warning';
  itemId: string;
  oldDurability: number;
  newDurability: number;
  reason: string;
  characterId?: string;
}

export interface DegradationRule {
  itemType: string;
  usageType: string; // 'combat', 'travel', 'crafting', etc.
  baseDegradation: number; // Base durability loss
  modifiers: {
    condition?: string; // Weather, environment effects
    quality?: string; // Item quality modifiers
    userSkill?: string; // User skill modifiers
  };
}

const DEFAULT_DURABILITY_CONFIG: DurabilityConfig = {
  enabled: true,
  degradationMultiplier: 1.0,
  repairCostMultiplier: 1.0,
  autoBreakEnabled: true,
  breakNotificationThreshold: 25, // Warn at 25% durability
  repairSkillRequired: true
};

export class DurabilityService extends BaseService {
  private config: DurabilityConfig;
  private degradationRules = new Map<string, DegradationRule[]>();
  private repairQueue = new Map<string, ItemRepair>();

  constructor(config: Partial<DurabilityConfig> = {}) {
    super('DurabilityService', { performanceBudget: 50 });
    this.config = { ...DEFAULT_DURABILITY_CONFIG, ...config };
    this.initializeDegradationRules();
  }

  protected async onInitialize(): Promise<void> {
    // Register event listeners
    this.eventBus.on('item:used', this.handleItemUsed.bind(this));
    this.eventBus.on('combat:ended', this.handleCombatEnded.bind(this));
    this.eventBus.on('travel:completed', this.handleTravelCompleted.bind(this));
    this.eventBus.on('crafting:completed', this.handleCraftingCompleted.bind(this));
    this.eventBus.on('repair:requested', this.handleRepairRequested.bind(this));

    console.log('[Durability] Initialized with config:', this.config);
  }

  protected async onShutdown(): Promise<void> {
    // Process any pending repairs
    await this.processPendingRepairs();
    console.log('[Durability] Shut down gracefully');
  }

  /**
   * Apply durability degradation to an item
   */
  async degradeItem(
    item: Item,
    usageType: string,
    context: {
      characterId?: string;
      environment?: string;
      userSkill?: number;
      intensity?: number; // 0.1 to 2.0 multiplier
    } = {}
  ): Promise<{
    success: boolean;
    newDurability: number;
    broke: boolean;
    events: DurabilityEvent[];
  }> {
    return this.measureOperation('degradeItem', async () => {
      if (!this.config.enabled) {
        return {
          success: true,
          newDurability: item.durabilityCurrent,
          broke: false,
          events: []
        };
      }

      const events: DurabilityEvent[] = [];
      const oldDurability = item.durabilityCurrent;

      // Calculate degradation
      const degradation = this.calculateDegradation(item, usageType, context);
      const newDurability = Math.max(0, oldDurability - degradation);

      // Check for warnings
      if (oldDurability > this.config.breakNotificationThreshold &&
          newDurability <= this.config.breakNotificationThreshold) {
        events.push({
          type: 'warning',
          itemId: item.id,
          oldDurability,
          newDurability,
          reason: `Item durability below ${this.config.breakNotificationThreshold}%`,
          characterId: context.characterId
        });
      }

      // Check for breaking
      const broke = newDurability <= item.breakThreshold;
      if (broke && this.config.autoBreakEnabled) {
        events.push({
          type: 'broken',
          itemId: item.id,
          oldDurability,
          newDurability,
          reason: 'Item durability reached break threshold',
          characterId: context.characterId
        });
      } else if (newDurability < oldDurability) {
        events.push({
          type: 'degraded',
          itemId: item.id,
          oldDurability,
          newDurability,
          reason: `Used in ${usageType}`,
          characterId: context.characterId
        });
      }

      // Update item durability (this would typically update the database)
      item.durabilityCurrent = newDurability;

      // Emit events
      for (const event of events) {
        this.eventBus.emit('durability:changed', event);
      }

      return {
        success: true,
        newDurability,
        broke,
        events
      };
    });
  }

  /**
   * Calculate durability repair cost and requirements
   */
  async calculateRepair(
    item: Item,
    targetDurability?: number
  ): Promise<ItemRepair> {
    return this.measureOperation('calculateRepair', async () => {
      const maxRestore = Math.min(
        item.durabilityMax - item.durabilityCurrent,
        targetDurability ? targetDurability - item.durabilityCurrent : item.durabilityMax
      );

      // Base repair cost scales with item value and damage
      const damageRatio = (item.durabilityMax - item.durabilityCurrent) / item.durabilityMax;
      const baseCost = Math.floor(item.baseValue * damageRatio * this.config.repairCostMultiplier);

      // Material requirements based on item type
      const materials = this.calculateRepairMaterials(item, maxRestore);

      // Success chance based on item complexity and damage
      const complexity = this.getItemComplexity(item);
      const successChance = Math.max(0.1, 1.0 - (damageRatio * 0.5) - (complexity * 0.2));

      // Repair time based on item size and damage
      const repairTime = Math.floor(
        (item.weight * 10) + (maxRestore * 2) + (complexity * 30)
      );

      const repair: ItemRepair = {
        itemId: item.id,
        repairCost: baseCost,
        repairTime,
        requiredMaterials: materials,
        successChance,
        maxDurabilityRestored: maxRestore
      };

      return repair;
    });
  }

  /**
   * Process item repair
   */
  async repairItem(
    item: Item,
    repair: ItemRepair,
    crafterId: string
  ): Promise<{
    success: boolean;
    newDurability: number;
    events: DurabilityEvent[];
    cost: number;
  }> {
    return this.measureOperation('repairItem', async () => {
      const events: DurabilityEvent[] = [];
      const oldDurability = item.durabilityCurrent;

      // Check success chance
      const success = Math.random() < repair.successChance;

      if (success) {
        const maxNewDurability = Math.min(
          item.durabilityMax,
          oldDurability + repair.maxDurabilityRestored
        );
        item.durabilityCurrent = maxNewDurability;

        events.push({
          type: 'repaired',
          itemId: item.id,
          oldDurability,
          newDurability: item.durabilityCurrent,
          reason: 'Successfully repaired',
          characterId: crafterId
        });
      } else {
        // Failed repair - slight damage
        const damage = Math.floor(item.durabilityMax * 0.05);
        item.durabilityCurrent = Math.max(0, oldDurability - damage);

        events.push({
          type: 'degraded',
          itemId: item.id,
          oldDurability,
          newDurability: item.durabilityCurrent,
          reason: 'Repair failed, item damaged',
          characterId: crafterId
        });
      }

      // Emit events
      for (const event of events) {
        this.eventBus.emit('durability:changed', event);
      }

      return {
        success,
        newDurability: item.durabilityCurrent,
        events,
        cost: repair.repairCost
      };
    });
  }

  /**
   * Get item condition based on durability
   */
  getItemCondition(item: Item): ItemCondition {
    const durabilityPercent = (item.durabilityCurrent / item.durabilityMax) * 100;

    if (durabilityPercent <= 0) return 'broken';
    if (durabilityPercent <= 25) return 'damaged';
    if (durabilityPercent <= 50) return 'worn';
    if (durabilityPercent <= 75) return 'good';
    if (durabilityPercent <= 95) return 'excellent';
    return 'pristine';
  }

  /**
   * Get durability statistics
   */
  getDurabilityStats() {
    // This would typically query the database for durability statistics
    return {
      totalItems: 0, // Would be populated from DB
      brokenItems: 0,
      warningItems: 0, // Items below warning threshold
      averageDurability: 0,
      repairQueueLength: this.repairQueue.size
    };
  }

  // Private methods

  private calculateDegradation(
    item: Item,
    usageType: string,
    context: {
      characterId?: string;
      environment?: string;
      userSkill?: number;
      intensity?: number;
    }
  ): number {
    const rules = this.degradationRules.get(item.type) || [];
    const rule = rules.find(r => r.usageType === usageType);

    if (!rule) {
      // Default degradation
      return Math.floor(item.durabilityMax * item.durabilityRate * (context.intensity || 1.0));
    }

    let degradation = rule.baseDegradation;

    // Apply modifiers
    if (context.environment && rule.modifiers.condition) {
      const conditionModifier = this.getConditionModifier(context.environment);
      degradation *= conditionModifier;
    }

    if (context.userSkill !== undefined) {
      const skillModifier = this.getSkillModifier(context.userSkill);
      degradation *= skillModifier;
    }

    // Apply intensity
    if (context.intensity) {
      degradation *= context.intensity;
    }

    // Apply global multiplier
    degradation *= this.config.degradationMultiplier;

    return Math.floor(degradation);
  }

  private calculateRepairMaterials(item: Item, maxRestore: number): Record<string, number> {
    const materials: Record<string, number> = {};

    // Base materials depend on item type
    switch (item.type) {
      case 'weapon':
        materials['metal_ingot'] = Math.ceil(maxRestore / 20);
        materials['leather_strip'] = Math.ceil(maxRestore / 30);
        break;
      case 'armor':
        materials['metal_ingot'] = Math.ceil(maxRestore / 15);
        materials['cloth'] = Math.ceil(maxRestore / 25);
        materials['leather_strip'] = Math.ceil(maxRestore / 20);
        break;
      case 'tool':
        materials['metal_ingot'] = Math.ceil(maxRestore / 25);
        materials['wood'] = Math.ceil(maxRestore / 30);
        break;
      default:
        materials['cloth'] = Math.ceil(maxRestore / 40);
        break;
    }

    return materials;
  }

  private getItemComplexity(item: Item): number {
    // Complexity based on item type and rarity
    const typeComplexity = {
      weapon: 3,
      armor: 4,
      tool: 2,
      consumable: 1,
      misc: 1
    };

    const rarityComplexity = {
      common: 1,
      uncommon: 1.5,
      rare: 2,
      epic: 3,
      legendary: 4,
      artifact: 5
    };

    return typeComplexity[item.type] * rarityComplexity[item.rarity];
  }

  private getConditionModifier(environment: string): number {
    const modifiers: Record<string, number> = {
      'rain': 1.2,
      'snow': 1.3,
      'desert': 1.4,
      'mountain': 1.1,
      'forest': 1.0,
      'urban': 0.9
    };

    return modifiers[environment] || 1.0;
  }

  private getSkillModifier(skill: number): number {
    // Higher skill reduces degradation
    if (skill >= 15) return 0.7;
    if (skill >= 10) return 0.8;
    if (skill >= 5) return 0.9;
    return 1.0;
  }

  private initializeDegradationRules(): void {
    // Weapon degradation rules
    this.degradationRules.set('weapon', [
      {
        itemType: 'weapon',
        usageType: 'combat',
        baseDegradation: 5,
        modifiers: {
          condition: 'environment',
          quality: 'item_rarity',
          userSkill: 'weapon_skill'
        }
      },
      {
        itemType: 'weapon',
        usageType: 'travel',
        baseDegradation: 1,
        modifiers: {
          condition: 'environment'
        }
      }
    ]);

    // Armor degradation rules
    this.degradationRules.set('armor', [
      {
        itemType: 'armor',
        usageType: 'combat',
        baseDegradation: 3,
        modifiers: {
          condition: 'environment',
          quality: 'item_rarity'
        }
      },
      {
        itemType: 'armor',
        usageType: 'travel',
        baseDegradation: 2,
        modifiers: {
          condition: 'environment'
        }
      }
    ]);

    // Tool degradation rules
    this.degradationRules.set('tool', [
      {
        itemType: 'tool',
        usageType: 'crafting',
        baseDegradation: 4,
        modifiers: {
          userSkill: 'crafting_skill'
        }
      },
      {
        itemType: 'tool',
        usageType: 'general',
        baseDegradation: 2,
        modifiers: {}
      }
    ]);
  }

  private async processPendingRepairs(): Promise<void> {
    // Process any repairs that were queued
    for (const [itemId, repair] of this.repairQueue) {
      console.log(`[Durability] Processing pending repair for item ${itemId}`);
      // Implementation would process the repair
    }
    this.repairQueue.clear();
  }

  // Event handlers

  private async handleItemUsed(data: { itemId: string; usageType: string; characterId: string; context?: any }): Promise<void> {
    try {
      // This would typically fetch the item from database
      // For now, we'll emit a degradation event that would be handled by the main system
      this.eventBus.emit('durability:degrade_request', {
        itemId: data.itemId,
        usageType: data.usageType,
        characterId: data.characterId,
        context: data.context
      });
    } catch (error) {
      console.error('[Durability] Error handling item used:', error);
    }
  }

  private async handleCombatEnded(data: { participants: any[]; duration: number }): Promise<void> {
    // Apply degradation to all combat equipment
    for (const participant of data.participants) {
      if (participant.equipment) {
        for (const equipment of participant.equipment) {
          await this.degradeItem(equipment, 'combat', {
            characterId: participant.id,
            intensity: Math.min(2.0, data.duration / 60) // Longer combat = more degradation
          });
        }
      }
    }
  }

  private async handleTravelCompleted(data: { characterId: string; distance: number; environment: string }): Promise<void> {
    // Apply degradation based on travel distance and environment
    const intensity = Math.min(2.0, data.distance / 100); // Scale with distance
    // Implementation would fetch and degrade travel equipment
  }

  private async handleCraftingCompleted(data: { characterId: string; toolId: string; complexity: number }): Promise<void> {
    // Apply degradation to crafting tools
    // Implementation would fetch and degrade the tool
  }

  private async handleRepairRequested(data: { itemId: string; characterId: string }): Promise<void> {
    // Queue repair request
    // Implementation would calculate repair cost and queue it
  }
}

// Global instance
export const durabilityService = new DurabilityService();
