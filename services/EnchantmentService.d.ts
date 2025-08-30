/**
 * Enchantment Service - Manages Item Enchantments with Conflicts and Power Levels
 *
 * Critical innovation: Complex enchantment system with realistic conflicts
 * and power scaling that creates strategic trade-offs in item enhancement.
 */
import { BaseService } from './BaseService';
import { Item, Enchantment, EnchantmentType, EnchantmentEffect } from '../../src/types';
export interface EnchantmentConfig {
    enabled: boolean;
    maxEnchantmentsPerItem: number;
    powerScalingEnabled: boolean;
    conflictDetectionEnabled: boolean;
    curseChance: number;
    legendaryThreshold: number;
}
export interface EnchantmentRecipe {
    id: string;
    name: string;
    type: EnchantmentType;
    basePower: number;
    requiredMaterials: Record<string, number>;
    requiredSkill: number;
    successChance: number;
    instabilityChance: number;
    conflicts: string[];
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
    curse?: Enchantment;
    instabilityEffects?: EnchantmentEffect[];
    powerConsumed: number;
    materialsConsumed: Record<string, number>;
}
export declare class EnchantmentService extends BaseService {
    private config;
    private recipes;
    private enchantmentHistory;
    constructor(config?: Partial<EnchantmentConfig>);
    protected onInitialize(): Promise<void>;
    protected onShutdown(): Promise<void>;
    /**
     * Attempt to enchant an item
     */
    attemptEnchantment(item: Item, recipeId: string, enchanterId: string, skillLevel: number, materials: Record<string, number>): Promise<EnchantmentResult>;
    /**
     * Remove enchantment from item
     */
    removeEnchantment(item: Item, enchantmentId: string, removerId: string): Promise<{
        success: boolean;
        itemDestroyed: boolean;
        materialsRecovered: Record<string, number>;
    }>;
    /**
     * Check for enchantment conflicts
     */
    checkEnchantmentConflicts(item: Item, newEnchantment: Enchantment): {
        hasConflicts: boolean;
        conflicts: string[];
        canAdd: boolean;
    };
    /**
     * Calculate enchantment power for item
     */
    calculateEnchantmentPower(item: Item): number;
    /**
     * Get available enchantment recipes for item type
     */
    getAvailableRecipes(itemType: string): EnchantmentRecipe[];
    /**
     * Get enchantment statistics
     */
    getEnchantmentStats(): {
        totalRecipes: number;
        recipesByType: Record<string, number>;
        totalEnchantmentAttempts: number;
        legendaryEnchantments: number;
    };
    private validateEnchantmentAttempt;
    private calculateSuccessChance;
    private createEnchantment;
    private addEnchantmentToItem;
    private generateEnchantmentEffects;
    private checkInstability;
    private generateCurse;
    private calculateScaledPower;
    private calculateRemovalChance;
    private calculateMaterialRecovery;
    private getItemQualityModifier;
    private isRecipeCompatible;
    private updateItemProperties;
    private applyInstabilityEffects;
    private recordEnchantmentAttempt;
    private initializeRecipes;
    private handleEnchantmentAttempt;
    private handleItemCreated;
    private handleCraftingCompleted;
}
export declare const enchantmentService: EnchantmentService;
//# sourceMappingURL=EnchantmentService.d.ts.map