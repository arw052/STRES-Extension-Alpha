/**
 * WorldIntegrationService - Main orchestrator for world integration
 *
 * Coordinates AzgaarParserService, WorldDataService, NPCPlacementService, and TradeRouteService
 * Provides unified interface for world data management and NPC placement
 */

import { BaseService } from '../../services/BaseService';
import { AzgaarParserService, ParsedWorldData, ParsedSettlement, NPCProfile } from './AzgaarParserService';
import { WorldDataService, WorldDataConfig, SpatialQuery, SpatialQueryResult } from './WorldDataService';
import { NPCPlacementService, NPCPlacementConfig, PlacementResult } from './NPCPlacementService';
import { TradeRouteService, TradeRouteConfig, TradeRoute, Caravan } from './TradeRouteService';

export interface WorldIntegrationConfig {
  campaignId: string;
  azgaarParser: Partial<any>;
  worldData: WorldDataConfig;
  npcPlacement: NPCPlacementConfig;
  tradeRoutes: TradeRouteConfig;
  enableFullIntegration: boolean;
  importBatchSize: number;
  enableCaching: boolean;
}

export interface WorldImportResult {
  success: boolean;
  parsedData: ParsedWorldData;
  importTime: number;
  statistics: {
    settlements: number;
    regions: number;
    cultures: number;
    religions: number;
    rivers: number;
    routes: number;
  };
  errors: string[];
  warnings: string[];
}

export interface NPCIntegrationResult {
  totalNPCs: number;
  placedNPCs: number;
  placementResults: PlacementResult[];
  unplacedNPCs: NPCProfile[];
  integrationTime: number;
  statistics: {
    optimalPlacements: number;
    acceptablePlacements: number;
    fallbackPlacements: number;
    averageScore: number;
  };
}

export interface WorldState {
  campaignId: string;
  isInitialized: boolean;
  lastImport: string | null;
  totalSettlements: number;
  totalNPCs: number;
  activeTradeRoutes: number;
  economicHealth: number;
  integrationHealth: {
    parser: boolean;
    data: boolean;
    placement: boolean;
    trade: boolean;
  };
}

export class WorldIntegrationService extends BaseService {
  private config: WorldIntegrationConfig;
  private azgaarParser: AzgaarParserService;
  private worldData: WorldDataService;
  private npcPlacement: NPCPlacementService;
  private tradeRoutes: TradeRouteService;

  private worldState: WorldState;
  private parsedWorldData: ParsedWorldData | null = null;

  constructor(config: WorldIntegrationConfig) {
    super('WorldIntegrationService', config);
    this.config = config;

    // Initialize services
    this.azgaarParser = new AzgaarParserService(config.azgaarParser);
    this.worldData = new WorldDataService(config.worldData);
    this.npcPlacement = new NPCPlacementService(config.npcPlacement);
    this.tradeRoutes = new TradeRouteService(config.tradeRoutes);

    // Initialize world state
    this.worldState = {
      campaignId: config.campaignId,
      isInitialized: false,
      lastImport: null,
      totalSettlements: 0,
      totalNPCs: 0,
      activeTradeRoutes: 0,
      economicHealth: 0,
      integrationHealth: {
        parser: false,
        data: false,
        placement: false,
        trade: false
      }
    };
  }

  protected async onInitialize(): Promise<void> {
    console.log('[WorldIntegrationService] Initializing world integration...');

    try {
      // Initialize all services
      await this.azgaarParser.initialize();
      await this.worldData.initialize();
      await this.npcPlacement.initialize();
      await this.tradeRoutes.initialize();

      // Register event listeners
      this.setupEventListeners();

      // Update integration health
      this.updateIntegrationHealth();

      console.log('[WorldIntegrationService] World integration initialized successfully');

    } catch (error) {
      console.error('[WorldIntegrationService] Failed to initialize:', error);
      throw error;
    }
  }

  protected async onShutdown(): Promise<void> {
    console.log('[WorldIntegrationService] Shutting down world integration...');

    // Shutdown all services
    await this.azgaarParser.shutdown();
    await this.worldData.shutdown();
    await this.npcPlacement.shutdown();
    await this.tradeRoutes.shutdown();

    console.log('[WorldIntegrationService] World integration shut down');
  }

