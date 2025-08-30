"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.durabilityService = exports.DurabilityService = void 0;
const BaseService_1 = require("./BaseService");
const DEFAULT_DURABILITY_CONFIG = {
    enabled: true,
    degradationMultiplier: 1.0,
    repairCostMultiplier: 1.0,
    autoBreakEnabled: true,
    breakNotificationThreshold: 25,
    repairSkillRequired: true
};
class DurabilityService extends BaseService_1.BaseService {
    constructor(config = {}) {
        super('DurabilityService', { performanceBudget: 50 });
        this.degradationRules = new Map();
        this.repairQueue = new Map();
        this.config = { ...DEFAULT_DURABILITY_CONFIG, ...config };
        this.initializeDegradationRules();
    }
    async onInitialize() {
        this.eventBus.on('item:used', this.handleItemUsed.bind(this));
        this.eventBus.on('combat:ended', this.handleCombatEnded.bind(this));
        this.eventBus.on('travel:completed', this.handleTravelCompleted.bind(this));
        this.eventBus.on('crafting:completed', this.handleCraftingCompleted.bind(this));
        this.eventBus.on('repair:requested', this.handleRepairRequested.bind(this));
        console.log('[Durability] Initialized with config:', this.config);
    }
    async onShutdown() {
        await this.processPendingRepairs();
        console.log('[Durability] Shut down gracefully');
    }
    async degradeItem(item, usageType, context = {}) {
        return this.measureOperation('degradeItem', async () => {
            if (!this.config.enabled) {
                return {
                    success: true,
                    newDurability: item.durabilityCurrent,
                    broke: false,
                    events: []
                };
            }
            const events = [];
            const oldDurability = item.durabilityCurrent;
            const degradation = this.calculateDegradation(item, usageType, context);
            const newDurability = Math.max(0, oldDurability - degradation);
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
            }
            else if (newDurability < oldDurability) {
                events.push({
                    type: 'degraded',
                    itemId: item.id,
                    oldDurability,
                    newDurability,
                    reason: `Used in ${usageType}`,
                    characterId: context.characterId
                });
            }
            item.durabilityCurrent = newDurability;
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
    async calculateRepair(item, targetDurability) {
        return this.measureOperation('calculateRepair', async () => {
            const maxRestore = Math.min(item.durabilityMax - item.durabilityCurrent, targetDurability ? targetDurability - item.durabilityCurrent : item.durabilityMax);
            const damageRatio = (item.durabilityMax - item.durabilityCurrent) / item.durabilityMax;
            const baseCost = Math.floor(item.baseValue * damageRatio * this.config.repairCostMultiplier);
            const materials = this.calculateRepairMaterials(item, maxRestore);
            const complexity = this.getItemComplexity(item);
            const successChance = Math.max(0.1, 1.0 - (damageRatio * 0.5) - (complexity * 0.2));
            const repairTime = Math.floor((item.weight * 10) + (maxRestore * 2) + (complexity * 30));
            const repair = {
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
    async repairItem(item, repair, crafterId) {
        return this.measureOperation('repairItem', async () => {
            const events = [];
            const oldDurability = item.durabilityCurrent;
            const success = Math.random() < repair.successChance;
            if (success) {
                const maxNewDurability = Math.min(item.durabilityMax, oldDurability + repair.maxDurabilityRestored);
                item.durabilityCurrent = maxNewDurability;
                events.push({
                    type: 'repaired',
                    itemId: item.id,
                    oldDurability,
                    newDurability: item.durabilityCurrent,
                    reason: 'Successfully repaired',
                    characterId: crafterId
                });
            }
            else {
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
    getItemCondition(item) {
        const durabilityPercent = (item.durabilityCurrent / item.durabilityMax) * 100;
        if (durabilityPercent <= 0)
            return 'broken';
        if (durabilityPercent <= 25)
            return 'damaged';
        if (durabilityPercent <= 50)
            return 'worn';
        if (durabilityPercent <= 75)
            return 'good';
        if (durabilityPercent <= 95)
            return 'excellent';
        return 'pristine';
    }
    getDurabilityStats() {
        return {
            totalItems: 0,
            brokenItems: 0,
            warningItems: 0,
            averageDurability: 0,
            repairQueueLength: this.repairQueue.size
        };
    }
    calculateDegradation(item, usageType, context) {
        const rules = this.degradationRules.get(item.type) || [];
        const rule = rules.find(r => r.usageType === usageType);
        if (!rule) {
            return Math.floor(item.durabilityMax * item.durabilityRate * (context.intensity || 1.0));
        }
        let degradation = rule.baseDegradation;
        if (context.environment && rule.modifiers.condition) {
            const conditionModifier = this.getConditionModifier(context.environment);
            degradation *= conditionModifier;
        }
        if (context.userSkill !== undefined) {
            const skillModifier = this.getSkillModifier(context.userSkill);
            degradation *= skillModifier;
        }
        if (context.intensity) {
            degradation *= context.intensity;
        }
        degradation *= this.config.degradationMultiplier;
        return Math.floor(degradation);
    }
    calculateRepairMaterials(item, maxRestore) {
        const materials = {};
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
    getItemComplexity(item) {
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
    getConditionModifier(environment) {
        const modifiers = {
            'rain': 1.2,
            'snow': 1.3,
            'desert': 1.4,
            'mountain': 1.1,
            'forest': 1.0,
            'urban': 0.9
        };
        return modifiers[environment] || 1.0;
    }
    getSkillModifier(skill) {
        if (skill >= 15)
            return 0.7;
        if (skill >= 10)
            return 0.8;
        if (skill >= 5)
            return 0.9;
        return 1.0;
    }
    initializeDegradationRules() {
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
    async processPendingRepairs() {
        for (const [itemId, repair] of this.repairQueue) {
            console.log(`[Durability] Processing pending repair for item ${itemId}`);
        }
        this.repairQueue.clear();
    }
    async handleItemUsed(data) {
        try {
            this.eventBus.emit('durability:degrade_request', {
                itemId: data.itemId,
                usageType: data.usageType,
                characterId: data.characterId,
                context: data.context
            });
        }
        catch (error) {
            console.error('[Durability] Error handling item used:', error);
        }
    }
    async handleCombatEnded(data) {
        for (const participant of data.participants) {
            if (participant.equipment) {
                for (const equipment of participant.equipment) {
                    await this.degradeItem(equipment, 'combat', {
                        characterId: participant.id,
                        intensity: Math.min(2.0, data.duration / 60)
                    });
                }
            }
        }
    }
    async handleTravelCompleted(data) {
        const intensity = Math.min(2.0, data.distance / 100);
    }
    async handleCraftingCompleted(data) {
    }
    async handleRepairRequested(data) {
    }
}
exports.DurabilityService = DurabilityService;
exports.durabilityService = new DurabilityService();
