/**
 * Enchantment Service - Manages Item Enchantments with Conflicts and Power Levels
 *
 * Critical innovation: Complex enchantment system with realistic conflicts
 * and power scaling that creates strategic trade-offs in item enhancement.
 */

import { BaseService } from './BaseService';
import { EventBus } from './EventBus';
import { TokenCounter } from '../../shared/utils/tokenCounter';
import {
  Item,
  Enchantment,
  EnchantmentType,
  EnchantmentEffect
} from '../../src/types';

export interface EnchantmentConfig {
  enabled: boolean;
  maxEnchantmentsPerItem: number; // Global max enchantments
  powerScalingEnabled: boolean; // Enable power-based scaling
  conflictDetectionEnabled: boolean; // Enable enchantment conflicts
  curseChance: number; // Chance of curses on high-power enchantments
  legendaryThreshold: number; // Power level for legendary enchantments
}

export interface EnchantmentRecipe {
  id: string;
  name: string;
  type: EnchantmentType;
  basePower: number;
  requiredMaterials: Record<string, number>;
  requiredSkill: number; // Minimum enchanting skill
  successChance: number;
  instabilityChance: number; // Chance of negative effects
  conflicts: string[]; // Enchantment IDs this conflicts with
  requiredSlots: number;
  description: string;
}

export interface EnchantmentAttempt {
  itemId: string;
  recipeId: string;
  enchanterId: string;
  materials: Record<string, number>;
  skillLevel: number;
  timestamp: Date;
}

export interface EnchantmentResult {
  success: boolean;
  enchantment?: Enchantment;
  curse?: Enchantment; // If enchantment failed and created a curse
  instabilityEffects?: EnchantmentEffect[];
  powerConsumed: number;
  materialsConsumed: Record<string, number>;
}

const DEFAULT_ENCHANTMENT_CONFIG: EnchantmentConfig = {
  enabled: true,
  maxEnchantmentsPerItem: 3,
  powerScalingEnabled: true,
  conflictDetectionEnabled: true,
  curseChance: 0.15, // 15% chance for curses on high-power items
  legendaryThreshold: 8
};

export class EnchantmentService extends BaseService {
  private config: EnchantmentConfig;
  private recipes = new Map<string, EnchantmentRecipe>();
  private enchantmentHistory = new Map<string, EnchantmentAttempt[]>();

  constructor(config: Partial<EnchantmentConfig> = {}) {
    super('EnchantmentService', { performanceBudget: 100 });
    this.config = { ...DEFAULT_ENCHANTMENT_CONFIG, ...config };
    this.initializeRecipes();
  }

  protected async onInitialize(): Promise<void> {
    // Register event listeners
    this.eventBus.on('enchantment:attempted', this.handleEnchantmentAttempt.bind(this));
    this.eventBus.on('item:created', this.handleItemCreated.bind(this));
    this.eventBus.on('crafting:completed', this.handleCraftingCompleted.bind(this));

    console.log('[Enchantment] Initialized with config:', this.config);
  }

  protected async onShutdown(): Promise<void> {
    console.log('[Enchantment] Shut down gracefully');
  }

  /**
   * Attempt to enchant an item
   */
  async attemptEnchantment(
    item: Item,
    recipeId: string,
    enchanterId: string,
    skillLevel: number,
    materials: Record<string, number>
  ): Promise<EnchantmentResult> {
    return this.measureOperation('attemptEnchantment', async () => {
      const recipe = this.recipes.get(recipeId);
      if (!recipe) {
        throw new Error(`Unknown enchantment recipe: ${recipeId}`);
      }

      // Validate requirements
      const validation = await this.validateEnchantmentAttempt(item, recipe, skillLevel, materials);
      if (!validation.valid) {
        throw new Error(`Enchantment validation failed: ${validation.reason}`);
      }

      // Calculate success chance
      const successChance = this.calculateSuccessChance(recipe, skillLevel, item);
      const success = Math.random() < successChance;

      const result: EnchantmentResult = {
        success,
        powerConsumed: recipe.basePower,
        materialsConsumed: { ...materials }
      };

      if (success) {
        // Create enchantment
        const enchantment = await this.createEnchantment(recipe, item, enchanterId);
        result.enchantment = enchantment;

        // Add to item
        await this.addEnchantmentToItem(item, enchantment);

        // Check for instability effects
        const instabilityEffects = await this.checkInstability(recipe, skillLevel);
        if (instabilityEffects.length > 0) {
          result.instabilityEffects = instabilityEffects;
          // Apply instability effects to item
          await this.applyInstabilityEffects(item, instabilityEffects);
        }
      } else {
        // Failed enchantment - possible curse
        if (Math.random() < this.config.curseChance) {
          const curse = await this.generateCurse(recipe, item);
          result.curse = curse;
          await this.addEnchantmentToItem(item, curse);
        }
      }

      // Record attempt
      await this.recordEnchantmentAttempt(item.id, recipeId, enchanterId, materials);

      // Emit result event
      this.eventBus.emit('enchantment:result', {
        itemId: item.id,
        recipeId,
        enchanterId,
        result
      });

      return result;
    });
  }

