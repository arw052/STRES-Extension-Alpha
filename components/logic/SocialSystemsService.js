"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.socialSystemsService = exports.SocialSystemsService = void 0;
const BaseService_1 = require("../../services/BaseService");
const DEFAULT_SOCIAL_CONFIG = {
    enabled: true,
    relationshipTracking: true,
    romanceSystem: true,
    factionSystem: true,
    maxRelationships: 50,
    relationshipDecayRate: 2,
    romanceThreshold: 60,
    debugMode: false
};
class SocialSystemsService extends BaseService_1.BaseService {
    constructor(config = {}) {
        super('SocialSystemsService', { performanceBudget: 20 });
        this.relationships = new Map();
        this.romances = new Map();
        this.factions = new Map();
        this.characterRelationships = new Map();
        this.config = { ...DEFAULT_SOCIAL_CONFIG, ...config };
    }
    async onInitialize() {
        this.eventBus.on('task:detected', this.handleTaskDetected.bind(this));
        this.eventBus.on('character:interaction', this.handleCharacterInteraction.bind(this));
        this.eventBus.on('quest:completed', this.handleQuestCompleted.bind(this));
        this.eventBus.on('social:action', this.handleSocialAction.bind(this));
        this.startRelationshipDecayTimer();
        console.log('[Social] Initialized with config:', this.config);
    }
    async onShutdown() {
        await this.persistAllSocialData();
        console.log('[Social] Shut down gracefully');
    }
    async updateRelationship(sourceId, targetId, points, reason, context) {
        return this.measureOperation('updateRelationship', async () => {
            const relationshipId = this.getRelationshipId(sourceId, targetId);
            let relationship = this.relationships.get(relationshipId);
            if (!relationship) {
                relationship = this.createNewRelationship(sourceId, targetId);
            }
            relationship.points = Math.max(-100, Math.min(100, relationship.points + points));
            relationship.lastInteraction = new Date();
            const event = {
                id: `event_${Date.now()}`,
                type: points > 0 ? 'positive' : points < 0 ? 'negative' : 'neutral',
                description: reason,
                pointsChange: points,
                timestamp: new Date(),
                context
            };
            relationship.history.push(event);
            relationship.level = this.calculateRelationshipLevel(relationship.points);
            this.addToCharacterIndex(sourceId, relationshipId);
            this.addToCharacterIndex(targetId, relationshipId);
            if (this.config.romanceSystem && relationship.points >= this.config.romanceThreshold) {
                await this.checkRomancePotential(relationship);
            }
            this.eventBus.emit('relationship:updated', {
                relationship,
                pointsChange: points,
                newLevel: relationship.level
            });
            return relationship;
        });
    }
    getRelationship(sourceId, targetId) {
        const relationshipId = this.getRelationshipId(sourceId, targetId);
        return this.relationships.get(relationshipId) || null;
    }
    getCharacterRelationships(characterId) {
        const relationshipIds = this.characterRelationships.get(characterId);
        if (!relationshipIds)
            return [];
        return Array.from(relationshipIds)
            .map(id => this.relationships.get(id))
            .filter(rel => rel !== undefined);
    }
    async startRomance(partner1Id, partner2Id) {
        return this.measureOperation('startRomance', async () => {
            if (!this.config.romanceSystem)
                return null;
            const relationship = this.getRelationship(partner1Id, partner2Id);
            if (!relationship || relationship.points < this.config.romanceThreshold) {
                return null;
            }
            const romanceId = this.getRomanceId(partner1Id, partner2Id);
            if (this.romances.has(romanceId)) {
                return this.romances.get(romanceId);
            }
            const compatibility = this.calculateCompatibility(partner1Id, partner2Id);
            const romance = {
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
            this.eventBus.emit('romance:started', {
                romance,
                compatibility,
                initialAffection: romance.affection
            });
            return romance;
        });
    }
    async updateRomance(partner1Id, partner2Id, affectionChange, reason) {
        const romanceId = this.getRomanceId(partner1Id, partner2Id);
        const romance = this.romances.get(romanceId);
        if (!romance || romance.status !== 'active')
            return null;
        romance.affection = Math.max(0, Math.min(100, romance.affection + affectionChange));
        romance.lastInteraction = new Date();
        const event = {
            id: `romance_event_${Date.now()}`,
            type: affectionChange > 0 ? 'date' : affectionChange < 0 ? 'conflict' : 'milestone',
            description: reason,
            affectionChange,
            timestamp: new Date()
        };
        romance.events.push(event);
        const newStage = this.calculateRomanceStage(romance.affection);
        if (newStage !== romance.stage) {
            const oldStage = romance.stage;
            romance.stage = newStage;
            this.eventBus.emit('romance:stage_changed', {
                romance,
                oldStage,
                newStage,
                affectionChange,
                reason
            });
        }
        this.eventBus.emit('romance:updated', {
            romance,
            affectionChange,
            newAffection: romance.affection
        });
        return romance;
    }
    async updateFactionStanding(factionId, pointsChange, reason) {
        return this.measureOperation('updateFactionStanding', async () => {
            const faction = this.factions.get(factionId);
            if (!faction) {
                throw new Error(`Faction not found: ${factionId}`);
            }
            faction.points = Math.max(-100, Math.min(100, faction.points + pointsChange));
            faction.lastInteraction = new Date();
            faction.standing = this.calculateFactionStanding(faction.points);
            faction.reputation = Math.max(0, Math.min(100, faction.reputation + (pointsChange * 0.5)));
            this.eventBus.emit('faction:standing_changed', {
                faction,
                pointsChange,
                newStanding: faction.standing.level,
                reason
            });
            return faction;
        });
    }
    getSocialStatus(characterId) {
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
    createNewRelationship(sourceId, targetId) {
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
    calculateRelationshipLevel(points) {
        if (points >= 80)
            return 'intimate';
        if (points >= 60)
            return 'close';
        if (points >= 20)
            return 'friendly';
        if (points >= -19)
            return 'neutral';
        if (points >= -59)
            return 'unfriendly';
        if (points >= -79)
            return 'hostile';
        return 'hated';
    }
    async checkRomancePotential(relationship) {
        const existingRomance = this.getRomanceId(relationship.sourceCharacter, relationship.targetCharacter);
        if (this.romances.has(existingRomance))
            return;
        if (await this.charactersEligibleForRomance(relationship.sourceCharacter, relationship.targetCharacter)) {
            this.eventBus.emit('romance:potential', {
                sourceCharacter: relationship.sourceCharacter,
                targetCharacter: relationship.targetCharacter,
                relationshipPoints: relationship.points
            });
        }
    }
    async charactersEligibleForRomance(char1, char2) {
        return true;
    }
    calculateCompatibility(char1, char2) {
        return Math.floor(Math.random() * 40) + 60;
    }
    calculateRomanceStage(affection) {
        if (affection >= 90)
            return 'married';
        if (affection >= 80)
            return 'committed';
        if (affection >= 70)
            return 'relationship';
        if (affection >= 60)
            return 'dating';
        return 'interest';
    }
    calculateFactionStanding(points) {
        let level;
        let description;
        let benefits = [];
        let penalties = [];
        if (points >= 80) {
            level = 'exalted';
            description = 'Revered and trusted';
            benefits = ['Access to exclusive quests', 'Discounts on services', 'Special titles'];
        }
        else if (points >= 60) {
            level = 'honored';
            description = 'Highly respected';
            benefits = ['Access to special items', 'Priority services'];
        }
        else if (points >= 20) {
            level = 'friendly';
            description = 'Well-liked';
            benefits = ['Discounts on goods'];
        }
        else if (points >= -19) {
            level = 'neutral';
            description = 'Neither liked nor disliked';
        }
        else if (points >= -59) {
            level = 'hostile';
            description = 'Distrusted';
            penalties = ['Higher prices', 'Limited access'];
        }
        else {
            level = 'hated';
            description = 'Actively despised';
            penalties = ['Attack on sight', 'Banned from territories'];
        }
        return { level, description, benefits, penalties };
    }
    getRelationshipId(char1, char2) {
        const [first, second] = [char1, char2].sort();
        return `rel_${first}_${second}`;
    }
    getRomanceId(char1, char2) {
        const [first, second] = [char1, char2].sort();
        return `rom_${first}_${second}`;
    }
    addToCharacterIndex(characterId, relationshipId) {
        if (!this.characterRelationships.has(characterId)) {
            this.characterRelationships.set(characterId, new Set());
        }
        this.characterRelationships.get(characterId).add(relationshipId);
    }
    getCharacterRomances(characterId) {
        return Array.from(this.romances.values())
            .filter(romance => romance.partners.includes(characterId));
    }
    calculateSocialScore(relationships, romances) {
        let score = 0;
        for (const rel of relationships) {
            score += rel.points;
        }
        for (const romance of romances) {
            if (romance.status === 'active') {
                score += romance.affection * 2;
            }
        }
        return Math.max(0, score);
    }
    calculateAverageRelationshipPoints() {
        if (this.relationships.size === 0)
            return 0;
        const totalPoints = Array.from(this.relationships.values())
            .reduce((sum, rel) => sum + rel.points, 0);
        return totalPoints / this.relationships.size;
    }
    calculateRomanceSuccessRate() {
        if (this.romances.size === 0)
            return 0;
        const successfulRomances = Array.from(this.romances.values())
            .filter(romance => romance.stage === 'married' || romance.stage === 'committed')
            .length;
        return (successfulRomances / this.romances.size) * 100;
    }
    getFactionStandingDistribution() {
        const distribution = {
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
    startRelationshipDecayTimer() {
        setInterval(() => {
            this.performRelationshipDecay();
        }, 24 * 60 * 60 * 1000);
    }
    async performRelationshipDecay() {
        const now = new Date();
        const decayThreshold = 7 * 24 * 60 * 60 * 1000;
        for (const relationship of this.relationships.values()) {
            const daysSinceInteraction = (now.getTime() - relationship.lastInteraction.getTime()) / (24 * 60 * 60 * 1000);
            if (daysSinceInteraction > 7) {
                const decayAmount = Math.floor(daysSinceInteraction / 7) * this.config.relationshipDecayRate;
                relationship.points = Math.max(-100, relationship.points - decayAmount);
                relationship.level = this.calculateRelationshipLevel(relationship.points);
                this.eventBus.emit('relationship:decayed', {
                    relationship,
                    decayAmount,
                    daysSinceInteraction
                });
            }
        }
    }
    async persistAllSocialData() {
        console.log(`[Social] Persisting ${this.relationships.size} relationships, ${this.romances.size} romances, ${this.factions.size} factions`);
    }
    async handleTaskDetected(data) {
        var _a, _b, _c;
        if (!data.characterId || !this.config.relationshipTracking)
            return;
        const task = data.task;
        if (task.type === 'social') {
            const targetId = task.details.target;
            if (targetId) {
                let points = 0;
                const reason = `Social interaction: ${task.details.action || task.type}`;
                if (((_a = task.details.socialContext) === null || _a === void 0 ? void 0 : _a.tone) === 'friendly') {
                    points = 5;
                }
                else if (((_b = task.details.socialContext) === null || _b === void 0 ? void 0 : _b.tone) === 'hostile') {
                    points = -5;
                }
                else if (((_c = task.details.socialContext) === null || _c === void 0 ? void 0 : _c.tone) === 'romantic') {
                    points = 8;
                }
                if (points !== 0) {
                    await this.updateRelationship(data.characterId, targetId, points, reason);
                }
            }
        }
    }
    async handleCharacterInteraction(data) {
        if (!this.config.relationshipTracking)
            return;
        let points = 0;
        let reason = `Character interaction: ${data.type}`;
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
    async handleQuestCompleted(data) {
        if (!data.success)
            return;
        for (let i = 0; i < data.participants.length; i++) {
            for (let j = i + 1; j < data.participants.length; j++) {
                const char1 = data.participants[i];
                const char2 = data.participants[j];
                await this.updateRelationship(char1, char2, 5, 'Completed quest together');
            }
        }
    }
    async handleSocialAction(data) {
        var _a, _b;
        switch (data.action) {
            case 'propose_romance':
                if (data.targetId) {
                    await this.startRomance(data.sourceId, data.targetId);
                }
                break;
            case 'break_up':
                if (data.targetId) {
                    const romance = this.getCharacterRomances(data.sourceId)
                        .find(r => r.partners.includes(data.targetId) && r.status === 'active');
                    if (romance) {
                        romance.status = 'ended';
                        this.eventBus.emit('romance:ended', { romance, reason: (_a = data.context) === null || _a === void 0 ? void 0 : _a.reason });
                    }
                }
                break;
            case 'join_faction':
                if ((_b = data.context) === null || _b === void 0 ? void 0 : _b.factionId) {
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
exports.SocialSystemsService = SocialSystemsService;
exports.socialSystemsService = new SocialSystemsService();
