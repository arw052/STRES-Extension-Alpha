"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.globalEventBus = exports.EventBus = void 0;
class EventBus {
    constructor() {
        this.handlers = new Map();
        this.metrics = new Map();
        this.processingTimes = new Map();
    }
    on(event, handler) {
        if (!this.handlers.has(event)) {
            this.handlers.set(event, []);
            this.metrics.set(event, {
                totalEvents: 0,
                eventsPerSecond: 0,
                avgProcessingTime: 0,
                errorCount: 0
            });
            this.processingTimes.set(event, []);
        }
        this.handlers.get(event).push(handler);
    }
    off(event, handler) {
        const handlers = this.handlers.get(event);
        if (handlers) {
            const index = handlers.indexOf(handler);
            if (index !== -1) {
                handlers.splice(index, 1);
            }
        }
    }
    async emit(event, data) {
        const handlers = this.handlers.get(event);
        if (!handlers || handlers.length === 0) {
            return;
        }
        const metrics = this.metrics.get(event);
        const startTime = performance.now();
        try {
            await Promise.all(handlers.map(async (handler) => {
                try {
                    await handler(data);
                }
                catch (error) {
                    console.error(`Event handler error for ${event}:`, error);
                    metrics.errorCount++;
                }
            }));
            metrics.totalEvents++;
            const processingTime = performance.now() - startTime;
            const times = this.processingTimes.get(event);
            times.push(processingTime);
            if (times.length > 100) {
                times.shift();
            }
            metrics.avgProcessingTime = times.reduce((a, b) => a + b, 0) / times.length;
        }
        catch (error) {
            console.error(`Event emission error for ${event}:`, error);
            metrics.errorCount++;
        }
    }
    getMetrics(event) {
        return this.metrics.get(event) || null;
    }
    getRegisteredEvents() {
        return Array.from(this.handlers.keys());
    }
    clearEvent(event) {
        this.handlers.delete(event);
        this.metrics.delete(event);
        this.processingTimes.delete(event);
    }
    clearAll() {
        this.handlers.clear();
        this.metrics.clear();
        this.processingTimes.clear();
    }
}
exports.EventBus = EventBus;
exports.globalEventBus = new EventBus();
