/**
 * Memory Temperature System - Core Innovation for STRES
 *
 * Enables year-long campaigns by intelligently managing memory states:
 * - HOT: 100% retention (1 hour)
 * - WARM: 50% retention (1 day)
 * - COOL: 20% retention (1 week)
 * - COLD: 5% retention (1 month)
 * - FROZEN: 1% retention (forever)
 *
 * SUCCESS METRIC: 95% token reduction for cold data
 */

import { BaseService } from './BaseService';

export interface MemoryEntity {
  id: string;
  type: 'character' | 'location' | 'relationship' | 'item' | 'event';
  data: any;
  temperature: Temperature;
  lastAccessed: Date;
  accessCount: number;
  tokenCount: number;
  compressedData?: any;
  compressionRatio?: number;
}

export type Temperature = 'hot' | 'warm' | 'cool' | 'cold' | 'frozen';

export interface TemperatureConfig {
  enabled: boolean;
  debugMode: boolean;
  performanceBudget: number;
  fallbackEnabled: boolean;
  hotToWarm: number;      // hours
  warmToCool: number;     // hours
  coolToCold: number;     // days
  coldToFrozen: number;   // days
  compressionLevels: {
    warm: number;         // 0.0-1.0 retention
    cool: number;
    cold: number;
    frozen: number;
  };
}

export interface CompressionResult {
  compressedData: any;
  originalTokenCount: number;
  compressedTokenCount: number;
  compressionRatio: number;
  temperature: Temperature;
}

const DEFAULT_CONFIG: TemperatureConfig = {
  enabled: true,
  debugMode: false,
  performanceBudget: 50,
  fallbackEnabled: true,
  hotToWarm: 1,      // 1 hour
  warmToCool: 24,    // 24 hours
  coolToCold: 168,   // 7 days
  coldToFrozen: 720, // 30 days
  compressionLevels: {
    warm: 0.5,
    cool: 0.2,
    cold: 0.05,
    frozen: 0.01
  }
};

export class MemoryTemperatureService extends BaseService {
  protected config: TemperatureConfig;
  private memoryCache = new Map<string, MemoryEntity>();
  private compressionStrategies: Map<Temperature, (data: any) => any> = new Map();

  constructor(config: Partial<TemperatureConfig> = {}) {
    super('MemoryTemperatureService', { performanceBudget: 50 });
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.initializeCompressionStrategies();
  }

  protected async onInitialize(): Promise<void> {
    // Register event listeners
    this.eventBus.on('character:accessed', this.handleCharacterAccess.bind(this));
    this.eventBus.on('location:accessed', this.handleLocationAccess.bind(this));
    this.eventBus.on('memory:compress', this.handleCompressionRequest.bind(this));
    this.eventBus.on('memory:expand', this.handleExpansionRequest.bind(this));

    // Load existing memory states from database
    await this.loadExistingMemoryStates();

    console.log('[MemoryTemperature] Initialized with config:', this.config);
  }

  protected async onShutdown(): Promise<void> {
    // Save all memory states before shutdown
    await this.persistAllMemoryStates();

    // Clear cache
    this.memoryCache.clear();

    console.log('[MemoryTemperature] Shut down gracefully');
  }

  /**
   * Process entity access and update temperature
   */
  async processEntityAccess(entityId: string, entityType: MemoryEntity['type']): Promise<void> {
    return this.measureOperation('processEntityAccess', async () => {
      const entity = await this.getOrLoadEntity(entityId, entityType);
      const newTemperature = this.calculateTemperature(entity.lastAccessed);

      if (newTemperature !== entity.temperature) {
        await this.transitionTemperature(entity, newTemperature);
      }

      // Update access metadata
      entity.lastAccessed = new Date();
      entity.accessCount++;

      await this.persistEntity(entity);
    });
  }

  /**
   * Compress entity data based on temperature
   */
  async compressEntity(entityId: string, targetTemperature: Temperature, entityType?: MemoryEntity['type']): Promise<CompressionResult> {
    return this.measureOperation('compressEntity', async () => {
      const entity = await this.getOrLoadEntity(entityId, entityType || 'character');

      const compressionStrategy = this.compressionStrategies.get(targetTemperature);
      if (!compressionStrategy) {
        throw new Error(`No compression strategy for temperature: ${targetTemperature}`);
      }

      const originalTokenCount = entity.tokenCount;
      const compressedData = compressionStrategy(entity.data);
      const compressedTokenCount = this.estimateTokenCount(compressedData);
      const compressionRatio = compressedTokenCount / originalTokenCount;

      const result: CompressionResult = {
        compressedData,
        originalTokenCount,
        compressedTokenCount,
        compressionRatio,
        temperature: targetTemperature
      };

      // Update entity
      entity.temperature = targetTemperature;
      entity.compressedData = compressedData;
      entity.compressionRatio = compressionRatio;
      entity.tokenCount = compressedTokenCount;

      await this.persistEntity(entity);

      // Emit compression event
      this.eventBus.emit('memory:compressed', {
        entityId,
        result
      });

      return result;
    });
  }

