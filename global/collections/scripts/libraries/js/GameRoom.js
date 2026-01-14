class GameRoom {
    constructor(engine, roomId, gameInstance, maxPlayers) {
        this.id = roomId;
        this.engine = engine;
        this.game = gameInstance;
        this.serverNetworkManager = this.engine.serverNetworkManager;
        this.game.room = this;
        this.maxPlayers = maxPlayers;
        this.players = new Map();  // socketId -> player data
        this.socketToNumericId = new Map();  // socketId -> numeric playerId
        this.numericToSocketId = new Map();  // numeric playerId -> socketId
        this.nextPlayerId = 0;  // Counter for assigning numeric IDs
        this.isActive = false;
        this.lastStateSnapshot = null;
        this.stateHistory = []; // For lag compensation
        this.inputBuffer = new Map(); // Player inputs awaiting processing
    }

    addPlayer(socketId, playerData) {
        if (this.players.size >= this.maxPlayers) {
            return { success: false, reason: 'Room full' };
        }

        // Assign numeric player ID
        const numericPlayerId = this.nextPlayerId++;
        this.socketToNumericId.set(socketId, numericPlayerId);
        this.numericToSocketId.set(numericPlayerId, socketId);

        this.players.set(socketId, {
            id: socketId,
            numericId: numericPlayerId,
            ...playerData,
            lastInputSequence: 0,
            inputBuffer: [],
            latency: 0
        });


        if (this.players.size === this.maxPlayers) {
            this.startGame();
        }

        return { success: true, numericPlayerId };
    }

    removePlayer(socketId) {
        if (this.players.has(socketId)) {
            // Clean up numeric ID mappings
            const numericId = this.socketToNumericId.get(socketId);
            if (numericId !== undefined) {
                this.numericToSocketId.delete(numericId);
                this.socketToNumericId.delete(socketId);
            }

            // Remove player entity from game
            this.players.delete(socketId);

            if (this.players.size === 0) {
                this.isActive = false;
            }
        }
    }

    getPlayer(socketId) {
        return this.players.get(socketId);
    }

    getPlayerByNumericId(numericId) {
        const socketId = this.numericToSocketId.get(numericId);
        return socketId ? this.players.get(socketId) : null;
    }

    getNumericPlayerId(socketId) {
        return this.socketToNumericId.get(socketId);
    }

    getSocketId(numericId) {
        return this.numericToSocketId.get(numericId);
    }



    async startGame() {
        this.isActive = true;
        await this.game.init(true);
        // Initialize game scene
        console.log('GameRoom startGame()')

    }

    processPlayerInput(playerId, inputData) {
        const player = this.players.get(playerId);
        if (!player) return;

        // Validate input sequence to prevent replay attacks
        if (inputData.sequence <= player.lastInputSequence) {
            return;
        }

        player.lastInputSequence = inputData.sequence;
        
        // Queue input for processing
        if (!this.inputBuffer.has(playerId)) {
            this.inputBuffer.set(playerId, []);
        }
        
        this.inputBuffer.get(playerId).push({
            ...inputData,
            timestamp: Date.now()
        });
    }

    update(deltaTime) {
        if (!this.isActive) return;

        // Process all queued inputs
        this.processQueuedInputs();
        
        // Update game state
        this.game.update(deltaTime);
        
        // Store state snapshot for lag compensation
        this.storeStateSnapshot();
        
        // Prepare network update
        this.prepareNetworkUpdate();
    }

    processQueuedInputs() {
        for (const [playerId, inputs] of this.inputBuffer) {
            const player = this.players.get(playerId);
            if (!player || !player.entityId) continue;

            for (const input of inputs) {
                this.applyPlayerInput(player.entityId, input);
            }
            
            // Clear processed inputs
            inputs.length = 0;
        }
    }

    applyPlayerInput(entityId, inputData) {
        const transform = this.game.getComponent(entityId, 'Transform');
        if (!transform) return;

        const speed = 200; // pixels per second
        const deltaTime = 1/20; // Server tick rate

        // Apply movement
        if (inputData.keys.left) transform.x -= speed * deltaTime;
        if (inputData.keys.right) transform.x += speed * deltaTime;
        if (inputData.keys.up) transform.y -= speed * deltaTime;
        if (inputData.keys.down) transform.y += speed * deltaTime;

        // Validate movement (bounds checking, collision, etc.)
        this.validateMovement(entityId, transform);
    }

    validateMovement(entityId, transform) {
        // Implement game-specific validation
        // Bounds checking, collision detection, etc.
        const bounds = this.game.getCollections().configs.game.worldBounds;
        
        transform.x = Math.max(0, Math.min(bounds.width, transform.x));
        transform.y = Math.max(0, Math.min(bounds.height, transform.y));
    }

    storeStateSnapshot() {
        const snapshot = {
            timestamp: Date.now(),
            entities: new Map()
        };

        // Store relevant entity states
        for (const [playerId, player] of this.players) {
            if (player.entityId) {
                const transform = this.game.getComponent(player.entityId, 'Transform');
                const playerComp = this.game.getComponent(player.entityId, 'Player');
                
                snapshot.entities.set(player.entityId, {
                    transform: { ...transform },
                    player: { ...playerComp }
                });
            }
        }

        this.stateHistory.push(snapshot);
        
        // Keep only last 1 second of history (20 snapshots at 20 TPS)
        if (this.stateHistory.length > 20) {
            this.stateHistory.shift();
        }
    }

    prepareNetworkUpdate() {
        const gameState = {
            type: 'GAME_STATE',
            timestamp: Date.now(),
            entities: {}
        };

        // Include all network-synced entities
        for (const [playerId, player] of this.players) {
            if (player.entityId) {
                const transform = this.game.getComponent(player.entityId, 'Transform');
                const playerComp = this.game.getComponent(player.entityId, 'Player');
                
                gameState.entities[player.entityId] = {
                    playerId: playerId,
                    transform,
                    player: playerComp
                };
            }
        }

        this.lastStateSnapshot = gameState;
    }

    broadcastToPlayers(type, data) {
        this.serverNetworkManager.broadcastToRoom(this.id, type, data);
    }
}


// Assign to global.GUTS for server
if (typeof global !== 'undefined' && global.GUTS) {
    global.GUTS.GameRoom = GameRoom;
}

// ES6 exports for webpack bundling
export default GameRoom;
export { GameRoom };
