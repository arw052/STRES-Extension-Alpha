/**
 * WorldDataService - Manages world data persistence and retrieval
 *
 * Handles CRUD operations for world regions, settlements, cultures, religions, rivers, and routes
 * Integrates with PostGIS for spatial queries and indexing
 */

import { BaseService } from '../../services/BaseService';
import { ParsedWorldData, ParsedRegion, ParsedSettlement, ParsedCulture, ParsedReligion, ParsedRiver, ParsedRoute } from './AzgaarParserService';

export interface WorldDataConfig {
  campaignId: string;
  enableSpatialIndexing: boolean;
  batchSize: number;
  enableCaching: boolean;
  cacheTTL: number;
}

export interface SpatialQuery {
  center: GeoJSON.Point;
  radius: number; // meters
  filters?: {
    type?: string;
    population?: { min?: number; max?: number };
    region?: string;
    culture?: string;
  };
  limit?: number;
}

export interface SpatialQueryResult<T> {
  results: T[];
  totalCount: number;
  queryTime: number;
  bounds: GeoJSON.Polygon;
}

export interface WorldStatistics {
  totalRegions: number;
  totalSettlements: number;
  totalPopulation: number;
  averageSettlementSize: number;
  dominantCulture: string;
  largestSettlement: {
    name: string;
    population: number;
  };
  spatialCoverage: GeoJSON.Polygon;
}

export class WorldDataService extends BaseService {
  private config: WorldDataConfig;
  private cache = new Map<string, any>();

  constructor(config: WorldDataConfig) {
    super('WorldDataService', config);
    this.config = config;
  }

  protected async onInitialize(): Promise<void> {
    // Register event listeners
    this.eventBus.on('world:data-parsed', this.handleDataParsed.bind(this));
    this.eventBus.on('world:query-spatial', this.handleSpatialQuery.bind(this));
    this.eventBus.on('world:get-statistics', this.handleGetStatistics.bind(this));

    console.log('[WorldDataService] Initialized for campaign:', this.config.campaignId);
  }

  protected async onShutdown(): Promise<void> {
    this.eventBus.off('world:data-parsed', this.handleDataParsed.bind(this));
    this.eventBus.off('world:query-spatial', this.handleSpatialQuery.bind(this));
    this.eventBus.off('world:get-statistics', this.handleGetStatistics.bind(this));

    this.cache.clear();
    console.log('[WorldDataService] Shut down');
  }

