"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.xpCalculationService = exports.XPCalculationService = void 0;
const BaseService_1 = require("../../services/BaseService");
const DEFAULT_XP_CONFIG = {
    baseXPValues: {
        combat: 50,
        crafting: 25,
        training: 15,
        exploration: 20,
        social: 30,
        magic: 40,
        rest: 5,
        travel: 10,
        trade: 15,
        quest: 100,
        unknown: 0
    },
    modifiers: {
        firstTimeBonus: 1.5,
        perfectExecutionBonus: 1.3,
        barelySucceededBonus: 0.7,
        partySharedPenalty: 0.8,
        difficultyMultiplier: {
            1: 1.0,
            2: 1.2,
            3: 1.5,
            4: 2.0,
            5: 3.0
        },
        timeBonus: [
            { maxTime: 30, multiplier: 1.5 },
            { maxTime: 60, multiplier: 1.25 },
            { maxTime: 120, multiplier: 1.1 }
        ]
    },
    levelScaling: {
        baseXPToLevel: 1000,
        scalingFactor: 1.2,
        maxLevel: 20
    },
    skillBonuses: {
        proficiencyBonus: {
            'warrior': 1.2,
            'mage': 1.2,
            'rogue': 1.2,
            'cleric': 1.2,
            'craftsman': 1.15,
            'diplomat': 1.1
        },
        expertiseBonus: {
            'master': 1.5,
            'legendary': 2.0
        }
    },
    streakRewards: {
        enabled: true,
        sameTaskMultiplier: 1.1,
        differentTaskMultiplier: 1.05,
        maxStreakBonus: 2.0
    }
};
class XPCalculationService extends BaseService_1.BaseService {
    constructor(config = {}) {
        super('XPCalculationService', { performanceBudget: 20 });
        this.characterXP = new Map();
        this.config = { ...DEFAULT_XP_CONFIG, ...config };
    }
    async onInitialize() {
        this.eventBus.on('task:detected', this.handleTaskDetected.bind(this));
        this.eventBus.on('character:loaded', this.handleCharacterLoaded.bind(this));
        this.eventBus.on('combat:ended', this.handleCombatEnded.bind(this));
        console.log('[XPCalculation] Initialized XP system');
    }
    async onShutdown() {
        await this.persistAllXPData();
        this.characterXP.clear();
        console.log('[XPCalculation] Shut down');
    }
    async calculateXP(task, characterId) {
        return this.measureOperation('calculateXP', async () => {
            const character = await this.getOrLoadCharacterXP(characterId);
            const baseXP = this.config.baseXPValues[task.type] || 0;
            const modifiers = await this.calculateModifiers(task, character);
            let totalXP = baseXP;
            for (const modifier of modifiers) {
                totalXP *= modifier.value;
            }
            totalXP = Math.round(totalXP);
            const breakdown = this.createBreakdown(task, baseXP, modifiers, totalXP);
            const reward = {
                baseXP,
                modifiers,
                totalXP,
                breakdown
            };
            const levelUps = await this.checkLevelUps(character, totalXP);
            if (levelUps.length > 0) {
                reward.levelUps = levelUps;
            }
            await this.applyXP(character, totalXP, task);
            this.eventBus.emit('xp:gained', {
                characterId,
                reward,
                newTotalXP: character.totalXP + totalXP,
                newLevel: character.currentLevel
            });
            return reward;
        });
    }
    getCharacterXP(characterId) {
        return this.characterXP.get(characterId) || null;
    }
    getXPForNextLevel(currentLevel) {
        if (currentLevel >= this.config.levelScaling.maxLevel) {
            return 0;
        }
        const baseXP = this.config.levelScaling.baseXPToLevel;
        const scaling = this.config.levelScaling.scalingFactor;
        return Math.round(baseXP * Math.pow(scaling, currentLevel - 1));
    }
    async previewXP(task, characterId) {
        const character = await this.getOrLoadCharacterXP(characterId);
        return this.calculateXP(task, characterId);
    }
    async calculateModifiers(task, character) {
        const modifiers = [];
        const difficulty = task.details.difficulty || 1;
        const diffMultiplier = this.config.modifiers.difficultyMultiplier[difficulty] || 1.0;
        modifiers.push({
            type: 'difficulty',
            value: diffMultiplier,
            reason: `Difficulty level ${difficulty}`
        });
        const qualityMultiplier = this.calculateQualityMultiplier(task);
        modifiers.push({
            type: 'quality',
            value: qualityMultiplier,
            reason: `Task execution quality (${(task.confidence * 100).toFixed(0)}% confidence)`
        });
        const skillBonus = await this.calculateSkillBonus(task, character);
        if (skillBonus > 1.0) {
            modifiers.push({
                type: 'skill',
                value: skillBonus,
                reason: 'Character skill proficiency'
            });
        }
        const streakBonus = this.calculateStreakBonus(character);
        if (streakBonus > 1.0) {
            modifiers.push({
                type: 'streak',
                value: streakBonus,
                reason: 'Task completion streak'
            });
        }
        const timeBonus = this.calculateTimeBonus(task);
        if (timeBonus > 1.0) {
            modifiers.push({
                type: 'time',
                value: timeBonus,
                reason: 'Fast completion'
            });
        }
        return modifiers;
    }
    calculateQualityMultiplier(task) {
        let multiplier = 1.0;
        multiplier *= task.confidence;
        if (task.details.socialContext) {
            if (task.details.socialContext.tone === 'friendly') {
                multiplier *= 1.1;
            }
            else if (task.details.socialContext.tone === 'hostile') {
                multiplier *= 0.9;
            }
        }
        return Math.max(0.5, Math.min(2.0, multiplier));
    }
    async calculateSkillBonus(task, character) {
        const skillMultipliers = {
            combat: 1.2,
            crafting: 1.15,
            training: 1.1,
            exploration: 1.05,
            social: 1.1,
            magic: 1.25,
            rest: 1.0,
            travel: 1.0,
            trade: 1.1,
            quest: 1.3,
            unknown: 1.0
        };
        const baseMultiplier = skillMultipliers[task.type] || 1.0;
        const levelBonus = 1 + (character.currentLevel - 1) * 0.05;
        return baseMultiplier * levelBonus;
    }
    calculateStreakBonus(character) {
        if (!this.config.streakRewards.enabled)
            return 1.0;
        const streaks = character.streaks;
        if (streaks.currentStreak < 2)
            return 1.0;
        const multiplier = streaks.currentStreak >= 5 ?
            this.config.streakRewards.sameTaskMultiplier :
            this.config.streakRewards.differentTaskMultiplier;
        const streakBonus = Math.pow(multiplier, Math.min(streaks.currentStreak, 10));
        return Math.min(streakBonus, this.config.streakRewards.maxStreakBonus);
    }
    calculateTimeBonus(task) {
        return 1.0;
    }
    createBreakdown(task, baseXP, modifiers, totalXP) {
        var _a, _b, _c, _d, _e;
        return {
            taskType: task.type,
            baseValue: baseXP,
            difficultyMultiplier: ((_a = modifiers.find(m => m.type === 'difficulty')) === null || _a === void 0 ? void 0 : _a.value) || 1.0,
            qualityMultiplier: ((_b = modifiers.find(m => m.type === 'quality')) === null || _b === void 0 ? void 0 : _b.value) || 1.0,
            skillBonus: ((_c = modifiers.find(m => m.type === 'skill')) === null || _c === void 0 ? void 0 : _c.value) || 1.0,
            streakBonus: ((_d = modifiers.find(m => m.type === 'streak')) === null || _d === void 0 ? void 0 : _d.value) || 1.0,
            timeBonus: ((_e = modifiers.find(m => m.type === 'time')) === null || _e === void 0 ? void 0 : _e.value) || 1.0,
            finalTotal: totalXP
        };
    }
    async checkLevelUps(character, xpGained) {
        const levelUps = [];
        let remainingXP = character.currentXP + xpGained;
        let currentLevel = character.currentLevel;
        while (currentLevel < this.config.levelScaling.maxLevel) {
            const xpForNext = this.getXPForNextLevel(currentLevel);
            if (remainingXP >= xpForNext) {
                remainingXP -= xpForNext;
                currentLevel++;
                levelUps.push({
                    newLevel: currentLevel,
                    skillPoints: 2,
                    abilityImprovements: ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma']
                        .slice(0, currentLevel % 4 + 1)
                });
            }
            else {
                break;
            }
        }
        return levelUps;
    }
    async applyXP(character, xpGained, task) {
        character.totalXP += xpGained;
        character.currentXP += xpGained;
        while (character.currentXP >= character.xpToNextLevel && character.currentLevel < this.config.levelScaling.maxLevel) {
            character.currentXP -= character.xpToNextLevel;
            character.currentLevel++;
            character.xpToNextLevel = this.getXPForNextLevel(character.currentLevel);
        }
        character.recentTasks.unshift({
            taskType: task.type,
            timestamp: new Date(),
            xpGained,
            quality: task.confidence
        });
        character.recentTasks = character.recentTasks.slice(0, 20);
        this.updateStreaks(character, task);
        await this.persistCharacterXP(character);
    }
    updateStreaks(character, task) {
        const streaks = character.streaks;
        const now = new Date();
        if (streaks.lastTaskType === task.type) {
            streaks.currentStreak++;
        }
        else {
            streaks.currentStreak = 1;
            streaks.lastTaskType = task.type;
            streaks.streakStartTime = now;
        }
        streaks.longestStreak = Math.max(streaks.longestStreak, streaks.currentStreak);
    }
    async getOrLoadCharacterXP(characterId) {
        let character = this.characterXP.get(characterId);
        if (!character) {
            character = await this.loadCharacterXPFromDatabase(characterId);
            this.characterXP.set(characterId, character);
        }
        return character;
    }
    async loadCharacterXPFromDatabase(characterId) {
        return {
            characterId,
            currentLevel: 1,
            currentXP: 0,
            totalXP: 0,
            xpToNextLevel: this.getXPForNextLevel(1),
            recentTasks: [],
            streaks: {
                currentStreak: 0,
                longestStreak: 0,
                lastTaskType: null,
                streakStartTime: null
            }
        };
    }
    async persistCharacterXP(character) {
        this.characterXP.set(character.id, character);
    }
    async persistAllXPData() {
    }
    async handleTaskDetected(data) {
        if (data.characterId) {
            try {
                const reward = await this.calculateXP(data.task, data.characterId);
                if (this.config.debugMode) {
                    console.log(`[XPCalculation] Awarded ${reward.totalXP} XP for ${data.task.type}`);
                }
            }
            catch (error) {
                console.error('[XPCalculation] Error calculating XP:', error);
            }
        }
    }
    async handleCharacterLoaded(data) {
        await this.getOrLoadCharacterXP(data.characterId);
    }
    async handleCombatEnded(data) {
    }
}
exports.XPCalculationService = XPCalculationService;
exports.xpCalculationService = new XPCalculationService();
