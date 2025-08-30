"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseService = void 0;
const EventBus_1 = require("./EventBus");
class BaseService {
    constructor(serviceName, config = {}) {
        this.eventBus = EventBus_1.globalEventBus;
        this.isInitialized = false;
        this.performanceMetrics = {
            totalOperations: 0,
            avgResponseTime: 0,
            errorCount: 0,
            lastOperationTime: 0
        };
        this.serviceName = serviceName;
        this.config = {
            enabled: true,
            debugMode: false,
            performanceBudget: 100,
            fallbackEnabled: true,
            ...config
        };
    }
    async initialize() {
        if (this.isInitialized) {
            return;
        }
        try {
            await this.onInitialize();
            this.isInitialized = true;
            if (this.config.debugMode) {
                console.log(`[${this.serviceName}] Service initialized`);
            }
        }
        catch (error) {
            console.error(`[${this.serviceName}] Initialization failed:`, error);
            throw error;
        }
    }
    async shutdown() {
        if (!this.isInitialized) {
            return;
        }
        try {
            await this.onShutdown();
            this.isInitialized = false;
            if (this.config.debugMode) {
                console.log(`[${this.serviceName}] Service shut down`);
            }
        }
        catch (error) {
            console.error(`[${this.serviceName}] Shutdown failed:`, error);
        }
    }
    async measureOperation(operationName, operation) {
        if (!this.config.enabled) {
            throw new Error(`Service ${this.serviceName} is disabled`);
        }
        const startTime = performance.now();
        try {
            const result = await operation();
            const duration = performance.now() - startTime;
            this.performanceMetrics.totalOperations++;
            this.performanceMetrics.lastOperationTime = duration;
            this.performanceMetrics.avgResponseTime =
                (this.performanceMetrics.avgResponseTime * (this.performanceMetrics.totalOperations - 1) + duration) /
                    this.performanceMetrics.totalOperations;
            if (duration > this.config.performanceBudget) {
                console.warn(`[${this.serviceName}] Performance budget exceeded: ${operationName} took ${duration}ms (budget: ${this.config.performanceBudget}ms)`);
            }
            if (this.config.debugMode) {
                console.log(`[${this.serviceName}] ${operationName} completed in ${duration}ms`);
            }
            return result;
        }
        catch (error) {
            this.performanceMetrics.errorCount++;
            console.error(`[${this.serviceName}] ${operationName} failed:`, error);
            throw error;
        }
    }
    async withFallback(operation, fallback, operationName) {
        try {
            return await operation();
        }
        catch (error) {
            if (!this.config.fallbackEnabled) {
                throw error;
            }
            console.warn(`[${this.serviceName}] ${operationName} failed, using fallback:`, error);
            try {
                return await fallback();
            }
            catch (fallbackError) {
                console.error(`[${this.serviceName}] Fallback also failed:`, fallbackError);
                throw fallbackError;
            }
        }
    }
    getHealthStatus() {
        return {
            serviceName: this.serviceName,
            isInitialized: this.isInitialized,
            isEnabled: this.config.enabled,
            metrics: this.performanceMetrics,
            uptime: this.isInitialized ? Date.now() - performance.timeOrigin : 0
        };
    }
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
    }
}
exports.BaseService = BaseService;
