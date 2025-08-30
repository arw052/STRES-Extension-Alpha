/**
 * Guild Storage Service - Manages Guild Storage with Access Control and Permissions
 *
 * Critical innovation: Secure guild storage system with granular permissions
 * and theft mechanics that create meaningful social gameplay around resource sharing.
 */

import { BaseService } from './BaseService';
import { EventBus } from './EventBus';
import { TokenCounter } from '../../shared/utils/tokenCounter';
import {
  GuildStorage,
  GuildStoragePermission,
  StorageAccessLevel,
  InventoryTransaction,
  TransactionType,
  Item
} from '../../src/types';

export interface GuildStorageConfig {
  enabled: boolean;
  maxStoragesPerGuild: number;
  baseStorageCapacity: number;
  capacityUpgradeCost: number;
  securityUpgradeCost: number;
  theftDetectionEnabled: boolean;
  permissionExpirationEnabled: boolean;
  defaultPermissionDuration: number; // days
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
  duration?: number; // days
}

export interface TheftDetection {
  storageId: string;
  thiefId: string;
  targetItemId: string;
  detectionMethod: 'alarm' | 'trap' | 'guard' | 'magical';
  severity: number; // 1-10
  timestamp: Date;
}

const DEFAULT_GUILD_STORAGE_CONFIG: GuildStorageConfig = {
  enabled: true,
  maxStoragesPerGuild: 5,
  baseStorageCapacity: 100,
  capacityUpgradeCost: 1000, // gold per capacity point
  securityUpgradeCost: 500, // gold per security level
  theftDetectionEnabled: true,
  permissionExpirationEnabled: true,
  defaultPermissionDuration: 30 // days
};

export class GuildStorageService extends BaseService {
  private config: GuildStorageConfig;
  private activeTheftAttempts = new Map<string, TheftDetection>();

  constructor(config: Partial<GuildStorageConfig> = {}) {
    super('GuildStorageService', { performanceBudget: 50 });
    this.config = { ...DEFAULT_GUILD_STORAGE_CONFIG, ...config };
  }

  protected async onInitialize(): Promise<void> {
    // Register event listeners
    this.eventBus.on('guild:storage_operation', this.handleStorageOperation.bind(this));
    this.eventBus.on('guild:permission_request', this.handlePermissionRequest.bind(this));
    this.eventBus.on('guild:theft_attempt', this.handleTheftAttempt.bind(this));
    this.eventBus.on('character:joined_guild', this.handleCharacterJoinedGuild.bind(this));
    this.eventBus.on('character:left_guild', this.handleCharacterLeftGuild.bind(this));

    console.log('[GuildStorage] Initialized with config:', this.config);
  }

  protected async onShutdown(): Promise<void> {
    // Clean up any active theft attempts
    this.activeTheftAttempts.clear();
    console.log('[GuildStorage] Shut down gracefully');
  }

