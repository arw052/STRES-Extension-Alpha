"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.memoryTemperatureService = exports.MemoryTemperatureService = void 0;
const BaseService_1 = require("./BaseService");
const DEFAULT_CONFIG = {
    enabled: true,
    debugMode: false,
    performanceBudget: 50,
    fallbackEnabled: true,
    hotToWarm: 1,
    warmToCool: 24,
    coolToCold: 168,
    coldToFrozen: 720,
    compressionLevels: {
        warm: 0.5,
        cool: 0.2,
        cold: 0.05,
        frozen: 0.01
    }
};
class MemoryTemperatureService extends BaseService_1.BaseService {
    constructor(config = {}) {
        super('MemoryTemperatureService', { performanceBudget: 50 });
        this.memoryCache = new Map();
        this.compressionStrategies = new Map();
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.initializeCompressionStrategies();
    }
    async onInitialize() {
        this.eventBus.on('character:accessed', this.handleCharacterAccess.bind(this));
        this.eventBus.on('location:accessed', this.handleLocationAccess.bind(this));
        this.eventBus.on('memory:compress', this.handleCompressionRequest.bind(this));
        this.eventBus.on('memory:expand', this.handleExpansionRequest.bind(this));
        await this.loadExistingMemoryStates();
        console.log('[MemoryTemperature] Initialized with config:', this.config);
    }
    async onShutdown() {
        await this.persistAllMemoryStates();
        this.memoryCache.clear();
        console.log('[MemoryTemperature] Shut down gracefully');
    }
    async processEntityAccess(entityId, entityType) {
        return this.measureOperation('processEntityAccess', async () => {
            const entity = await this.getOrLoadEntity(entityId, entityType);
            const newTemperature = this.calculateTemperature(entity.lastAccessed);
            if (newTemperature !== entity.temperature) {
                await this.transitionTemperature(entity, newTemperature);
            }
            entity.lastAccessed = new Date();
            entity.accessCount++;
            await this.persistEntity(entity);
        });
    }
    async compressEntity(entityId, targetTemperature, entityType) {
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
            const result = {
                compressedData,
                originalTokenCount,
                compressedTokenCount,
                compressionRatio,
                temperature: targetTemperature
            };
            entity.temperature = targetTemperature;
            entity.compressedData = compressedData;
            entity.compressionRatio = compressionRatio;
            entity.tokenCount = compressedTokenCount;
            await this.persistEntity(entity);
            this.eventBus.emit('memory:compressed', {
                entityId,
                result
            });
            return result;
        });
    }
    async expandEntity(entityId) {
        return this.measureOperation('expandEntity', async () => {
            const entity = this.memoryCache.get(entityId);
            if (!entity) {
                throw new Error(`Entity not found: ${entityId}`);
            }
            if (entity.temperature === 'hot') {
                return entity.data;
            }
            const expandedData = await this.expandCompressedData(entity);
            await this.transitionTemperature(entity, 'hot');
            return expandedData;
        });
    }
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
        const entities = Array.from(this.memoryCache.values());
        const originalTokens = entities
            .reduce((sum, entity) => sum + (entity.tokenCount / (entity.compressionRatio || 1)), 0);
        const currentTokens = entities
            .reduce((sum, entity) => sum + entity.tokenCount, 0);
        stats.totalTokenReduction = originalTokens > 0 ?
            ((originalTokens - currentTokens) / originalTokens) * 100 : 0;
        return stats;
    }
    initializeCompressionStrategies() {
        this.compressionStrategies.set('warm', (data) => this.compressWarm(data));
        this.compressionStrategies.set('cool', (data) => this.compressCool(data));
        this.compressionStrategies.set('cold', (data) => this.compressCold(data));
        this.compressionStrategies.set('frozen', (data) => this.compressFrozen(data));
    }
    calculateTemperature(lastAccessed) {
        const hoursSinceAccess = (Date.now() - lastAccessed.getTime()) / (1000 * 60 * 60);
        if (hoursSinceAccess < this.config.hotToWarm)
            return 'hot';
        if (hoursSinceAccess < this.config.warmToCool)
            return 'warm';
        if (hoursSinceAccess < this.config.coolToCold * 24)
            return 'cool';
        if (hoursSinceAccess < this.config.coldToFrozen * 24)
            return 'cold';
        return 'frozen';
    }
    async transitionTemperature(entity, newTemperature) {
        const oldTemperature = entity.temperature;
        if (oldTemperature === newTemperature)
            return;
        console.log(`[MemoryTemperature] Transitioning ${entity.type}:${entity.id} from ${oldTemperature} to ${newTemperature}`);
        if (this.getTemperatureLevel(newTemperature) < this.getTemperatureLevel(oldTemperature)) {
            await this.compressEntity(entity.id, newTemperature);
        }
        else {
            await this.expandEntity(entity.id);
        }
        entity.temperature = newTemperature;
        this.eventBus.emit('memory:temperature_changed', {
            entityId: entity.id,
            entityType: entity.type,
            oldTemperature,
            newTemperature
        });
    }
    getTemperatureLevel(temperature) {
        const levels = { hot: 5, warm: 4, cool: 3, cold: 2, frozen: 1 };
        return levels[temperature];
    }
    compressWarm(data) {
        if (typeof data === 'string') {
            return data.substring(0, Math.floor(data.length * this.config.compressionLevels.warm));
        }
        if (typeof data === 'object') {
            const compressed = { ...data };
            delete compressed.description;
            delete compressed.flavorText;
            return compressed;
        }
        return data;
    }
    compressCool(data) {
        if (typeof data === 'string') {
            const sentences = data.split(/[.!?]+/).filter(s => s.trim().length > 0);
            return sentences.slice(0, 3).join('. ') + '.';
        }
        if (typeof data === 'object' && data !== null) {
            const essential = ['id', 'name', 'level', 'status', 'location'];
            const compressed = {};
            const dataObj = data;
            for (const key of essential) {
                if (dataObj[key] !== undefined) {
                    compressed[key] = dataObj[key];
                }
            }
            return compressed;
        }
        return data;
    }
    compressCold(data) {
        if (typeof data === 'string') {
            const words = data.split(/\s+/).filter(w => w.length > 0);
            return words.slice(0, 8).join(' ') + '...';
        }
        if (typeof data === 'object' && data !== null) {
            return {
                id: data.id,
                lvl: data.level,
                cls: data.class,
                loc: data.current_location_id || data.location,
                st: data.status
            };
        }
        return data;
    }
    compressFrozen(data) {
        if (typeof data === 'string') {
            const words = data.split(/\s+/).filter(w => w.length > 0);
            return words.slice(0, 3).join(' ') + '...';
        }
        if (typeof data === 'object' && data !== null) {
            return {
                id: data.id,
                l: data.level,
                c: data.class,
                s: data.status
            };
        }
        return data;
    }
    async expandCompressedData(entity) {
        return entity.compressedData || entity.data;
    }
    estimateTokenCount(data) {
        const jsonString = JSON.stringify(data);
        return Math.ceil(jsonString.length / 4);
    }
    async getOrLoadEntity(entityId, entityType) {
        let entity = this.memoryCache.get(entityId);
        if (!entity) {
            entity = await this.loadEntityFromDatabase(entityId, entityType);
            this.memoryCache.set(entityId, entity);
        }
        return entity;
    }
    async loadEntityFromDatabase(entityId, entityType) {
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
    async persistEntity(entity) {
        this.memoryCache.set(entity.id, entity);
    }
    async loadExistingMemoryStates() {
    }
    async persistAllMemoryStates() {
    }
    async handleCharacterAccess(data) {
        await this.processEntityAccess(data.characterId, 'character');
    }
    async handleLocationAccess(data) {
        await this.processEntityAccess(data.locationId, 'location');
    }
    async handleCompressionRequest(data) {
        await this.compressEntity(data.entityId, data.targetTemperature);
    }
    async handleExpansionRequest(data) {
        await this.expandEntity(data.entityId);
    }
}
exports.MemoryTemperatureService = MemoryTemperatureService;
exports.memoryTemperatureService = new MemoryTemperatureService();
