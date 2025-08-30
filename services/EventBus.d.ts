/**
 * Event-driven service communication system
 * Services never call each other directly - only through events
 */
interface EventHandler {
    (data: any): void;
}
interface EventMetrics {
    totalEvents: number;
    eventsPerSecond: number;
    avgProcessingTime: number;
    errorCount: number;
}
export declare class EventBus {
    private handlers;
    private metrics;
    private processingTimes;
    /**
     * Register an event handler
     */
    on(event: string, handler: EventHandler): void;
    /**
     * Remove an event handler
     */
    off(event: string, handler: EventHandler): void;
    /**
     * Emit an event to all registered handlers
     */
    emit(event: string, data: any): Promise<void>;
    /**
     * Get performance metrics for an event
     */
    getMetrics(event: string): EventMetrics | null;
    /**
     * Get all registered events
     */
    getRegisteredEvents(): string[];
    /**
     * Clear all handlers for an event
     */
    clearEvent(event: string): void;
    /**
     * Clear all handlers
     */
    clearAll(): void;
}
export declare const globalEventBus: EventBus;
export {};
//# sourceMappingURL=EventBus.d.ts.map