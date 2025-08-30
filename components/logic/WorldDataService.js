"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorldDataService = void 0;
const BaseService_1 = require("../../services/BaseService");
class WorldDataService extends BaseService_1.BaseService {
    constructor(config) {
        super('WorldDataService', config);
        this.cache = new Map();
        this.config = config;
    }
    async onInitialize() {
        this.eventBus.on('world:data-parsed', this.handleDataParsed.bind(this));
        this.eventBus.on('world:query-spatial', this.handleSpatialQuery.bind(this));
        this.eventBus.on('world:get-statistics', this.handleGetStatistics.bind(this));
        console.log('[WorldDataService] Initialized for campaign:', this.config.campaignId);
    }
    async onShutdown() {
        this.eventBus.off('world:data-parsed', this.handleDataParsed.bind(this));
        this.eventBus.off('world:query-spatial', this.handleSpatialQuery.bind(this));
        this.eventBus.off('world:get-statistics', this.handleGetStatistics.bind(this));
        this.cache.clear();
        console.log('[WorldDataService] Shut down');
    }
    async importWorldData(worldData) {
        return this.measureOperation('importWorldData', async () => {
            const startTime = Date.now();
            try {
                await this.clearExistingData();
                await this.importRegions(worldData.regions);
                await this.importSettlements(worldData.settlements);
                await this.importCultures(worldData.cultures);
                await this.importReligions(worldData.religions);
                await this.importRivers(worldData.rivers);
                await this.importRoutes(worldData.routes);
                if (this.config.enableSpatialIndexing) {
                    await this.createSpatialIndexes();
                }
                await this.refreshMaterializedViews();
                const duration = Date.now() - startTime;
                console.log(`[WorldDataService] World data imported in ${duration}ms`);
                await this.eventBus.emit('world:data-imported', {
                    campaignId: this.config.campaignId,
                    statistics: await this.getWorldStatistics(),
                    importTime: duration
                });
            }
            catch (error) {
                console.error('[WorldDataService] Failed to import world data:', error);
                await this.eventBus.emit('world:import-error', {
                    campaignId: this.config.campaignId,
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
                throw error;
            }
        });
    }
    async clearExistingData() {
        console.log('[WorldDataService] Clearing existing world data');
        this.cache.clear();
    }
    async importRegions(regions) {
        const batches = this.createBatches(regions, this.config.batchSize);
        for (const batch of batches) {
            await this.importRegionBatch(batch);
        }
        console.log(`[WorldDataService] Imported ${regions.length} regions`);
    }
    async importSettlements(settlements) {
        const batches = this.createBatches(settlements, this.config.batchSize);
        for (const batch of batches) {
            await this.importSettlementBatch(batch);
        }
        console.log(`[WorldDataService] Imported ${settlements.length} settlements`);
    }
    async importCultures(cultures) {
        const batches = this.createBatches(cultures, this.config.batchSize);
        for (const batch of batches) {
            await this.importCultureBatch(batch);
        }
        console.log(`[WorldDataService] Imported ${cultures.length} cultures`);
    }
    async importReligions(religions) {
        const batches = this.createBatches(religions, this.config.batchSize);
        for (const batch of batches) {
            await this.importReligionBatch(batch);
        }
        console.log(`[WorldDataService] Imported ${religions.length} religions`);
    }
    async importRivers(rivers) {
        const batches = this.createBatches(rivers, this.config.batchSize);
        for (const batch of batches) {
            await this.importRiverBatch(batch);
        }
        console.log(`[WorldDataService] Imported ${rivers.length} rivers`);
    }
    async importRoutes(routes) {
        const batches = this.createBatches(routes, this.config.batchSize);
        for (const batch of batches) {
            await this.importRouteBatch(batch);
        }
        console.log(`[WorldDataService] Imported ${routes.length} routes`);
    }
    createBatches(items, batchSize) {
        const batches = [];
        for (let i = 0; i < items.length; i += batchSize) {
            batches.push(items.slice(i, i + batchSize));
        }
        return batches;
    }
    async importRegionBatch(batch) {
        for (const region of batch) {
            await this.insertRegion(region);
        }
    }
    async importSettlementBatch(batch) {
        for (const settlement of batch) {
            await this.insertSettlement(settlement);
        }
    }
    async importCultureBatch(batch) {
        for (const culture of batch) {
            await this.insertCulture(culture);
        }
    }
    async importReligionBatch(batch) {
        for (const religion of batch) {
            await this.insertReligion(religion);
        }
    }
    async importRiverBatch(batch) {
        for (const river of batch) {
            await this.insertRiver(river);
        }
    }
    async importRouteBatch(batch) {
        for (const route of batch) {
            await this.insertRoute(route);
        }
    }
    async insertRegion(region) {
        const query = `
      INSERT INTO world_regions (
        id, campaign_id, name, type, boundary, center_point,
        culture, government, population, properties, created_at
      ) VALUES ($1, $2, $3, $4, ST_GeomFromGeoJSON($5), ST_GeomFromGeoJSON($6), $7, $8, $9, $10, NOW())
    `;
        this.cache.set(`region:${region.id}`, region);
    }
    async insertSettlement(settlement) {
        const query = `
      INSERT INTO world_settlements (
        id, campaign_id, region_id, name, type, coordinates,
        population, size_category, economy_type, properties, created_at
      ) VALUES ($1, $2, $3, $4, $5, ST_GeomFromGeoJSON($6), $7, $8, $9, $10, NOW())
    `;
        this.cache.set(`settlement:${settlement.id}`, settlement);
    }
    async insertCulture(culture) {
        const query = `
      INSERT INTO world_cultures (
        id, campaign_id, name, type, color, properties, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
    `;
        this.cache.set(`culture:${culture.id}`, culture);
    }
    async insertReligion(religion) {
        const query = `
      INSERT INTO world_religions (
        id, campaign_id, name, type, culture, color, properties, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    `;
        this.cache.set(`religion:${religion.id}`, religion);
    }
    async insertRiver(river) {
        const query = `
      INSERT INTO world_rivers (
        id, campaign_id, name, type, geometry, length, properties, created_at
      ) VALUES ($1, $2, $3, $4, ST_GeomFromGeoJSON($5), $6, $7, NOW())
    `;
        this.cache.set(`river:${river.id}`, river);
    }
    async insertRoute(route) {
        const query = `
      INSERT INTO world_routes (
        id, campaign_id, type, geometry, length, properties, created_at
      ) VALUES ($1, $2, $3, ST_GeomFromGeoJSON($4), $5, $6, NOW())
    `;
        this.cache.set(`route:${route.id}`, route);
    }
    async createSpatialIndexes() {
        console.log('[WorldDataService] Creating spatial indexes');
    }
    async refreshMaterializedViews() {
        console.log('[WorldDataService] Refreshing materialized views');
    }
    async queryNearbySettlements(query) {
        return this.measureOperation('queryNearbySettlements', async () => {
            const startTime = performance.now();
            const allSettlements = await this.getAllSettlements();
            const results = this.filterSettlementsByQuery(allSettlements, query);
            const queryTime = performance.now() - startTime;
            return {
                results,
                totalCount: results.length,
                queryTime,
                bounds: this.calculateQueryBounds(query)
            };
        });
    }
    async getWorldStatistics() {
        const cacheKey = 'world-statistics';
        if (this.config.enableCaching && this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }
        const regions = await this.getAllRegions();
        const settlements = await this.getAllSettlements();
        const stats = {
            totalRegions: regions.length,
            totalSettlements: settlements.length,
            totalPopulation: settlements.reduce((sum, s) => sum + s.population, 0),
            averageSettlementSize: settlements.length > 0
                ? settlements.reduce((sum, s) => sum + s.population, 0) / settlements.length
                : 0,
            dominantCulture: this.findDominantCulture(regions),
            largestSettlement: this.findLargestSettlement(settlements),
            spatialCoverage: this.calculateSpatialCoverage(regions)
        };
        if (this.config.enableCaching) {
            this.cache.set(cacheKey, stats);
            setTimeout(() => this.cache.delete(cacheKey), this.config.cacheTTL);
        }
        return stats;
    }
    async getAllRegions() {
        return Array.from(this.cache.values()).filter(item => { var _a; return (_a = item.id) === null || _a === void 0 ? void 0 : _a.startsWith('region_'); });
    }
    async getAllSettlements() {
        return Array.from(this.cache.values()).filter(item => { var _a; return (_a = item.id) === null || _a === void 0 ? void 0 : _a.startsWith('settlement_'); });
    }
    filterSettlementsByQuery(settlements, query) {
        return settlements.filter(settlement => {
            var _a, _b, _c, _d, _e;
            const distance = this.calculateDistance(query.center.coordinates, settlement.coordinates.coordinates);
            if (distance > query.radius)
                return false;
            if (((_a = query.filters) === null || _a === void 0 ? void 0 : _a.type) && settlement.type !== query.filters.type)
                return false;
            if (((_c = (_b = query.filters) === null || _b === void 0 ? void 0 : _b.population) === null || _c === void 0 ? void 0 : _c.min) && settlement.population < query.filters.population.min)
                return false;
            if (((_e = (_d = query.filters) === null || _d === void 0 ? void 0 : _d.population) === null || _e === void 0 ? void 0 : _e.max) && settlement.population > query.filters.population.max)
                return false;
            return true;
        }).slice(0, query.limit || 100);
    }
    calculateDistance(point1, point2) {
        const [x1, y1] = point1;
        const [x2, y2] = point2;
        return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
    }
    calculateQueryBounds(query) {
        const [lng, lat] = query.center.coordinates;
        const radiusDegrees = query.radius / 111000;
        return {
            type: 'Polygon',
            coordinates: [[
                    [lng - radiusDegrees, lat - radiusDegrees],
                    [lng + radiusDegrees, lat - radiusDegrees],
                    [lng + radiusDegrees, lat + radiusDegrees],
                    [lng - radiusDegrees, lat + radiusDegrees],
                    [lng - radiusDegrees, lat - radiusDegrees]
                ]]
        };
    }
    findDominantCulture(regions) {
        var _a;
        const cultureCount = regions.reduce((acc, region) => {
            acc[region.culture] = (acc[region.culture] || 0) + 1;
            return acc;
        }, {});
        return ((_a = Object.entries(cultureCount)
            .sort(([, a], [, b]) => b - a)[0]) === null || _a === void 0 ? void 0 : _a[0]) || 'Unknown';
    }
    findLargestSettlement(settlements) {
        if (settlements.length === 0) {
            return { name: 'None', population: 0 };
        }
        const largest = settlements.reduce((max, settlement) => settlement.population > max.population ? { name: settlement.name, population: settlement.population } : max, { name: settlements[0].name, population: settlements[0].population });
        return largest;
    }
    calculateSpatialCoverage(regions) {
        if (regions.length === 0) {
            return { type: 'Polygon', coordinates: [[]] };
        }
        return regions[0].boundary;
    }
    async handleDataParsed(data) {
        if (data.campaignId === this.config.campaignId) {
            await this.importWorldData(data.data);
        }
    }
    async handleSpatialQuery(data) {
        try {
            let results;
            switch (data.type) {
                case 'settlements':
                    results = await this.queryNearbySettlements(data.query);
                    break;
                default:
                    throw new Error(`Unknown spatial query type: ${data.type}`);
            }
            await this.eventBus.emit('world:spatial-query-result', {
                query: data.query,
                type: data.type,
                results
            });
        }
        catch (error) {
            await this.eventBus.emit('world:spatial-query-error', {
                query: data.query,
                type: data.type,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
    async handleGetStatistics(data) {
        if (data.campaignId === this.config.campaignId) {
            const statistics = await this.getWorldStatistics();
            await this.eventBus.emit('world:statistics-result', {
                campaignId: data.campaignId,
                statistics
            });
        }
    }
}
exports.WorldDataService = WorldDataService;