  /**
   * Import and integrate a complete world from Azgaar map file
   */
  async importWorldFromAzgaar(mapData: string): Promise<WorldImportResult> {
    return this.measureOperation('importWorldFromAzgaar', async () => {
      const startTime = Date.now();
      const errors: string[] = [];
      const warnings: string[] = [];

      console.log('[WorldIntegrationService] Starting world import from Azgaar map');

      try {
        // Step 1: Parse the map file
        console.log('[WorldIntegrationService] Parsing Azgaar map file...');
        const parsedData = await this.azgaarParser.parseMapFile(mapData);

        // Step 2: Validate parsed data
        const validation = this.validateParsedData(parsedData);
        errors.push(...validation.errors);
        warnings.push(...validation.warnings);

        // Step 3: Import world data
        console.log('[WorldIntegrationService] Importing world data...');
        await this.worldData.importWorldData(parsedData);

        // Step 4: Generate trade routes
        console.log('[WorldIntegrationService] Generating trade routes...');
        await this.tradeRoutes.generateTradeRoutes(parsedData.settlements, parsedData.routes);

        // Store parsed data
        this.parsedWorldData = parsedData;

        // Update world state
        this.updateWorldState(parsedData);

        const importTime = Date.now() - startTime;

        const result: WorldImportResult = {
          success: errors.length === 0,
          parsedData,
          importTime,
          statistics: {
            settlements: parsedData.settlements.length,
            regions: parsedData.regions.length,
            cultures: parsedData.cultures.length,
            religions: parsedData.religions.length,
            rivers: parsedData.rivers.length,
            routes: parsedData.routes.length
          },
          errors,
          warnings
        };

        console.log(`[WorldIntegrationService] World import completed in ${importTime}ms`);
        console.log(`[WorldIntegrationService] Imported ${result.statistics.settlements} settlements, ${result.statistics.regions} regions`);

        // Emit completion event
        await this.eventBus.emit('world:import-complete', {
          campaignId: this.config.campaignId,
          result
        });

        return result;

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error during world import';
        console.error('[WorldIntegrationService] World import failed:', errorMessage);
        errors.push(errorMessage);

        await this.eventBus.emit('world:import-error', {
          campaignId: this.config.campaignId,
          error: errorMessage
        });

        return {
          success: false,
          parsedData: {} as ParsedWorldData,
          importTime: Date.now() - startTime,
          statistics: { settlements: 0, regions: 0, cultures: 0, religions: 0, rivers: 0, routes: 0 },
          errors,
          warnings
        };
      }
    });
  }

