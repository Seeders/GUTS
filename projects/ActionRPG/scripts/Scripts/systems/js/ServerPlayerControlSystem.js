class ServerPlayerControlSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.serverPlayerControlSystem = this;
        this.serverNetworkManager = this.engine.serverNetworkManager;

        // Track player states
        this.playerEntities = new Map(); // playerId -> entityId
        this.playerPositions = new Map(); // playerId -> {x, y}
        this.playerStates = new Map(); // playerId -> state data

        // Update rate limiting
        this.positionUpdateInterval = 50; // ms between position broadcasts
        this.lastPositionUpdates = new Map(); // playerId -> timestamp
    }

    init(params) {
        this.params = params || {};

        // Register game manager methods
        this.game.gameManager.register('registerPlayerEntity', this.registerPlayerEntity.bind(this));
        this.game.gameManager.register('getPlayerEntityForPlayer', this.getPlayerEntityForPlayer.bind(this));
        this.game.gameManager.register('broadcastPlayerState', this.broadcastPlayerState.bind(this));

        this.subscribeToEvents();
    }

    subscribeToEvents() {
        if (!this.game.serverEventManager) {
            console.error('ServerPlayerControlSystem: No event manager found');
            return;
        }

        // Player movement and control events
        this.game.serverEventManager.subscribe('PLAYER_MOVE', this.handlePlayerMove.bind(this));
        this.game.serverEventManager.subscribe('PLAYER_STOP', this.handlePlayerStop.bind(this));
        this.game.serverEventManager.subscribe('PLAYER_CLICK_MOVE', this.handlePlayerClickMove.bind(this));
        this.game.serverEventManager.subscribe('PLAYER_USE_ABILITY', this.handlePlayerUseAbility.bind(this));
        this.game.serverEventManager.subscribe('PLAYER_USE_POTION', this.handlePlayerUsePotion.bind(this));
        this.game.serverEventManager.subscribe('PLAYER_AUTO_ATTACK', this.handlePlayerAutoAttack.bind(this));
        this.game.serverEventManager.subscribe('REQUEST_PLAYER_STATES', this.handleRequestPlayerStates.bind(this));
    }

    registerPlayerEntity(playerId, entityId) {
        this.playerEntities.set(playerId, entityId);

        // Get initial position
        const position = this.game.getComponent(entityId, 'Position');
        if (position) {
            this.playerPositions.set(playerId, { x: position.x, y: position.y });
        }

        // Initialize state
        this.playerStates.set(playerId, {
            entityId: entityId,
            isMoving: false,
            velocity: { x: 0, y: 0 },
            targetPosition: null,
            lastAbilityTime: 0
        });
    }

    getPlayerEntityForPlayer(playerId) {
        return this.playerEntities.get(playerId);
    }

    handlePlayerMove(eventData) {
        try {
            const { playerId, data } = eventData;
            const { velocity, position } = data;

            const roomId = this.serverNetworkManager.getPlayerRoom(playerId);
            if (!roomId) return;

            const entityId = this.playerEntities.get(playerId);
            if (!entityId) return;

            // Update entity velocity on server
            const velocityComp = this.game.getComponent(entityId, 'Velocity');
            if (velocityComp) {
                velocityComp.x = velocity.x;
                velocityComp.y = velocity.y;
            }

            // Update position if provided (for sync correction)
            if (position) {
                const positionComp = this.game.getComponent(entityId, 'Position');
                if (positionComp) {
                    positionComp.x = position.x;
                    positionComp.y = position.y;
                }
                this.playerPositions.set(playerId, { x: position.x, y: position.y });
            }

            // Update state
            const state = this.playerStates.get(playerId);
            if (state) {
                state.isMoving = velocity.x !== 0 || velocity.y !== 0;
                state.velocity = { x: velocity.x, y: velocity.y };
                state.targetPosition = null; // Clear click-move target
            }

            // Broadcast to other players in room
            this.broadcastPlayerMovement(playerId, roomId, velocity, position);

        } catch (error) {
            console.error('ServerPlayerControlSystem: Error handling player move:', error);
        }
    }

    handlePlayerStop(eventData) {
        try {
            const { playerId, data } = eventData;
            const { position } = data;

            const roomId = this.serverNetworkManager.getPlayerRoom(playerId);
            if (!roomId) return;

            const entityId = this.playerEntities.get(playerId);
            if (!entityId) return;

            // Stop entity
            const velocityComp = this.game.getComponent(entityId, 'Velocity');
            if (velocityComp) {
                velocityComp.x = 0;
                velocityComp.y = 0;
            }

            // Update position
            if (position) {
                const positionComp = this.game.getComponent(entityId, 'Position');
                if (positionComp) {
                    positionComp.x = position.x;
                    positionComp.y = position.y;
                }
                this.playerPositions.set(playerId, { x: position.x, y: position.y });
            }

            // Update state
            const state = this.playerStates.get(playerId);
            if (state) {
                state.isMoving = false;
                state.velocity = { x: 0, y: 0 };
                state.targetPosition = null;
            }

            // Broadcast stop to other players
            this.serverNetworkManager.broadcastToRoom(roomId, 'PLAYER_STOPPED', {
                playerId: playerId,
                position: position
            }, playerId); // Exclude sender

        } catch (error) {
            console.error('ServerPlayerControlSystem: Error handling player stop:', error);
        }
    }

    handlePlayerClickMove(eventData) {
        try {
            const { playerId, data } = eventData;
            const { targetPosition, currentPosition } = data;

            const roomId = this.serverNetworkManager.getPlayerRoom(playerId);
            if (!roomId) return;

            const entityId = this.playerEntities.get(playerId);
            if (!entityId) return;

            // Update state
            const state = this.playerStates.get(playerId);
            if (state) {
                state.targetPosition = targetPosition;
                state.isMoving = true;
            }

            // Broadcast click-move to other players
            this.serverNetworkManager.broadcastToRoom(roomId, 'PLAYER_CLICK_MOVED', {
                playerId: playerId,
                targetPosition: targetPosition,
                currentPosition: currentPosition
            }, playerId);

        } catch (error) {
            console.error('ServerPlayerControlSystem: Error handling click move:', error);
        }
    }

    handlePlayerUseAbility(eventData) {
        try {
            const { playerId, data } = eventData;
            const { abilityIndex, abilityId, targetPosition, targetEntityId } = data;

            const roomId = this.serverNetworkManager.getPlayerRoom(playerId);
            if (!roomId) return;

            const entityId = this.playerEntities.get(playerId);
            if (!entityId) return;

            // Validate ability usage (cooldown, mana, etc.)
            const validation = this.validateAbilityUse(entityId, abilityId);
            if (!validation.valid) {
                this.serverNetworkManager.sendToPlayer(playerId, 'ABILITY_FAILED', {
                    reason: validation.reason,
                    abilityId: abilityId
                });
                return;
            }

            // Execute ability on server
            const success = this.game.gameManager.call('useAbility', entityId, abilityId, targetPosition, targetEntityId);

            if (success) {
                // Broadcast ability use to all players in room
                this.serverNetworkManager.broadcastToRoom(roomId, 'PLAYER_USED_ABILITY', {
                    playerId: playerId,
                    entityId: entityId,
                    abilityIndex: abilityIndex,
                    abilityId: abilityId,
                    targetPosition: targetPosition,
                    targetEntityId: targetEntityId
                });

                // Confirm to sender
                this.serverNetworkManager.sendToPlayer(playerId, 'ABILITY_CONFIRMED', {
                    abilityId: abilityId,
                    success: true
                });
            } else {
                this.serverNetworkManager.sendToPlayer(playerId, 'ABILITY_FAILED', {
                    reason: 'execution_failed',
                    abilityId: abilityId
                });
            }

        } catch (error) {
            console.error('ServerPlayerControlSystem: Error handling ability use:', error);
        }
    }

    handlePlayerUsePotion(eventData) {
        try {
            const { playerId, data } = eventData;
            const { potionType, slotIndex } = data;

            const roomId = this.serverNetworkManager.getPlayerRoom(playerId);
            if (!roomId) return;

            const entityId = this.playerEntities.get(playerId);
            if (!entityId) return;

            // Use potion through potion system
            const success = this.game.gameManager.call('usePotion', entityId, potionType);

            if (success) {
                // Broadcast potion use to room
                this.serverNetworkManager.broadcastToRoom(roomId, 'PLAYER_USED_POTION', {
                    playerId: playerId,
                    entityId: entityId,
                    potionType: potionType
                });

                this.serverNetworkManager.sendToPlayer(playerId, 'POTION_CONFIRMED', {
                    potionType: potionType,
                    success: true
                });
            } else {
                this.serverNetworkManager.sendToPlayer(playerId, 'POTION_FAILED', {
                    potionType: potionType,
                    reason: 'no_potions_or_cooldown'
                });
            }

        } catch (error) {
            console.error('ServerPlayerControlSystem: Error handling potion use:', error);
        }
    }

    handlePlayerAutoAttack(eventData) {
        try {
            const { playerId, data } = eventData;
            const { targetEntityId, enabled } = data;

            const roomId = this.serverNetworkManager.getPlayerRoom(playerId);
            if (!roomId) return;

            const entityId = this.playerEntities.get(playerId);
            if (!entityId) return;

            // Update combat target
            const combat = this.game.getComponent(entityId, 'Combat');
            if (combat) {
                combat.targetId = enabled ? targetEntityId : null;
            }

            // Broadcast auto-attack state
            this.serverNetworkManager.broadcastToRoom(roomId, 'PLAYER_AUTO_ATTACK_CHANGED', {
                playerId: playerId,
                entityId: entityId,
                targetEntityId: enabled ? targetEntityId : null,
                enabled: enabled
            }, playerId);

        } catch (error) {
            console.error('ServerPlayerControlSystem: Error handling auto attack:', error);
        }
    }

    handleRequestPlayerStates(eventData) {
        try {
            const { playerId } = eventData;

            const roomId = this.serverNetworkManager.getPlayerRoom(playerId);
            if (!roomId) return;

            // Send all player states in the room
            const room = this.engine.getRoom(roomId);
            const playerStates = [];

            for (const [pid, state] of this.playerStates) {
                if (this.serverNetworkManager.getPlayerRoom(pid) === roomId) {
                    const entityId = this.playerEntities.get(pid);
                    const position = this.playerPositions.get(pid);

                    playerStates.push({
                        playerId: pid,
                        entityId: entityId,
                        position: position,
                        state: state
                    });
                }
            }

            this.serverNetworkManager.sendToPlayer(playerId, 'PLAYER_STATES', {
                players: playerStates
            });

        } catch (error) {
            console.error('ServerPlayerControlSystem: Error handling player states request:', error);
        }
    }

    validateAbilityUse(entityId, abilityId) {
        // Check if entity exists
        if (!this.game.hasEntity(entityId)) {
            return { valid: false, reason: 'entity_not_found' };
        }

        // Check cooldown via ability system
        const onCooldown = this.game.gameManager.call('isAbilityOnCooldown', entityId, abilityId);
        if (onCooldown) {
            return { valid: false, reason: 'on_cooldown' };
        }

        // Check mana cost
        const manaCost = this.game.gameManager.call('getAbilityManaCost', abilityId);
        if (manaCost) {
            const resourcePool = this.game.getComponent(entityId, 'ResourcePool');
            if (resourcePool && resourcePool.mana < manaCost) {
                return { valid: false, reason: 'insufficient_mana' };
            }
        }

        return { valid: true };
    }

    broadcastPlayerMovement(playerId, roomId, velocity, position) {
        // Rate limit position updates
        const now = Date.now();
        const lastUpdate = this.lastPositionUpdates.get(playerId) || 0;

        if (now - lastUpdate < this.positionUpdateInterval) {
            return;
        }

        this.lastPositionUpdates.set(playerId, now);

        // Broadcast to other players
        this.serverNetworkManager.broadcastToRoom(roomId, 'PLAYER_MOVED', {
            playerId: playerId,
            velocity: velocity,
            position: position
        }, playerId); // Exclude sender
    }

    broadcastPlayerState(playerId) {
        const roomId = this.serverNetworkManager.getPlayerRoom(playerId);
        if (!roomId) return;

        const entityId = this.playerEntities.get(playerId);
        if (!entityId) return;

        // Get full entity state
        const position = this.game.getComponent(entityId, 'Position');
        const velocity = this.game.getComponent(entityId, 'Velocity');
        const health = this.game.getComponent(entityId, 'Health');
        const resourcePool = this.game.getComponent(entityId, 'ResourcePool');

        this.serverNetworkManager.broadcastToRoom(roomId, 'PLAYER_STATE_UPDATE', {
            playerId: playerId,
            entityId: entityId,
            position: position ? { x: position.x, y: position.y } : null,
            velocity: velocity ? { x: velocity.x, y: velocity.y } : null,
            health: health ? { current: health.current, max: health.max } : null,
            mana: resourcePool ? { current: resourcePool.mana, max: resourcePool.maxMana } : null
        });
    }

    update(deltaTime) {
        // Periodically sync player positions for all players
        // This ensures consistency even if some updates are lost
    }

    cleanup() {
        this.playerEntities.clear();
        this.playerPositions.clear();
        this.playerStates.clear();
        this.lastPositionUpdates.clear();
    }
}
