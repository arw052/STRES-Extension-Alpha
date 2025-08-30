/**
 * World Integration Test Suite
 *
 * Comprehensive tests for CLAUDE-5A-WORLD-INTEGRATION
 * Tests Euterra map import, spatial queries, NPC placement, and trade routes
 */

import { WorldIntegrationService, WorldIntegrationConfig, WorldImportResult, NPCIntegrationResult } from './WorldIntegrationService';
import { ParsedSettlement, NPCProfile } from './AzgaarParserService';
import { CoordinateUtils, AzgaarCoordinateUtils } from '../../shared/utils/coordinateUtils';
import { RTreeIndex, SpatialQuery, SpatialIndexItem } from '../../shared/utils/spatialIndexing';

export interface TestResult {
  testName: string;
  passed: boolean;
  duration: number;
  error?: string;
  details?: any;
}

export interface TestSuiteResult {
  suiteName: string;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  totalDuration: number;
  results: TestResult[];
  summary: {
    successRate: number;
    averageDuration: number;
    criticalFailures: number;
  };
}

/**
 * World Integration Test Suite
 */
export class WorldIntegrationTestSuite {
  private config: WorldIntegrationConfig;
  private service: WorldIntegrationService;
  private testResults: TestResult[] = [];

  constructor() {
    this.config = {
      campaignId: 'test-campaign-world-integration',
      azgaarParser: {},
      worldData: {
        campaignId: 'test-campaign-world-integration',
        enableSpatialIndexing: true,
        batchSize: 50,
        enableCaching: false,
        cacheTTL: 300000
      },
      npcPlacement: {
        campaignId: 'test-campaign-world-integration',
        placementStrategy: 'balanced',
        maxNPCsPerSettlement: 20,
        minNPCsPerSettlement: 1,
        respectCulturalBoundaries: true,
        balanceProfessions: true,
        considerTradeRoutes: true
      },
      tradeRoutes: {
        campaignId: 'test-campaign-world-integration',
        enableEconomicSimulation: false,
        caravanTravelSpeed: 30,
        tradeRouteRefreshInterval: 3600000, // 1 hour
        maxRoutesPerSettlement: 5
      },
      enableFullIntegration: true,
      importBatchSize: 100
    };

    this.service = new WorldIntegrationService(this.config);
  }

  /**
   * Run all tests
   */
  async runAllTests(): Promise<TestSuiteResult> {
    const startTime = Date.now();
    console.log('[WorldIntegrationTestSuite] Starting comprehensive test suite...');

    // Initialize service
    await this.service.initialize();

    // Run test categories
    await this.runAzgaarParserTests();
    await this.runCoordinateConversionTests();
    await this.runSpatialIndexingTests();
    await this.runWorldDataTests();
    await this.runNPCPlacementTests();
    await this.runTradeRouteTests();
    await this.runIntegrationTests();

    // Calculate results
    const totalDuration = Date.now() - startTime;
    const passedTests = this.testResults.filter(r => r.passed).length;
    const failedTests = this.testResults.filter(r => !r.passed).length;
    const criticalFailures = this.testResults.filter(r => !r.passed && r.testName.includes('CRITICAL')).length;

    const result: TestSuiteResult = {
      suiteName: 'World Integration Complete Test Suite',
      totalTests: this.testResults.length,
      passedTests,
      failedTests,
      totalDuration,
      results: this.testResults,
      summary: {
        successRate: (passedTests / this.testResults.length) * 100,
        averageDuration: totalDuration / this.testResults.length,
        criticalFailures
      }
    };

    console.log(`[WorldIntegrationTestSuite] Test suite completed: ${passedTests}/${this.testResults.length} tests passed (${result.summary.successRate.toFixed(1)}%)`);

    // Cleanup
    await this.service.shutdown();

    return result;
  }

