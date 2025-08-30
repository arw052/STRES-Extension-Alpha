"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AzgaarParserService = void 0;
const BaseService_1 = require("../../services/BaseService");
class AzgaarParserService extends BaseService_1.BaseService {
    constructor(config = {}) {
        super('AzgaarParserService', config);
        this.coordinateConverter = new AzgaarCoordinateConverter();
    }
    async onInitialize() {
        this.eventBus.on('world:parse-map', this.handleParseMap.bind(this));
        this.eventBus.on('world:validate-data', this.handleValidateData.bind(this));
        console.log('[AzgaarParserService] Initialized');
    }
    async onShutdown() {
        this.eventBus.off('world:parse-map', this.handleParseMap.bind(this));
        this.eventBus.off('world:validate-data', this.handleValidateData.bind(this));
        console.log('[AzgaarParserService] Shut down');
    }
    async parseMapFile(mapData) {
        return this.measureOperation('parseMapFile', async () => {
            try {
                const azgaarData = JSON.parse(mapData);
                this.validateMapData(azgaarData);
                const regions = await this.parseRegions(azgaarData);
                const settlements = await this.parseSettlements(azgaarData);
                const cultures = await this.parseCultures(azgaarData);
                const religions = await this.parseReligions(azgaarData);
                const rivers = await this.parseRivers(azgaarData);
                const routes = await this.parseRoutes(azgaarData);
                const metadata = this.createMetadata(azgaarData, regions, settlements);
                return {
                    regions,
                    settlements,
                    cultures,
                    religions,
                    rivers,
                    routes,
                    metadata
                };
            }
            catch (error) {
                console.error('[AzgaarParserService] Failed to parse map file:', error);
                throw new Error(`Map parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        });
    }
    async parseRegions(data) {
        var _a;
        const regions = [];
        for (const state of data.states) {
            if (state.id === 0)
                continue;
            const region = {
                id: `region_${state.id}`,
                name: state.name,
                type: this.determineRegionType(state),
                boundary: this.createRegionBoundary(state, data),
                centerPoint: this.coordinateConverter.convertToGeoJSON(state.centerX, state.centerY),
                culture: ((_a = data.cultures.find(c => c.id === state.culture)) === null || _a === void 0 ? void 0 : _a.name) || 'Unknown',
                government: this.determineGovernmentType(state),
                population: this.calculateRegionPopulation(state, data),
                properties: {
                    azgaarId: state.id,
                    expansionism: state.expansionism,
                    color: state.color,
                    capitalBurgId: state.capital,
                    cellCount: state.cells.length
                }
            };
            regions.push(region);
        }
        return regions;
    }
    async parseSettlements(data) {
        var _a, _b, _c;
        const settlements = [];
        for (const burg of data.burgs) {
            if (burg.id === 0)
                continue;
            const settlement = {
                id: `settlement_${burg.id}`,
                name: burg.name,
                type: burg.type,
                coordinates: this.coordinateConverter.convertToGeoJSON(burg.x, burg.y),
                population: burg.population,
                sizeCategory: this.determineSettlementSize(burg),
                economyType: this.determineEconomyType(burg, data),
                properties: {
                    azgaarId: burg.id,
                    culture: ((_a = data.cultures.find(c => c.id === burg.culture)) === null || _a === void 0 ? void 0 : _a.name) || 'Unknown',
                    religion: ((_b = data.religions.find(r => r.id === burg.religion)) === null || _b === void 0 ? void 0 : _b.name) || 'Unknown',
                    state: ((_c = data.states.find(s => s.id === burg.state)) === null || _c === void 0 ? void 0 : _c.name) || 'Independent',
                    capital: burg.capital,
                    citadel: burg.citadel,
                    walls: burg.walls,
                    port: burg.port,
                    temple: burg.temple,
                    shanty: burg.shanty
                }
            };
            settlements.push(settlement);
        }
        return settlements;
    }
    async parseCultures(data) {
        return data.cultures
            .filter(culture => culture.id !== 0)
            .map(culture => ({
            id: `culture_${culture.id}`,
            name: culture.name,
            type: culture.type,
            color: culture.color,
            properties: {
                azgaarId: culture.id,
                expansionism: culture.expansionism,
                base: culture.base,
                origins: culture.origins
            }
        }));
    }
    async parseReligions(data) {
        return data.religions
            .filter(religion => religion.id !== 0)
            .map(religion => {
            var _a;
            return ({
                id: `religion_${religion.id}`,
                name: religion.name,
                type: religion.type,
                culture: ((_a = data.cultures.find(c => c.id === religion.culture)) === null || _a === void 0 ? void 0 : _a.name) || 'Unknown',
                color: religion.color,
                properties: {
                    azgaarId: religion.id,
                    expansionism: religion.expansionism,
                    origins: religion.origins
                }
            });
        });
    }
    async parseRivers(data) {
        return data.rivers
            .filter(river => river.id !== 0)
            .map(river => ({
            id: `river_${river.id}`,
            name: river.name,
            type: river.type,
            geometry: this.createRiverGeometry(river, data),
            length: river.length,
            properties: {
                azgaarId: river.id,
                basin: river.basin,
                cellCount: river.cells.length
            }
        }));
    }
    async parseRoutes(data) {
        return data.routes
            .filter(route => route.id !== 0)
            .map(route => ({
            id: `route_${route.id}`,
            type: route.type,
            geometry: this.createRouteGeometry(route, data),
            length: route.length,
            properties: {
                azgaarId: route.id,
                cellCount: route.cells.length
            }
        }));
    }
    validateMapData(data) {
        const requiredFields = ['settings', 'cells', 'burgs', 'states', 'cultures', 'religions'];
        const missingFields = requiredFields.filter(field => !data[field]);
        if (missingFields.length > 0) {
            throw new Error(`Invalid map data: missing fields ${missingFields.join(', ')}`);
        }
        if (!data.settings.width || !data.settings.height) {
            throw new Error('Invalid map settings: missing width/height');
        }
        console.log('[AzgaarParserService] Map data validation passed');
    }
    determineRegionType(state) {
        if (state.expansionism > 80)
            return 'Empire';
        if (state.expansionism > 60)
            return 'Kingdom';
        if (state.expansionism > 40)
            return 'Duchy';
        return 'County';
    }
    determineGovernmentType(state) {
        const types = ['Monarchy', 'Republic', 'Theocracy', 'Oligarchy', 'Tribal'];
        return types[Math.floor(Math.random() * types.length)];
    }
    calculateRegionPopulation(state, data) {
        const regionBurgs = data.burgs.filter(burg => burg.state === state.id);
        return regionBurgs.reduce((total, burg) => total + burg.population, 0);
    }
    createRegionBoundary(state, data) {
        const cellCoords = state.cells
            .map(cellId => data.cells.find(cell => cell.id === cellId))
            .filter(cell => cell !== undefined)
            .map(cell => [cell.x, cell.y]);
        if (cellCoords.length === 0) {
            return {
                type: 'Polygon',
                coordinates: [[
                        [state.centerX - 10, state.centerY - 10],
                        [state.centerX + 10, state.centerY - 10],
                        [state.centerX + 10, state.centerY + 10],
                        [state.centerX - 10, state.centerY + 10],
                        [state.centerX - 10, state.centerY - 10]
                    ]]
            };
        }
        return this.createConvexHull(cellCoords);
    }
    determineSettlementSize(burg) {
        if (burg.population >= 100000)
            return 'Metropolis';
        if (burg.population >= 50000)
            return 'Large City';
        if (burg.population >= 10000)
            return 'City';
        if (burg.population >= 1000)
            return 'Large Town';
        if (burg.population >= 100)
            return 'Town';
        return 'Village';
    }
    determineEconomyType(burg, data) {
        if (burg.port > 0)
            return 'Maritime Trade';
        if (burg.temple)
            return 'Religious Center';
        if (burg.citadel)
            return 'Military Garrison';
        const cell = data.cells.find(c => c.id === burg.cell);
        if (cell) {
            switch (cell.biome) {
                case 1: return 'Farming';
                case 2: return 'Fishing';
                case 3: return 'Mining';
                case 4: return 'Forestry';
                default: return 'Mixed';
            }
        }
        return 'Mixed';
    }
    createRiverGeometry(river, data) {
        const coordinates = river.cells
            .map(cellId => data.cells.find(cell => cell.id === cellId))
            .filter(cell => cell !== undefined)
            .map(cell => [cell.x, cell.y]);
        return {
            type: 'LineString',
            coordinates: coordinates
        };
    }
    createRouteGeometry(route, data) {
        const coordinates = route.cells
            .map(cellId => data.cells.find(cell => cell.id === cellId))
            .filter(cell => cell !== undefined)
            .map(cell => [cell.x, cell.y]);
        return {
            type: 'LineString',
            coordinates: coordinates
        };
    }
    createConvexHull(coordinates) {
        if (coordinates.length === 0) {
            return {
                type: 'Polygon',
                coordinates: [[]]
            };
        }
        const xs = coordinates.map(coord => coord[0]);
        const ys = coordinates.map(coord => coord[1]);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        return {
            type: 'Polygon',
            coordinates: [[
                    [minX, minY],
                    [maxX, minY],
                    [maxX, maxY],
                    [minX, maxY],
                    [minX, minY]
                ]]
        };
    }
    createMetadata(azgaarData, regions, settlements) {
        return {
            source: 'Azgaar',
            version: '1.0',
            bounds: this.createWorldBounds(azgaarData),
            totalSettlements: settlements.length,
            totalRegions: regions.length,
            createdAt: new Date().toISOString()
        };
    }
    createWorldBounds(data) {
        const { width, height } = data.settings;
        return {
            type: 'Polygon',
            coordinates: [[
                    [0, 0],
                    [width, 0],
                    [width, height],
                    [0, height],
                    [0, 0]
                ]]
        };
    }
    async handleParseMap(data) {
        try {
            const parsedData = await this.parseMapFile(data.mapData);
            await this.eventBus.emit('world:data-parsed', {
                campaignId: data.campaignId,
                data: parsedData
            });
        }
        catch (error) {
            await this.eventBus.emit('world:parse-error', {
                campaignId: data.campaignId,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
    async handleValidateData(data) {
        const validationResult = this.validateParsedData(data.worldData);
        await this.eventBus.emit('world:data-validated', validationResult);
    }
    validateParsedData(data) {
        const errors = [];
        const warnings = [];
        if (data.regions.length === 0) {
            errors.push('No regions found');
        }
        if (data.settlements.length === 0) {
            errors.push('No settlements found');
        }
        if (data.settlements.length > 1000) {
            warnings.push('Large number of settlements may impact performance');
        }
        return {
            valid: errors.length === 0,
            errors,
            warnings,
            stats: {
                regions: data.regions.length,
                settlements: data.settlements.length,
                cultures: data.cultures.length,
                religions: data.religions.length
            }
        };
    }
}
exports.AzgaarParserService = AzgaarParserService;
class AzgaarCoordinateConverter {
    convertToGeoJSON(x, y) {
        const lat = this.pixelToLat(y);
        const lng = this.pixelToLng(x);
        return {
            type: 'Point',
            coordinates: [lng, lat]
        };
    }
    pixelToLat(pixelY) {
        return 90 - (pixelY / 4096) * 180;
    }
    pixelToLng(pixelX) {
        return (pixelX / 4096) * 360 - 180;
    }
    convertToPostGIS(x, y) {
        const point = this.convertToGeoJSON(x, y);
        return `ST_GeomFromGeoJSON('${JSON.stringify(point)}')`;
    }
}
