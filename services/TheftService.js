"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.theftService = exports.TheftService = void 0;
const BaseService_1 = require("./BaseService");
const DEFAULT_THEFT_CONFIG = {
    enabled: true,
    baseDetectionChance: 0.2,
    securityMultiplier: 0.1,
    skillImportance: 0.3,
    alarmCooldown: 30,
    bountySystemEnabled: true,
    reputationImpactEnabled: true
};
class TheftService extends BaseService_1.BaseService {
    constructor(config = {}) {
        super('TheftService', { performanceBudget: 100 });
        this.securityMeasures = new Map();
        this.activeAlarms = new Map();
        this.bounties = new Map();
        this.config = { ...DEFAULT_THEFT_CONFIG, ...config };
        this.initializeSecurityMeasures();
    }
    async onInitialize() {
        this.eventBus.on('theft:attempt', this.handleTheftAttempt.bind(this));
        this.eventBus.on('security:alarm_triggered', this.handleAlarmTriggered.bind(this));
        this.eventBus.on('bounty:posted', this.handleBountyPosted.bind(this));
        this.eventBus.on('bounty:claimed', this.handleBountyClaimed.bind(this));
        console.log('[Theft] Initialized with config:', this.config);
    }
    async onShutdown() {
        this.activeAlarms.clear();
        this.bounties.clear();
        console.log('[Theft] Shut down gracefully');
    }
    async attemptTheft(thiefId, storageId, targetItems, thiefSkill = 1) {
        return this.measureOperation('attemptTheft', async () => {
            const storage = await this.getGuildStorage(storageId);
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
            const theftChance = this.calculateTheftSuccessChance(storage, thiefSkill);
            const success = Math.random() < theftChance;
            const detectionChance = this.calculateDetectionChance(storage, thiefSkill);
            const detected = Math.random() < detectionChance;
            const result = {
                success: success && !detected,
                detected,
                stolenItems: [],
                consequences: [],
                stolenValue: 0
            };
            if (success && !detected) {
                result.stolenItems = await this.processSuccessfulTheft(storageId, targetItems, thiefId);
                result.stolenValue = await this.calculateStolenValue(result.stolenItems);
                await this.createTheftTransaction(storageId, thiefId, result.stolenItems);
            }
            result.consequences = await this.generateTheftConsequences(storage, detected, success);
            if (detected) {
                const detectionMethod = await this.triggerSecurityMeasures(storage);
                result.detectionMethod = detectionMethod;
                this.setAlarmCooldown(storageId);
            }
            this.eventBus.emit('theft:result', {
                thiefId,
                storageId,
                result
            });
            return result;
        });
    }
    async installSecurityMeasure(storageId, measureId, installerId) {
        return this.measureOperation('installSecurityMeasure', async () => {
            const measure = this.getSecurityMeasure(measureId);
            if (!measure) {
                throw new Error(`Unknown security measure: ${measureId}`);
            }
            const storage = await this.getGuildStorage(storageId);
            if (!this.securityMeasures.has(storageId)) {
                this.securityMeasures.set(storageId, []);
            }
            this.securityMeasures.get(storageId).push(measure);
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
    async postBounty(thiefId, storageId, amount, posterId, reason) {
        return this.measureOperation('postBounty', async () => {
            if (!this.config.bountySystemEnabled) {
                throw new Error('Bounty system is disabled');
            }
            const bounty = {
                id: `bounty_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                thiefId,
                storageId,
                amount,
                reason,
                postedBy: posterId,
                expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                claimed: false
            };
            this.bounties.set(bounty.id, bounty);
            this.eventBus.emit('bounty:posted', bounty);
            return bounty;
        });
    }
    async claimBounty(bountyId, claimantId) {
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
            bounty.claimed = true;
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
    async getSecurityStatus(storageId) {
        const storage = await this.getGuildStorage(storageId);
        const measures = this.securityMeasures.get(storageId) || [];
        const cooldownRemaining = this.getAlarmCooldownRemaining(storageId);
        const vulnerabilityScore = Math.max(0, 10 - storage.securityLevel - (measures.length * 0.5));
        return {
            securityLevel: storage.securityLevel,
            activeMeasures: measures,
            recentBreaches: 0,
            alarmCooldownRemaining: cooldownRemaining,
            vulnerabilityScore
        };
    }
    getAvailableSecurityMeasures() {
        return Array.from(this.securityMeasures.values()).flat();
    }
    getActiveBounties(storageId) {
        const allBounties = Array.from(this.bounties.values());
        const activeBounties = allBounties.filter(b => !b.claimed && b.expiresAt > new Date());
        if (storageId) {
            return activeBounties.filter(b => b.storageId === storageId);
        }
        return activeBounties;
    }
    calculateTheftSuccessChance(storage, thiefSkill) {
        let chance = 0.4;
        chance += (thiefSkill - 1) * this.config.skillImportance;
        chance -= storage.securityLevel * 0.05;
        return Math.max(0.05, Math.min(0.95, chance));
    }
    calculateDetectionChance(storage, thiefSkill) {
        let chance = this.config.baseDetectionChance;
        chance += storage.securityLevel * this.config.securityMultiplier;
        chance -= (thiefSkill - 1) * (this.config.skillImportance * 0.5);
        const measures = this.securityMeasures.get(storage.id) || [];
        chance += measures.length * 0.05;
        return Math.max(0.05, Math.min(0.95, chance));
    }
    async processSuccessfulTheft(storageId, targetItems, thiefId) {
        const stolenItems = [];
        for (const target of targetItems) {
            stolenItems.push({
                itemId: target.itemId,
                quantity: target.quantity
            });
        }
        return stolenItems;
    }
    async calculateStolenValue(stolenItems) {
        let totalValue = 0;
        for (const item of stolenItems) {
            totalValue += 100 * item.quantity;
        }
        return totalValue;
    }
    async generateTheftConsequences(storage, detected, success) {
        const consequences = [];
        if (detected) {
            consequences.push({
                type: 'alarm',
                severity: Math.floor(storage.securityLevel / 2) + 3,
                description: 'Security system detected unauthorized access'
            });
            if (this.config.reputationImpactEnabled) {
                consequences.push({
                    type: 'reputation_loss',
                    severity: success ? 2 : 4,
                    description: 'Guild reputation damaged by security breach'
                });
            }
        }
        if (success && !detected) {
            consequences.push({
                type: 'reputation_loss',
                severity: 1,
                description: 'Subtle suspicion of theft activity'
            });
        }
        if (storage.securityLevel >= 5) {
            consequences.push({
                type: 'damage',
                severity: Math.floor(storage.securityLevel / 3),
                description: 'Security countermeasures caused damage'
            });
        }
        return consequences;
    }
    async triggerSecurityMeasures(storage) {
        const measures = this.securityMeasures.get(storage.id) || [];
        const triggeredMeasure = measures[Math.floor(Math.random() * measures.length)];
        if (triggeredMeasure) {
            this.eventBus.emit('security:measure_triggered', {
                storageId: storage.id,
                measure: triggeredMeasure
            });
            return triggeredMeasure.type;
        }
        return 'basic_alarm';
    }
    async createTheftTransaction(storageId, thiefId, stolenItems) {
        for (const item of stolenItems) {
            const transaction = {
                id: `theft_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                itemId: item.itemId,
                characterId: thiefId,
                transactionType: 'acquire',
                fromLocation: `guild_storage:${storageId}`,
                toLocation: 'inventory',
                quantity: item.quantity,
                value: 0,
                durabilityChange: 0,
                notes: 'Acquired through theft',
                transactionAt: new Date(),
                campaignId: 'mock_campaign',
                performedBy: thiefId,
                metadata: {
                    theft: true,
                    originalStorage: storageId
                }
            };
            this.eventBus.emit('inventory:transaction', transaction);
        }
    }
    isAlarmOnCooldown(storageId) {
        const lastAlarm = this.activeAlarms.get(storageId);
        if (!lastAlarm)
            return false;
        const cooldownMs = this.config.alarmCooldown * 60 * 1000;
        return Date.now() - lastAlarm.getTime() < cooldownMs;
    }
    setAlarmCooldown(storageId) {
        this.activeAlarms.set(storageId, new Date());
    }
    getAlarmCooldownRemaining(storageId) {
        const lastAlarm = this.activeAlarms.get(storageId);
        if (!lastAlarm)
            return 0;
        const cooldownMs = this.config.alarmCooldown * 60 * 1000;
        const elapsed = Date.now() - lastAlarm.getTime();
        const remaining = Math.max(0, cooldownMs - elapsed);
        return Math.floor(remaining / (60 * 1000));
    }
    async getGuildStorage(storageId) {
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
    getSecurityMeasure(measureId) {
        for (const measures of this.securityMeasures.values()) {
            const measure = measures.find(m => m.id === measureId);
            if (measure)
                return measure;
        }
        return undefined;
    }
    initializeSecurityMeasures() {
        const measures = [
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
        this.securityMeasures.set('global_measures', measures);
    }
    async handleTheftAttempt(data) {
        try {
            await this.attemptTheft(data.thiefId, data.storageId, data.targetItems, data.thiefSkill || 1);
        }
        catch (error) {
            console.error('[Theft] Error handling theft attempt:', error);
        }
    }
    async handleAlarmTriggered(data) {
        console.log(`[Theft] Alarm triggered for storage ${data.storageId} with severity ${data.severity}`);
    }
    async handleBountyPosted(data) {
        console.log(`[Theft] Bounty posted for ${data.amount} gold on thief ${data.thiefId}`);
    }
    async handleBountyClaimed(data) {
        console.log(`[Theft] Bounty claimed by ${data.claimantId} for ${data.bounty.amount} gold`);
    }
}
exports.TheftService = TheftService;
exports.theftService = new TheftService();