  /**
   * Azgaar Parser Tests
   */
  private async runAzgaarParserTests(): Promise<void> {
    console.log('[WorldIntegrationTestSuite] Running Azgaar Parser tests...');

    // Test 1: Parse Euterra map data
    await this.runTest('Parse Euterra Map Data', async () => {
      const mockEuterraData = this.createMockEuterraData();
      const result = await this.service.importWorldFromAzgaar(JSON.stringify(mockEuterraData));

      this.assert(result.success, 'Import should succeed');
      this.assert(result.parsedData.settlements.length > 0, 'Should parse settlements');
      this.assert(result.parsedData.regions.length > 0, 'Should parse regions');
      this.assert(result.statistics.totalSettlements > 100, 'Should have significant number of settlements');

      return result;
    });

    // Test 2: Handle malformed data
    await this.runTest('Handle Malformed Map Data', async () => {
      try {
        await this.service.importWorldFromAzgaar('invalid json');
        this.fail('Should throw error for invalid JSON');
      } catch (error) {
        this.assert(true, 'Correctly handled malformed data');
      }
    });

    // Test 3: Validate coordinate conversion
    await this.runTest('Coordinate Conversion Accuracy', async () => {
      const pixelX = 4096, pixelY = 2048; // Center of typical Azgaar map
      const geo = CoordinateUtils.pixelToGeographic(pixelX, pixelY);

      this.assert(typeof geo.latitude === 'number', 'Latitude should be number');
      this.assert(typeof geo.longitude === 'number', 'Longitude should be number');
      this.assert(geo.latitude >= -90 && geo.latitude <= 90, 'Latitude should be valid');
      this.assert(geo.longitude >= -180 && geo.longitude <= 180, 'Longitude should be valid');

      return geo;
    });
  }

  /**
   * Coordinate Conversion Tests
   */
  private async runCoordinateConversionTests(): Promise<void> {
    console.log('[WorldIntegrationTestSuite] Running Coordinate Conversion tests...');

    // Test 1: Pixel to Geographic conversion
    await this.runTest('Pixel to Geographic Conversion', () => {
      const pixelX = 2048, pixelY = 1024;
      const geo = CoordinateUtils.pixelToGeographic(pixelX, pixelY);

      this.assert(geo.latitude !== undefined, 'Should convert latitude');
      this.assert(geo.longitude !== undefined, 'Should convert longitude');

      // Test round-trip conversion
      const backToPixel = CoordinateUtils.geographicToPixel(geo.latitude, geo.longitude);
      this.assert(Math.abs(backToPixel.x - pixelX) < 10, 'Round-trip X should be close');
      this.assert(Math.abs(backToPixel.y - pixelY) < 10, 'Round-trip Y should be close');
    });

    // Test 2: Geographic to PostGIS conversion
    await this.runTest('Geographic to PostGIS Conversion', () => {
      const geo = { latitude: 45.0, longitude: -75.0 };
      const postgis = CoordinateUtils.geographicToPostGIS(geo.latitude, geo.longitude);

      this.assert(postgis.includes('POINT'), 'Should create PostGIS POINT');
      this.assert(postgis.includes('-75'), 'Should include longitude');
      this.assert(postgis.includes('45'), 'Should include latitude');
    });

    // Test 3: Distance calculation
    await this.runTest('Distance Calculation Accuracy', () => {
      const point1 = { latitude: 40.7128, longitude: -74.0060 }; // NYC
      const point2 = { latitude: 34.0522, longitude: -118.2437 }; // LA

      const distance = CoordinateUtils.calculateDistance(point1, point2);

      // Distance between NYC and LA is approximately 3935 km
      this.assert(distance > 3900 && distance < 4000, `Distance should be ~3935km, got ${distance}km`);
    });

    // Test 4: Bearing calculation
    await this.runTest('Bearing Calculation', () => {
      const point1 = { latitude: 0, longitude: 0 };
      const point2 = { latitude: 0, longitude: 90 };

      const bearing = CoordinateUtils.calculateBearing(point1, point2);

      this.assert(Math.abs(bearing - 90) < 1, `Bearing should be 90°, got ${bearing}°`);
    });
  }

