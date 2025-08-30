/**
 * AzgaarParserService - Parse Azgaar .map files into STRES world data
 *
 * Handles conversion from Azgaar's pixel-based coordinate system to PostGIS geography
 * Processes cells, burgs, states, cultures, religions, rivers, and routes
 */

import { BaseService } from '../../services/BaseService';

export interface AzgaarMapData {
  settings: {
    width: number;
    height: number;
    distanceUnit: string;
    distanceScale: number;
  };
  cells: AzgaarCell[];
  burgs: AzgaarBurg[];
  states: AzgaarState[];
  cultures: AzgaarCulture[];
  religions: AzgaarReligion[];
  rivers: AzgaarRiver[];
  routes: AzgaarRoute[];
}

export interface AzgaarCell {
  id: number;
  x: number;
  y: number;
  height: number;
  biome: number;
  culture: number;
  religion: number;
  state: number;
  burg: number;
  province: number;
}

export interface AzgaarBurg {
  id: number;
  name: string;
  x: number;
  y: number;
  cell: number;
  culture: number;
  religion: number;
  state: number;
  population: number;
  type: string;
  capital: boolean;
  citadel: boolean;
  walls: boolean;
  port: number;
  temple: boolean;
  shanty: boolean;
}

export interface AzgaarState {
  id: number;
  name: string;
  capital: number;
  centerX: number;
  centerY: number;
  type: string;
  culture: number;
  religion: number;
  color: string;
  expansionism: number;
  cells: number[];
}

export interface AzgaarCulture {
  id: number;
  name: string;
  type: string;
  center: number;
  color: string;
  expansionism: number;
  base: number;
  origins: number[];
}

export interface AzgaarReligion {
  id: number;
  name: string;
  type: string;
  culture: number;
  center: number;
  color: string;
  expansionism: number;
  origins: number[];
}

export interface AzgaarRiver {
  id: number;
  name: string;
  type: string;
  basin: number;
  cells: number[];
  length: number;
}

export interface AzgaarRoute {
  id: number;
  type: string;
  cells: number[];
  length: number;
}

export interface ParsedWorldData {
  regions: ParsedRegion[];
  settlements: ParsedSettlement[];
  cultures: ParsedCulture[];
  religions: ParsedReligion[];
  rivers: ParsedRiver[];
  routes: ParsedRoute[];
  metadata: WorldMetadata;
}

export interface ParsedRegion {
  id: string;
  name: string;
  type: string;
  boundary: GeoJSON.Polygon;
  centerPoint: GeoJSON.Point;
  culture: string;
  government: string;
  population: number;
  properties: Record<string, any>;
}

export interface ParsedSettlement {
  id: string;
  name: string;
  type: string;
  coordinates: GeoJSON.Point;
  population: number;
  sizeCategory: string;
  economyType: string;
  properties: Record<string, any>;
}

export interface ParsedCulture {
  id: string;
  name: string;
  type: string;
  color: string;
  properties: Record<string, any>;
}

export interface ParsedReligion {
  id: string;
  name: string;
  type: string;
  culture: string;
  color: string;
  properties: Record<string, any>;
}

export interface ParsedRiver {
  id: string;
  name: string;
  type: string;
  geometry: GeoJSON.LineString;
  length: number;
  properties: Record<string, any>;
}

export interface ParsedRoute {
  id: string;
  type: string;
  geometry: GeoJSON.LineString;
  length: number;
  properties: Record<string, any>;
}

export interface WorldMetadata {
  source: string;
  version: string;
  bounds: GeoJSON.Polygon;
  totalSettlements: number;
  totalRegions: number;
  createdAt: string;
}

export class AzgaarParserService extends BaseService {
  private coordinateConverter: AzgaarCoordinateConverter;

  constructor(config: Partial<any> = {}) {
    super('AzgaarParserService', config);
    this.coordinateConverter = new AzgaarCoordinateConverter();
  }

  protected async onInitialize(): Promise<void> {
    // Register event listeners
    this.eventBus.on('world:parse-map', this.handleParseMap.bind(this));
    this.eventBus.on('world:validate-data', this.handleValidateData.bind(this));

    console.log('[AzgaarParserService] Initialized');
  }

  protected async onShutdown(): Promise<void> {
    this.eventBus.off('world:parse-map', this.handleParseMap.bind(this));
    this.eventBus.off('world:validate-data', this.handleValidateData.bind(this));

    console.log('[AzgaarParserService] Shut down');
  }