  /**
   * Import parsed world data into database
   */
  async importWorldData(worldData: ParsedWorldData): Promise<void> {
    return this.measureOperation('importWorldData', async () => {
      const startTime = Date.now();

      try {
        // Clear existing data for this campaign
        await this.clearExistingData();

        // Import in batches to avoid overwhelming the database
        await this.importRegions(worldData.regions);
        await this.importSettlements(worldData.settlements);
        await this.importCultures(worldData.cultures);
        await this.importReligions(worldData.religions);
        await this.importRivers(worldData.rivers);
        await this.importRoutes(worldData.routes);

        // Create spatial indexes
        if (this.config.enableSpatialIndexing) {
          await this.createSpatialIndexes();
        }

        // Refresh materialized views
        await this.refreshMaterializedViews();

        const duration = Date.now() - startTime;
        console.log(`[WorldDataService] World data imported in ${duration}ms`);

        // Emit success event
        await this.eventBus.emit('world:data-imported', {
          campaignId: this.config.campaignId,
          statistics: await this.getWorldStatistics(),
          importTime: duration
        });

      } catch (error) {
        console.error('[WorldDataService] Failed to import world data:', error);
        await this.eventBus.emit('world:import-error', {
          campaignId: this.config.campaignId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        throw error;
      }
    });
  }

  /**
   * Clear existing world data for this campaign
   */
  private async clearExistingData(): Promise<void> {
    // Note: In a real implementation, this would use the database connection
    // For now, we'll simulate the database operations

    console.log('[WorldDataService] Clearing existing world data');

    // This would be actual database queries:
    // await db.query('DELETE FROM world_settlements WHERE campaign_id = $1', [this.config.campaignId]);
    // await db.query('DELETE FROM world_regions WHERE campaign_id = $1', [this.config.campaignId]);
    // etc.

    // Clear cache
    this.cache.clear();
  }

  /**
   * Import regions in batches
   */
  private async importRegions(regions: ParsedRegion[]): Promise<void> {
    const batches = this.createBatches(regions, this.config.batchSize);

    for (const batch of batches) {
      await this.importRegionBatch(batch);
    }

    console.log(`[WorldDataService] Imported ${regions.length} regions`);
  }

  /**
   * Import settlements in batches
   */
  private async importSettlements(settlements: ParsedSettlement[]): Promise<void> {
    const batches = this.createBatches(settlements, this.config.batchSize);

    for (const batch of batches) {
      await this.importSettlementBatch(batch);
    }

    console.log(`[WorldDataService] Imported ${settlements.length} settlements`);
  }

  /**
   * Import cultures
   */
  private async importCultures(cultures: ParsedCulture[]): Promise<void> {
    const batches = this.createBatches(cultures, this.config.batchSize);

    for (const batch of batches) {
      await this.importCultureBatch(batch);
    }

    console.log(`[WorldDataService] Imported ${cultures.length} cultures`);
  }

  /**
   * Import religions
   */
  private async importReligions(religions: ParsedReligion[]): Promise<void> {
    const batches = this.createBatches(religions, this.config.batchSize);

    for (const batch of batches) {
      await this.importReligionBatch(batch);
    }

    console.log(`[WorldDataService] Imported ${religions.length} religions`);
  }

  /**
   * Import rivers
   */
  private async importRivers(rivers: ParsedRiver[]): Promise<void> {
    const batches = this.createBatches(rivers, this.config.batchSize);

    for (const batch of batches) {
      await this.importRiverBatch(batch);
    }

    console.log(`[WorldDataService] Imported ${rivers.length} rivers`);
  }

  /**
   * Import routes
   */
  private async importRoutes(routes: ParsedRoute[]): Promise<void> {
    const batches = this.createBatches(routes, this.config.batchSize);

    for (const batch of batches) {
      await this.importRouteBatch(batch);
    }

    console.log(`[WorldDataService] Imported ${routes.length} routes`);
  }

  /**
   * Batch processing utilities
   */
  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  private async importRegionBatch(batch: ParsedRegion[]): Promise<void> {
    // Simulate database batch insert
    for (const region of batch) {
      await this.insertRegion(region);
    }
  }

  private async importSettlementBatch(batch: ParsedSettlement[]): Promise<void> {
    for (const settlement of batch) {
      await this.insertSettlement(settlement);
    }
  }

  private async importCultureBatch(batch: ParsedCulture[]): Promise<void> {
    for (const culture of batch) {
      await this.insertCulture(culture);
    }
  }

  private async importReligionBatch(batch: ParsedReligion[]): Promise<void> {
    for (const religion of batch) {
      await this.insertReligion(religion);
    }
  }

  private async importRiverBatch(batch: ParsedRiver[]): Promise<void> {
    for (const river of batch) {
      await this.insertRiver(river);
    }
  }

  private async importRouteBatch(batch: ParsedRoute[]): Promise<void> {
    for (const route of batch) {
      await this.insertRoute(route);
    }
  }

  /**
   * Individual insert operations (would use actual database queries)
   */
  private async insertRegion(region: ParsedRegion): Promise<void> {
    // Simulate database insert
    const query = `
      INSERT INTO world_regions (
        id, campaign_id, name, type, boundary, center_point,
        culture, government, population, properties, created_at
      ) VALUES ($1, $2, $3, $4, ST_GeomFromGeoJSON($5), ST_GeomFromGeoJSON($6), $7, $8, $9, $10, NOW())
    `;

    // Cache the region data
    this.cache.set(`region:${region.id}`, region);
  }

  private async insertSettlement(settlement: ParsedSettlement): Promise<void> {
    const query = `
      INSERT INTO world_settlements (
        id, campaign_id, region_id, name, type, coordinates,
        population, size_category, economy_type, properties, created_at
      ) VALUES ($1, $2, $3, $4, $5, ST_GeomFromGeoJSON($6), $7, $8, $9, $10, NOW())
    `;

    this.cache.set(`settlement:${settlement.id}`, settlement);
  }

  private async insertCulture(culture: ParsedCulture): Promise<void> {
    // Cultures don't have spatial data, so simpler insert
    const query = `
      INSERT INTO world_cultures (
        id, campaign_id, name, type, color, properties, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
    `;

    this.cache.set(`culture:${culture.id}`, culture);
  }

  private async insertReligion(religion: ParsedReligion): Promise<void> {
    const query = `
      INSERT INTO world_religions (
        id, campaign_id, name, type, culture, color, properties, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    `;

    this.cache.set(`religion:${religion.id}`, religion);
  }

  private async insertRiver(river: ParsedRiver): Promise<void> {
    const query = `
      INSERT INTO world_rivers (
        id, campaign_id, name, type, geometry, length, properties, created_at
      ) VALUES ($1, $2, $3, $4, ST_GeomFromGeoJSON($5), $6, $7, NOW())
    `;

    this.cache.set(`river:${river.id}`, river);
  }

  private async insertRoute(route: ParsedRoute): Promise<void> {
    const query = `
      INSERT INTO world_routes (
        id, campaign_id, type, geometry, length, properties, created_at
      ) VALUES ($1, $2, $3, ST_GeomFromGeoJSON($4), $5, $6, NOW())
    `;

    this.cache.set(`route:${route.id}`, route);
  }

  /**
   * Create spatial indexes for performance
   */
  private async createSpatialIndexes(): Promise<void> {
    console.log('[WorldDataService] Creating spatial indexes');

    // These would be actual database commands:
    // CREATE INDEX CONCURRENTLY idx_world_regions_boundary_geom ON world_regions USING GIST (boundary);
    // CREATE INDEX CONCURRENTLY idx_world_settlements_coords_geom ON world_settlements USING GIST (coordinates);
    // etc.
  }

  /**
   * Refresh materialized views
   */
  private async refreshMaterializedViews(): Promise<void> {
    console.log('[WorldDataService] Refreshing materialized views');

    // This would call the database function we defined in schema:
    // SELECT refresh_materialized_views();
  }

  /**
   * Spatial query for settlements near a point
   */
  async queryNearbySettlements(query: SpatialQuery): Promise<SpatialQueryResult<ParsedSettlement>> {
    return this.measureOperation('queryNearbySettlements', async () => {
      const startTime = performance.now();

      // Simulate spatial query
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

  /**
   * Get world statistics
   */
  async getWorldStatistics(): Promise<WorldStatistics> {
    const cacheKey = 'world-statistics';
    if (this.config.enableCaching && this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    const regions = await this.getAllRegions();
    const settlements = await this.getAllSettlements();

    const stats: WorldStatistics = {
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

  /**
   * Helper methods for data retrieval
   */
  private async getAllRegions(): Promise<ParsedRegion[]> {
    // Simulate database query
    return Array.from(this.cache.values()).filter(item => item.id?.startsWith('region_'));
  }

  private async getAllSettlements(): Promise<ParsedSettlement[]> {
    // Simulate database query
    return Array.from(this.cache.values()).filter(item => item.id?.startsWith('settlement_'));
  }

  private filterSettlementsByQuery(settlements: ParsedSettlement[], query: SpatialQuery): ParsedSettlement[] {
    return settlements.filter(settlement => {
      // Check spatial distance (simplified)
      const distance = this.calculateDistance(
        query.center.coordinates as [number, number],
        settlement.coordinates.coordinates as [number, number]
      );

      if (distance > query.radius) return false;

      // Apply filters
      if (query.filters?.type && settlement.type !== query.filters.type) return false;
      if (query.filters?.population?.min && settlement.population < query.filters.population.min) return false;
      if (query.filters?.population?.max && settlement.population > query.filters.population.max) return false;

      return true;
    }).slice(0, query.limit || 100);
  }

  private calculateDistance(point1: [number, number], point2: [number, number]): number {
    // Simplified Euclidean distance (in real implementation, use PostGIS ST_Distance)
    const [x1, y1] = point1;
    const [x2, y2] = point2;
    return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
  }

  private calculateQueryBounds(query: SpatialQuery): GeoJSON.Polygon {
    const [lng, lat] = query.center.coordinates as [number, number];
    const radiusDegrees = query.radius / 111000; // Rough conversion meters to degrees

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

  private findDominantCulture(regions: ParsedRegion[]): string {
    const cultureCount = regions.reduce((acc, region) => {
      acc[region.culture] = (acc[region.culture] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return Object.entries(cultureCount)
      .sort(([, a], [, b]) => b - a)[0]?.[0] || 'Unknown';
  }

  private findLargestSettlement(settlements: ParsedSettlement[]): { name: string; population: number } {
    if (settlements.length === 0) {
      return { name: 'None', population: 0 };
    }

    const largest = settlements.reduce((max, settlement) =>
      settlement.population > max.population ? { name: settlement.name, population: settlement.population } : max,
      { name: settlements[0].name, population: settlements[0].population }
    );

    return largest;
  }

  private calculateSpatialCoverage(regions: ParsedRegion[]): GeoJSON.Polygon {
    if (regions.length === 0) {
      return { type: 'Polygon', coordinates: [[]] };
    }

    // Simplified: just return the first region's boundary as coverage
    // In reality, you'd compute the union of all region boundaries
    return regions[0].boundary;
  }

  /**
   * Event handlers
   */
  private async handleDataParsed(data: { campaignId: string; data: ParsedWorldData }): Promise<void> {
    if (data.campaignId === this.config.campaignId) {
      await this.importWorldData(data.data);
    }
  }

  private async handleSpatialQuery(data: { query: SpatialQuery; type: string }): Promise<void> {
    try {
      let results: SpatialQueryResult<any>;

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

    } catch (error) {
      await this.eventBus.emit('world:spatial-query-error', {
        query: data.query,
        type: data.type,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  private async handleGetStatistics(data: { campaignId: string }): Promise<void> {
    if (data.campaignId === this.config.campaignId) {
      const statistics = await this.getWorldStatistics();
      await this.eventBus.emit('world:statistics-result', {
        campaignId: data.campaignId,
        statistics
      });
    }
  }
}