  /**
   * Expand compressed entity data
   */
  async expandEntity(entityId: string): Promise<any> {
    return this.measureOperation('expandEntity', async () => {
      const entity = this.memoryCache.get(entityId);
      if (!entity) {
        throw new Error(`Entity not found: ${entityId}`);
      }

      if (entity.temperature === 'hot') {
        return entity.data;
      }

      // For compressed entities, we need to reconstruct from compressed data
      // This is a simplified reconstruction - in practice, you'd have more sophisticated expansion
      const expandedData = await this.expandCompressedData(entity);

      // Transition to hot temperature
      await this.transitionTemperature(entity, 'hot');

      return expandedData;
    });
  }

  /**
   * Get memory statistics
   */
  getMemoryStats() {
    const stats = {
      totalEntities: this.memoryCache.size,
      byTemperature: {
        hot: 0,
        warm: 0,
        cool: 0,
        cold: 0,
        frozen: 0
      },
      totalTokenReduction: 0,
      avgCompressionRatio: 0
    };

    let totalCompressionRatio = 0;
    let entitiesWithCompression = 0;

    for (const entity of Array.from(this.memoryCache.values())) {
      stats.byTemperature[entity.temperature]++;

      if (entity.compressionRatio) {
        totalCompressionRatio += entity.compressionRatio;
        entitiesWithCompression++;
      }
    }

    stats.avgCompressionRatio = entitiesWithCompression > 0 ?
      totalCompressionRatio / entitiesWithCompression : 1;

    // Calculate total token reduction
    const entities = Array.from(this.memoryCache.values());
    const originalTokens = entities
      .reduce((sum, entity) => sum + (entity.tokenCount / (entity.compressionRatio || 1)), 0);

    const currentTokens = entities
      .reduce((sum, entity) => sum + entity.tokenCount, 0);

    stats.totalTokenReduction = originalTokens > 0 ?
      ((originalTokens - currentTokens) / originalTokens) * 100 : 0;

    return stats;
  }

  // Private methods

  private initializeCompressionStrategies(): void {
    this.compressionStrategies.set('warm', (data) => this.compressWarm(data));
    this.compressionStrategies.set('cool', (data) => this.compressCool(data));
    this.compressionStrategies.set('cold', (data) => this.compressCold(data));
    this.compressionStrategies.set('frozen', (data) => this.compressFrozen(data));
  }

  private calculateTemperature(lastAccessed: Date): Temperature {
    const hoursSinceAccess = (Date.now() - lastAccessed.getTime()) / (1000 * 60 * 60);

    if (hoursSinceAccess < this.config.hotToWarm) return 'hot';
    if (hoursSinceAccess < this.config.warmToCool) return 'warm';
    if (hoursSinceAccess < this.config.coolToCold * 24) return 'cool';
    if (hoursSinceAccess < this.config.coldToFrozen * 24) return 'cold';
    return 'frozen';
  }

  private async transitionTemperature(entity: MemoryEntity, newTemperature: Temperature): Promise<void> {
    const oldTemperature = entity.temperature;

    if (oldTemperature === newTemperature) return;

    console.log(`[MemoryTemperature] Transitioning ${entity.type}:${entity.id} from ${oldTemperature} to ${newTemperature}`);

    // Compress if moving to colder temperature
    if (this.getTemperatureLevel(newTemperature) < this.getTemperatureLevel(oldTemperature)) {
      await this.compressEntity(entity.id, newTemperature);
    } else {
      // Expand if moving to hotter temperature
      await this.expandEntity(entity.id);
    }

    entity.temperature = newTemperature;

    // Emit temperature transition event
    this.eventBus.emit('memory:temperature_changed', {
      entityId: entity.id,
      entityType: entity.type,
      oldTemperature,
      newTemperature
    });
  }

  private getTemperatureLevel(temperature: Temperature): number {
    const levels = { hot: 5, warm: 4, cool: 3, cold: 2, frozen: 1 };
    return levels[temperature];
  }

