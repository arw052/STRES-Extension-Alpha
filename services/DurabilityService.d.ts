/**
 * Durability Service - Manages Item Degradation, Repair, and Break Conditions
 *
 * Critical innovation: Realistic item degradation with strategic repair mechanics
 * that create meaningful gameplay decisions around equipment maintenance.
 */
import { BaseService } from './BaseService';
import { Item, ItemCondition, ItemRepair } from '../../src/types';
export interface DurabilityConfig {
    enabled: boolean;
    degradationMultiplier: number;
    repairCostMultiplier: number;
    autoBreakEnabled: boolean;
    breakNotificationThreshold: number;
    repairSkillRequired: boolean;
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
    usageType: string;
    baseDegradation: number;
    modifiers: {
        condition?: string;
        quality?: string;
        userSkill?: string;
    };
}
export declare class DurabilityService extends BaseService {
    private config;
    private degradationRules;
    private repairQueue;
    constructor(config?: Partial<DurabilityConfig>);
    protected onInitialize(): Promise<void>;
    protected onShutdown(): Promise<void>;
    /**
     * Apply durability degradation to an item
     */
    degradeItem(item: Item, usageType: string, context?: {
        characterId?: string;
        environment?: string;
        userSkill?: number;
        intensity?: number;
    }): Promise<{
        success: boolean;
        newDurability: number;
        broke: boolean;
        events: DurabilityEvent[];
    }>;
    /**
     * Calculate durability repair cost and requirements
     */
    calculateRepair(item: Item, targetDurability?: number): Promise<ItemRepair>;
    /**
     * Process item repair
     */
    repairItem(item: Item, repair: ItemRepair, crafterId: string): Promise<{
        success: boolean;
        newDurability: number;
        events: DurabilityEvent[];
        cost: number;
    }>;
    /**
     * Get item condition based on durability
     */
    getItemCondition(item: Item): ItemCondition;
    /**
     * Get durability statistics
     */
    getDurabilityStats(): {
        totalItems: number;
        brokenItems: number;
        warningItems: number;
        averageDurability: number;
        repairQueueLength: number;
    };
    private calculateDegradation;
    private calculateRepairMaterials;
    private getItemComplexity;
    private getConditionModifier;
    private getSkillModifier;
    private initializeDegradationRules;
    private processPendingRepairs;
    private handleItemUsed;
    private handleCombatEnded;
    private handleTravelCompleted;
    private handleCraftingCompleted;
    private handleRepairRequested;
}
export declare const durabilityService: DurabilityService;
//# sourceMappingURL=DurabilityService.d.ts.map