  /**
   * Parse Azgaar .map file data
   */
  async parseMapFile(mapData: string): Promise<ParsedWorldData> {
    return this.measureOperation('parseMapFile', async () => {
      try {
        // Parse JSON data
        const azgaarData: AzgaarMapData = JSON.parse(mapData);

        // Validate structure
        this.validateMapData(azgaarData);

        // Parse each component
        const regions = await this.parseRegions(azgaarData);
        const settlements = await this.parseSettlements(azgaarData);
        const cultures = await this.parseCultures(azgaarData);
        const religions = await this.parseReligions(azgaarData);
        const rivers = await this.parseRivers(azgaarData);
        const routes = await this.parseRoutes(azgaarData);

        // Create metadata
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

      } catch (error) {
        console.error('[AzgaarParserService] Failed to parse map file:', error);
        throw new Error(`Map parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    });
  }

  /**
   * Parse regions from Azgaar states
   */
  private async parseRegions(data: AzgaarMapData): Promise<ParsedRegion[]> {
    const regions: ParsedRegion[] = [];

    for (const state of data.states) {
      if (state.id === 0) continue; // Skip neutral state

      const region: ParsedRegion = {
        id: `region_${state.id}`,
        name: state.name,
        type: this.determineRegionType(state),
        boundary: this.createRegionBoundary(state, data),
        centerPoint: this.coordinateConverter.convertToGeoJSON(state.centerX, state.centerY),
        culture: data.cultures.find(c => c.id === state.culture)?.name || 'Unknown',
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

  /**
   * Parse settlements from Azgaar burgs
   */
  private async parseSettlements(data: AzgaarMapData): Promise<ParsedSettlement[]> {
    const settlements: ParsedSettlement[] = [];

    for (const burg of data.burgs) {
      if (burg.id === 0) continue; // Skip neutral burg

      const settlement: ParsedSettlement = {
        id: `settlement_${burg.id}`,
        name: burg.name,
        type: burg.type,
        coordinates: this.coordinateConverter.convertToGeoJSON(burg.x, burg.y),
        population: burg.population,
        sizeCategory: this.determineSettlementSize(burg),
        economyType: this.determineEconomyType(burg, data),
        properties: {
          azgaarId: burg.id,
          culture: data.cultures.find(c => c.id === burg.culture)?.name || 'Unknown',
          religion: data.religions.find(r => r.id === burg.religion)?.name || 'Unknown',
          state: data.states.find(s => s.id === burg.state)?.name || 'Independent',
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

  /**
   * Parse cultures from Azgaar cultures
   */
  private async parseCultures(data: AzgaarMapData): Promise<ParsedCulture[]> {
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

  /**
   * Parse religions from Azgaar religions
   */
  private async parseReligions(data: AzgaarMapData): Promise<ParsedReligion[]> {
    return data.religions
      .filter(religion => religion.id !== 0)
      .map(religion => ({
        id: `religion_${religion.id}`,
        name: religion.name,
        type: religion.type,
        culture: data.cultures.find(c => c.id === religion.culture)?.name || 'Unknown',
        color: religion.color,
        properties: {
          azgaarId: religion.id,
          expansionism: religion.expansionism,
          origins: religion.origins
        }
      }));
  }

  /**
   * Parse rivers from Azgaar rivers
   */
  private async parseRivers(data: AzgaarMapData): Promise<ParsedRiver[]> {
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

  /**
   * Parse routes from Azgaar routes
   */
  private async parseRoutes(data: AzgaarMapData): Promise<ParsedRoute[]> {
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

  /**
   * Validate Azgaar map data structure
   */
  private validateMapData(data: any): void {
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

  /**
   * Determine region type from Azgaar state data
   */
  private determineRegionType(state: AzgaarState): string {
    // Simple heuristic based on state properties
    if (state.expansionism > 80) return 'Empire';
    if (state.expansionism > 60) return 'Kingdom';
    if (state.expansionism > 40) return 'Duchy';
    return 'County';
  }

  /**
   * Determine government type (simplified)
   */
  private determineGovernmentType(state: AzgaarState): string {
    const types = ['Monarchy', 'Republic', 'Theocracy', 'Oligarchy', 'Tribal'];
    return types[Math.floor(Math.random() * types.length)]; // Placeholder
  }

  /**
   * Calculate region population from associated burgs
   */
  private calculateRegionPopulation(state: AzgaarState, data: AzgaarMapData): number {
    const regionBurgs = data.burgs.filter(burg => burg.state === state.id);
    return regionBurgs.reduce((total, burg) => total + burg.population, 0);
  }

  /**
   * Create region boundary from state cells
   */
  private createRegionBoundary(state: AzgaarState, data: AzgaarMapData): GeoJSON.Polygon {
    const cellCoords = state.cells
      .map(cellId => data.cells.find(cell => cell.id === cellId))
      .filter(cell => cell !== undefined)
      .map(cell => [cell!.x, cell!.y]);

    if (cellCoords.length === 0) {
      // Fallback to center point if no cells
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

    // Create convex hull approximation
    return this.createConvexHull(cellCoords);
  }

  /**
   * Determine settlement size category
   */
  private determineSettlementSize(burg: AzgaarBurg): string {
    if (burg.population >= 100000) return 'Metropolis';
    if (burg.population >= 50000) return 'Large City';
    if (burg.population >= 10000) return 'City';
    if (burg.population >= 1000) return 'Large Town';
    if (burg.population >= 100) return 'Town';
    return 'Village';
  }

  /**
   * Determine economy type based on burg properties
   */
  private determineEconomyType(burg: AzgaarBurg, data: AzgaarMapData): string {
    if (burg.port > 0) return 'Maritime Trade';
    if (burg.temple) return 'Religious Center';
    if (burg.citadel) return 'Military Garrison';

    const cell = data.cells.find(c => c.id === burg.cell);
    if (cell) {
      // Simple biome-based economy
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

  /**
   * Create river geometry from cell path
   */
  private createRiverGeometry(river: AzgaarRiver, data: AzgaarMapData): GeoJSON.LineString {
    const coordinates = river.cells
      .map(cellId => data.cells.find(cell => cell.id === cellId))
      .filter(cell => cell !== undefined)
      .map(cell => [cell!.x, cell!.y]);

    return {
      type: 'LineString',
      coordinates: coordinates
    };
  }

  /**
   * Create route geometry from cell path
   */
  private createRouteGeometry(route: AzgaarRoute, data: AzgaarMapData): GeoJSON.LineString {
    const coordinates = route.cells
      .map(cellId => data.cells.find(cell => cell.id === cellId))
      .filter(cell => cell !== undefined)
      .map(cell => [cell!.x, cell!.y]);

    return {
      type: 'LineString',
      coordinates: coordinates
    };
  }

  /**
   * Create convex hull from coordinates (simplified)
   */
  private createConvexHull(coordinates: number[][]): GeoJSON.Polygon {
    if (coordinates.length === 0) {
      return {
        type: 'Polygon',
        coordinates: [[]]
      };
    }

    // Simple bounding box for now (can be improved with actual convex hull algorithm)
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

  /**
   * Create world metadata
   */
  private createMetadata(
    azgaarData: AzgaarMapData,
    regions: ParsedRegion[],
    settlements: ParsedSettlement[]
  ): WorldMetadata {
    return {
      source: 'Azgaar',
      version: '1.0',
      bounds: this.createWorldBounds(azgaarData),
      totalSettlements: settlements.length,
      totalRegions: regions.length,
      createdAt: new Date().toISOString()
    };
  }

  /**
   * Create world bounds polygon
   */
  private createWorldBounds(data: AzgaarMapData): GeoJSON.Polygon {
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

  /**
   * Event handlers
   */
  private async handleParseMap(data: { mapData: string; campaignId: string }): Promise<void> {
    try {
      const parsedData = await this.parseMapFile(data.mapData);

      // Emit parsed data event
      await this.eventBus.emit('world:data-parsed', {
        campaignId: data.campaignId,
        data: parsedData
      });

    } catch (error) {
      await this.eventBus.emit('world:parse-error', {
        campaignId: data.campaignId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  private async handleValidateData(data: { worldData: ParsedWorldData }): Promise<void> {
    const validationResult = this.validateParsedData(data.worldData);
    await this.eventBus.emit('world:data-validated', validationResult);
  }

  /**
   * Validate parsed world data
   */
  private validateParsedData(data: ParsedWorldData): any {
    const errors: string[] = [];
    const warnings: string[] = [];

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

/**
 * Coordinate conversion utility for Azgaar maps
 */
class AzgaarCoordinateConverter {
  // Azgaar uses pixel coordinates, we need to convert to lat/lng
  // This is a simplified conversion - in production you'd use proper projection

  convertToGeoJSON(x: number, y: number): GeoJSON.Point {
    // Simple linear transformation (placeholder)
    // In reality, you'd use the map's projection parameters
    const lat = this.pixelToLat(y);
    const lng = this.pixelToLng(x);

    return {
      type: 'Point',
      coordinates: [lng, lat]
    };
  }

  private pixelToLat(pixelY: number): number {
    // Placeholder conversion - assumes map height represents latitude range
    // You'd calibrate this based on the actual map projection
    return 90 - (pixelY / 4096) * 180; // Assuming 8192x8192 map
  }

  private pixelToLng(pixelX: number): number {
    // Placeholder conversion
    return (pixelX / 4096) * 360 - 180;
  }

  convertToPostGIS(x: number, y: number): string {
    const point = this.convertToGeoJSON(x, y);
    return `ST_GeomFromGeoJSON('${JSON.stringify(point)}')`;
  }
}