  /**
   * Remove enchantment from item
   */
  async removeEnchantment(
    item: Item,
    enchantmentId: string,
    removerId: string
  ): Promise<{
    success: boolean;
    itemDestroyed: boolean;
    materialsRecovered: Record<string, number>;
  }> {
    return this.measureOperation('removeEnchantment', async () => {
      const enchantment = item.enchantments.find(e => e.id === enchantmentId);
      if (!enchantment) {
        throw new Error(`Enchantment not found: ${enchantmentId}`);
      }

      // Calculate removal success chance
      const removalChance = this.calculateRemovalChance(enchantment, item);
      const success = Math.random() < removalChance;

      if (success) {
        // Remove enchantment
        item.enchantments = item.enchantments.filter(e => e.id !== enchantmentId);
        item.enchantmentSlots += enchantment.requiredSlots;

        // Recover some materials
        const materialsRecovered = this.calculateMaterialRecovery(enchantment);

        return {
          success: true,
          itemDestroyed: false,
          materialsRecovered
        };
      } else {
        // Failed removal - possible item damage
        const itemDestroyed = Math.random() < 0.3; // 30% chance of destruction

        if (itemDestroyed) {
          // Mark item as broken
          item.durabilityCurrent = 0;
        } else {
          // Reduce durability
          item.durabilityCurrent = Math.floor(item.durabilityCurrent * 0.8);
        }

        return {
          success: false,
          itemDestroyed,
          materialsRecovered: {}
        };
      }
    });
  }

  /**
   * Check for enchantment conflicts
   */
  checkEnchantmentConflicts(
    item: Item,
    newEnchantment: Enchantment
  ): {
    hasConflicts: boolean;
    conflicts: string[];
    canAdd: boolean;
  } {
    if (!this.config.conflictDetectionEnabled) {
      return { hasConflicts: false, conflicts: [], canAdd: true };
    }

    const conflicts: string[] = [];

    // Check direct conflicts
    for (const existing of item.enchantments) {
      if (newEnchantment.conflicts.includes(existing.id) ||
          existing.conflicts.includes(newEnchantment.id)) {
        conflicts.push(`${existing.name} conflicts with ${newEnchantment.name}`);
      }
    }

    // Check slot availability
    const totalSlotsUsed = item.enchantments.reduce((sum, e) => sum + e.requiredSlots, 0);
    const availableSlots = item.enchantmentSlots - totalSlotsUsed;

    if (newEnchantment.requiredSlots > availableSlots) {
      conflicts.push(`Not enough enchantment slots (${newEnchantment.requiredSlots} required, ${availableSlots} available)`);
    }

    // Check enchantment limit
    if (item.enchantments.length >= this.config.maxEnchantmentsPerItem) {
      conflicts.push(`Maximum enchantments reached (${this.config.maxEnchantmentsPerItem})`);
    }

    return {
      hasConflicts: conflicts.length > 0,
      conflicts,
      canAdd: conflicts.length === 0
    };
  }

  /**
   * Calculate enchantment power for item
   */
  calculateEnchantmentPower(item: Item): number {
    if (!this.config.powerScalingEnabled) {
      return item.enchantments.length;
    }

    let totalPower = 0;
    for (const enchantment of item.enchantments) {
      totalPower += enchantment.power;
    }

    return totalPower;
  }

  /**
   * Get available enchantment recipes for item type
   */
  getAvailableRecipes(itemType: string): EnchantmentRecipe[] {
    return Array.from(this.recipes.values())
      .filter(recipe => this.isRecipeCompatible(recipe, itemType));
  }

