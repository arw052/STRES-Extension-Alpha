"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TradeRouteService = void 0;
const BaseService_1 = require("../../services/BaseService");
class TradeRouteService extends BaseService_1.BaseService {
    constructor(config) {
        super('TradeRouteService', config);
        this.tradeRoutes = new Map();
        this.caravans = new Map();
        this.marketData = new Map();
        this.economicConnections = new Map();
        this.config = config;
    }
    async onInitialize() {
        this.eventBus.on('world:generate-trade-routes', this.handleGenerateTradeRoutes.bind(this));
        this.eventBus.on('world:create-caravan', this.handleCreateCaravan.bind(this));
        this.eventBus.on('world:update-market', this.handleUpdateMarket.bind(this));
        this.eventBus.on('world:simulate-trade', this.handleSimulateTrade.bind(this));
        if (this.config.enableEconomicSimulation) {
            this.startEconomicSimulation();
        }
        console.log('[TradeRouteService] Initialized with economic simulation:', this.config.enableEconomicSimulation);
    }
    async onShutdown() {
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
    async generateTradeRoutes(settlements, existingRoutes = []) {
        return this.measureOperation('generateTradeRoutes', async () => {
            const startTime = Date.now();
            const routes = [];
            try {
                console.log(`[TradeRouteService] Generating trade routes for ${settlements.length} settlements`);
                const majorSettlements = settlements.filter(s => ['Metropolis', 'Large City', 'City'].includes(s.sizeCategory));
                for (let i = 0; i < majorSettlements.length; i++) {
                    for (let j = i + 1; j < majorSettlements.length; j++) {
                        const route = await this.generateRouteBetweenSettlements(majorSettlements[i], majorSettlements[j], existingRoutes);
                        if (route) {
                            routes.push(route);
                            this.tradeRoutes.set(route.id, route);
                        }
                    }
                }
                const secondaryRoutes = await this.generateSecondaryRoutes(settlements, routes);
                routes.push(...secondaryRoutes);
                const duration = Date.now() - startTime;
                console.log(`[TradeRouteService] Generated ${routes.length} trade routes in ${duration}ms`);
                await this.eventBus.emit('world:trade-routes-generated', {
                    campaignId: this.config.campaignId,
                    routes,
                    statistics: this.generateRouteStatistics(routes)
                });
                return routes;
            }
            catch (error) {
                console.error('[TradeRouteService] Failed to generate trade routes:', error);
                await this.eventBus.emit('world:trade-route-error', {
                    campaignId: this.config.campaignId,
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
                throw error;
            }
        });
    }
    async createCaravan(fromSettlementId, toSettlementId, goods) {
        return this.measureOperation('createCaravan', async () => {
            const route = Array.from(this.tradeRoutes.values()).find(r => (r.fromSettlementId === fromSettlementId && r.toSettlementId === toSettlementId) ||
                (r.fromSettlementId === toSettlementId && r.toSettlementId === fromSettlementId));
            if (!route) {
                throw new Error(`No trade route found between ${fromSettlementId} and ${toSettlementId}`);
            }
            const caravan = {
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
            await this.eventBus.emit('world:caravan-created', {
                caravan,
                route
            });
            return caravan;
        });
    }
    async updateMarketData(settlementId, newPrices) {
        const marketData = this.marketData.get(settlementId) || this.createDefaultMarketData(settlementId);
        if (newPrices) {
            marketData.prices = { ...marketData.prices, ...newPrices };
        }
        if (this.config.enableDynamicPricing) {
            marketData.prices = this.simulatePriceFluctuations(marketData.prices);
        }
        marketData.supplyLevels = this.updateSupplyLevels(settlementId, marketData.supplyLevels);
        marketData.demandLevels = this.updateDemandLevels(settlementId, marketData.demandLevels);
        marketData.economicHealth = this.calculateEconomicHealth(marketData);
        marketData.lastUpdated = new Date().toISOString();
        this.marketData.set(settlementId, marketData);
        return marketData;
    }
    async generateRouteBetweenSettlements(settlement1, settlement2, existingRoutes) {
        const distance = this.calculateDistance(settlement1.coordinates, settlement2.coordinates);
        const routeType = this.determineRouteType(settlement1, settlement2, existingRoutes);
        if (distance < 50 || distance > 2000) {
            return null;
        }
        const route = {
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
    async generateSecondaryRoutes(settlements, majorRoutes) {
        const secondaryRoutes = [];
        const connectedSettlements = new Set();
        majorRoutes.forEach(route => {
            connectedSettlements.add(route.fromSettlementId);
            connectedSettlements.add(route.toSettlementId);
        });
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
    calculateDistance(point1, point2) {
        const [lng1, lat1] = point1.coordinates;
        const [lng2, lat2] = point2.coordinates;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLng / 2) * Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return 6371 * c;
    }
    determineRouteType(settlement1, settlement2, existingRoutes) {
        var _a, _b;
        const hasPort = ((_a = settlement1.properties) === null || _a === void 0 ? void 0 : _a.port) || ((_b = settlement2.properties) === null || _b === void 0 ? void 0 : _b.port);
        const hasRiverRoute = existingRoutes.some(route => route.type === 'river' &&
            this.isRouteBetweenSettlements(route, settlement1, settlement2));
        if (hasRiverRoute)
            return 'river';
        if (hasPort && this.calculateDistance(settlement1.coordinates, settlement2.coordinates) > 500) {
            return 'sea';
        }
        return 'land';
    }
    calculateTravelTime(distance, routeType) {
        const baseSpeed = this.config.caravanTravelSpeed;
        const speedMultipliers = {
            'land': 1.0,
            'sea': 2.0,
            'river': 1.5,
            'air': 5.0
        };
        const speed = baseSpeed * (speedMultipliers[routeType] || 1.0);
        return Math.ceil(distance / speed);
    }
    calculateRouteDifficulty(settlement1, settlement2, routeType) {
        let difficulty = 5;
        if (this.config.considerTerrainDifficulty) {
            const terrainDifficulty = this.assessTerrainDifficulty(settlement1, settlement2);
            difficulty += terrainDifficulty;
        }
        const routeDifficulties = {
            'land': 0,
            'sea': -1,
            'river': 1,
            'air': 2
        };
        difficulty += routeDifficulties[routeType] || 0;
        return Math.max(1, Math.min(10, difficulty));
    }
    calculateRouteSafety(settlement1, settlement2) {
        const avgDanger = (settlement1.dangerLevel + settlement2.dangerLevel) / 2;
        return Math.max(1, Math.min(10, 11 - avgDanger));
    }
    estimateTradeVolume(settlement1, settlement2) {
        const pop1 = settlement1.population;
        const pop2 = settlement2.population;
        return Math.floor((pop1 * pop2) / 1000000);
    }
    determineCommodities(settlement1, settlement2) {
        const commodities = [];
        const economy1 = settlement1.economyType;
        const economy2 = settlement2.economyType;
        const economyCommodities = {
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
        commodities.push(...commodities1, ...commodities2);
        return [...new Set(commodities)].slice(0, 5);
    }
    generateWaypoints(from, to) {
        const waypoints = [];
        const [lng1, lat1] = from.coordinates;
        const [lng2, lat2] = to.coordinates;
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
    calculateEconomicValue(settlement1, settlement2, distance) {
        const tradeVolume = this.estimateTradeVolume(settlement1, settlement2);
        const distanceMultiplier = Math.max(0.1, 1 - distance / 2000);
        return Math.floor(tradeVolume * distanceMultiplier * 100);
    }
    isRouteBetweenSettlements(route, settlement1, settlement2) {
        return true;
    }
    findNearestMajorSettlement(settlement, allSettlements) {
        const majorSettlements = allSettlements.filter(s => ['Metropolis', 'Large City', 'City'].includes(s.sizeCategory) && s.id !== settlement.id);
        if (majorSettlements.length === 0)
            return null;
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
    calculateGoodsValue(goods) {
        let total = 0;
        for (const [commodity, quantity] of Object.entries(goods)) {
            const pricePerUnit = this.getCommodityPrice(commodity);
            total += pricePerUnit * quantity;
        }
        return total;
    }
    calculateArrivalTime(route) {
        const departureTime = new Date();
        departureTime.setDate(departureTime.getDate() + route.travelTime);
        return departureTime.toISOString();
    }
    calculateGuardRequirement(route) {
        const baseGuards = Math.max(2, Math.floor(route.distance / 200));
        const dangerMultiplier = (11 - route.safety) / 10;
        return Math.floor(baseGuards * (1 + dangerMultiplier));
    }
    assessTerrainDifficulty(settlement1, settlement2) {
        return Math.floor(Math.random() * 3);
    }
    createDefaultMarketData(settlementId) {
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
    simulatePriceFluctuations(prices) {
        const newPrices = { ...prices };
        for (const commodity of Object.keys(newPrices)) {
            const fluctuation = (Math.random() - 0.5) * 0.2;
            newPrices[commodity] = Math.max(1, Math.floor(newPrices[commodity] * (1 + fluctuation)));
        }
        return newPrices;
    }
    updateSupplyLevels(settlementId, currentLevels) {
        const newLevels = { ...currentLevels };
        for (const commodity of Object.keys(newLevels)) {
            const change = (Math.random() - 0.5) * 10;
            newLevels[commodity] = Math.max(0, Math.min(100, newLevels[commodity] + change));
        }
        return newLevels;
    }
    updateDemandLevels(settlementId, currentLevels) {
        const newLevels = { ...currentLevels };
        for (const commodity of Object.keys(newLevels)) {
            const change = (Math.random() - 0.5) * 8;
            newLevels[commodity] = Math.max(0, Math.min(100, newLevels[commodity] + change));
        }
        return newLevels;
    }
    calculateEconomicHealth(marketData) {
        const avgSupply = Object.values(marketData.supplyLevels).reduce((a, b) => a + b, 0) / Object.values(marketData.supplyLevels).length;
        const avgDemand = Object.values(marketData.demandLevels).reduce((a, b) => a + b, 0) / Object.values(marketData.demandLevels).length;
        return Math.floor((avgSupply + avgDemand) / 2);
    }
    getCommodityPrice(commodity) {
        const basePrices = {
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
    generateRouteStatistics(routes) {
        const totalDistance = routes.reduce((sum, r) => sum + r.distance, 0);
        const avgTravelTime = routes.reduce((sum, r) => sum + r.travelTime, 0) / routes.length;
        const routeTypes = routes.reduce((acc, r) => {
            acc[r.routeType] = (acc[r.routeType] || 0) + 1;
            return acc;
        }, {});
        return {
            totalRoutes: routes.length,
            totalDistance: Math.floor(totalDistance),
            avgTravelTime: Math.floor(avgTravelTime),
            routeTypes,
            totalEconomicValue: routes.reduce((sum, r) => sum + r.economicValue, 0)
        };
    }
    startEconomicSimulation() {
        setInterval(async () => {
            try {
                for (const settlementId of this.marketData.keys()) {
                    await this.updateMarketData(settlementId);
                }
            }
            catch (error) {
                console.error('[TradeRouteService] Economic simulation error:', error);
            }
        }, this.config.tradeRouteRefreshInterval * 60 * 60 * 1000);
    }
    async handleGenerateTradeRoutes(data) {
        try {
            const routes = await this.generateTradeRoutes(data.settlements, data.existingRoutes);
            await this.eventBus.emit('world:trade-routes-ready', {
                campaignId: this.config.campaignId,
                routes
            });
        }
        catch (error) {
            await this.eventBus.emit('world:trade-route-generation-error', {
                campaignId: this.config.campaignId,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
    async handleCreateCaravan(data) {
        try {
            const caravan = await this.createCaravan(data.fromSettlementId, data.toSettlementId, data.goods);
            await this.eventBus.emit('world:caravan-ready', {
                caravan
            });
        }
        catch (error) {
            await this.eventBus.emit('world:caravan-creation-error', {
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
    async handleUpdateMarket(data) {
        try {
            const marketData = await this.updateMarketData(data.settlementId, data.prices);
            await this.eventBus.emit('world:market-updated', {
                settlementId: data.settlementId,
                marketData
            });
        }
        catch (error) {
            await this.eventBus.emit('world:market-update-error', {
                settlementId: data.settlementId,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
    async handleSimulateTrade(data) {
        console.log(`[TradeRouteService] Simulating ${data.days} days of trade`);
        await this.eventBus.emit('world:trade-simulation-complete', {
            daysSimulated: data.days,
            events: []
        });
    }
}
exports.TradeRouteService = TradeRouteService;
