/**
 * Base service interface and utilities
 * All services extend from this base for consistent behavior
 */

import { globalEventBus } from './EventBus';

export interface ServiceConfig {
  enabled: boolean;
  debugMode: boolean;
  performanceBudget: number; // ms
  fallbackEnabled: boolean;
}

export abstract class BaseService {
  protected config: ServiceConfig;
  protected eventBus = globalEventBus;
  protected serviceName: string;
  protected isInitialized = false;
  protected performanceMetrics = {
    totalOperations: 0,
    avgResponseTime: 0,
    errorCount: 0,
    lastOperationTime: 0
  };

  constructor(serviceName: string, config: Partial<ServiceConfig> = {}) {
    this.serviceName = serviceName;
    this.config = {
      enabled: true,
      debugMode: false,
      performanceBudget: 100,
      fallbackEnabled: true,
      ...config
    };
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      await this.onInitialize();
      this.isInitialized = true;

      if (this.config.debugMode) {
        console.log(`[${this.serviceName}] Service initialized`);
      }
    } catch (error) {
      console.error(`[${this.serviceName}] Initialization failed:`, error);
      throw error;
    }
  }

  /**
   * Shutdown the service
   */
  async shutdown(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    try {
      await this.onShutdown();
      this.isInitialized = false;

      if (this.config.debugMode) {
        console.log(`[${this.serviceName}] Service shut down`);
      }
    } catch (error) {
      console.error(`[${this.serviceName}] Shutdown failed:`, error);
    }
  }

  /**
   * Measure operation performance and enforce budgets
   */
  protected async measureOperation<T>(
    operationName: string,
    operation: () => Promise<T>
  ): Promise<T> {
    if (!this.config.enabled) {
      throw new Error(`Service ${this.serviceName} is disabled`);
    }

    const startTime = performance.now();

    try {
      const result = await operation();
      const duration = performance.now() - startTime;

      // Update metrics
      this.performanceMetrics.totalOperations++;
      this.performanceMetrics.lastOperationTime = duration;
      this.performanceMetrics.avgResponseTime =
        (this.performanceMetrics.avgResponseTime * (this.performanceMetrics.totalOperations - 1) + duration) /
        this.performanceMetrics.totalOperations;

      // Check performance budget
      if (duration > this.config.performanceBudget) {
        console.warn(
          `[${this.serviceName}] Performance budget exceeded: ${operationName} took ${duration}ms (budget: ${this.config.performanceBudget}ms)`
        );
      }

      if (this.config.debugMode) {
        console.log(`[${this.serviceName}] ${operationName} completed in ${duration}ms`);
      }

      return result;
    } catch (error) {
      this.performanceMetrics.errorCount++;
      console.error(`[${this.serviceName}] ${operationName} failed:`, error);
      throw error;
    }
  }

  /**
   * Execute operation with fallback
   */
  protected async withFallback<T>(
    operation: () => Promise<T>,
    fallback: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (!this.config.fallbackEnabled) {
        throw error;
      }

      console.warn(
        `[${this.serviceName}] ${operationName} failed, using fallback:`,
        error
      );

      try {
        return await fallback();
      } catch (fallbackError) {
        console.error(`[${this.serviceName}] Fallback also failed:`, fallbackError);
        throw fallbackError;
      }
    }
  }

  /**
   * Get service health status
   */
  getHealthStatus() {
    return {
      serviceName: this.serviceName,
      isInitialized: this.isInitialized,
      isEnabled: this.config.enabled,
      metrics: this.performanceMetrics,
      uptime: this.isInitialized ? Date.now() - (performance as any).timeOrigin : 0
    };
  }

  /**
   * Update service configuration
   */
  updateConfig(newConfig: Partial<ServiceConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Abstract methods to be implemented by subclasses
   */
  protected abstract onInitialize(): Promise<void>;
  protected abstract onShutdown(): Promise<void>;
}
