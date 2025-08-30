/**
 * TradeRouteService - Manages trade routes and economic connections
 *
 * Handles trade route generation, economic relationships between settlements,
 * travel times, caravan management, and economic simulation
 */

import { BaseService } from '../../services/BaseService';
import { ParsedSettlement, ParsedRoute } from './AzgaarParserService';

export interface TradeRouteConfig {
  campaignId: string;
  enableEconomicSimulation: boolean;
  caravanTravelSpeed: number; // km/day
  tradeRouteRefreshInterval: number; // hours
  maxRoutesPerSettlement: number;
  considerTerrainDifficulty: boolean;
  enableDynamicPricing: boolean;
}

export interface TradeRoute {
  id: string;
  fromSettlementId: string;
  toSettlementId: string;
  routeType: 'land' | 'sea' | 'river' | 'air';
  distance: number; // km
  travelTime: number; // days
  difficulty: number; // 1-10
  safety: number; // 1-10 (1 = very dangerous, 10 = very safe)
  tradeVolume: number; // goods per month
  commodities: string[];
  waypoints: GeoJSON.Point[];
  economicValue: number;
  lastUpdated: string;
}

export interface Caravan {
  id: string;
  routeId: string;
  originSettlement: string;
  destinationSettlement: string;
  goods: Record<string, number>; // commodity -> quantity
  value: number;
  departureTime: string;
  estimatedArrival: string;
  status: 'planning' | 'departed' | 'in-transit' | 'arrived' | 'lost' | 'attacked';
  guards: number;
  merchants: number;
  incidents: TradeIncident[];
}

export interface TradeIncident {
  id: string;
  caravanId: string;
  type: 'bandits' | 'weather' | 'accident' | 'disease' | 'successful';
  location: GeoJSON.Point;
  timestamp: string;
  description: string;
  casualties: number;
  goodsLost: Record<string, number>;
  resolution: string;
}

export interface EconomicConnection {
  settlement1Id: string;
  settlement2Id: string;
  relationshipStrength: number; // 0-100
  tradeBalance: number; // positive = settlement1 exports more
  commodities: {
    exports: string[];
    imports: string[];
  };
  tariffs: Record<string, number>; // commodity -> tariff rate
  lastTrade: string;
  diplomaticStatus: 'allied' | 'neutral' | 'hostile' | 'embargo';
}

export interface MarketData {
  settlementId: string;
  prices: Record<string, number>; // commodity -> price
  supplyLevels: Record<string, number>; // commodity -> 0-100
  demandLevels: Record<string, number>; // commodity -> 0-100
  economicHealth: number; // 0-100
  lastUpdated: string;
}

export class TradeRouteService extends BaseService {
  private config: TradeRouteConfig;
  private tradeRoutes = new Map<string, TradeRoute>();
  private caravans = new Map<string, Caravan>();
  private marketData = new Map<string, MarketData>();
  private economicConnections = new Map<string, EconomicConnection>();

  constructor(config: TradeRouteConfig) {
    super('TradeRouteService', config);
    this.config = config;
  }

  protected async onInitialize(): Promise<void> {
    // Register event listeners
    this.eventBus.on('world:generate-trade-routes', this.handleGenerateTradeRoutes.bind(this));
    this.eventBus.on('world:create-caravan', this.handleCreateCaravan.bind(this));
    this.eventBus.on('world:update-market', this.handleUpdateMarket.bind(this));
    this.eventBus.on('world:simulate-trade', this.handleSimulateTrade.bind(this));

    // Start periodic updates
    if (this.config.enableEconomicSimulation) {
      this.startEconomicSimulation();
    }

    console.log('[TradeRouteService] Initialized with economic simulation:', this.config.enableEconomicSimulation);
  }

