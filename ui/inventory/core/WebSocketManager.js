"use strict";

class WebSocketManager {
    constructor(configManager) {
        this.configManager = configManager;
        this.ws = null;
        this.isConnected = false;
        this.eventHandlers = new Map();
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        this.messageQueue = [];
        this.isReconnecting = false;
    }

    connect(apiBase) {
        if (this.ws && this.isConnected) {
            console.log('[STRES] WebSocket already connected');
            return;
        }

        try {
            // Extract host from API base, default to localhost:3001
            const apiUrl = apiBase || 'http://localhost:3001';
            const url = new URL(apiUrl);
            const wsUrl = `ws://${url.host}`;

            console.log('[STRES] Connecting to WebSocket:', wsUrl);
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                console.log('[STRES] WebSocket connected');
                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.isReconnecting = false;

                // Send join message
                this.sendJoinMessage();

                // Process queued messages
                while (this.messageQueue.length > 0) {
                    const message = this.messageQueue.shift();
                    this.send(message);
                }
            };

            this.ws.onmessage = (event) => {
                try {
                    const envelope = JSON.parse(event.data);
                    this.handleMessage(envelope);
                } catch (error) {
                    console.error('[STRES] Failed to parse WebSocket message:', error);
                }
            };

            this.ws.onclose = (event) => {
                console.log('[STRES] WebSocket closed:', event.code, event.reason);
                this.isConnected = false;
                this.ws = null;

                if (!this.isReconnecting && event.code !== 1000) {
                    this.attemptReconnect();
                }
            };

            this.ws.onerror = (error) => {
                console.error('[STRES] WebSocket error:', error);
                this.isConnected = false;
            };

        } catch (error) {
            console.error('[STRES] Failed to create WebSocket connection:', error);
            this.attemptReconnect();
        }
    }

    sendJoinMessage() {
        const config = this.configManager.getEffectiveConfig();
        const campaignId = config.combat?.campaignId || 'default-campaign';
        const filters = {
            channels: ['inventory', 'combat', 'campaign', 'token']
        };

        const joinMessage = {
            type: 'join.campaign',
            campaignId: campaignId,
            filters: filters,
            timestamp: Date.now()
        };

        console.log('[STRES] Sending join message:', joinMessage);
        this.send(joinMessage);
    }

    send(message) {
        if (!this.ws || !this.isConnected) {
            console.warn('[STRES] WebSocket not connected, queuing message');
            this.messageQueue.push(message);
            return false;
        }

        try {
            this.ws.send(JSON.stringify(message));
            return true;
        } catch (error) {
            console.error('[STRES] Failed to send WebSocket message:', error);
            return false;
        }
    }

    handleMessage(envelope) {
        const { type, eventId, data, timestamp } = envelope;

        console.log('[STRES] Received WS message:', type, data);

        // Handle specific event types
        if (type === 'join.ack') {
            console.log('[STRES] Successfully joined campaign');
            window.dispatchEvent(new CustomEvent('stres:ws:joined', { detail: data }));
            return;
        }

        // Route to registered handlers
        const handlers = this.eventHandlers.get(type) || [];
        handlers.forEach(handler => {
            try {
                handler(data, envelope);
            } catch (error) {
                console.error('[STRES] Error in event handler for', type, error);
            }
        });

        // Dispatch general event
        window.dispatchEvent(new CustomEvent('stres:ws:message', {
            detail: { type, eventId, data, timestamp, envelope }
        }));
    }

    on(eventType, handler) {
        if (!this.eventHandlers.has(eventType)) {
            this.eventHandlers.set(eventType, []);
        }
        this.eventHandlers.get(eventType).push(handler);
    }

    off(eventType, handler) {
        const handlers = this.eventHandlers.get(eventType);
        if (handlers) {
            const index = handlers.indexOf(handler);
            if (index > -1) {
                handlers.splice(index, 1);
            }
        }
    }

    attemptReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('[STRES] Max WebSocket reconnect attempts reached');
            return;
        }

        this.isReconnecting = true;
        this.reconnectAttempts++;

        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
        console.log(`[STRES] Attempting WebSocket reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);

        setTimeout(() => {
            const config = this.configManager.getEffectiveConfig();
            this.connect(config.combat?.apiBase);
        }, delay);
    }

    disconnect() {
        if (this.ws) {
            this.ws.close(1000, 'Client disconnect');
            this.ws = null;
        }
        this.isConnected = false;
        this.isReconnecting = false;
        this.messageQueue = [];
    }

    isReady() {
        return this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN;
    }

    getConnectionStatus() {
        if (!this.ws) return 'disconnected';
        switch (this.ws.readyState) {
            case WebSocket.CONNECTING: return 'connecting';
            case WebSocket.OPEN: return 'connected';
            case WebSocket.CLOSING: return 'closing';
            case WebSocket.CLOSED: return 'closed';
            default: return 'unknown';
        }
    }
}

export { WebSocketManager };