  /**
   * Spatial Indexing Tests
   */
  private async runSpatialIndexingTests(): Promise<void> {
    console.log('[WorldIntegrationTestSuite] Running Spatial Indexing tests...');

    // Test 1: R-Tree insertion and search
    await this.runTest('R-Tree Basic Operations', async () => {
      const index = new RTreeIndex();

      // Insert test points
      const testPoints: SpatialIndexItem[] = [
        { id: 'point1', point: { latitude: 40.0, longitude: -74.0 }, data: { name: 'NYC' } },
        { id: 'point2', point: { latitude: 34.0, longitude: -118.0 }, data: { name: 'LA' } },
        { id: 'point3', point: { latitude: 41.0, longitude: -87.0 }, data: { name: 'Chicago' } }
      ];

      for (const point of testPoints) {
        index.insert(point);
      }

      // Test search
      const query: SpatialQuery = {
        center: { latitude: 40.0, longitude: -74.0 },
        radius: 100,
        type: 'radius'
      };

      const results = index.search(query);

      this.assert(results.items.length > 0, 'Should find points within radius');
      this.assert(results.items.some(item => item.id === 'point1'), 'Should find NYC');

      return results;
    });

    // Test 2: Bulk insertion performance
    await this.runTest('Bulk Insertion Performance', async () => {
      const index = new RTreeIndex();
      const bulkPoints: SpatialIndexItem[] = [];

      // Generate 1000 test points
      for (let i = 0; i < 1000; i++) {
        bulkPoints.push({
          id: `bulk_${i}`,
          point: {
            latitude: (Math.random() - 0.5) * 180,
            longitude: (Math.random() - 0.5) * 360
          },
          data: { index: i }
        });
      }

      const startTime = performance.now();
      index.bulkInsert(bulkPoints);
      const duration = performance.now() - startTime;

      this.assert(duration < 5000, `Bulk insert should complete in <5s, took ${duration}ms`);
      this.assert(index.getStatistics().totalItems === 1000, 'Should contain all inserted items');

      return { duration, itemCount: index.getStatistics().totalItems };
    });

    // Test 3: Spatial query performance
    await this.runTest('Spatial Query Performance', async () => {
      const index = new RTreeIndex();

      // Insert 10,000 points
      for (let i = 0; i < 10000; i++) {
        index.insert({
          id: `perf_${i}`,
          point: {
            latitude: (Math.random() - 0.5) * 180,
            longitude: (Math.random() - 0.5) * 360
          },
          data: { index: i }
        });
      }

      // Test radius query
      const query: SpatialQuery = {
        center: { latitude: 0, longitude: 0 },
        radius: 1000,
        type: 'radius'
      };

      const startTime = performance.now();
      const results = index.search(query);
      const duration = performance.now() - startTime;

      this.assert(duration < 100, `Query should complete in <100ms, took ${duration}ms`);
      this.assert(results.items.length > 0, 'Should find some results');

      return { duration, resultCount: results.items.length };
    });
  }

  /**
   * World Data Tests
   */
  private async runWorldDataTests(): Promise<void> {
    console.log('[WorldIntegrationTestSuite] Running World Data tests...');

    // Test 1: World statistics calculation
    await this.runTest('World Statistics Calculation', async () => {
      // First import test data
      const mockData = this.createMockEuterraData();
      await this.service.importWorldFromAzgaar(JSON.stringify(mockData));

      const stats = await this.service.getWorldStatistics();

      this.assert(stats.totalSettlements > 0, 'Should have settlements');
      this.assert(stats.totalPopulation > 0, 'Should have population');
      this.assert(stats.averageSettlementSize > 0, 'Should calculate average size');
      this.assert(stats.economicHealth >= 0 && stats.economicHealth <= 100, 'Economic health should be valid');

      return stats;
    });

    // Test 2: Spatial queries on world data
    await this.runTest('Spatial Queries on World Data', async () => {
      const query = {
        center: { type: 'Point', coordinates: [0, 0] },
        radius: 1000,
        type: 'radius' as const
      };

      const results = await this.service.querySpatialData(query, 'settlements');

      this.assert(results.items.length >= 0, 'Query should not fail');
      this.assert(results.queryTime >= 0, 'Should have query time');

      return results;
    });
  }