  /**
   * Integrate NPCs into the world
   */
  async integrateNPCsIntoWorld(npcs: NPCProfile[]): Promise<NPCIntegrationResult> {
    return this.measureOperation('integrateNPCsIntoWorld', async () => {
      const startTime = Date.now();

      if (!this.parsedWorldData) {
        throw new Error('World data must be imported before integrating NPCs');
      }

      console.log(`[WorldIntegrationService] Integrating ${npcs.length} NPCs into world`);

      try {
        // Place NPCs in settlements
        const placementResults = await this.npcPlacement.assignNPCsToWorld(
          npcs,
          this.parsedWorldData.settlements
        );

        // Categorize results
        const optimalPlacements = placementResults.filter(r => r.placementType === 'optimal').length;
        const acceptablePlacements = placementResults.filter(r => r.placementType === 'acceptable').length;
        const fallbackPlacements = placementResults.filter(r => r.placementType === 'fallback').length;
        const averageScore = placementResults.reduce((sum, r) => sum + r.score, 0) / placementResults.length;

        // Identify unplaced NPCs (those with very low scores or errors)
        const unplacedNPCs = npcs.filter(npc =>
          !placementResults.some(result => result.npcId === npc.id) ||
          placementResults.find(result => result.npcId === npc.id)?.score < 30
        );

        const result: NPCIntegrationResult = {
          totalNPCs: npcs.length,
          placedNPCs: placementResults.length - unplacedNPCs.length,
          placementResults,
          unplacedNPCs,
          integrationTime: Date.now() - startTime,
          statistics: {
            optimalPlacements,
            acceptablePlacements,
            fallbackPlacements,
            averageScore: Math.round(averageScore * 100) / 100
          }
        };

        // Update world state
        this.worldState.totalNPCs = result.placedNPCs;

        console.log(`[WorldIntegrationService] NPC integration completed: ${result.placedNPCs}/${result.totalNPCs} placed`);

        // Emit completion event
        await this.eventBus.emit('world:npc-integration-complete', {
          campaignId: this.config.campaignId,
          result
        });

        return result;

      } catch (error) {
        console.error('[WorldIntegrationService] NPC integration failed:', error);
        await this.eventBus.emit('world:npc-integration-error', {
          campaignId: this.config.campaignId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        throw error;
      }
    });
  }

  /**
   * Query spatial data from the world
   */
  async querySpatialData(query: SpatialQuery, type: 'settlements' | 'regions' | 'npcs'): Promise<SpatialQueryResult<any>> {
    return this.measureOperation('querySpatialData', async () => {
      switch (type) {
        case 'settlements':
          return await this.worldData.queryNearbySettlements(query);
        case 'regions':
          // Would implement region spatial queries
          throw new Error('Region spatial queries not yet implemented');
        case 'npcs':
          // Would implement NPC spatial queries
          throw new Error('NPC spatial queries not yet implemented');
        default:
          throw new Error(`Unknown spatial query type: ${type}`);
      }
    });
  }

  /**
   * Get current world state
   */
  getWorldState(): WorldState {
    return { ...this.worldState };
  }

  /**
   * Get world statistics
   */
  async getWorldStatistics(): Promise<any> {
    if (!this.parsedWorldData) {
      throw new Error('World data not yet imported');
    }

    const dataStats = await this.worldData.getWorldStatistics();

    return {
      ...dataStats,
      npcIntegration: {
        totalNPCs: this.worldState.totalNPCs,
        integrationComplete: this.worldState.totalNPCs > 0
      },
      tradeRoutes: {
        activeRoutes: this.worldState.activeTradeRoutes
      },
      integrationHealth: this.worldState.integrationHealth
    };
  }

  /**
   * Create a caravan between settlements
   */
  async createCaravan(fromSettlementId: string, toSettlementId: string, goods: Record<string, number>): Promise<Caravan> {
    return await this.tradeRoutes.createCaravan(fromSettlementId, toSettlementId, goods);
  }

  /**
   * Find optimal location for a specific NPC
   */
  async findNPCLocation(npc: NPCProfile): Promise<PlacementResult | null> {
    if (!this.parsedWorldData) {
      throw new Error('World data must be imported before finding NPC locations');
    }

    return await this.npcPlacement.findOptimalLocation(npc, this.parsedWorldData.settlements);
  }

  /**
   * Export world data for backup or transfer
   */
  async exportWorldData(): Promise<ParsedWorldData> {
    if (!this.parsedWorldData) {
      throw new Error('No world data available to export');
    }

    return { ...this.parsedWorldData };
  }

  /**
   * Validate parsed world data
   */
  private validateParsedData(data: ParsedWorldData): { errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (data.settlements.length === 0) {
      errors.push('No settlements found in parsed data');
    }

    if (data.regions.length === 0) {
      warnings.push('No regions found - world may be incomplete');
    }

    if (data.settlements.length > 10000) {
      warnings.push('Large number of settlements may impact performance');
    }

    // Check for coordinate consistency
    const invalidCoords = data.settlements.filter(s => {
      const coords = s.coordinates.coordinates as [number, number];
      return coords[0] < -180 || coords[0] > 180 || coords[1] < -90 || coords[1] > 90;
    });

    if (invalidCoords.length > 0) {
      warnings.push(`${invalidCoords.length} settlements have invalid coordinates`);
    }

    return { errors, warnings };
  }

  /**
   * Update world state after successful import
   */
  private updateWorldState(parsedData: ParsedWorldData): void {
    this.worldState.isInitialized = true;
    this.worldState.lastImport = new Date().toISOString();
    this.worldState.totalSettlements = parsedData.settlements.length;
    this.updateIntegrationHealth();
  }

  /**
   * Update integration health status
   */
  private updateIntegrationHealth(): void {
    this.worldState.integrationHealth = {
      parser: this.azgaarParser.getHealthStatus().isInitialized,
      data: this.worldData.getHealthStatus().isInitialized,
      placement: this.npcPlacement.getHealthStatus().isInitialized,
      trade: this.tradeRoutes.getHealthStatus().isInitialized
    };
  }

  /**
   * Setup event listeners for inter-service communication
   */
  private setupEventListeners(): void {
    // Listen for data parsed events
    this.eventBus.on('world:data-parsed', async (data) => {
      console.log('[WorldIntegrationService] World data parsed event received');
    });

    // Listen for NPCs assigned events
    this.eventBus.on('world:npcs-assigned', async (data) => {
      console.log(`[WorldIntegrationService] ${data.totalNPCs} NPCs assigned to world`);
    });

    // Listen for trade routes generated events
    this.eventBus.on('world:trade-routes-generated', async (data) => {
      this.worldState.activeTradeRoutes = data.routes.length;
      console.log(`[WorldIntegrationService] ${data.routes.length} trade routes generated`);
    });

    // Listen for service health updates
    this.eventBus.on('service:health-update', async () => {
      this.updateIntegrationHealth();
    });
  }

  /**
   * Get service health status
   */
  getHealthStatus(): any {
    return {
      ...super.getHealthStatus(),
      worldState: this.worldState,
      services: {
        parser: this.azgaarParser.getHealthStatus(),
        data: this.worldData.getHealthStatus(),
        placement: this.npcPlacement.getHealthStatus(),
        trade: this.tradeRoutes.getHealthStatus()
      },
      worldDataLoaded: this.parsedWorldData !== null
    };
  }

  /**
   * Perform full world integration test
   */
  async performIntegrationTest(): Promise<any> {
    console.log('[WorldIntegrationService] Performing integration test...');

    const testResults = {
      servicesInitialized: false,
      worldDataImported: false,
      npcPlacementWorking: false,
      tradeRoutesWorking: false,
      spatialQueriesWorking: false,
      errors: [] as string[],
      performance: {} as Record<string, number>
    };

    try {
      // Test 1: Check all services are initialized
      testResults.servicesInitialized = this.worldState.integrationHealth.parser &&
                                      this.worldState.integrationHealth.data &&
                                      this.worldState.integrationHealth.placement &&
                                      this.worldState.integrationHealth.trade;

      // Test 2: Check world data is loaded
      testResults.worldDataImported = this.parsedWorldData !== null;

      if (testResults.worldDataImported && this.parsedWorldData) {
        // Test 3: Test NPC placement
        const testNPC: NPCProfile = {
          id: 'test-npc',
          name: 'Test NPC',
          level: 5,
          profession: 'Blacksmith',
          culture: 'TestCulture',
          personality: ['Friendly'],
          goals: ['Make good weapons'],
          relationships: [],
          interactionPriority: 5
        };

        const startTime = performance.now();
        const placement = await this.findNPCLocation(testNPC);
        testResults.performance.npcPlacement = performance.now() - startTime;
        testResults.npcPlacementWorking = placement !== null;

        // Test 4: Test spatial query
        const query: SpatialQuery = {
          center: { type: 'Point', coordinates: [0, 0] },
          radius: 1000,
          limit: 10
        };

        const spatialStart = performance.now();
        await this.querySpatialData(query, 'settlements');
        testResults.performance.spatialQuery = performance.now() - spatialStart;
        testResults.spatialQueriesWorking = true;

        // Test 5: Test trade route generation
        const tradeStart = performance.now();
        await this.tradeRoutes.generateTradeRoutes(this.parsedWorldData.settlements);
        testResults.performance.tradeRouteGeneration = performance.now() - tradeStart;
        testResults.tradeRoutesWorking = true;
      }

    } catch (error) {
      testResults.errors.push(error instanceof Error ? error.message : 'Unknown test error');
    }

    console.log('[WorldIntegrationService] Integration test completed:', testResults);
    return testResults;
  }
}
