class GameRoom {
    constructor(engine, roomId, gameInstance, maxPlayers) {
        this.id = roomId;
        this.engine = engine;
        this.game = gameInstance;
        this.serverNetworkManager = this.engine.serverNetworkManager;
        this.game.room = this;
        this.maxPlayers = maxPlayers;
        this.players = new Map();
        this.isActive = false;
        this.lastStateSnapshot = null;
        this.stateHistory = []; // For lag compensation
        this.inputBuffer = new Map(); // Player inputs awaiting processing
    }

    addPlayer(playerId, playerData) {
        if (this.players.size >= this.maxPlayers) {
            return { success: false, reason: 'Room full' };
        }

        this.players.set(playerId, {
            id: playerId,
            ...playerData,
            lastInputSequence: 0,
            inputBuffer: [],
            latency: 0
        });

        // Spawn player entity in game
        this.spawnPlayerEntity(playerId);

        if (this.players.size === this.maxPlayers) {
            this.startGame();
        }

        return { success: true };
    }

    removePlayer(playerId) {
        if (this.players.has(playerId)) {
            // Remove player entity from game
            this.despawnPlayerEntity(playerId);
            this.players.delete(playerId);
            
            if (this.players.size === 0) {
                this.isActive = false;
            }
        }
    }

    getPlayer(playerId){
        return this.players.get(playerId);
    }

    spawnPlayerEntity(playerId) {
        // Create player entity in ECS
        const entityId = this.game.createEntity();
        
        // Add components for player
        this.game.addComponent(entityId, 'Transform', {
            x: 100 + (this.players.size * 50),
            y: 100,
            rotation: 0
        });
        
        this.game.addComponent(entityId, 'Player', {
            playerId: playerId,
            health: 100,
            score: 0
        });
        
        this.game.addComponent(entityId, 'NetworkSync', {
            playerId: playerId,
            lastUpdate: Date.now()
        });

        // Store entity reference
        this.players.get(playerId).entityId = entityId;
    }

    despawnPlayerEntity(playerId) {
        const player = this.players.get(playerId);
        if (player && player.entityId) {
            this.game.destroyEntity(player.entityId);
        }
    }

    startGame() {
        this.isActive = true;
        
        // Initialize game scene
        this.game.sceneManager.load(this.game.getCollections().configs.server.initialScene);

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

    update(deltaTime, now) {
        if (!this.isActive) return;

        // Process all queued inputs
        this.processQueuedInputs();
        
        // Update game state
        this.game.update(deltaTime, now);
        
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
            console.log('broadcasting to all players', message);
        this.serverNetworkManager.broadcastToRoom(this.id, type, data);
    }
}


if (typeof window !== 'undefined') {
    window.GameRoom = GameRoom;
}

// Make available as ES module export (new for server)  
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GameRoom;
}

// Make available as ES6 export (also new for server)
if (typeof exports !== 'undefined') {
    exports.default = GameRoom;
    exports.GameRoom = GameRoom;
}