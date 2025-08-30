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

export class EventBus {
  private handlers: Map<string, EventHandler[]> = new Map();
  private metrics: Map<string, EventMetrics> = new Map();
  private processingTimes: Map<string, number[]> = new Map();

  /**
   * Register an event handler
   */
  on(event: string, handler: EventHandler): void {
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
    this.handlers.get(event)!.push(handler);
  }

  /**
   * Remove an event handler
   */
  off(event: string, handler: EventHandler): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index !== -1) {
        handlers.splice(index, 1);
      }
    }
  }

  /**
   * Emit an event to all registered handlers
   */
  async emit(event: string, data: any): Promise<void> {
    const handlers = this.handlers.get(event);
    if (!handlers || handlers.length === 0) {
      return;
    }

    const metrics = this.metrics.get(event)!;
    const startTime = performance.now();

    try {
      // Process all handlers concurrently
      await Promise.all(
        handlers.map(async (handler) => {
          try {
            await handler(data);
          } catch (error) {
            console.error(`Event handler error for ${event}:`, error);
            metrics.errorCount++;
          }
        })
      );

      // Update metrics
      metrics.totalEvents++;
      const processingTime = performance.now() - startTime;
      const times = this.processingTimes.get(event)!;
      times.push(processingTime);

      // Keep only last 100 measurements for rolling average
      if (times.length > 100) {
        times.shift();
      }

      metrics.avgProcessingTime = times.reduce((a, b) => a + b, 0) / times.length;

    } catch (error) {
      console.error(`Event emission error for ${event}:`, error);
      metrics.errorCount++;
    }
  }

  /**
   * Get performance metrics for an event
   */
  getMetrics(event: string): EventMetrics | null {
    return this.metrics.get(event) || null;
  }

  /**
   * Get all registered events
   */
  getRegisteredEvents(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Clear all handlers for an event
   */
  clearEvent(event: string): void {
    this.handlers.delete(event);
    this.metrics.delete(event);
    this.processingTimes.delete(event);
  }

  /**
   * Clear all handlers
   */
  clearAll(): void {
    this.handlers.clear();
    this.metrics.clear();
    this.processingTimes.clear();
  }
}

// Global event bus instance
export const globalEventBus = new EventBus();