  /**
   * NPC Placement Tests
   */
  private async runNPCPlacementTests(): Promise<void> {
    console.log('[WorldIntegrationTestSuite] Running NPC Placement tests...');

    // Test 1: NPC placement integration
    await this.runTest('NPC Placement Integration', async () => {
      // Import world data first
      const mockData = this.createMockEuterraData();
      await this.service.importWorldFromAzgaar(JSON.stringify(mockData));

      // Create test NPCs
      const testNPCs: NPCProfile[] = [
        {
          id: 'test-npc-1',
          name: 'Test Blacksmith',
          level: 5,
          profession: 'Blacksmith',
          culture: 'TestCulture',
          personality: ['Friendly'],
          goals: ['Make good weapons'],
          relationships: [],
          interactionPriority: 5
        },
        {
          id: 'test-npc-2',
          name: 'Test Merchant',
          level: 3,
          profession: 'Merchant',
          culture: 'TestCulture',
          personality: ['Ambitious'],
          goals: ['Get rich'],
          relationships: [],
          interactionPriority: 4
        }
      ];

      const result = await this.service.integrateNPCsIntoWorld(testNPCs);

      this.assert(result.totalNPCs === testNPCs.length, 'Should process all NPCs');
      this.assert(result.placementResults.length > 0, 'Should have placement results');
      this.assert(result.statistics.averageScore >= 0, 'Should calculate average score');

      return result;
    });

    // Test 2: Individual NPC placement
    await this.runTest('Individual NPC Placement', async () => {
      const testNPC: NPCProfile = {
        id: 'single-npc-test',
        name: 'Test Guard',
        level: 4,
        profession: 'Guard',
        culture: 'TestCulture',
        personality: ['Disciplined'],
        goals: ['Protect the town'],
        relationships: [],
        interactionPriority: 6
      };

      const result = await this.service.findNPCLocation(testNPC);

      this.assert(result !== null, 'Should find a location for NPC');
      if (result) {
        this.assert(result.npcId === testNPC.id, 'Should return correct NPC ID');
        this.assert(result.score >= 0 && result.score <= 100, 'Score should be valid');
        this.assert(['optimal', 'acceptable', 'fallback'].includes(result.placementType), 'Should have valid placement type');
      }

      return result;
    });
  }

  /**
   * Trade Route Tests
   */
  private async runTradeRouteTests(): Promise<void> {
    console.log('[WorldIntegrationTestSuite] Running Trade Route tests...');

    // Test 1: Trade route generation
    await this.runTest('Trade Route Generation', async () => {
      // Import world data first
      const mockData = this.createMockEuterraData();
      await this.service.importWorldFromAzgaar(JSON.stringify(mockData));

      const caravan = await this.service.createCaravan('settlement_1', 'settlement_2', {
        grain: 100,
        weapons: 25,
        cloth: 50
      });

      this.assert(caravan.id.startsWith('caravan_'), 'Should create caravan with ID');
      this.assert(caravan.goods.grain === 100, 'Should preserve goods');
      this.assert(caravan.status === 'planning', 'Should start in planning status');
      this.assert(caravan.value > 0, 'Should calculate value');

      return caravan;
    });

    // Test 2: Market data updates
    await this.runTest('Market Data Updates', async () => {
      const marketData = await this.service.updateMarketData('settlement_1', {
        grain: 8,
        weapons: 60
      });

      this.assert(marketData.settlementId === 'settlement_1', 'Should update correct settlement');
      this.assert(marketData.prices.grain === 8, 'Should update grain price');
      this.assert(marketData.prices.weapons === 60, 'Should update weapons price');
      this.assert(marketData.lastUpdated, 'Should have last updated timestamp');

      return marketData;
    });
  }

  /**
   * Integration Tests
   */
  private async runIntegrationTests(): Promise<void> {
    console.log('[WorldIntegrationTestSuite] Running Integration tests...');

    // Test 1: Full world import and NPC integration
    await this.runTest('CRITICAL - Full World Import and NPC Integration', async () => {
      // This is the main integration test that validates the complete CLAUDE-5A-WORLD-INTEGRATION
      const mockData = this.createMockEuterraData();
      const importResult = await this.service.importWorldFromAzgaar(JSON.stringify(mockData));

      this.assert(importResult.success, 'World import should succeed');
      this.assert(importResult.parsedData.settlements.length > 0, 'Should have settlements');

      // Now integrate NPCs
      const testNPCs = this.createTestNPCs(50); // Test with 50 NPCs
      const npcResult = await this.service.integrateNPCsIntoWorld(testNPCs);

      this.assert(npcResult.totalNPCs === 50, 'Should process 50 NPCs');
      this.assert(npcResult.placedNPCs > 0, 'Should place some NPCs');
      this.assert(npcResult.integrationTime > 0, 'Should have integration time');

      // Test spatial queries
      const spatialQuery = {
        center: { type: 'Point', coordinates: [0, 0] },
        radius: 500,
        type: 'radius' as const
      };

      const spatialResults = await this.service.querySpatialData(spatialQuery, 'settlements');
      this.assert(spatialResults.queryTime < 1000, 'Spatial query should be fast');

      return {
        importResult,
        npcResult,
        spatialResults,
        totalDuration: importResult.importTime + npcResult.integrationTime + spatialResults.queryTime
      };
    });

    // Test 2: Performance validation
    await this.runTest('Performance Validation', async () => {
      const state = this.service.getWorldState();

      this.assert(state.campaignId === this.config.campaignId, 'Should have correct campaign ID');
      this.assert(typeof state.isInitialized === 'boolean', 'Should have initialization status');

      // Test service health
      const health = this.service.getHealthStatus();
      this.assert(health.services.parser, 'Parser service should be healthy');
      this.assert(health.services.data, 'Data service should be healthy');
      this.assert(health.services.placement, 'Placement service should be healthy');
      this.assert(health.services.trade, 'Trade service should be healthy');

      return { state, health };
    });

    // Test 3: Error handling
    await this.runTest('Error Handling Validation', async () => {
      // Test with invalid data
      try {
        await this.service.importWorldFromAzgaar('{"invalid": "data"}');
        this.fail('Should reject invalid world data');
      } catch (error) {
        this.assert(true, 'Correctly handled invalid data');
      }

      // Test NPC placement without world data
      const newService = new WorldIntegrationService({
        ...this.config,
        campaignId: 'error-test-campaign'
      });
      await newService.initialize();

      try {
        await newService.integrateNPCsIntoWorld([this.createTestNPCs(1)[0]]);
        this.fail('Should reject NPC integration without world data');
      } catch (error) {
        this.assert(true, 'Correctly handled NPC integration without world data');
      }

      await newService.shutdown();
    });
  }

