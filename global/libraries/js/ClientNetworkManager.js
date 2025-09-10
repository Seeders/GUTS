class ClientNetworkManager {
    constructor(game, options = {}) {
        this.game = game;
        this.game.clientNetworkManager = this;
        this.socket = null;
        this.isConnected = false;
        
        // Configuration
        this.serverUrl = options.serverUrl || this.game.getCollections().configs.multiplayer.serverUrl;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = options.maxReconnectAttempts || 5;
        this.reconnectDelay = options.reconnectDelay || 1000;
        this.callTimeout = options.callTimeout || 10000;
        
        // Event system
        this.listeners = new Map(); // eventName -> Set of callbacks
        this.oneTimeCallbacks = new Map(); // eventName -> Map of callbackId -> callback
        this.callbackCounter = 0;
        
    }

    // =============================================
    // CONNECTION MANAGEMENT
    // =============================================

    async connect(serverUrl = null) {
        if (serverUrl) {
            this.serverUrl = serverUrl;
        }

        try {
            // Uncomment when socket.io is available
            // const { io } = await import('/socket.io/socket.io.js');
            this.socket = io(this.serverUrl, {
                transports: ['websocket', 'polling']
            });

            this.setupSocketEventHandlers();
            
            return new Promise((resolve, reject) => {
                this.socket.on('connect', () => {
                    console.log('Connected to server');
                    this.isConnected = true;
                    this.reconnectAttempts = 0;
                    this.emit('connect', { connected: true });
                    resolve();
                });

                this.socket.on('connect_error', (error) => {
                    console.log('disconnected:', error);
                    this.emit('connect_error', error);
                    reject(error);
                });
            });
        } catch (error) {
            console.error('Failed to initialize socket connection:', error);
            throw error;
        }
    }

    setupSocketEventHandlers() {
        // Handle disconnect
        this.socket.on('disconnect', (reason) => {
            console.log('Disconnected from server:', reason);
            this.isConnected = false;
            this.emit('disconnect', { reason });
            this.handleDisconnection();
        });

        // Forward all events to our event system
        if (typeof this.socket.onAny === 'function') {
            this.socket.onAny((eventName, data) => {
                this.emit(eventName, data);
            });
        } else {
            // Fallback for older socket.io versions
            const originalOn = this.socket.on.bind(this.socket);
            
            this.socket.on = (eventName, callback) => {
                const wrappedCallback = (data) => {
                    if (callback) callback(data);
                    this.emit(eventName, data);
                };
                
                return originalOn(eventName, wrappedCallback);
            };
        }
    }

    handleDisconnection() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            console.log(`Attempting to reconnect... (${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})`);
            
            setTimeout(() => {
                this.reconnectAttempts++;
                this.connect().catch(() => {
                    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                        this.emit('connection_lost', {
                            attempts: this.reconnectAttempts,
                            maxAttempts: this.maxReconnectAttempts
                        });
                    }
                });
            }, this.reconnectDelay * this.reconnectAttempts);
        } else {
            this.emit('connection_lost', {
                attempts: this.reconnectAttempts,
                maxAttempts: this.maxReconnectAttempts
            });
        }
    }

    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
        this.isConnected = false;
        this.emit('disconnect', { reason: 'Manual disconnect' });
    }

    // =============================================
    // EVENT SYSTEM
    // =============================================

    /**
     * Listen for an event from the server
     * @param {string} eventName - The event name to listen for
     * @param {function} callback - The callback function
     * @returns {function} - Unsubscribe function
     */
    listen(eventName, callback) {
        if (!this.listeners.has(eventName)) {
            this.listeners.set(eventName, new Set());
        }
        
        this.listeners.get(eventName).add(callback);
        
        // Return unsubscribe function
        return () => {
            const callbacks = this.listeners.get(eventName);
            if (callbacks) {
                callbacks.delete(callback);
                if (callbacks.size === 0) {
                    this.listeners.delete(eventName);
                }
            }
        };
    }

    /**
     * Remove a listener for an event
     * @param {string} eventName - The event name
     * @param {function} callback - The callback to remove
     */
    unlisten(eventName, callback) {
        const callbacks = this.listeners.get(eventName);
        if (callbacks) {
            callbacks.delete(callback);
            if (callbacks.size === 0) {
                this.listeners.delete(eventName);
            }
        }
    }

    /**
     * Emit an event to all listeners
     * @param {string} eventName - The event name
     * @param {any} data - The event data
     */
    emit(eventName, data) {
        // Emit to persistent listeners
        const callbacks = this.listeners.get(eventName);
        if (callbacks) {
            callbacks.forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`Error in event listener for ${eventName}:`, error);
                }
            });
        }

        // Emit to one-time callbacks
        const oneTimeCallbacks = this.oneTimeCallbacks.get(eventName);
        if (oneTimeCallbacks) {
            oneTimeCallbacks.forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`Error in one-time callback for ${eventName}:`, error);
                }
            });
            this.oneTimeCallbacks.delete(eventName);
        }
    }

    /**
     * Call a server method - optionally wait for a response
     * @param {string} sendEvent - The event to send to server
     * @param {any} data - Data to send
     * @param {string} responseEvent - The event to wait for (optional)
     * @param {function} callback - Callback when response is received (optional)
     * @param {number} timeout - Timeout in milliseconds (optional)
     * @returns {number|null} - Callback ID that can be used to cancel, or null for fire-and-forget
     */
    call(sendEvent, data = {}, responseEvent = null, callback = null, timeout = null) {
        if (!this.isConnected) {
            const error = new Error('Not connected to server');
            if (callback) {
                setTimeout(() => callback(null, error), 0);
            }
            return null;
        }

        // If no response event expected, just send (fire and forget)
        if (!responseEvent || !callback) {
            this.socket.emit(sendEvent, data);
            if (callback) {
                setTimeout(() => callback(true), 0);
            }
            return null;
        }

        // Generate unique callback ID
        const callbackId = ++this.callbackCounter;

        // Store the one-time callback
        if (!this.oneTimeCallbacks.has(responseEvent)) {
            this.oneTimeCallbacks.set(responseEvent, new Map());
        }
        
        const responseCallbacks = this.oneTimeCallbacks.get(responseEvent);
        responseCallbacks.set(callbackId, callback);

        // Set up timeout
        const timeoutMs = timeout || this.callTimeout;
        let timeoutId = null;
        if (timeoutMs > 0) {
            timeoutId = setTimeout(() => {
                const callbacks = this.oneTimeCallbacks.get(responseEvent);
                if (callbacks && callbacks.has(callbackId)) {
                    callbacks.delete(callbackId);
                    if (callbacks.size === 0) {
                        this.oneTimeCallbacks.delete(responseEvent);
                    }
                    const timeoutError = new Error(`Timeout waiting for ${responseEvent}`);
                    callback(null, timeoutError);
                }
            }, timeoutMs);
        }

        // Wrap callback to clear timeout
        if (timeoutId) {
            const originalCallback = responseCallbacks.get(callbackId);
            responseCallbacks.set(callbackId, (data) => {
                clearTimeout(timeoutId);
                originalCallback(data);
            });
        }

        // Send the event
        this.socket.emit(sendEvent, data);

        return callbackId;
    }

    /**
     * Cancel a pending call
     * @param {string} responseEvent - The response event
     * @param {number} callbackId - The callback ID
     */
    cancelCall(responseEvent, callbackId) {
        const callbacks = this.oneTimeCallbacks.get(responseEvent);
        if (callbacks && callbacks.has(callbackId)) {
            callbacks.delete(callbackId);
            if (callbacks.size === 0) {
                this.oneTimeCallbacks.delete(responseEvent);
            }
        }
    }

    // =============================================
    // UTILITY METHODS
    // =============================================

    /**
     * Get connection state
     */
    getConnectionState() {
        return {
            isConnected: this.isConnected,
            reconnectAttempts: this.reconnectAttempts,
            maxReconnectAttempts: this.maxReconnectAttempts
        };
    }

    /**
     * Set reconnection options
     */
    setReconnectionOptions(options) {
        if (options.maxReconnectAttempts !== undefined) {
            this.maxReconnectAttempts = options.maxReconnectAttempts;
        }
        if (options.reconnectDelay !== undefined) {
            this.reconnectDelay = options.reconnectDelay;
        }
        if (options.callTimeout !== undefined) {
            this.callTimeout = options.callTimeout;
        }
    }

    // =============================================
    // CLEANUP
    // =============================================

    destroy() {
        // Clean up all listeners
        this.listeners.clear();
        this.oneTimeCallbacks.clear();
        
        // Disconnect socket
        this.disconnect();
    }
}