  private compressWarm(data: any): any {
    // Remove redundant text, keep key events
    if (typeof data === 'string') {
      // Remove repeated phrases, keep essential information
      return data.substring(0, Math.floor(data.length * this.config.compressionLevels.warm));
    }

    if (typeof data === 'object') {
      const compressed = { ...data };
      // Remove less important fields
      delete compressed.description;
      delete compressed.flavorText;
      return compressed;
    }

    return data;
  }

  private compressCool(data: any): any {
    // Single paragraph summary only
    if (typeof data === 'string') {
      const sentences = data.split(/[.!?]+/).filter(s => s.trim().length > 0);
      return sentences.slice(0, 3).join('. ') + '.'; // Keep first 3 sentences
    }

    if (typeof data === 'object' && data !== null) {
      // Keep only essential fields
      const essential = ['id', 'name', 'level', 'status', 'location'];
      const compressed: Record<string, any> = {};
      const dataObj = data as Record<string, any>;
      for (const key of essential) {
        if (dataObj[key] !== undefined) {
          compressed[key] = dataObj[key];
        }
      }
      return compressed;
    }

    return data;
  }

  private compressCold(data: any): any {
    // Aggressive compression: minimal statistical data only (95% reduction target)
    if (typeof data === 'string') {
      // Keep only essential keywords (first 8 words)
      const words = data.split(/\s+/).filter(w => w.length > 0);
      return words.slice(0, 8).join(' ') + '...';
    }

    if (typeof data === 'object' && data !== null) {
      // Keep only core identifiers and stats with shortened names
      return {
        id: data.id,
        lvl: data.level,  // Shortened field name
        cls: data.class,  // Shortened field name
        loc: data.current_location_id || data.location,  // Shortened field name
        st: data.status   // Shortened field name
      };
    }

    return data;
  }

  private compressFrozen(data: any): any {
    // Maximum compression: only essential identifiers (99% reduction target)
    if (typeof data === 'string') {
      // Keep only first 3 words
      const words = data.split(/\s+/).filter(w => w.length > 0);
      return words.slice(0, 3).join(' ') + '...';
    }

    if (typeof data === 'object' && data !== null) {
      // Minimal data: only ID and basic stats with single character names
      return {
        id: data.id,
        l: data.level,   // Single character field name
        c: data.class,   // Single character field name
        s: data.status   // Single character field name
      };
    }

    return data;
  }

  private async expandCompressedData(entity: MemoryEntity): Promise<any> {
    // In a real implementation, this would reconstruct data from compressed form
    // For now, return compressed data as-is for hot temperature
    return entity.compressedData || entity.data;
  }

  private estimateTokenCount(data: any): number {
    // Rough token estimation (1 token ≈ 4 characters)
    const jsonString = JSON.stringify(data);
    return Math.ceil(jsonString.length / 4);
  }

  private async getOrLoadEntity(entityId: string, entityType: MemoryEntity['type']): Promise<MemoryEntity> {
    let entity = this.memoryCache.get(entityId);

    if (!entity) {
      // Load from database (simulated for now)
      entity = await this.loadEntityFromDatabase(entityId, entityType);
      this.memoryCache.set(entityId, entity);
    }

    return entity;
  }

  private async loadEntityFromDatabase(entityId: string, entityType: MemoryEntity['type']): Promise<MemoryEntity> {
    // This would connect to the actual database
    // For now, return a mock entity
    return {
      id: entityId,
      type: entityType,
      data: { id: entityId, name: `Entity ${entityId}` },
      temperature: 'hot',
      lastAccessed: new Date(),
      accessCount: 0,
      tokenCount: 100
    };
  }

  private async persistEntity(entity: MemoryEntity): Promise<void> {
    // This would save to the database
    this.memoryCache.set(entity.id, entity);
  }

  private async loadExistingMemoryStates(): Promise<void> {
    // Load existing memory states from database
    // This would be implemented when we have database connectivity
  }

  private async persistAllMemoryStates(): Promise<void> {
    // Persist all memory states to database
    // This would be implemented when we have database connectivity
  }

  // Event handlers

  private async handleCharacterAccess(data: { characterId: string }): Promise<void> {
    await this.processEntityAccess(data.characterId, 'character');
  }

  private async handleLocationAccess(data: { locationId: string }): Promise<void> {
    await this.processEntityAccess(data.locationId, 'location');
  }

  private async handleCompressionRequest(data: { entityId: string; targetTemperature: Temperature }): Promise<void> {
    await this.compressEntity(data.entityId, data.targetTemperature);
  }

  private async handleExpansionRequest(data: { entityId: string }): Promise<void> {
    await this.expandEntity(data.entityId);
  }
}

// Global instance
export const memoryTemperatureService = new MemoryTemperatureService();
