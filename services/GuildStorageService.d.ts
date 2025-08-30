/**
 * Guild Storage Service - Manages Guild Storage with Access Control and Permissions
 *
 * Critical innovation: Secure guild storage system with granular permissions
 * and theft mechanics that create meaningful social gameplay around resource sharing.
 */
import { BaseService } from './BaseService';
import { GuildStorage, GuildStoragePermission, StorageAccessLevel, InventoryTransaction, Item } from '../../src/types';
export interface GuildStorageConfig {
    enabled: boolean;
    maxStoragesPerGuild: number;
    baseStorageCapacity: number;
    capacityUpgradeCost: number;
    securityUpgradeCost: number;
    theftDetectionEnabled: boolean;
    permissionExpirationEnabled: boolean;
    defaultPermissionDuration: number;
}
export interface StorageOperation {
    storageId: string;
    characterId: string;
    operation: 'deposit' | 'withdraw' | 'view';
    items?: Array<{
        itemId: string;
        quantity: number;
    }>;
}
export interface PermissionRequest {
    storageId: string;
    requesterId: string;
    targetCharacterId: string;
    requestedLevel: StorageAccessLevel;
    reason?: string;
    duration?: number;
}
export interface TheftDetection {
    storageId: string;
    thiefId: string;
    targetItemId: string;
    detectionMethod: 'alarm' | 'trap' | 'guard' | 'magical';
    severity: number;
    timestamp: Date;
}
export declare class GuildStorageService extends BaseService {
    private config;
    private activeTheftAttempts;
    constructor(config?: Partial<GuildStorageConfig>);
    protected onInitialize(): Promise<void>;
    protected onShutdown(): Promise<void>;
    /**
     * Create new guild storage
     */
    createGuildStorage(campaignId: string, name: string, creatorId: string, options?: {
        locationId?: string;
        initialCapacity?: number;
        initialSecurity?: number;
        coordinates?: {
            lat: number;
            lng: number;
        };
    }): Promise<GuildStorage>;
    /**
     * Perform storage operation (deposit/withdraw/view)
     */
    performStorageOperation(operation: StorageOperation): Promise<{
        success: boolean;
        transactions: InventoryTransaction[];
        deniedReason?: string;
    }>;
    /**
     * Grant storage permission
     */
    grantStoragePermission(storageId: string, targetCharacterId: string, accessLevel: StorageAccessLevel, granterId: string, durationDays?: number): Promise<GuildStoragePermission>;
    /**
     * Revoke storage permission
     */
    revokeStoragePermission(storageId: string, targetCharacterId: string, revokerId: string): Promise<boolean>;
    /**
     * Upgrade storage capacity
     */
    upgradeStorageCapacity(storageId: string, characterId: string, additionalCapacity: number): Promise<{
        success: boolean;
        newCapacity: number;
        cost: number;
    }>;
    /**
     * Upgrade storage security
     */
    upgradeStorageSecurity(storageId: string, characterId: string): Promise<{
        success: boolean;
        newSecurityLevel: number;
        cost: number;
    }>;
    /**
     * Get storage contents
     */
    getStorageContents(storageId: string, viewerId: string): Promise<Array<{
        item: Item;
        quantity: number;
    }>>;
    /**
     * Get storage statistics
     */
    getStorageStats(storageId: string, viewerId: string): Promise<{
        storage: GuildStorage;
        totalPermissions: number;
        permissionsByLevel: Record<string, number>;
        utilizationRate: number;
        securityStatus: string;
    }>;
    private getRequiredAccessLevel;
    private performDeposit;
    private performWithdraw;
    private performView;
    private calculateTheftRiskModifier;
    private getSecurityStatus;
    private checkStorageAccess;
    private getGuildStorage;
    private getGuildStorages;
    private getStoragePermission;
    private getStoragePermissions;
    private handleStorageOperation;
    private handlePermissionRequest;
    private handleTheftAttempt;
    private handleCharacterJoinedGuild;
    private handleCharacterLeftGuild;
    private processTheftConsequences;
}
export declare const guildStorageService: GuildStorageService;
//# sourceMappingURL=GuildStorageService.d.ts.map