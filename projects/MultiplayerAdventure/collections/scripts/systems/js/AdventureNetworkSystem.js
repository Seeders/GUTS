/**
 * AdventureNetworkSystem - Handles networking for the multiplayer adventure game
 *
 * Manages:
 * - Server connection and player identification
 * - Town hub synchronization (seeing other players)
 * - Party management (invite, join, leave)
 * - Instance creation and joining
 * - Real-time position/action sync within instances
 */
class AdventureNetworkSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.adventureNetworkSystem = this;

        // State tracking
        this.playerId = null;
        this.playerName = null;
        this.currentZone = 'lobby'; // lobby, town, instance
        this.instanceId = null;
        this.partyId = null;
        this.isPartyLeader = false;

        // Network listeners cleanup
        this.networkUnsubscribers = [];

        // Position sync throttling
        this.lastPositionSync = 0;
        this.positionSyncInterval = 50; // ms between position updates

        // Other players in current zone
        this.otherPlayers = new Map(); // playerId -> { entityId, name, position, etc }
    }

    init(params) {
        this.params = params || {};
        console.log('[AdventureNetworkSystem] Initializing...');
        this.registerServices();
        this.connectToServer();
    }

    registerServices() {
        // Connection services
        this.game.register('connectToServer', this.connectToServer.bind(this));
        this.game.register('getPlayerId', () => this.playerId);
        this.game.register('getPlayerName', () => this.playerName);

        // Zone services
        this.game.register('enterTown', this.enterTown.bind(this));
        this.game.register('leaveTown', this.leaveTown.bind(this));
        this.game.register('getCurrentZone', () => this.currentZone);

        // Party services
        this.game.register('createParty', this.createParty.bind(this));
        this.game.register('inviteToParty', this.inviteToParty.bind(this));
        this.game.register('joinParty', this.joinParty.bind(this));
        this.game.register('leaveParty', this.leaveParty.bind(this));
        this.game.register('getPartyMembers', this.getPartyMembers.bind(this));
        this.game.register('isInParty', () => this.partyId !== null);
        this.game.register('isPartyLeader', () => this.isPartyLeader);

        // Instance services
        this.game.register('startAdventure', this.startAdventure.bind(this));
        this.game.register('leaveInstance', this.leaveInstance.bind(this));
        this.game.register('isInInstance', () => this.instanceId !== null);

        // Sync services
        this.game.register('syncPlayerPosition', this.syncPlayerPosition.bind(this));
        this.game.register('syncPlayerAction', this.syncPlayerAction.bind(this));
        this.game.register('getOtherPlayers', () => this.otherPlayers);
    }

    async connectToServer() {
        try {
            await this.game.clientNetworkManager.connect();

            this.game.clientNetworkManager.call(
                'CONNECT',
                { playerName: this.playerName || 'Adventurer' },
                'CONNECTED',
                (data, error) => {
                    if (error) {
                        console.error('[AdventureNetworkSystem] Failed to connect:', error);
                        this.game.call('showNotification', 'Failed to connect to server', 'error');
                    } else if (data && data.playerId) {
                        this.playerId = data.playerId;
                        this.game.clientNetworkManager.playerId = data.playerId;
                        this.game.state.playerId = data.playerId;
                        console.log('[AdventureNetworkSystem] Connected with playerId:', this.playerId);
                        this.setupNetworkListeners();
                    }
                }
            );
        } catch (error) {
            console.error('[AdventureNetworkSystem] Connection error:', error);
        }
    }

    setupNetworkListeners() {
        const nm = this.game.clientNetworkManager;
        if (!nm) return;

        this.networkUnsubscribers.push(
            // Player presence in town
            nm.listen('PLAYER_ENTERED_TOWN', (data) => this.handlePlayerEnteredTown(data)),
            nm.listen('PLAYER_LEFT_TOWN', (data) => this.handlePlayerLeftTown(data)),
            nm.listen('PLAYER_POSITION_UPDATE', (data) => this.handlePlayerPositionUpdate(data)),
            nm.listen('PLAYERS_IN_TOWN', (data) => this.handlePlayersInTown(data)),

            // Party events
            nm.listen('PARTY_CREATED', (data) => this.handlePartyCreated(data)),
            nm.listen('PARTY_INVITE', (data) => this.handlePartyInvite(data)),
            nm.listen('PARTY_MEMBER_JOINED', (data) => this.handlePartyMemberJoined(data)),
            nm.listen('PARTY_MEMBER_LEFT', (data) => this.handlePartyMemberLeft(data)),
            nm.listen('PARTY_DISBANDED', (data) => this.handlePartyDisbanded(data)),

            // Instance events
            nm.listen('INSTANCE_CREATED', (data) => this.handleInstanceCreated(data)),
            nm.listen('INSTANCE_JOINED', (data) => this.handleInstanceJoined(data)),
            nm.listen('INSTANCE_STATE_SYNC', (data) => this.handleInstanceStateSync(data)),
            nm.listen('PLAYER_ACTION', (data) => this.handlePlayerAction(data)),

            // Monster/combat events in instance
            nm.listen('MONSTER_SPAWNED', (data) => this.handleMonsterSpawned(data)),
            nm.listen('MONSTER_DIED', (data) => this.handleMonsterDied(data)),
            nm.listen('LOOT_DROPPED', (data) => this.handleLootDropped(data)),
            nm.listen('DAMAGE_DEALT', (data) => this.handleDamageDealt(data))
        );
    }

    // ============ TOWN HUB METHODS ============

    enterTown(playerName, callback) {
        this.playerName = playerName || 'Adventurer';

        this.game.clientNetworkManager.call(
            'ENTER_TOWN',
            { playerName: this.playerName },
            'ENTERED_TOWN',
            (data, error) => {
                if (error) {
                    console.error('[AdventureNetworkSystem] Failed to enter town:', error);
                    callback?.(false, error);
                } else {
                    this.currentZone = 'town';
                    this.game.state.currentZone = 'town';
                    this.game.state.phase = 'town';
                    console.log('[AdventureNetworkSystem] Entered town');
                    callback?.(true, data);
                }
            }
        );
    }

    leaveTown(callback) {
        this.game.clientNetworkManager.call(
            'LEAVE_TOWN',
            {},
            'LEFT_TOWN',
            (data, error) => {
                if (error) {
                    callback?.(false, error);
                } else {
                    this.currentZone = 'lobby';
                    this.game.state.currentZone = 'lobby';
                    this.otherPlayers.clear();
                    callback?.(true, data);
                }
            }
        );
    }

    handlePlayerEnteredTown(data) {
        if (data.playerId === this.playerId) return;

        console.log('[AdventureNetworkSystem] Player entered town:', data.playerName);

        // Create entity for other player
        const entityId = `player_${data.playerId}`;
        this.otherPlayers.set(data.playerId, {
            entityId,
            name: data.playerName,
            position: data.position || { x: 0, y: 0, z: 0 }
        });

        // Spawn visual representation
        this.game.call('spawnOtherPlayer', data.playerId, data.playerName, data.position);
        this.game.call('showNotification', `${data.playerName} entered the town`, 'info');
    }

    handlePlayerLeftTown(data) {
        if (data.playerId === this.playerId) return;

        const playerData = this.otherPlayers.get(data.playerId);
        if (playerData) {
            // Remove entity
            this.game.call('removeOtherPlayer', data.playerId);
            this.otherPlayers.delete(data.playerId);
            this.game.call('showNotification', `${playerData.name} left the town`, 'info');
        }
    }

    handlePlayersInTown(data) {
        // Initial sync of all players in town when we join
        for (const player of data.players) {
            if (player.playerId === this.playerId) continue;

            this.otherPlayers.set(player.playerId, {
                entityId: `player_${player.playerId}`,
                name: player.playerName,
                position: player.position || { x: 0, y: 0, z: 0 }
            });

            this.game.call('spawnOtherPlayer', player.playerId, player.playerName, player.position);
        }
    }

    handlePlayerPositionUpdate(data) {
        if (data.playerId === this.playerId) return;

        const playerData = this.otherPlayers.get(data.playerId);
        if (playerData) {
            playerData.position = data.position;
            this.game.call('updateOtherPlayerPosition', data.playerId, data.position, data.velocity);
        }
    }

    syncPlayerPosition(position, velocity) {
        const now = performance.now();
        if (now - this.lastPositionSync < this.positionSyncInterval) return;
        this.lastPositionSync = now;

        this.game.clientNetworkManager.send('PLAYER_POSITION', {
            position,
            velocity,
            timestamp: this.game.state.now
        });
    }

    // ============ PARTY METHODS ============

    createParty(callback) {
        this.game.clientNetworkManager.call(
            'CREATE_PARTY',
            {},
            'PARTY_CREATED_RESPONSE',
            (data, error) => {
                if (error) {
                    callback?.(false, error);
                } else {
                    this.partyId = data.partyId;
                    this.isPartyLeader = true;
                    this.game.state.partyId = data.partyId;
                    this.game.state.isPartyLeader = true;
                    callback?.(true, data);
                }
            }
        );
    }

    inviteToParty(targetPlayerId, callback) {
        if (!this.partyId) {
            callback?.(false, 'Not in a party');
            return;
        }

        this.game.clientNetworkManager.call(
            'INVITE_TO_PARTY',
            { targetPlayerId },
            'PARTY_INVITE_SENT',
            (data, error) => {
                if (error) {
                    callback?.(false, error);
                } else {
                    callback?.(true, data);
                }
            }
        );
    }

    joinParty(partyId, callback) {
        this.game.clientNetworkManager.call(
            'JOIN_PARTY',
            { partyId },
            'PARTY_JOINED',
            (data, error) => {
                if (error) {
                    callback?.(false, error);
                } else {
                    this.partyId = partyId;
                    this.isPartyLeader = false;
                    this.game.state.partyId = partyId;
                    this.game.state.isPartyLeader = false;
                    callback?.(true, data);
                }
            }
        );
    }

    leaveParty(callback) {
        this.game.clientNetworkManager.call(
            'LEAVE_PARTY',
            {},
            'PARTY_LEFT',
            (data, error) => {
                if (error) {
                    callback?.(false, error);
                } else {
                    this.partyId = null;
                    this.isPartyLeader = false;
                    this.game.state.partyId = null;
                    this.game.state.isPartyLeader = false;
                    callback?.(true, data);
                }
            }
        );
    }

    getPartyMembers(callback) {
        if (!this.partyId) {
            callback?.(false, 'Not in a party');
            return;
        }

        this.game.clientNetworkManager.call(
            'GET_PARTY_MEMBERS',
            {},
            'PARTY_MEMBERS',
            (data, error) => {
                callback?.(error ? false : true, error || data);
            }
        );
    }

    handlePartyCreated(data) {
        this.game.call('showNotification', 'Party created!', 'success');
        this.game.triggerEvent('onPartyCreated', data);
    }

    handlePartyInvite(data) {
        // Show invite UI
        this.game.call('showPartyInvite', data.fromPlayerName, data.partyId);
    }

    handlePartyMemberJoined(data) {
        this.game.call('showNotification', `${data.playerName} joined the party`, 'info');
        this.game.triggerEvent('onPartyMemberJoined', data);
    }

    handlePartyMemberLeft(data) {
        this.game.call('showNotification', `${data.playerName} left the party`, 'info');
        this.game.triggerEvent('onPartyMemberLeft', data);
    }

    handlePartyDisbanded(data) {
        this.partyId = null;
        this.isPartyLeader = false;
        this.game.state.partyId = null;
        this.game.state.isPartyLeader = false;
        this.game.call('showNotification', 'Party disbanded', 'warning');
        this.game.triggerEvent('onPartyDisbanded', data);
    }

    // ============ INSTANCE METHODS ============

    startAdventure(adventureId, callback) {
        if (!this.isPartyLeader && this.partyId) {
            callback?.(false, 'Only party leader can start adventures');
            return;
        }

        this.game.clientNetworkManager.call(
            'START_ADVENTURE',
            { adventureId },
            'ADVENTURE_STARTED',
            (data, error) => {
                if (error) {
                    callback?.(false, error);
                } else {
                    this.instanceId = data.instanceId;
                    this.game.state.instanceId = data.instanceId;
                    this.game.state.inInstance = true;
                    this.currentZone = 'instance';
                    this.game.state.currentZone = 'instance';
                    callback?.(true, data);
                }
            }
        );
    }

    leaveInstance(callback) {
        this.game.clientNetworkManager.call(
            'LEAVE_INSTANCE',
            {},
            'INSTANCE_LEFT',
            (data, error) => {
                if (error) {
                    callback?.(false, error);
                } else {
                    this.instanceId = null;
                    this.game.state.instanceId = null;
                    this.game.state.inInstance = false;
                    this.currentZone = 'town';
                    this.game.state.currentZone = 'town';
                    callback?.(true, data);
                }
            }
        );
    }

    handleInstanceCreated(data) {
        console.log('[AdventureNetworkSystem] Instance created:', data.instanceId);
        this.game.triggerEvent('onInstanceCreated', data);
    }

    handleInstanceJoined(data) {
        this.instanceId = data.instanceId;
        this.game.state.instanceId = data.instanceId;
        this.game.state.inInstance = true;

        // Initialize deterministic RNG for this instance
        const instanceSeed = GUTS.SeededRandom.hashString(data.instanceId);
        this.game.rng = new GUTS.SeededRandom(instanceSeed);

        console.log('[AdventureNetworkSystem] Joined instance:', data.instanceId);
        this.game.triggerEvent('onInstanceJoined', data);
    }

    handleInstanceStateSync(data) {
        // Sync entities from server state
        if (data.entities) {
            for (const entityData of data.entities) {
                if (!this.game.entities.has(entityData.id)) {
                    this.game.createEntity(entityData.id);
                }
                for (const [componentType, componentData] of Object.entries(entityData.components)) {
                    if (this.game.hasComponent(entityData.id, componentType)) {
                        const existing = this.game.getComponent(entityData.id, componentType);
                        Object.assign(existing, componentData);
                    } else {
                        this.game.addComponent(entityData.id, componentType, componentData);
                    }
                }
            }
        }
    }

    syncPlayerAction(action) {
        if (!this.instanceId) return;

        this.game.clientNetworkManager.send('PLAYER_ACTION', {
            action,
            timestamp: this.game.state.now
        });
    }

    handlePlayerAction(data) {
        if (data.playerId === this.playerId) return;

        // Apply other player's action
        this.game.triggerEvent('onOtherPlayerAction', data);
    }

    // ============ COMBAT/MONSTER HANDLERS ============

    handleMonsterSpawned(data) {
        this.game.call('spawnMonster', data.monsterId, data.monsterType, data.position);
    }

    handleMonsterDied(data) {
        this.game.call('handleMonsterDeath', data.monsterId, data.killerPlayerId);
    }

    handleLootDropped(data) {
        this.game.call('spawnLoot', data.lootId, data.position, data.items);
    }

    handleDamageDealt(data) {
        this.game.call('applyDamage', data.targetId, data.damage, data.sourceId, data.damageType);
    }

    // ============ UPDATE LOOP ============

    update() {
        // Sync local player position if in town or instance
        if (this.currentZone === 'town' || this.currentZone === 'instance') {
            const localPlayerEntity = this.game.call('getLocalPlayerEntity');
            if (localPlayerEntity) {
                const transform = this.game.getComponent(localPlayerEntity, 'transform');
                const velocity = this.game.getComponent(localPlayerEntity, 'velocity');
                if (transform?.position) {
                    this.syncPlayerPosition(transform.position, velocity);
                }
            }
        }
    }

    // ============ CLEANUP ============

    dispose() {
        this.networkUnsubscribers.forEach(unsubscribe => {
            if (typeof unsubscribe === 'function') {
                unsubscribe();
            }
        });
        this.networkUnsubscribers = [];
        this.otherPlayers.clear();
    }

    onSceneUnload() {
        this.otherPlayers.clear();
    }
}
