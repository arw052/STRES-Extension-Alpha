/**
 * Base service interface and utilities
 * All services extend from this base for consistent behavior
 */
export interface ServiceConfig {
    enabled: boolean;
    debugMode: boolean;
    performanceBudget: number;
    fallbackEnabled: boolean;
}
export declare abstract class BaseService {
    protected config: ServiceConfig;
    protected eventBus: import("./EventBus").EventBus;
    protected serviceName: string;
    protected isInitialized: boolean;
    protected performanceMetrics: {
        totalOperations: number;
        avgResponseTime: number;
        errorCount: number;
        lastOperationTime: number;
    };
    constructor(serviceName: string, config?: Partial<ServiceConfig>);
    /**
     * Initialize the service
     */
    initialize(): Promise<void>;
    /**
     * Shutdown the service
     */
    shutdown(): Promise<void>;
    /**
     * Measure operation performance and enforce budgets
     */
    protected measureOperation<T>(operationName: string, operation: () => Promise<T>): Promise<T>;
    /**
     * Execute operation with fallback
     */
    protected withFallback<T>(operation: () => Promise<T>, fallback: () => Promise<T>, operationName: string): Promise<T>;
    /**
     * Get service health status
     */
    getHealthStatus(): {
        serviceName: string;
        isInitialized: boolean;
        isEnabled: boolean;
        metrics: {
            totalOperations: number;
            avgResponseTime: number;
            errorCount: number;
            lastOperationTime: number;
        };
        uptime: number;
    };
    /**
     * Update service configuration
     */
    updateConfig(newConfig: Partial<ServiceConfig>): void;
    /**
     * Abstract methods to be implemented by subclasses
     */
    protected abstract onInitialize(): Promise<void>;
    protected abstract onShutdown(): Promise<void>;
}
//# sourceMappingURL=BaseService.d.ts.map