  /**
   * Create new guild storage
   */
  async createGuildStorage(
    campaignId: string,
    name: string,
    creatorId: string,
    options: {
      locationId?: string;
      initialCapacity?: number;
      initialSecurity?: number;
      coordinates?: { lat: number; lng: number };
    } = {}
  ): Promise<GuildStorage> {
    return this.measureOperation('createGuildStorage', async () => {
      // Check guild storage limits
      const existingStorages = await this.getGuildStorages(campaignId);
      if (existingStorages.length >= this.config.maxStoragesPerGuild) {
        throw new Error(`Maximum guild storages reached (${this.config.maxStoragesPerGuild})`);
      }

      const storage: GuildStorage = {
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

      // Grant creator admin permissions
      await this.grantStoragePermission(storage.id, creatorId, 'admin', creatorId, -1);

      // Emit creation event
      this.eventBus.emit('guild:storage_created', {
        storage,
        creatorId
      });

      return storage;
    });
  }

  /**
   * Perform storage operation (deposit/withdraw/view)
   */
  async performStorageOperation(operation: StorageOperation): Promise<{
    success: boolean;
    transactions: InventoryTransaction[];
    deniedReason?: string;
  }> {
    return this.measureOperation('performStorageOperation', async () => {
      // Check permissions
      const hasPermission = await this.checkStorageAccess(
        operation.storageId,
        operation.characterId,
        this.getRequiredAccessLevel(operation.operation)
      );

      if (!hasPermission) {
        return {
          success: false,
          transactions: [],
          deniedReason: `Insufficient permissions for ${operation.operation}`
        };
      }

      const transactions: InventoryTransaction[] = [];

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

  /**
   * Grant storage permission
   */
  async grantStoragePermission(
    storageId: string,
    targetCharacterId: string,
    accessLevel: StorageAccessLevel,
    granterId: string,
    durationDays: number = this.config.defaultPermissionDuration
  ): Promise<GuildStoragePermission> {
    return this.measureOperation('grantStoragePermission', async () => {
      // Check if granter has admin permissions
      const granterHasAdmin = await this.checkStorageAccess(storageId, granterId, 'admin');
      if (!granterHasAdmin) {
        throw new Error('Insufficient permissions to grant storage access');
      }

      // Check for existing permission
      const existingPermission = await this.getStoragePermission(storageId, targetCharacterId);

      const permission: GuildStoragePermission = {
        id: existingPermission?.id || `perm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
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

      // Emit permission granted event
      this.eventBus.emit('guild:permission_granted', {
        permission,
        granterId
      });

      return permission;
    });
  }

  /**
   * Revoke storage permission
   */
  async revokeStoragePermission(
    storageId: string,
    targetCharacterId: string,
    revokerId: string
  ): Promise<boolean> {
    return this.measureOperation('revokeStoragePermission', async () => {
      // Check if revoker has admin permissions
      const revokerHasAdmin = await this.checkStorageAccess(storageId, revokerId, 'admin');
      if (!revokerHasAdmin) {
        throw new Error('Insufficient permissions to revoke storage access');
      }

      // Emit permission revoked event
      this.eventBus.emit('guild:permission_revoked', {
        storageId,
        targetCharacterId,
        revokerId
      });

      return true;
    });
  }

  /**
   * Upgrade storage capacity
   */
  async upgradeStorageCapacity(
    storageId: string,
    characterId: string,
    additionalCapacity: number
  ): Promise<{
    success: boolean;
    newCapacity: number;
    cost: number;
  }> {
    return this.measureOperation('upgradeStorageCapacity', async () => {
      // Check admin permissions
      const hasAdmin = await this.checkStorageAccess(storageId, characterId, 'admin');
      if (!hasAdmin) {
        throw new Error('Insufficient permissions to upgrade storage');
      }

      const storage = await this.getGuildStorage(storageId);
      const cost = additionalCapacity * this.config.capacityUpgradeCost;

      // Update capacity
      const newCapacity = storage.capacity + additionalCapacity;

      // Emit upgrade event
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

  /**
   * Upgrade storage security
   */
  async upgradeStorageSecurity(
    storageId: string,
    characterId: string
  ): Promise<{
    success: boolean;
    newSecurityLevel: number;
    cost: number;
  }> {
    return this.measureOperation('upgradeStorageSecurity', async () => {
      // Check admin permissions
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

      // Emit upgrade event
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

  /**
   * Get storage contents
   */
  async getStorageContents(
    storageId: string,
    viewerId: string
  ): Promise<Array<{ item: Item; quantity: number }>> {
    return this.measureOperation('getStorageContents', async () => {
      // Check view permissions
      const hasAccess = await this.checkStorageAccess(storageId, viewerId, 'read');
      if (!hasAccess) {
        throw new Error('Insufficient permissions to view storage contents');
      }

      // Return storage contents (would query database)
      return [];
    });
  }

  /**
   * Get storage statistics
   */
  async getStorageStats(storageId: string, viewerId: string) {
    // Check view permissions
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
      }, {} as Record<string, number>),
      utilizationRate: storage.capacity > 0 ? (storage.usedCapacity / storage.capacity) * 100 : 0,
      securityStatus: this.getSecurityStatus(storage.securityLevel)
    };
  }

  // Private methods

  private getRequiredAccessLevel(operation: string): StorageAccessLevel {
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

  private async performDeposit(
    operation: StorageOperation,
    transactions: InventoryTransaction[]
  ): Promise<{ success: boolean; transactions: InventoryTransaction[] }> {
    if (!operation.items || operation.items.length === 0) {
      throw new Error('No items specified for deposit');
    }

    const storage = await this.getGuildStorage(operation.storageId);

    // Check capacity
    const totalItems = operation.items.reduce((sum, item) => sum + item.quantity, 0);
    if (storage.usedCapacity + totalItems > storage.capacity) {
      return {
        success: false,
        transactions: [],
        deniedReason: 'Insufficient storage capacity'
      };
    }

    // Create transactions
    for (const item of operation.items) {
      const transaction: InventoryTransaction = {
        id: `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        itemId: item.itemId,
        characterId: operation.characterId,
        transactionType: 'guild_deposit',
        fromLocation: 'inventory',
        toLocation: `guild_storage:${operation.storageId}`,
        quantity: item.quantity,
        value: 0, // Would calculate item value
        durabilityChange: 0,
        transactionAt: new Date(),
        campaignId: storage.campaignId,
        performedBy: operation.characterId,
        metadata: {}
      };

      transactions.push(transaction);
    }

    // Update storage capacity
    storage.usedCapacity += totalItems;

    return {
      success: true,
      transactions
    };
  }

  private async performWithdraw(
    operation: StorageOperation,
    transactions: InventoryTransaction[]
  ): Promise<{ success: boolean; transactions: InventoryTransaction[] }> {
    if (!operation.items || operation.items.length === 0) {
      throw new Error('No items specified for withdrawal');
    }

    const storage = await this.getGuildStorage(operation.storageId);

    // Create transactions
    for (const item of operation.items) {
      const transaction: InventoryTransaction = {
        id: `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        itemId: item.itemId,
        characterId: operation.characterId,
        transactionType: 'guild_withdraw',
        fromLocation: `guild_storage:${operation.storageId}`,
        toLocation: 'inventory',
        quantity: item.quantity,
        value: 0, // Would calculate item value
        durabilityChange: 0,
        transactionAt: new Date(),
        campaignId: storage.campaignId,
        performedBy: operation.characterId,
        metadata: {}
      };

      transactions.push(transaction);
    }

    // Update storage capacity
    const totalItems = operation.items.reduce((sum, item) => sum + item.quantity, 0);
    storage.usedCapacity = Math.max(0, storage.usedCapacity - totalItems);

    return {
      success: true,
      transactions
    };
  }

  private async performView(
    operation: StorageOperation
  ): Promise<{ success: boolean; transactions: InventoryTransaction[] }> {
    // View operations don't create transactions
    return {
      success: true,
      transactions: []
    };
  }

  private calculateTheftRiskModifier(accessLevel: StorageAccessLevel): number {
    // Higher access levels have lower theft risk
    const modifiers = {
      read: 1.0,
      write: 0.8,
      admin: 0.5
    };

    return modifiers[accessLevel];
  }

  private getSecurityStatus(securityLevel: number): string {
    if (securityLevel >= 8) return 'fort_knox';
    if (securityLevel >= 6) return 'high_security';
    if (securityLevel >= 4) return 'secure';
    if (securityLevel >= 2) return 'basic';
    return 'minimal';
  }

  private async checkStorageAccess(
    storageId: string,
    characterId: string,
    requiredLevel: StorageAccessLevel
  ): Promise<boolean> {
    // This would query the database for permissions
    // For now, return true for implementation
    return true;
  }

  private async getGuildStorage(storageId: string): Promise<GuildStorage> {
    // This would query the database
    // For now, return a mock storage
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

  private async getGuildStorages(campaignId: string): Promise<GuildStorage[]> {
    // This would query the database
    return [];
  }

  private async getStoragePermission(
    storageId: string,
    characterId: string
  ): Promise<GuildStoragePermission | null> {
    // This would query the database
    return null;
  }

  private async getStoragePermissions(storageId: string): Promise<GuildStoragePermission[]> {
    // This would query the database
    return [];
  }

  // Event handlers

  private async handleStorageOperation(data: StorageOperation): Promise<void> {
    try {
      await this.performStorageOperation(data);
    } catch (error) {
      console.error('[GuildStorage] Error handling storage operation:', error);
    }
  }

  private async handlePermissionRequest(data: PermissionRequest): Promise<void> {
    try {
      await this.grantStoragePermission(
        data.storageId,
        data.targetCharacterId,
        data.requestedLevel,
        data.requesterId,
        data.duration
      );
    } catch (error) {
      console.error('[GuildStorage] Error handling permission request:', error);
    }
  }

  private async handleTheftAttempt(data: TheftDetection): Promise<void> {
    try {
      this.activeTheftAttempts.set(data.storageId, data);

      // Process theft consequences
      await this.processTheftConsequences(data);

      // Emit theft detected event
      this.eventBus.emit('guild:theft_detected', data);
    } catch (error) {
      console.error('[GuildStorage] Error handling theft attempt:', error);
    }
  }

  private async handleCharacterJoinedGuild(data: { characterId: string; guildId: string }): Promise<void> {
    // Grant basic storage permissions to new guild members
    // Implementation would find guild storages and grant read access
  }

  private async handleCharacterLeftGuild(data: { characterId: string; guildId: string }): Promise<void> {
    // Revoke all storage permissions for character
    // Implementation would find and revoke all permissions
  }

  private async processTheftConsequences(theft: TheftDetection): Promise<void> {
    // Calculate consequences based on theft severity and storage security
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

    // Emit consequences
    for (const consequence of consequences) {
      this.eventBus.emit('guild:theft_consequence', {
        theftId: theft.storageId,
        consequence
      });
    }
  }
}

// Global instance
export const guildStorageService = new GuildStorageService();
