"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.guildStorageService = exports.GuildStorageService = void 0;
const BaseService_1 = require("./BaseService");
const DEFAULT_GUILD_STORAGE_CONFIG = {
    enabled: true,
    maxStoragesPerGuild: 5,
    baseStorageCapacity: 100,
    capacityUpgradeCost: 1000,
    securityUpgradeCost: 500,
    theftDetectionEnabled: true,
    permissionExpirationEnabled: true,
    defaultPermissionDuration: 30
};
class GuildStorageService extends BaseService_1.BaseService {
    constructor(config = {}) {
        super('GuildStorageService', { performanceBudget: 50 });
        this.activeTheftAttempts = new Map();
        this.config = { ...DEFAULT_GUILD_STORAGE_CONFIG, ...config };
    }
    async onInitialize() {
        this.eventBus.on('guild:storage_operation', this.handleStorageOperation.bind(this));
        this.eventBus.on('guild:permission_request', this.handlePermissionRequest.bind(this));
        this.eventBus.on('guild:theft_attempt', this.handleTheftAttempt.bind(this));
        this.eventBus.on('character:joined_guild', this.handleCharacterJoinedGuild.bind(this));
        this.eventBus.on('character:left_guild', this.handleCharacterLeftGuild.bind(this));
        console.log('[GuildStorage] Initialized with config:', this.config);
    }
    async onShutdown() {
        this.activeTheftAttempts.clear();
        console.log('[GuildStorage] Shut down gracefully');
    }
    async createGuildStorage(campaignId, name, creatorId, options = {}) {
        return this.measureOperation('createGuildStorage', async () => {
            const existingStorages = await this.getGuildStorages(campaignId);
            if (existingStorages.length >= this.config.maxStoragesPerGuild) {
                throw new Error(`Maximum guild storages reached (${this.config.maxStoragesPerGuild})`);
            }
            const storage = {
                id: `guild_storage_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                campaignId,
                name,
                description: `${name} - Guild storage facility`,
                locationId: options.locationId,
                capacity: options.initialCapacity || this.config.baseStorageCapacity,
                usedCapacity: 0,
                securityLevel: options.initialSecurity || 1,
                accessLevel: 'member',
                coordinates: options.coordinates,
                properties: {},
                createdAt: new Date(),
                updatedAt: new Date()
            };
            await this.grantStoragePermission(storage.id, creatorId, 'admin', creatorId, -1);
            this.eventBus.emit('guild:storage_created', {
                storage,
                creatorId
            });
            return storage;
        });
    }
    async performStorageOperation(operation) {
        return this.measureOperation('performStorageOperation', async () => {
            const hasPermission = await this.checkStorageAccess(operation.storageId, operation.characterId, this.getRequiredAccessLevel(operation.operation));
            if (!hasPermission) {
                return {
                    success: false,
                    transactions: [],
                    deniedReason: `Insufficient permissions for ${operation.operation}`
                };
            }
            const transactions = [];
            switch (operation.operation) {
                case 'deposit':
                    return await this.performDeposit(operation, transactions);
                case 'withdraw':
                    return await this.performWithdraw(operation, transactions);
                case 'view':
                    return await this.performView(operation);
                default:
                    throw new Error(`Unknown operation: ${operation.operation}`);
            }
        });
    }
    async grantStoragePermission(storageId, targetCharacterId, accessLevel, granterId, durationDays = this.config.defaultPermissionDuration) {
        return this.measureOperation('grantStoragePermission', async () => {
            const granterHasAdmin = await this.checkStorageAccess(storageId, granterId, 'admin');
            if (!granterHasAdmin) {
                throw new Error('Insufficient permissions to grant storage access');
            }
            const existingPermission = await this.getStoragePermission(storageId, targetCharacterId);
            const permission = {
                id: (existingPermission === null || existingPermission === void 0 ? void 0 : existingPermission.id) || `perm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                storageId,
                characterId: targetCharacterId,
                accessLevel,
                canDeposit: accessLevel === 'admin' || accessLevel === 'write',
                canWithdraw: accessLevel === 'admin' || accessLevel === 'write',
                canView: accessLevel === 'admin' || accessLevel === 'write' || accessLevel === 'read',
                theftRiskModifier: this.calculateTheftRiskModifier(accessLevel),
                grantedAt: new Date(),
                grantedBy: granterId,
                expiresAt: durationDays > 0 ? new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000) : undefined
            };
            this.eventBus.emit('guild:permission_granted', {
                permission,
                granterId
            });
            return permission;
        });
    }
    async revokeStoragePermission(storageId, targetCharacterId, revokerId) {
        return this.measureOperation('revokeStoragePermission', async () => {
            const revokerHasAdmin = await this.checkStorageAccess(storageId, revokerId, 'admin');
            if (!revokerHasAdmin) {
                throw new Error('Insufficient permissions to revoke storage access');
            }
            this.eventBus.emit('guild:permission_revoked', {
                storageId,
                targetCharacterId,
                revokerId
            });
            return true;
        });
    }
    async upgradeStorageCapacity(storageId, characterId, additionalCapacity) {
        return this.measureOperation('upgradeStorageCapacity', async () => {
            const hasAdmin = await this.checkStorageAccess(storageId, characterId, 'admin');
            if (!hasAdmin) {
                throw new Error('Insufficient permissions to upgrade storage');
            }
            const storage = await this.getGuildStorage(storageId);
            const cost = additionalCapacity * this.config.capacityUpgradeCost;
            const newCapacity = storage.capacity + additionalCapacity;
            this.eventBus.emit('guild:storage_upgraded', {
                storageId,
                upgradeType: 'capacity',
                oldValue: storage.capacity,
                newValue: newCapacity,
                cost,
                characterId
            });
            return {
                success: true,
                newCapacity,
                cost
            };
        });
    }
    async upgradeStorageSecurity(storageId, characterId) {
        return this.measureOperation('upgradeStorageSecurity', async () => {
            const hasAdmin = await this.checkStorageAccess(storageId, characterId, 'admin');
            if (!hasAdmin) {
                throw new Error('Insufficient permissions to upgrade security');
            }
            const storage = await this.getGuildStorage(storageId);
            if (storage.securityLevel >= 10) {
                throw new Error('Maximum security level reached');
            }
            const cost = (storage.securityLevel + 1) * this.config.securityUpgradeCost;
            const newSecurityLevel = storage.securityLevel + 1;
            this.eventBus.emit('guild:storage_upgraded', {
                storageId,
                upgradeType: 'security',
                oldValue: storage.securityLevel,
                newValue: newSecurityLevel,
                cost,
                characterId
            });
            return {
                success: true,
                newSecurityLevel,
                cost
            };
        });
    }
    async getStorageContents(storageId, viewerId) {
        return this.measureOperation('getStorageContents', async () => {
            const hasAccess = await this.checkStorageAccess(storageId, viewerId, 'read');
            if (!hasAccess) {
                throw new Error('Insufficient permissions to view storage contents');
            }
            return [];
        });
    }
    async getStorageStats(storageId, viewerId) {
        const hasAccess = await this.checkStorageAccess(storageId, viewerId, 'read');
        if (!hasAccess) {
            throw new Error('Insufficient permissions to view storage stats');
        }
        const storage = await this.getGuildStorage(storageId);
        const permissions = await this.getStoragePermissions(storageId);
        return {
            storage,
            totalPermissions: permissions.length,
            permissionsByLevel: permissions.reduce((acc, perm) => {
                acc[perm.accessLevel] = (acc[perm.accessLevel] || 0) + 1;
                return acc;
            }, {}),
            utilizationRate: storage.capacity > 0 ? (storage.usedCapacity / storage.capacity) * 100 : 0,
            securityStatus: this.getSecurityStatus(storage.securityLevel)
        };
    }
    getRequiredAccessLevel(operation) {
        switch (operation) {
            case 'deposit':
            case 'withdraw':
                return 'write';
            case 'view':
                return 'read';
            default:
                return 'read';
        }
    }
    async performDeposit(operation, transactions) {
        if (!operation.items || operation.items.length === 0) {
            throw new Error('No items specified for deposit');
        }
        const storage = await this.getGuildStorage(operation.storageId);
        const totalItems = operation.items.reduce((sum, item) => sum + item.quantity, 0);
        if (storage.usedCapacity + totalItems > storage.capacity) {
            return {
                success: false,
                transactions: [],
                deniedReason: 'Insufficient storage capacity'
            };
        }
        for (const item of operation.items) {
            const transaction = {
                id: `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                itemId: item.itemId,
                characterId: operation.characterId,
                transactionType: 'guild_deposit',
                fromLocation: 'inventory',
                toLocation: `guild_storage:${operation.storageId}`,
                quantity: item.quantity,
                value: 0,
                durabilityChange: 0,
                transactionAt: new Date(),
                campaignId: storage.campaignId,
                performedBy: operation.characterId,
                metadata: {}
            };
            transactions.push(transaction);
        }
        storage.usedCapacity += totalItems;
        return {
            success: true,
            transactions
        };
    }
    async performWithdraw(operation, transactions) {
        if (!operation.items || operation.items.length === 0) {
            throw new Error('No items specified for withdrawal');
        }
        const storage = await this.getGuildStorage(operation.storageId);
        for (const item of operation.items) {
            const transaction = {
                id: `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                itemId: item.itemId,
                characterId: operation.characterId,
                transactionType: 'guild_withdraw',
                fromLocation: `guild_storage:${operation.storageId}`,
                toLocation: 'inventory',
                quantity: item.quantity,
                value: 0,
                durabilityChange: 0,
                transactionAt: new Date(),
                campaignId: storage.campaignId,
                performedBy: operation.characterId,
                metadata: {}
            };
            transactions.push(transaction);
        }
        const totalItems = operation.items.reduce((sum, item) => sum + item.quantity, 0);
        storage.usedCapacity = Math.max(0, storage.usedCapacity - totalItems);
        return {
            success: true,
            transactions
        };
    }
    async performView(operation) {
        return {
            success: true,
            transactions: []
        };
    }
    calculateTheftRiskModifier(accessLevel) {
        const modifiers = {
            read: 1.0,
            write: 0.8,
            admin: 0.5
        };
        return modifiers[accessLevel];
    }
    getSecurityStatus(securityLevel) {
        if (securityLevel >= 8)
            return 'fort_knox';
        if (securityLevel >= 6)
            return 'high_security';
        if (securityLevel >= 4)
            return 'secure';
        if (securityLevel >= 2)
            return 'basic';
        return 'minimal';
    }
    async checkStorageAccess(storageId, characterId, requiredLevel) {
        return true;
    }
    async getGuildStorage(storageId) {
        return {
            id: storageId,
            campaignId: 'mock_campaign',
            name: 'Mock Storage',
            capacity: 100,
            usedCapacity: 0,
            securityLevel: 1,
            accessLevel: 'member',
            createdAt: new Date(),
            updatedAt: new Date()
        };
    }
    async getGuildStorages(campaignId) {
        return [];
    }
    async getStoragePermission(storageId, characterId) {
        return null;
    }
    async getStoragePermissions(storageId) {
        return [];
    }
    async handleStorageOperation(data) {
        try {
            await this.performStorageOperation(data);
        }
        catch (error) {
            console.error('[GuildStorage] Error handling storage operation:', error);
        }
    }
    async handlePermissionRequest(data) {
        try {
            await this.grantStoragePermission(data.storageId, data.targetCharacterId, data.requestedLevel, data.requesterId, data.duration);
        }
        catch (error) {
            console.error('[GuildStorage] Error handling permission request:', error);
        }
    }
    async handleTheftAttempt(data) {
        try {
            this.activeTheftAttempts.set(data.storageId, data);
            await this.processTheftConsequences(data);
            this.eventBus.emit('guild:theft_detected', data);
        }
        catch (error) {
            console.error('[GuildStorage] Error handling theft attempt:', error);
        }
    }
    async handleCharacterJoinedGuild(data) {
    }
    async handleCharacterLeftGuild(data) {
    }
    async processTheftConsequences(theft) {
        const consequences = [];
        if (theft.severity >= 8) {
            consequences.push({
                type: 'alarm',
                severity: theft.severity,
                description: 'Guild alarm triggered - guards alerted'
            });
        }
        if (theft.severity >= 6) {
            consequences.push({
                type: 'reputation_loss',
                severity: Math.floor(theft.severity / 2),
                description: 'Guild reputation damaged'
            });
        }
        for (const consequence of consequences) {
            this.eventBus.emit('guild:theft_consequence', {
                theftId: theft.storageId,
                consequence
            });
        }
    }
}
exports.GuildStorageService = GuildStorageService;
exports.guildStorageService = new GuildStorageService();
