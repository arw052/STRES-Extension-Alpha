"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.enchantmentService = exports.EnchantmentService = void 0;
const BaseService_1 = require("./BaseService");
const DEFAULT_ENCHANTMENT_CONFIG = {
    enabled: true,
    maxEnchantmentsPerItem: 3,
    powerScalingEnabled: true,
    conflictDetectionEnabled: true,
    curseChance: 0.15,
    legendaryThreshold: 8
};
class EnchantmentService extends BaseService_1.BaseService {
    constructor(config = {}) {
        super('EnchantmentService', { performanceBudget: 100 });
        this.recipes = new Map();
        this.enchantmentHistory = new Map();
        this.config = { ...DEFAULT_ENCHANTMENT_CONFIG, ...config };
        this.initializeRecipes();
    }
    async onInitialize() {
        this.eventBus.on('enchantment:attempted', this.handleEnchantmentAttempt.bind(this));
        this.eventBus.on('item:created', this.handleItemCreated.bind(this));
        this.eventBus.on('crafting:completed', this.handleCraftingCompleted.bind(this));
        console.log('[Enchantment] Initialized with config:', this.config);
    }
    async onShutdown() {
        console.log('[Enchantment] Shut down gracefully');
    }
    async attemptEnchantment(item, recipeId, enchanterId, skillLevel, materials) {
        return this.measureOperation('attemptEnchantment', async () => {
            const recipe = this.recipes.get(recipeId);
            if (!recipe) {
                throw new Error(`Unknown enchantment recipe: ${recipeId}`);
            }
            const validation = await this.validateEnchantmentAttempt(item, recipe, skillLevel, materials);
            if (!validation.valid) {
                throw new Error(`Enchantment validation failed: ${validation.reason}`);
            }
            const successChance = this.calculateSuccessChance(recipe, skillLevel, item);
            const success = Math.random() < successChance;
            const result = {
                success,
                powerConsumed: recipe.basePower,
                materialsConsumed: { ...materials }
            };
            if (success) {
                const enchantment = await this.createEnchantment(recipe, item, enchanterId);
                result.enchantment = enchantment;
                await this.addEnchantmentToItem(item, enchantment);
                const instabilityEffects = await this.checkInstability(recipe, skillLevel);
                if (instabilityEffects.length > 0) {
                    result.instabilityEffects = instabilityEffects;
                    await this.applyInstabilityEffects(item, instabilityEffects);
                }
            }
            else {
                if (Math.random() < this.config.curseChance) {
                    const curse = await this.generateCurse(recipe, item);
                    result.curse = curse;
                    await this.addEnchantmentToItem(item, curse);
                }
            }
            await this.recordEnchantmentAttempt(item.id, recipeId, enchanterId, materials);
            this.eventBus.emit('enchantment:result', {
                itemId: item.id,
                recipeId,
                enchanterId,
                result
            });
            return result;
        });
    }
    async removeEnchantment(item, enchantmentId, removerId) {
        return this.measureOperation('removeEnchantment', async () => {
            const enchantment = item.enchantments.find(e => e.id === enchantmentId);
            if (!enchantment) {
                throw new Error(`Enchantment not found: ${enchantmentId}`);
            }
            const removalChance = this.calculateRemovalChance(enchantment, item);
            const success = Math.random() < removalChance;
            if (success) {
                item.enchantments = item.enchantments.filter(e => e.id !== enchantmentId);
                item.enchantmentSlots += enchantment.requiredSlots;
                const materialsRecovered = this.calculateMaterialRecovery(enchantment);
                return {
                    success: true,
                    itemDestroyed: false,
                    materialsRecovered
                };
            }
            else {
                const itemDestroyed = Math.random() < 0.3;
                if (itemDestroyed) {
                    item.durabilityCurrent = 0;
                }
                else {
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
    checkEnchantmentConflicts(item, newEnchantment) {
        if (!this.config.conflictDetectionEnabled) {
            return { hasConflicts: false, conflicts: [], canAdd: true };
        }
        const conflicts = [];
        for (const existing of item.enchantments) {
            if (newEnchantment.conflicts.includes(existing.id) ||
                existing.conflicts.includes(newEnchantment.id)) {
                conflicts.push(`${existing.name} conflicts with ${newEnchantment.name}`);
            }
        }
        const totalSlotsUsed = item.enchantments.reduce((sum, e) => sum + e.requiredSlots, 0);
        const availableSlots = item.enchantmentSlots - totalSlotsUsed;
        if (newEnchantment.requiredSlots > availableSlots) {
            conflicts.push(`Not enough enchantment slots (${newEnchantment.requiredSlots} required, ${availableSlots} available)`);
        }
        if (item.enchantments.length >= this.config.maxEnchantmentsPerItem) {
            conflicts.push(`Maximum enchantments reached (${this.config.maxEnchantmentsPerItem})`);
        }
        return {
            hasConflicts: conflicts.length > 0,
            conflicts,
            canAdd: conflicts.length === 0
        };
    }
    calculateEnchantmentPower(item) {
        if (!this.config.powerScalingEnabled) {
            return item.enchantments.length;
        }
        let totalPower = 0;
        for (const enchantment of item.enchantments) {
            totalPower += enchantment.power;
        }
        return totalPower;
    }
    getAvailableRecipes(itemType) {
        return Array.from(this.recipes.values())
            .filter(recipe => this.isRecipeCompatible(recipe, itemType));
    }
    getEnchantmentStats() {
        const recipes = Array.from(this.recipes.values());
        const totalAttempts = Array.from(this.enchantmentHistory.values())
            .reduce((sum, attempts) => sum + attempts.length, 0);
        return {
            totalRecipes: recipes.length,
            recipesByType: recipes.reduce((acc, recipe) => {
                acc[recipe.type] = (acc[recipe.type] || 0) + 1;
                return acc;
            }, {}),
            totalEnchantmentAttempts: totalAttempts,
            legendaryEnchantments: recipes.filter(r => r.basePower >= this.config.legendaryThreshold).length
        };
    }
    async validateEnchantmentAttempt(item, recipe, skillLevel, materials) {
        if (skillLevel < recipe.requiredSkill) {
            return {
                valid: false,
                reason: `Insufficient skill level (${skillLevel}/${recipe.requiredSkill})`
            };
        }
        for (const [material, required] of Object.entries(recipe.requiredMaterials)) {
            const provided = materials[material] || 0;
            if (provided < required) {
                return {
                    valid: false,
                    reason: `Insufficient ${material} (${provided}/${required})`
                };
            }
        }
        const mockEnchantment = {
            id: recipe.id,
            name: recipe.name,
            type: recipe.type,
            power: recipe.basePower,
            description: recipe.description,
            effects: [],
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
    calculateSuccessChance(recipe, skillLevel, item) {
        let chance = recipe.successChance;
        const skillBonus = Math.min(0.3, (skillLevel - recipe.requiredSkill) * 0.05);
        chance += skillBonus;
        const qualityModifier = this.getItemQualityModifier(item);
        chance *= qualityModifier;
        const enchantmentPenalty = Math.max(0.7, 1.0 - (item.enchantments.length * 0.1));
        chance *= enchantmentPenalty;
        return Math.min(0.95, Math.max(0.05, chance));
    }
    async createEnchantment(recipe, item, enchanterId) {
        const power = this.config.powerScalingEnabled ?
            this.calculateScaledPower(recipe, item) :
            recipe.basePower;
        const enchantment = {
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
    async addEnchantmentToItem(item, enchantment) {
        const conflicts = this.checkEnchantmentConflicts(item, enchantment);
        if (!conflicts.canAdd) {
            throw new Error(`Cannot add enchantment: ${conflicts.conflicts.join(', ')}`);
        }
        item.enchantments.push(enchantment);
        item.enchantmentPower += enchantment.power;
        item.enchantmentSlots -= enchantment.requiredSlots;
        await this.updateItemProperties(item, enchantment);
    }
    async generateEnchantmentEffects(recipe, power) {
        const effects = [];
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
    async checkInstability(recipe, skillLevel) {
        const instabilityRoll = Math.random();
        if (instabilityRoll > recipe.instabilityChance) {
            return [];
        }
        const effects = [];
        const severity = Math.random();
        if (severity > 0.7) {
            effects.push({
                type: 'curse',
                target: 'durability',
                value: -Math.floor(recipe.basePower * 0.5),
                condition: 'permanent'
            });
        }
        else {
            effects.push({
                type: 'curse',
                target: 'weight',
                value: Math.floor(recipe.basePower * 0.2),
                condition: 'permanent'
            });
        }
        return effects;
    }
    async generateCurse(recipe, item) {
        const curse = {
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
    calculateScaledPower(recipe, item) {
        let power = recipe.basePower;
        const rarityMultipliers = {
            common: 0.8,
            uncommon: 1.0,
            rare: 1.2,
            epic: 1.5,
            legendary: 2.0,
            artifact: 3.0
        };
        power *= rarityMultipliers[item.rarity];
        const existingPower = this.calculateEnchantmentPower(item);
        const scalingFactor = Math.max(0.5, 1.0 - (existingPower * 0.05));
        power *= scalingFactor;
        return Math.floor(power);
    }
    calculateRemovalChance(enchantment, item) {
        let chance = Math.max(0.1, 1.0 - (enchantment.power * 0.05));
        const qualityModifier = this.getItemQualityModifier(item);
        chance *= qualityModifier;
        return Math.min(0.9, chance);
    }
    calculateMaterialRecovery(enchantment) {
        const recoveryRate = 0.3;
        const recipe = this.recipes.get(enchantment.id.split('_')[1]);
        if (!recipe)
            return {};
        const recovered = {};
        for (const [material, amount] of Object.entries(recipe.requiredMaterials)) {
            recovered[material] = Math.floor(amount * recoveryRate);
        }
        return recovered;
    }
    getItemQualityModifier(item) {
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
    isRecipeCompatible(recipe, itemType) {
        var _a;
        const compatibility = {
            weapon: ['damage', 'utility', 'cursed'],
            armor: ['defense', 'utility', 'cursed'],
            tool: ['utility', 'cursed'],
            consumable: ['utility'],
            misc: ['utility', 'cursed']
        };
        return ((_a = compatibility[itemType]) === null || _a === void 0 ? void 0 : _a.includes(recipe.type)) || false;
    }
    async updateItemProperties(item, enchantment) {
        for (const effect of enchantment.effects) {
            switch (effect.type) {
                case 'stat_bonus':
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
    async applyInstabilityEffects(item, effects) {
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
    async recordEnchantmentAttempt(itemId, recipeId, enchanterId, materials) {
        const attempt = {
            itemId,
            recipeId,
            enchanterId,
            materials,
            skillLevel: 0,
            timestamp: new Date()
        };
        if (!this.enchantmentHistory.has(itemId)) {
            this.enchantmentHistory.set(itemId, []);
        }
        this.enchantmentHistory.get(itemId).push(attempt);
    }
    initializeRecipes() {
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
    async handleEnchantmentAttempt(data) {
        try {
            console.log(`[Enchantment] Processing attempt for item ${data.itemId}`);
        }
        catch (error) {
            console.error('[Enchantment] Error processing enchantment attempt:', error);
        }
    }
    async handleItemCreated(data) {
        if (data.item.rarity === 'legendary' || data.item.rarity === 'artifact') {
            console.log(`[Enchantment] Legendary item created: ${data.item.name}`);
        }
    }
    async handleCraftingCompleted(data) {
        console.log(`[Enchantment] Crafting completed for item ${data.itemId}`);
    }
}
exports.EnchantmentService = EnchantmentService;
exports.enchantmentService = new EnchantmentService();