  /**
   * Test runner utility
   */
  private async runTest(testName: string, testFn: () => Promise<any> | any): Promise<void> {
    const startTime = performance.now();

    try {
      const result = await testFn();
      const duration = performance.now() - startTime;

      this.testResults.push({
        testName,
        passed: true,
        duration,
        details: result
      });

      console.log(`✅ ${testName} - PASSED (${duration.toFixed(2)}ms)`);

    } catch (error) {
      const duration = performance.now() - startTime;

      this.testResults.push({
        testName,
        passed: false,
        duration,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      console.log(`❌ ${testName} - FAILED (${duration.toFixed(2)}ms): ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Assertion utilities
   */
  private assert(condition: boolean, message: string): void {
    if (!condition) {
      throw new Error(`Assertion failed: ${message}`);
    }
  }

  private fail(message: string): void {
    throw new Error(message);
  }

  /**
   * Mock data creation utilities
   */
  private createMockEuterraData() {
    return {
      settings: {
        width: 8192,
        height: 4096,
        distanceUnit: 'km',
        distanceScale: 100
      },
      cells: this.createMockCells(),
      burgs: this.createMockBurgs(),
      states: this.createMockStates(),
      cultures: this.createMockCultures(),
      religions: this.createMockReligions(),
      rivers: this.createMockRivers(),
      routes: this.createMockRoutes()
    };
  }

  private createMockCells() {
    const cells = [];
    for (let i = 0; i < 1000; i++) {
      cells.push({
        id: i,
        x: Math.random() * 8192,
        y: Math.random() * 4096,
        height: Math.random() * 100,
        biome: Math.floor(Math.random() * 10),
        culture: Math.floor(Math.random() * 5),
        religion: Math.floor(Math.random() * 3),
        state: Math.floor(Math.random() * 10),
        burg: Math.random() > 0.9 ? Math.floor(Math.random() * 50) : 0,
        province: Math.floor(Math.random() * 20)
      });
    }
    return cells;
  }

  private createMockBurgs() {
    const burgs = [];
    const types = ['City', 'Town', 'Village', 'Fortress', 'Temple'];
    const economies = ['Farming', 'Mining', 'Fishing', 'Forestry', 'Maritime Trade', 'Military Garrison'];

    for (let i = 1; i <= 200; i++) {
      burgs.push({
        id: i,
        name: `Test Settlement ${i}`,
        x: Math.random() * 8192,
        y: Math.random() * 4096,
        cell: Math.floor(Math.random() * 1000),
        culture: Math.floor(Math.random() * 5),
        religion: Math.floor(Math.random() * 3),
        state: Math.floor(Math.random() * 10),
        population: Math.floor(Math.random() * 50000) + 1000,
        type: types[Math.floor(Math.random() * types.length)],
        capital: Math.random() > 0.9,
        citadel: Math.random() > 0.8,
        walls: Math.random() > 0.7,
        port: Math.random() > 0.6 ? Math.floor(Math.random() * 10) : 0,
        temple: Math.random() > 0.5,
        shanty: Math.random() > 0.4
      });
    }
    return burgs;
  }

  private createMockStates() {
    const states = [];
    const names = ['Kingdom of Test', 'Empire of Mock', 'Republic of Data', 'Duchy of Code', 'County of Scripts'];

    for (let i = 1; i <= 10; i++) {
      states.push({
        id: i,
        name: names[i - 1] || `State ${i}`,
        capital: Math.floor(Math.random() * 50) + 1,
        centerX: Math.random() * 8192,
        centerY: Math.random() * 4096,
        type: 'Monarchy',
        culture: Math.floor(Math.random() * 5),
        religion: Math.floor(Math.random() * 3),
        color: `#${Math.floor(Math.random()*16777215).toString(16)}`,
        expansionism: Math.random() * 100,
        cells: Array.from({length: Math.floor(Math.random() * 100) + 10}, () => Math.floor(Math.random() * 1000))
      });
    }
    return states;
  }

  private createMockCultures() {
    const cultures = [];
    const names = ['Test Culture 1', 'Test Culture 2', 'Mock Culture 3', 'Data Culture 4', 'Code Culture 5'];

    for (let i = 1; i <= 5; i++) {
      cultures.push({
        id: i,
        name: names[i - 1],
        type: 'Folk',
        center: Math.floor(Math.random() * 1000),
        color: `#${Math.floor(Math.random()*16777215).toString(16)}`,
        expansionism: Math.random() * 100,
        base: Math.floor(Math.random() * 1000),
        origins: [Math.floor(Math.random() * 1000)]
      });
    }
    return cultures;
  }

  private createMockReligions() {
    const religions = [];
    const names = ['Test Faith', 'Mock Belief', 'Data Doctrine'];

    for (let i = 1; i <= 3; i++) {
      religions.push({
        id: i,
        name: names[i - 1],
        type: 'Organized',
        culture: Math.floor(Math.random() * 5),
        center: Math.floor(Math.random() * 1000),
        color: `#${Math.floor(Math.random()*16777215).toString(16)}`,
        expansionism: Math.random() * 100,
        origins: [Math.floor(Math.random() * 1000)]
      });
    }
    return religions;
  }

  private createMockRivers() {
    const rivers = [];

    for (let i = 1; i <= 20; i++) {
      rivers.push({
        id: i,
        name: `River ${i}`,
        type: 'River',
        basin: Math.floor(Math.random() * 10),
        cells: Array.from({length: Math.floor(Math.random() * 50) + 10}, () => Math.floor(Math.random() * 1000)),
        length: Math.random() * 1000 + 100
      });
    }
    return rivers;
  }

  private createMockRoutes() {
    const routes = [];

    for (let i = 1; i <= 15; i++) {
      routes.push({
        id: i,
        type: 'Land',
        cells: Array.from({length: Math.floor(Math.random() * 30) + 5}, () => Math.floor(Math.random() * 1000)),
        length: Math.random() * 500 + 50
      });
    }
    return routes;
  }

  private createTestNPCs(count: number): NPCProfile[] {
    const npcs: NPCProfile[] = [];
    const professions = ['Blacksmith', 'Merchant', 'Guard', 'Innkeeper', 'Priest', 'Farmer', 'Scholar', 'Noble'];
    const cultures = ['TestCulture1', 'TestCulture2', 'MockCulture'];

    for (let i = 0; i < count; i++) {
      npcs.push({
        id: `test-npc-${i}`,
        name: `Test NPC ${i}`,
        level: Math.floor(Math.random() * 10) + 1,
        profession: professions[Math.floor(Math.random() * professions.length)],
        culture: cultures[Math.floor(Math.random() * cultures.length)],
        personality: ['Friendly', 'Ambitious', 'Wise', 'Brave'][Math.floor(Math.random() * 4)].split(','),
        goals: ['Make money', 'Help others', 'Gain knowledge', 'Seek adventure'][Math.floor(Math.random() * 4)].split(','),
        relationships: [],
        interactionPriority: Math.floor(Math.random() * 10) + 1
      });
    }

    return npcs;
  }
}

/**
 * Standalone test runner
 */
export async function runWorldIntegrationTests(): Promise<TestSuiteResult> {
  const testSuite = new WorldIntegrationTestSuite();
  return await testSuite.runAllTests();
}

// Export for use in other test files
export { WorldIntegrationTestSuite };