  /**
   * Get enchantment statistics
   */
  getEnchantmentStats() {
    const recipes = Array.from(this.recipes.values());
    const totalAttempts = Array.from(this.enchantmentHistory.values())
      .reduce((sum, attempts) => sum + attempts.length, 0);

    return {
      totalRecipes: recipes.length,
      recipesByType: recipes.reduce((acc, recipe) => {
        acc[recipe.type] = (acc[recipe.type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      totalEnchantmentAttempts: totalAttempts,
      legendaryEnchantments: recipes.filter(r => r.basePower >= this.config.legendaryThreshold).length
    };
  }

  // Private methods

  private async validateEnchantmentAttempt(
    item: Item,
    recipe: EnchantmentRecipe,
    skillLevel: number,
    materials: Record<string, number>
  ): Promise<{ valid: boolean; reason?: string }> {
    // Check skill requirement
    if (skillLevel < recipe.requiredSkill) {
      return {
        valid: false,
        reason: `Insufficient skill level (${skillLevel}/${recipe.requiredSkill})`
      };
    }

    // Check materials
    for (const [material, required] of Object.entries(recipe.requiredMaterials)) {
      const provided = materials[material] || 0;
      if (provided < required) {
        return {
          valid: false,
          reason: `Insufficient ${material} (${provided}/${required})`
        };
      }
    }

    // Check enchantment conflicts
    const mockEnchantment: Enchantment = {
      id: recipe.id,
      name: recipe.name,
      type: recipe.type,
      power: recipe.basePower,
      description: recipe.description,
      effects: [], // Would be populated
      conflicts: recipe.conflicts,
      requiredSlots: recipe.requiredSlots
    };

    const conflicts = this.checkEnchantmentConflicts(item, mockEnchantment);
    if (!conflicts.canAdd) {
      return {
        valid: false,
        reason: conflicts.conflicts.join(', ')
      };
    }

    return { valid: true };
  }

  private calculateSuccessChance(recipe: EnchantmentRecipe, skillLevel: number, item: Item): number {
    let chance = recipe.successChance;

    // Skill modifier
    const skillBonus = Math.min(0.3, (skillLevel - recipe.requiredSkill) * 0.05);
    chance += skillBonus;

    // Item quality modifier
    const qualityModifier = this.getItemQualityModifier(item);
    chance *= qualityModifier;

    // Existing enchantments modifier (more enchantments = harder)
    const enchantmentPenalty = Math.max(0.7, 1.0 - (item.enchantments.length * 0.1));
    chance *= enchantmentPenalty;

    return Math.min(0.95, Math.max(0.05, chance));
  }

  private async createEnchantment(
    recipe: EnchantmentRecipe,
    item: Item,
    enchanterId: string
  ): Promise<Enchantment> {
    const power = this.config.powerScalingEnabled ?
      this.calculateScaledPower(recipe, item) :
      recipe.basePower;

    const enchantment: Enchantment = {
      id: `enchant_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: recipe.name,
      type: recipe.type,
      power,
      description: recipe.description,
      effects: await this.generateEnchantmentEffects(recipe, power),
      conflicts: recipe.conflicts,
      requiredSlots: recipe.requiredSlots
    };

    return enchantment;
  }

  private async addEnchantmentToItem(item: Item, enchantment: Enchantment): Promise<void> {
    // Check conflicts again (in case something changed)
    const conflicts = this.checkEnchantmentConflicts(item, enchantment);
    if (!conflicts.canAdd) {
      throw new Error(`Cannot add enchantment: ${conflicts.conflicts.join(', ')}`);
    }

    item.enchantments.push(enchantment);
    item.enchantmentPower += enchantment.power;
    item.enchantmentSlots -= enchantment.requiredSlots;

    // Update item properties based on enchantment
    await this.updateItemProperties(item, enchantment);
  }

  private async generateEnchantmentEffects(
    recipe: EnchantmentRecipe,
    power: number
  ): Promise<EnchantmentEffect[]> {
    const effects: EnchantmentEffect[] = [];

    // Generate effects based on recipe type and power
    switch (recipe.type) {
      case 'damage':
        effects.push({
          type: 'damage_bonus',
          target: 'weapon_damage',
          value: Math.floor(power * 2),
          condition: 'melee_attack'
        });
        break;

      case 'defense':
        effects.push({
          type: 'stat_bonus',
          target: 'armor_class',
          value: Math.floor(power * 1.5)
        });
        break;

      case 'utility':
        effects.push({
          type: 'ability',
          target: 'light_generation',
          value: power,
          condition: 'activated'
        });
        break;
    }

    return effects;
  }

  private async checkInstability(
    recipe: EnchantmentRecipe,
    skillLevel: number
  ): Promise<EnchantmentEffect[]> {
    const instabilityRoll = Math.random();
    if (instabilityRoll > recipe.instabilityChance) {
      return [];
    }

    // Generate instability effects
    const effects: EnchantmentEffect[] = [];
    const severity = Math.random();

    if (severity > 0.7) {
      // Major instability
      effects.push({
        type: 'curse',
        target: 'durability',
        value: -Math.floor(recipe.basePower * 0.5),
        condition: 'permanent'
      });
    } else {
      // Minor instability
      effects.push({
        type: 'curse',
        target: 'weight',
        value: Math.floor(recipe.basePower * 0.2),
        condition: 'permanent'
      });
    }

    return effects;
  }

  private async generateCurse(recipe: EnchantmentRecipe, item: Item): Promise<Enchantment> {
    const curse: Enchantment = {
      id: `curse_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: `Cursed ${recipe.name}`,
      type: 'cursed',
      power: Math.floor(recipe.basePower * 0.5),
      description: `A failed enchantment that backfired, causing negative effects`,
      effects: [
        {
          type: 'curse',
          target: 'durability_loss',
          value: Math.floor(recipe.basePower * 0.3),
          condition: 'on_use'
        }
      ],
      conflicts: [],
      requiredSlots: 0
    };

    return curse;
  }

  private calculateScaledPower(recipe: EnchantmentRecipe, item: Item): number {
    let power = recipe.basePower;

    // Scale based on item rarity
    const rarityMultipliers = {
      common: 0.8,
      uncommon: 1.0,
      rare: 1.2,
      epic: 1.5,
      legendary: 2.0,
      artifact: 3.0
    };

    power *= rarityMultipliers[item.rarity];

    // Scale based on existing enchantments (diminishing returns)
    const existingPower = this.calculateEnchantmentPower(item);
    const scalingFactor = Math.max(0.5, 1.0 - (existingPower * 0.05));
    power *= scalingFactor;

    return Math.floor(power);
  }

  private calculateRemovalChance(enchantment: Enchantment, item: Item): number {
    // Base chance depends on enchantment power
    let chance = Math.max(0.1, 1.0 - (enchantment.power * 0.05));

    // Item quality affects removal
    const qualityModifier = this.getItemQualityModifier(item);
    chance *= qualityModifier;

    return Math.min(0.9, chance);
  }

  private calculateMaterialRecovery(enchantment: Enchantment): Record<string, number> {
    // Recover some materials based on removal success
    const recoveryRate = 0.3; // 30% recovery rate
    const recipe = this.recipes.get(enchantment.id.split('_')[1]); // Extract recipe ID

    if (!recipe) return {};

    const recovered: Record<string, number> = {};
    for (const [material, amount] of Object.entries(recipe.requiredMaterials)) {
      recovered[material] = Math.floor(amount * recoveryRate);
    }

    return recovered;
  }

  private getItemQualityModifier(item: Item): number {
    // Better items have higher enchantment success/removal rates
    const rarityModifiers = {
      common: 0.8,
      uncommon: 1.0,
      rare: 1.1,
      epic: 1.2,
      legendary: 1.3,
      artifact: 1.4
    };

    return rarityModifiers[item.rarity];
  }

  private isRecipeCompatible(recipe: EnchantmentRecipe, itemType: string): boolean {
    // Define which enchantments work on which item types
    const compatibility: Record<string, EnchantmentType[]> = {
      weapon: ['damage', 'utility', 'cursed'],
      armor: ['defense', 'utility', 'cursed'],
      tool: ['utility', 'cursed'],
      consumable: ['utility'],
      misc: ['utility', 'cursed']
    };

    return compatibility[itemType]?.includes(recipe.type) || false;
  }

  private async updateItemProperties(item: Item, enchantment: Enchantment): Promise<void> {
    // Update item properties based on enchantment effects
    for (const effect of enchantment.effects) {
      switch (effect.type) {
        case 'stat_bonus':
          // Apply stat bonuses to item properties
          if (!item.properties[effect.target]) {
            item.properties[effect.target] = 0;
          }
          item.properties[effect.target] += effect.value;
          break;

        case 'damage_bonus':
          if (!item.properties.weapon_damage) {
            item.properties.weapon_damage = 0;
          }
          item.properties.weapon_damage += effect.value;
          break;
      }
    }
  }

  private async applyInstabilityEffects(item: Item, effects: EnchantmentEffect[]): Promise<void> {
    for (const effect of effects) {
      switch (effect.target) {
        case 'durability':
          item.durabilityCurrent = Math.max(0, item.durabilityCurrent + effect.value);
          break;
        case 'weight':
          item.weight = Math.max(0.1, item.weight + effect.value);
          break;
      }
    }
  }

  private async recordEnchantmentAttempt(
    itemId: string,
    recipeId: string,
    enchanterId: string,
    materials: Record<string, number>
  ): Promise<void> {
    const attempt: EnchantmentAttempt = {
      itemId,
      recipeId,
      enchanterId,
      materials,
      skillLevel: 0, // Would be passed in
      timestamp: new Date()
    };

    if (!this.enchantmentHistory.has(itemId)) {
      this.enchantmentHistory.set(itemId, []);
    }

    this.enchantmentHistory.get(itemId)!.push(attempt);
  }

  private initializeRecipes(): void {
    // Damage enchantments
    this.recipes.set('sharpness', {
      id: 'sharpness',
      name: 'Sharpness',
      type: 'damage',
      basePower: 2,
      requiredMaterials: { 'dragon_scale': 1, 'mithril_ingot': 2 },
      requiredSkill: 5,
      successChance: 0.7,
      instabilityChance: 0.2,
      conflicts: ['bluntness'],
      requiredSlots: 1,
      description: 'Increases weapon damage'
    });

    this.recipes.set('flaming', {
      id: 'flaming',
      name: 'Flaming',
      type: 'damage',
      basePower: 3,
      requiredMaterials: { 'fire_essence': 1, 'ruby': 1 },
      requiredSkill: 8,
      successChance: 0.6,
      instabilityChance: 0.3,
      conflicts: ['freezing', 'frost'],
      requiredSlots: 1,
      description: 'Adds fire damage to attacks'
    });

    // Defense enchantments
    this.recipes.set('protection', {
      id: 'protection',
      name: 'Protection',
      type: 'defense',
      basePower: 2,
      requiredMaterials: { 'diamond': 1, 'mithril_ingot': 1 },
      requiredSkill: 6,
      successChance: 0.75,
      instabilityChance: 0.15,
      conflicts: [],
      requiredSlots: 1,
      description: 'Increases armor class'
    });

    // Utility enchantments
    this.recipes.set('light', {
      id: 'light',
      name: 'Light',
      type: 'utility',
      basePower: 1,
      requiredMaterials: { 'glowstone': 1 },
      requiredSkill: 3,
      successChance: 0.9,
      instabilityChance: 0.05,
      conflicts: ['darkness'],
      requiredSlots: 1,
      description: 'Item glows with light'
    });
  }

  // Event handlers

  private async handleEnchantmentAttempt(data: EnchantmentAttempt): Promise<void> {
    try {
      // This would process the enchantment attempt
      console.log(`[Enchantment] Processing attempt for item ${data.itemId}`);
    } catch (error) {
      console.error('[Enchantment] Error processing enchantment attempt:', error);
    }
  }

  private async handleItemCreated(data: { item: Item }): Promise<void> {
    // Check if item should have base enchantments
    if (data.item.rarity === 'legendary' || data.item.rarity === 'artifact') {
      // Legendary items might have innate enchantments
      console.log(`[Enchantment] Legendary item created: ${data.item.name}`);
    }
  }

  private async handleCraftingCompleted(data: { itemId: string; crafterId: string }): Promise<void> {
    // Could apply crafting-based enchantments
    console.log(`[Enchantment] Crafting completed for item ${data.itemId}`);
  }
}

// Global instance
export const enchantmentService = new EnchantmentService();