  protected async onShutdown(): Promise<void> {
    this.eventBus.off('world:generate-trade-routes', this.handleGenerateTradeRoutes.bind(this));
    this.eventBus.off('world:create-caravan', this.handleCreateCaravan.bind(this));
    this.eventBus.off('world:update-market', this.handleUpdateMarket.bind(this));
    this.eventBus.off('world:simulate-trade', this.handleSimulateTrade.bind(this));

    this.tradeRoutes.clear();
    this.caravans.clear();
    this.marketData.clear();
    this.economicConnections.clear();

    console.log('[TradeRouteService] Shut down');
  }

  /**
   * Generate trade routes between settlements
   */
  async generateTradeRoutes(settlements: ParsedSettlement[], existingRoutes: ParsedRoute[] = []): Promise<TradeRoute[]> {
    return this.measureOperation('generateTradeRoutes', async () => {
      const startTime = Date.now();
      const routes: TradeRoute[] = [];

      try {
        console.log(`[TradeRouteService] Generating trade routes for ${settlements.length} settlements`);

        // Generate routes between major settlements
        const majorSettlements = settlements.filter(s =>
          ['Metropolis', 'Large City', 'City'].includes(s.sizeCategory)
        );

        for (let i = 0; i < majorSettlements.length; i++) {
          for (let j = i + 1; j < majorSettlements.length; j++) {
            const route = await this.generateRouteBetweenSettlements(
              majorSettlements[i],
              majorSettlements[j],
              existingRoutes
            );

            if (route) {
              routes.push(route);
              this.tradeRoutes.set(route.id, route);
            }
          }
        }

        // Generate secondary routes to smaller settlements
        const secondaryRoutes = await this.generateSecondaryRoutes(settlements, routes);
        routes.push(...secondaryRoutes);

        const duration = Date.now() - startTime;
        console.log(`[TradeRouteService] Generated ${routes.length} trade routes in ${duration}ms`);

        // Emit completion event
        await this.eventBus.emit('world:trade-routes-generated', {
          campaignId: this.config.campaignId,
          routes,
          statistics: this.generateRouteStatistics(routes)
        });

        return routes;

      } catch (error) {
        console.error('[TradeRouteService] Failed to generate trade routes:', error);
        await this.eventBus.emit('world:trade-route-error', {
          campaignId: this.config.campaignId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        throw error;
      }
    });
  }

  /**
   * Create a caravan for trade
   */
  async createCaravan(
    fromSettlementId: string,
    toSettlementId: string,
    goods: Record<string, number>
  ): Promise<Caravan> {
    return this.measureOperation('createCaravan', async () => {
      const route = Array.from(this.tradeRoutes.values()).find(r =>
        (r.fromSettlementId === fromSettlementId && r.toSettlementId === toSettlementId) ||
        (r.fromSettlementId === toSettlementId && r.toSettlementId === fromSettlementId)
      );

      if (!route) {
        throw new Error(`No trade route found between ${fromSettlementId} and ${toSettlementId}`);
      }

      const caravan: Caravan = {
        id: `caravan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        routeId: route.id,
        originSettlement: fromSettlementId,
        destinationSettlement: toSettlementId,
        goods,
        value: this.calculateGoodsValue(goods),
        departureTime: new Date().toISOString(),
        estimatedArrival: this.calculateArrivalTime(route),
        status: 'planning',
        guards: this.calculateGuardRequirement(route),
        merchants: Math.max(1, Math.floor(Object.keys(goods).length / 2)),
        incidents: []
      };

      this.caravans.set(caravan.id, caravan);

      // Emit caravan created event
      await this.eventBus.emit('world:caravan-created', {
        caravan,
        route
      });

      return caravan;
    });
  }

  /**
   * Update market data for settlements
   */
  async updateMarketData(settlementId: string, newPrices?: Record<string, number>): Promise<MarketData> {
    const marketData = this.marketData.get(settlementId) || this.createDefaultMarketData(settlementId);

    if (newPrices) {
      marketData.prices = { ...marketData.prices, ...newPrices };
    }

    // Simulate market fluctuations
    if (this.config.enableDynamicPricing) {
      marketData.prices = this.simulatePriceFluctuations(marketData.prices);
    }

    // Update supply and demand based on local factors
    marketData.supplyLevels = this.updateSupplyLevels(settlementId, marketData.supplyLevels);
    marketData.demandLevels = this.updateDemandLevels(settlementId, marketData.demandLevels);
    marketData.economicHealth = this.calculateEconomicHealth(marketData);
    marketData.lastUpdated = new Date().toISOString();

    this.marketData.set(settlementId, marketData);

    return marketData;
  }

  /**
   * Generate route between two settlements
   */
  private async generateRouteBetweenSettlements(
    settlement1: ParsedSettlement,
    settlement2: ParsedSettlement,
    existingRoutes: ParsedRoute[]
  ): Promise<TradeRoute | null> {
    const distance = this.calculateDistance(settlement1.coordinates, settlement2.coordinates);
    const routeType = this.determineRouteType(settlement1, settlement2, existingRoutes);

    // Skip if settlements are too close or too far
    if (distance < 50 || distance > 2000) {
      return null;
    }

    const route: TradeRoute = {
      id: `route_${settlement1.id}_${settlement2.id}`,
      fromSettlementId: settlement1.id,
      toSettlementId: settlement2.id,
      routeType,
      distance,
      travelTime: this.calculateTravelTime(distance, routeType),
      difficulty: this.calculateRouteDifficulty(settlement1, settlement2, routeType),
      safety: this.calculateRouteSafety(settlement1, settlement2),
      tradeVolume: this.estimateTradeVolume(settlement1, settlement2),
      commodities: this.determineCommodities(settlement1, settlement2),
      waypoints: this.generateWaypoints(settlement1.coordinates, settlement2.coordinates),
      economicValue: this.calculateEconomicValue(settlement1, settlement2, distance),
      lastUpdated: new Date().toISOString()
    };

    return route;
  }

  /**
   * Generate secondary routes to smaller settlements
   */
  private async generateSecondaryRoutes(settlements: ParsedSettlement[], majorRoutes: TradeRoute[]): Promise<TradeRoute[]> {
    const secondaryRoutes: TradeRoute[] = [];
    const connectedSettlements = new Set<string>();

    // Track which settlements are already connected
    majorRoutes.forEach(route => {
      connectedSettlements.add(route.fromSettlementId);
      connectedSettlements.add(route.toSettlementId);
    });

    // Connect smaller settlements to the major route network
    const unconnectedSettlements = settlements.filter(s => !connectedSettlements.has(s.id));

    for (const settlement of unconnectedSettlements) {
      const nearestMajorSettlement = this.findNearestMajorSettlement(settlement, settlements);

      if (nearestMajorSettlement) {
        const route = await this.generateRouteBetweenSettlements(settlement, nearestMajorSettlement, []);
        if (route) {
          secondaryRoutes.push(route);
        }
      }
    }

    return secondaryRoutes;
  }

  /**
   * Calculate distance between two points (simplified)
   */
  private calculateDistance(point1: GeoJSON.Point, point2: GeoJSON.Point): number {
    const [lng1, lat1] = point1.coordinates as [number, number];
    const [lng2, lat2] = point2.coordinates as [number, number];

    // Haversine formula approximation (in km)
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return 6371 * c; // Earth's radius in km
  }

  /**
   * Determine route type based on settlement properties
   */
  private determineRouteType(
    settlement1: ParsedSettlement,
    settlement2: ParsedSettlement,
    existingRoutes: ParsedRoute[]
  ): 'land' | 'sea' | 'river' | 'air' {
    // Check if either settlement is coastal/port
    const hasPort = settlement1.properties?.port || settlement2.properties?.port;

    // Check for existing river routes
    const hasRiverRoute = existingRoutes.some(route =>
      route.type === 'river' &&
      this.isRouteBetweenSettlements(route, settlement1, settlement2)
    );

    if (hasRiverRoute) return 'river';
    if (hasPort && this.calculateDistance(settlement1.coordinates, settlement2.coordinates) > 500) {
      return 'sea';
    }

    return 'land';
  }

  /**
   * Calculate travel time based on distance and route type
   */
  private calculateTravelTime(distance: number, routeType: string): number {
    const baseSpeed = this.config.caravanTravelSpeed;

    const speedMultipliers: Record<string, number> = {
      'land': 1.0,
      'sea': 2.0, // Ships are faster
      'river': 1.5,
      'air': 5.0 // Fantasy air travel
    };

    const speed = baseSpeed * (speedMultipliers[routeType] || 1.0);
    return Math.ceil(distance / speed);
  }

  /**
   * Calculate route difficulty
   */
  private calculateRouteDifficulty(
    settlement1: ParsedSettlement,
    settlement2: ParsedSettlement,
    routeType: string
  ): number {
    let difficulty = 5; // Base difficulty

    // Terrain difficulty
    if (this.config.considerTerrainDifficulty) {
      const terrainDifficulty = this.assessTerrainDifficulty(settlement1, settlement2);
      difficulty += terrainDifficulty;
    }

    // Route type difficulty
    const routeDifficulties: Record<string, number> = {
      'land': 0,
      'sea': -1, // Seas can be easier to navigate
      'river': 1, // Rivers can have currents/issues
      'air': 2 // Air travel has weather risks
    };

    difficulty += routeDifficulties[routeType] || 0;

    return Math.max(1, Math.min(10, difficulty));
  }

  /**
   * Calculate route safety
   */
  private calculateRouteSafety(settlement1: ParsedSettlement, settlement2: ParsedSettlement): number {
    // Base safety on settlement danger levels
    const avgDanger = (settlement1.dangerLevel + settlement2.dangerLevel) / 2;
    return Math.max(1, Math.min(10, 11 - avgDanger)); // Invert danger level
  }

  /**
   * Estimate trade volume between settlements
   */
  private estimateTradeVolume(settlement1: ParsedSettlement, settlement2: ParsedSettlement): number {
    const pop1 = settlement1.population;
    const pop2 = settlement2.population;

    // Trade volume roughly correlates with population product
    return Math.floor((pop1 * pop2) / 1000000); // Goods per month
  }

  /**
   * Determine commodities traded between settlements
   */
  private determineCommodities(settlement1: ParsedSettlement, settlement2: ParsedSettlement): string[] {
    const commodities: string[] = [];

    // Based on settlement economies
    const economy1 = settlement1.economyType;
    const economy2 = settlement2.economyType;

    const economyCommodities: Record<string, string[]> = {
      'Farming': ['grain', 'vegetables', 'livestock'],
      'Mining': ['ore', 'gems', 'metals'],
      'Fishing': ['fish', 'seafood', 'salt'],
      'Forestry': ['lumber', 'resin', 'paper'],
      'Maritime Trade': ['spices', 'silk', 'luxury goods'],
      'Military Garrison': ['weapons', 'armor', 'horses'],
      'Religious Center': ['incense', 'books', 'artifacts']
    };

    const commodities1 = economyCommodities[economy1] || ['goods'];
    const commodities2 = economyCommodities[economy2] || ['goods'];

    // Combine commodities from both settlements
    commodities.push(...commodities1, ...commodities2);

    // Remove duplicates and limit to 5
    return [...new Set(commodities)].slice(0, 5);
  }

  /**
   * Generate waypoints for route
   */
  private generateWaypoints(from: GeoJSON.Point, to: GeoJSON.Point): GeoJSON.Point[] {
    const waypoints: GeoJSON.Point[] = [];
    const [lng1, lat1] = from.coordinates as [number, number];
    const [lng2, lat2] = to.coordinates as [number, number];

    // Generate intermediate waypoints (simplified)
    const steps = 5;
    for (let i = 1; i < steps; i++) {
      const ratio = i / steps;
      const lng = lng1 + (lng2 - lng1) * ratio;
      const lat = lat1 + (lat2 - lat1) * ratio;

      waypoints.push({
        type: 'Point',
        coordinates: [lng, lat]
      });
    }

    return waypoints;
  }

  /**
   * Calculate economic value of route
   */
  private calculateEconomicValue(settlement1: ParsedSettlement, settlement2: ParsedSettlement, distance: number): number {
    const tradeVolume = this.estimateTradeVolume(settlement1, settlement2);
    const distanceMultiplier = Math.max(0.1, 1 - distance / 2000); // Closer routes are more valuable

    return Math.floor(tradeVolume * distanceMultiplier * 100); // Arbitrary economic value
  }

  /**
   * Helper methods
   */
  private isRouteBetweenSettlements(route: ParsedRoute, settlement1: ParsedSettlement, settlement2: ParsedSettlement): boolean {
    // Simplified check - would need more sophisticated logic in reality
    return true;
  }

  private findNearestMajorSettlement(settlement: ParsedSettlement, allSettlements: ParsedSettlement[]): ParsedSettlement | null {
    const majorSettlements = allSettlements.filter(s =>
      ['Metropolis', 'Large City', 'City'].includes(s.sizeCategory) && s.id !== settlement.id
    );

    if (majorSettlements.length === 0) return null;

    let nearest = majorSettlements[0];
    let minDistance = this.calculateDistance(settlement.coordinates, nearest.coordinates);

    for (const candidate of majorSettlements.slice(1)) {
      const distance = this.calculateDistance(settlement.coordinates, candidate.coordinates);
      if (distance < minDistance) {
        minDistance = distance;
        nearest = candidate;
      }
    }

    return nearest;
  }

  private calculateGoodsValue(goods: Record<string, number>): number {
    let total = 0;
    for (const [commodity, quantity] of Object.entries(goods)) {
      const pricePerUnit = this.getCommodityPrice(commodity);
      total += pricePerUnit * quantity;
    }
    return total;
  }

  private calculateArrivalTime(route: TradeRoute): string {
    const departureTime = new Date();
    departureTime.setDate(departureTime.getDate() + route.travelTime);
    return departureTime.toISOString();
  }

  private calculateGuardRequirement(route: TradeRoute): number {
    // More dangerous routes need more guards
    const baseGuards = Math.max(2, Math.floor(route.distance / 200));
    const dangerMultiplier = (11 - route.safety) / 10; // Invert safety
    return Math.floor(baseGuards * (1 + dangerMultiplier));
  }

  private assessTerrainDifficulty(settlement1: ParsedSettlement, settlement2: ParsedSettlement): number {
    // Simplified terrain assessment
    return Math.floor(Math.random() * 3); // 0-2 difficulty points
  }

  private createDefaultMarketData(settlementId: string): MarketData {
    return {
      settlementId,
      prices: {
        grain: 5,
        weapons: 50,
        armor: 100,
        spices: 20,
        cloth: 15
      },
      supplyLevels: {
        grain: 70,
        weapons: 50,
        armor: 30,
        spices: 40,
        cloth: 60
      },
      demandLevels: {
        grain: 60,
        weapons: 70,
        armor: 80,
        spices: 50,
        cloth: 40
      },
      economicHealth: 65,
      lastUpdated: new Date().toISOString()
    };
  }

  private simulatePriceFluctuations(prices: Record<string, number>): Record<string, number> {
    const newPrices = { ...prices };
    for (const commodity of Object.keys(newPrices)) {
      // Random fluctuation of ±10%
      const fluctuation = (Math.random() - 0.5) * 0.2;
      newPrices[commodity] = Math.max(1, Math.floor(newPrices[commodity] * (1 + fluctuation)));
    }
    return newPrices;
  }

  private updateSupplyLevels(settlementId: string, currentLevels: Record<string, number>): Record<string, number> {
    // Simulate supply changes based on local production
    const newLevels = { ...currentLevels };
    for (const commodity of Object.keys(newLevels)) {
      const change = (Math.random() - 0.5) * 10; // ±5% change
      newLevels[commodity] = Math.max(0, Math.min(100, newLevels[commodity] + change));
    }
    return newLevels;
  }

  private updateDemandLevels(settlementId: string, currentLevels: Record<string, number>): Record<string, number> {
    // Simulate demand changes based on population and events
    const newLevels = { ...currentLevels };
    for (const commodity of Object.keys(newLevels)) {
      const change = (Math.random() - 0.5) * 8; // ±4% change
      newLevels[commodity] = Math.max(0, Math.min(100, newLevels[commodity] + change));
    }
    return newLevels;
  }

  private calculateEconomicHealth(marketData: MarketData): number {
    const avgSupply = Object.values(marketData.supplyLevels).reduce((a, b) => a + b, 0) / Object.values(marketData.supplyLevels).length;
    const avgDemand = Object.values(marketData.demandLevels).reduce((a, b) => a + b, 0) / Object.values(marketData.demandLevels).length;

    // Economic health based on supply-demand balance
    return Math.floor((avgSupply + avgDemand) / 2);
  }

  private getCommodityPrice(commodity: string): number {
    const basePrices: Record<string, number> = {
      grain: 5,
      weapons: 50,
      armor: 100,
      spices: 20,
      cloth: 15,
      ore: 30,
      gems: 200,
      fish: 8,
      lumber: 12,
      livestock: 25
    };
    return basePrices[commodity] || 10;
  }

  private generateRouteStatistics(routes: TradeRoute[]): any {
    const totalDistance = routes.reduce((sum, r) => sum + r.distance, 0);
    const avgTravelTime = routes.reduce((sum, r) => sum + r.travelTime, 0) / routes.length;
    const routeTypes = routes.reduce((acc, r) => {
      acc[r.routeType] = (acc[r.routeType] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      totalRoutes: routes.length,
      totalDistance: Math.floor(totalDistance),
      avgTravelTime: Math.floor(avgTravelTime),
      routeTypes,
      totalEconomicValue: routes.reduce((sum, r) => sum + r.economicValue, 0)
    };
  }

  private startEconomicSimulation(): void {
    // Update markets periodically
    setInterval(async () => {
      try {
        for (const settlementId of this.marketData.keys()) {
          await this.updateMarketData(settlementId);
        }
      } catch (error) {
        console.error('[TradeRouteService] Economic simulation error:', error);
      }
    }, this.config.tradeRouteRefreshInterval * 60 * 60 * 1000); // Convert hours to ms
  }

  /**
   * Event handlers
   */
  private async handleGenerateTradeRoutes(data: { settlements: ParsedSettlement[]; existingRoutes?: ParsedRoute[] }): Promise<void> {
    try {
      const routes = await this.generateTradeRoutes(data.settlements, data.existingRoutes);
      await this.eventBus.emit('world:trade-routes-ready', {
        campaignId: this.config.campaignId,
        routes
      });
    } catch (error) {
      await this.eventBus.emit('world:trade-route-generation-error', {
        campaignId: this.config.campaignId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  private async handleCreateCaravan(data: { fromSettlementId: string; toSettlementId: string; goods: Record<string, number> }): Promise<void> {
    try {
      const caravan = await this.createCaravan(data.fromSettlementId, data.toSettlementId, data.goods);
      await this.eventBus.emit('world:caravan-ready', {
        caravan
      });
    } catch (error) {
      await this.eventBus.emit('world:caravan-creation-error', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  private async handleUpdateMarket(data: { settlementId: string; prices?: Record<string, number> }): Promise<void> {
    try {
      const marketData = await this.updateMarketData(data.settlementId, data.prices);
      await this.eventBus.emit('world:market-updated', {
        settlementId: data.settlementId,
        marketData
      });
    } catch (error) {
      await this.eventBus.emit('world:market-update-error', {
        settlementId: data.settlementId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  private async handleSimulateTrade(data: { days: number }): Promise<void> {
    // Simulate trade activities for specified number of days
    console.log(`[TradeRouteService] Simulating ${data.days} days of trade`);

    // This would trigger caravan movements, market updates, etc.
    await this.eventBus.emit('world:trade-simulation-complete', {
      daysSimulated: data.days,
      events: [] // Would contain actual trade events
    });
  }
}
