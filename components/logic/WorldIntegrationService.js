"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorldIntegrationService = void 0;
const BaseService_1 = require("../../services/BaseService");
const AzgaarParserService_1 = require("./AzgaarParserService");
const WorldDataService_1 = require("./WorldDataService");
const NPCPlacementService_1 = require("./NPCPlacementService");
const TradeRouteService_1 = require("./TradeRouteService");
class WorldIntegrationService extends BaseService_1.BaseService {
    constructor(config) {
        super('WorldIntegrationService', config);
        this.parsedWorldData = null;
        this.config = config;
        this.azgaarParser = new AzgaarParserService_1.AzgaarParserService(config.azgaarParser);
        this.worldData = new WorldDataService_1.WorldDataService(config.worldData);
        this.npcPlacement = new NPCPlacementService_1.NPCPlacementService(config.npcPlacement);
        this.tradeRoutes = new TradeRouteService_1.TradeRouteService(config.tradeRoutes);
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
    async onInitialize() {
        console.log('[WorldIntegrationService] Initializing world integration...');
        try {
            await this.azgaarParser.initialize();
            await this.worldData.initialize();
            await this.npcPlacement.initialize();
            await this.tradeRoutes.initialize();
            this.setupEventListeners();
            this.updateIntegrationHealth();
            console.log('[WorldIntegrationService] World integration initialized successfully');
        }
        catch (error) {
            console.error('[WorldIntegrationService] Failed to initialize:', error);
            throw error;
        }
    }
    async onShutdown() {
        console.log('[WorldIntegrationService] Shutting down world integration...');
        await this.azgaarParser.shutdown();
        await this.worldData.shutdown();
        await this.npcPlacement.shutdown();
        await this.tradeRoutes.shutdown();
        console.log('[WorldIntegrationService] World integration shut down');
    }
    async importWorldFromAzgaar(mapData) {
        return this.measureOperation('importWorldFromAzgaar', async () => {
            const startTime = Date.now();
            const errors = [];
            const warnings = [];
            console.log('[WorldIntegrationService] Starting world import from Azgaar map');
            try {
                console.log('[WorldIntegrationService] Parsing Azgaar map file...');
                const parsedData = await this.azgaarParser.parseMapFile(mapData);
                const validation = this.validateParsedData(parsedData);
                errors.push(...validation.errors);
                warnings.push(...validation.warnings);
                console.log('[WorldIntegrationService] Importing world data...');
                await this.worldData.importWorldData(parsedData);
                console.log('[WorldIntegrationService] Generating trade routes...');
                await this.tradeRoutes.generateTradeRoutes(parsedData.settlements, parsedData.routes);
                this.parsedWorldData = parsedData;
                this.updateWorldState(parsedData);
                const importTime = Date.now() - startTime;
                const result = {
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
                await this.eventBus.emit('world:import-complete', {
                    campaignId: this.config.campaignId,
                    result
                });
                return result;
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error during world import';
                console.error('[WorldIntegrationService] World import failed:', errorMessage);
                errors.push(errorMessage);
                await this.eventBus.emit('world:import-error', {
                    campaignId: this.config.campaignId,
                    error: errorMessage
                });
                return {
                    success: false,
                    parsedData: {},
                    importTime: Date.now() - startTime,
                    statistics: { settlements: 0, regions: 0, cultures: 0, religions: 0, rivers: 0, routes: 0 },
                    errors,
                    warnings
                };
            }
        });
    }
    async integrateNPCsIntoWorld(npcs) {
        return this.measureOperation('integrateNPCsIntoWorld', async () => {
            const startTime = Date.now();
            if (!this.parsedWorldData) {
                throw new Error('World data must be imported before integrating NPCs');
            }
            console.log(`[WorldIntegrationService] Integrating ${npcs.length} NPCs into world`);
            try {
                const placementResults = await this.npcPlacement.assignNPCsToWorld(npcs, this.parsedWorldData.settlements);
                const optimalPlacements = placementResults.filter(r => r.placementType === 'optimal').length;
                const acceptablePlacements = placementResults.filter(r => r.placementType === 'acceptable').length;
                const fallbackPlacements = placementResults.filter(r => r.placementType === 'fallback').length;
                const averageScore = placementResults.reduce((sum, r) => sum + r.score, 0) / placementResults.length;
                const unplacedNPCs = npcs.filter(npc => {
                    var _a;
                    return !placementResults.some(result => result.npcId === npc.id) ||
                        ((_a = placementResults.find(result => result.npcId === npc.id)) === null || _a === void 0 ? void 0 : _a.score) < 30;
                });
                const result = {
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
                this.worldState.totalNPCs = result.placedNPCs;
                console.log(`[WorldIntegrationService] NPC integration completed: ${result.placedNPCs}/${result.totalNPCs} placed`);
                await this.eventBus.emit('world:npc-integration-complete', {
                    campaignId: this.config.campaignId,
                    result
                });
                return result;
            }
            catch (error) {
                console.error('[WorldIntegrationService] NPC integration failed:', error);
                await this.eventBus.emit('world:npc-integration-error', {
                    campaignId: this.config.campaignId,
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
                throw error;
            }
        });
    }
    async querySpatialData(query, type) {
        return this.measureOperation('querySpatialData', async () => {
            switch (type) {
                case 'settlements':
                    return await this.worldData.queryNearbySettlements(query);
                case 'regions':
                    throw new Error('Region spatial queries not yet implemented');
                case 'npcs':
                    throw new Error('NPC spatial queries not yet implemented');
                default:
                    throw new Error(`Unknown spatial query type: ${type}`);
            }
        });
    }
    getWorldState() {
        return { ...this.worldState };
    }
    async getWorldStatistics() {
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
    async createCaravan(fromSettlementId, toSettlementId, goods) {
        return await this.tradeRoutes.createCaravan(fromSettlementId, toSettlementId, goods);
    }
    async findNPCLocation(npc) {
        if (!this.parsedWorldData) {
            throw new Error('World data must be imported before finding NPC locations');
        }
        return await this.npcPlacement.findOptimalLocation(npc, this.parsedWorldData.settlements);
    }
    async exportWorldData() {
        if (!this.parsedWorldData) {
            throw new Error('No world data available to export');
        }
        return { ...this.parsedWorldData };
    }
    validateParsedData(data) {
        const errors = [];
        const warnings = [];
        if (data.settlements.length === 0) {
            errors.push('No settlements found in parsed data');
        }
        if (data.regions.length === 0) {
            warnings.push('No regions found - world may be incomplete');
        }
        if (data.settlements.length > 10000) {
            warnings.push('Large number of settlements may impact performance');
        }
        const invalidCoords = data.settlements.filter(s => {
            const coords = s.coordinates.coordinates;
            return coords[0] < -180 || coords[0] > 180 || coords[1] < -90 || coords[1] > 90;
        });
        if (invalidCoords.length > 0) {
            warnings.push(`${invalidCoords.length} settlements have invalid coordinates`);
        }
        return { errors, warnings };
    }
    updateWorldState(parsedData) {
        this.worldState.isInitialized = true;
        this.worldState.lastImport = new Date().toISOString();
        this.worldState.totalSettlements = parsedData.settlements.length;
        this.updateIntegrationHealth();
    }
    updateIntegrationHealth() {
        this.worldState.integrationHealth = {
            parser: this.azgaarParser.getHealthStatus().isInitialized,
            data: this.worldData.getHealthStatus().isInitialized,
            placement: this.npcPlacement.getHealthStatus().isInitialized,
            trade: this.tradeRoutes.getHealthStatus().isInitialized
        };
    }
    setupEventListeners() {
        this.eventBus.on('world:data-parsed', async (data) => {
            console.log('[WorldIntegrationService] World data parsed event received');
        });
        this.eventBus.on('world:npcs-assigned', async (data) => {
            console.log(`[WorldIntegrationService] ${data.totalNPCs} NPCs assigned to world`);
        });
        this.eventBus.on('world:trade-routes-generated', async (data) => {
            this.worldState.activeTradeRoutes = data.routes.length;
            console.log(`[WorldIntegrationService] ${data.routes.length} trade routes generated`);
        });
        this.eventBus.on('service:health-update', async () => {
            this.updateIntegrationHealth();
        });
    }
    getHealthStatus() {
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
    async performIntegrationTest() {
        console.log('[WorldIntegrationService] Performing integration test...');
        const testResults = {
            servicesInitialized: false,
            worldDataImported: false,
            npcPlacementWorking: false,
            tradeRoutesWorking: false,
            spatialQueriesWorking: false,
            errors: [],
            performance: {}
        };
        try {
            testResults.servicesInitialized = this.worldState.integrationHealth.parser &&
                this.worldState.integrationHealth.data &&
                this.worldState.integrationHealth.placement &&
                this.worldState.integrationHealth.trade;
            testResults.worldDataImported = this.parsedWorldData !== null;
            if (testResults.worldDataImported && this.parsedWorldData) {
                const testNPC = {
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
                const query = {
                    center: { type: 'Point', coordinates: [0, 0] },
                    radius: 1000,
                    limit: 10
                };
                const spatialStart = performance.now();
                await this.querySpatialData(query, 'settlements');
                testResults.performance.spatialQuery = performance.now() - spatialStart;
                testResults.spatialQueriesWorking = true;
                const tradeStart = performance.now();
                await this.tradeRoutes.generateTradeRoutes(this.parsedWorldData.settlements);
                testResults.performance.tradeRouteGeneration = performance.now() - tradeStart;
                testResults.tradeRoutesWorking = true;
            }
        }
        catch (error) {
            testResults.errors.push(error instanceof Error ? error.message : 'Unknown test error');
        }
        console.log('[WorldIntegrationService] Integration test completed:', testResults);
        return testResults;
    }
}
exports.WorldIntegrationService = WorldIntegrationService;
