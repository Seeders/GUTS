/**
 * TownHubSystem - Manages the town hub social area
 *
 * Handles:
 * - Player spawning in town (terrain-aware)
 * - Other player entity management
 * - NPC interactions
 * - Adventure portal management
 * - Town-specific game logic with terrain integration
 *
 * Uses ECS queries for entity lookups instead of redundant tracking maps
 */
class TownHubSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.townHubSystem = this;

        // Only track local player ID (single entity reference)
        this.localPlayerEntityId = null;

        // Town configuration (will be set from terrain)
        this.spawnPoint = { x: 0, y: 0, z: 0 };
        this.townBounds = null;
        this.gridSize = 48;

        // Portal definitions (static config, entities created dynamically)
        this.portalDefinitions = [
            {
                adventureId: 'forest_dungeon',
                name: 'Forest Dungeon',
                description: 'A mysterious forest filled with goblins',
                minLevel: 1,
                maxPlayers: 4,
                terrainLevel: 'forest_instance',
                gridPosition: { x: 15, z: 4 }
            },
            {
                adventureId: 'cave_dungeon',
                name: 'Crystal Caves',
                description: 'Deep caves with valuable crystals and dangers',
                minLevel: 5,
                maxPlayers: 4,
                terrainLevel: 'cave_instance',
                gridPosition: { x: 27, z: 15 }
            },
            {
                adventureId: 'castle_dungeon',
                name: 'Haunted Castle',
                description: 'An ancient castle overrun by undead',
                minLevel: 10,
                maxPlayers: 4,
                terrainLevel: 'hell',
                gridPosition: { x: 15, z: 27 }
            }
        ];

        // Terrain integration
        this.terrainReady = false;
    }

    init(params) {
        this.params = params || {};
        console.log('[TownHubSystem] Initializing...');
        this.registerServices();
    }

    registerServices() {
        // Player management
        this.game.register('getLocalPlayerEntity', () => this.localPlayerEntityId);
        this.game.register('spawnLocalPlayer', this.spawnLocalPlayer.bind(this));
        this.game.register('spawnOtherPlayer', this.spawnOtherPlayer.bind(this));
        this.game.register('removeOtherPlayer', this.removeOtherPlayer.bind(this));
        this.game.register('updateOtherPlayerPosition', this.updateOtherPlayerPosition.bind(this));

        // Town utilities
        this.game.register('getTownSpawnPoint', () => this.spawnPoint);
        this.game.register('isInTownBounds', this.isInTownBounds.bind(this));
        this.game.register('getTerrainHeightAt', this.getTerrainHeightAt.bind(this));

        // Portal management (ECS queries)
        this.game.register('getAdventurePortals', this.getAdventurePortals.bind(this));
        this.game.register('getNearestPortal', this.getNearestPortal.bind(this));
        this.game.register('getPortalByAdventureId', this.getPortalByAdventureId.bind(this));
    }

    onSceneLoad(sceneData) {
        if (sceneData.title?.includes('Town Hub')) {
            this.waitForTerrain().then(() => {
                this.initializeTown(sceneData);
            });
        }
    }

    async waitForTerrain() {
        return new Promise((resolve) => {
            const checkTerrain = () => {
                const terrainSize = this.game.call('getTerrainSize');
                if (terrainSize && terrainSize > 0) {
                    this.terrainReady = true;
                    resolve();
                } else {
                    setTimeout(checkTerrain, 100);
                }
            };
            checkTerrain();
        });
    }

    initializeTown(sceneData) {
        console.log('[TownHubSystem] Initializing town hub with terrain...');

        this.setupTerrainBounds();
        this.calculateSpawnPoint();
        this.createAdventurePortals();
        this.spawnLocalPlayer();

        const playerName = localStorage.getItem('playerName') || 'Adventurer';
        this.game.call('enterTown', playerName, (success, data) => {
            if (success) {
                console.log('[TownHubSystem] Successfully entered town');
                if (data && data.players) {
                    for (const player of data.players) {
                        if (player.playerId !== this.game.call('getPlayerId')) {
                            this.spawnOtherPlayer(player.playerId, player.name, player.position);
                        }
                    }
                }
            }
        });
    }

    setupTerrainBounds() {
        const terrainSize = this.game.call('getTerrainSize') || 1536;
        const margin = this.gridSize;
        this.townBounds = {
            minX: margin,
            maxX: terrainSize - margin,
            minZ: margin,
            maxZ: terrainSize - margin
        };
        console.log('[TownHubSystem] Town bounds set:', this.townBounds);
    }

    calculateSpawnPoint() {
        const terrainSize = this.game.call('getTerrainSize') || 1536;
        const centerX = terrainSize / 2;
        const centerZ = terrainSize / 2;
        const height = this.getTerrainHeightAt(centerX, centerZ);

        this.spawnPoint = { x: centerX, y: height, z: centerZ };
        console.log('[TownHubSystem] Spawn point calculated:', this.spawnPoint);
    }

    getTerrainHeightAt(worldX, worldZ) {
        let height = this.game.call('getTerrainHeightAtPositionSmooth', worldX, worldZ);
        if (height === undefined || height === null) {
            height = this.game.call('getTerrainHeightAtPosition', worldX, worldZ);
        }
        return height || 0;
    }

    createAdventurePortals() {
        for (let i = 0; i < this.portalDefinitions.length; i++) {
            const def = this.portalDefinitions[i];

            const worldX = def.gridPosition.x * this.gridSize + this.gridSize / 2;
            const worldZ = def.gridPosition.z * this.gridSize + this.gridSize / 2;
            const worldY = this.getTerrainHeightAt(worldX, worldZ);

            const entityId = this.game.createEntity();

            this.game.addComponents(entityId, {
                transform: {
                    position: { x: worldX, y: worldY, z: worldZ },
                    rotation: { x: 0, y: 0, z: 0 },
                    scale: { x: 2, y: 2, z: 2 }
                },
                adventurePortal: {
                    adventureId: def.adventureId,
                    name: def.name,
                    description: def.description,
                    minLevel: def.minLevel,
                    maxPlayers: def.maxPlayers,
                    terrainLevel: def.terrainLevel
                },
                interactable: {
                    interactionType: 'portal',
                    interactionRadius: 80,
                    promptText: `Enter ${def.name} (Lvl ${def.minLevel}+)`
                }
            });

            this.game.call('spawnInstance', entityId, 'effects', 'portal_effect', { x: worldX, y: worldY, z: worldZ });
            console.log('[TownHubSystem] Created portal:', def.name, 'entityId:', entityId);
        }
    }

    // Query ECS for all portal entities
    getAdventurePortals() {
        const portals = [];
        const entities = this.game.getEntitiesWith('adventurePortal', 'transform');

        for (const entityId of entities) {
            const portal = this.game.getComponent(entityId, 'adventurePortal');
            const transform = this.game.getComponent(entityId, 'transform');
            if (portal && transform) {
                portals.push({
                    entityId,
                    position: transform.position,
                    ...portal
                });
            }
        }
        return portals;
    }

    // Query ECS to find portal by adventureId
    getPortalByAdventureId(adventureId) {
        const entities = this.game.getEntitiesWith('adventurePortal', 'transform');

        for (const entityId of entities) {
            const portal = this.game.getComponent(entityId, 'adventurePortal');
            if (portal && portal.adventureId === adventureId) {
                const transform = this.game.getComponent(entityId, 'transform');
                return {
                    entityId,
                    position: transform?.position,
                    ...portal
                };
            }
        }
        return null;
    }

    // Query ECS for nearest portal
    getNearestPortal(position, maxDistance = 100) {
        let nearest = null;
        let nearestDist = Infinity;

        const entities = this.game.getEntitiesWith('adventurePortal', 'transform');

        for (const entityId of entities) {
            const portal = this.game.getComponent(entityId, 'adventurePortal');
            const transform = this.game.getComponent(entityId, 'transform');

            if (portal && transform?.position) {
                const dx = transform.position.x - position.x;
                const dz = transform.position.z - position.z;
                const dist = Math.sqrt(dx * dx + dz * dz);

                if (dist < nearestDist && dist <= maxDistance) {
                    nearestDist = dist;
                    nearest = {
                        entityId,
                        position: transform.position,
                        distance: dist,
                        ...portal
                    };
                }
            }
        }
        return nearest;
    }

    spawnLocalPlayer(position = null) {
        let spawnPos = position || { ...this.spawnPoint };
        spawnPos.y = this.getTerrainHeightAt(spawnPos.x, spawnPos.z);

        const playerId = this.game.call('getPlayerId');
        const playerName = this.game.call('getPlayerName') || 'Adventurer';

        const entityId = this.game.createEntity();

        this.game.addComponents(entityId, {
            transform: {
                position: { x: spawnPos.x, y: spawnPos.y, z: spawnPos.z },
                rotation: { x: 0, y: 0, z: 0 },
                scale: { x: 1, y: 1, z: 1 }
            },
            velocity: {
                vx: 0, vy: 0, vz: 0,
                maxSpeed: 150,
                affectedByGravity: true,
                anchored: false
            },
            playerCharacter: {
                playerId: playerId,
                playerName: playerName,
                isLocal: true,
                characterClass: 'warrior',
                level: this.game.state.playerLevel || 1
            },
            health: { current: 100, max: 100 },
            movement: { speed: 150, acceleration: 500, friction: 0.9 },
            controllable: { isControlled: true },
            team: { team: 'player' },
            collision: { radius: 10, height: 50 },
            renderable: { objectType: 'units', spawnType: 'peasant', capacity: 128 }
        });

        this.localPlayerEntityId = entityId;
        this.game.call('spawnInstance', entityId, 'units', 'peasant', spawnPos);

        console.log('[TownHubSystem] Spawned local player entityId:', entityId);
        return entityId;
    }

    spawnOtherPlayer(playerId, playerName, position) {
        // Check if already exists via ECS query
        const existing = this.findPlayerEntityByPlayerId(playerId);
        if (existing) {
            console.warn('[TownHubSystem] Player already spawned:', playerId);
            return existing;
        }

        let spawnPos = position || { ...this.spawnPoint };
        spawnPos.y = this.getTerrainHeightAt(spawnPos.x, spawnPos.z);

        const entityId = this.game.createEntity();

        this.game.addComponents(entityId, {
            transform: {
                position: { x: spawnPos.x, y: spawnPos.y, z: spawnPos.z },
                rotation: { x: 0, y: 0, z: 0 },
                scale: { x: 1, y: 1, z: 1 }
            },
            velocity: {
                vx: 0, vy: 0, vz: 0,
                maxSpeed: 150,
                affectedByGravity: true,
                anchored: false
            },
            playerCharacter: {
                playerId: playerId,
                playerName: playerName,
                isLocal: false,
                characterClass: 'warrior',
                level: 1
            },
            health: { current: 100, max: 100 },
            team: { team: 'player' },
            collision: { radius: 10, height: 50 },
            renderable: { objectType: 'units', spawnType: 'peasant', capacity: 128 },
            networkSynced: { lastUpdate: 0 }
        });

        this.game.call('spawnInstance', entityId, 'units', 'peasant', spawnPos);
        console.log('[TownHubSystem] Spawned other player:', playerName, 'entityId:', entityId);

        return entityId;
    }

    // Find player entity by playerId using ECS query
    findPlayerEntityByPlayerId(playerId) {
        const entities = this.game.getEntitiesWith('playerCharacter');

        for (const entityId of entities) {
            const pc = this.game.getComponent(entityId, 'playerCharacter');
            if (pc && pc.playerId === playerId && !pc.isLocal) {
                return entityId;
            }
        }
        return null;
    }

    removeOtherPlayer(playerId) {
        const entityId = this.findPlayerEntityByPlayerId(playerId);
        if (!entityId) return;

        this.game.call('removeInstance', entityId);
        this.game.destroyEntity(entityId);
        console.log('[TownHubSystem] Removed other player:', playerId);
    }

    updateOtherPlayerPosition(playerId, position, velocity) {
        const entityId = this.findPlayerEntityByPlayerId(playerId);
        if (!entityId) return;

        const transform = this.game.getComponent(entityId, 'transform');
        const vel = this.game.getComponent(entityId, 'velocity');

        if (transform && position) {
            transform.position.x = position.x;
            transform.position.y = this.getTerrainHeightAt(position.x, position.z);
            transform.position.z = position.z;
        }

        if (vel && velocity) {
            vel.vx = velocity.vx || 0;
            vel.vy = velocity.vy || 0;
            vel.vz = velocity.vz || 0;
        }

        if (transform) {
            this.game.call('updateInstanceTransform', entityId, transform.position);
        }
    }

    isInTownBounds(position) {
        if (!this.townBounds) return true;
        return position.x >= this.townBounds.minX &&
               position.x <= this.townBounds.maxX &&
               position.z >= this.townBounds.minZ &&
               position.z <= this.townBounds.maxZ;
    }

    update() {
        if (!this.terrainReady) return;

        // Update local player - keep on terrain and in bounds
        if (this.localPlayerEntityId) {
            const transform = this.game.getComponent(this.localPlayerEntityId, 'transform');
            if (transform?.position && this.townBounds) {
                transform.position.x = Math.max(this.townBounds.minX,
                    Math.min(this.townBounds.maxX, transform.position.x));
                transform.position.z = Math.max(this.townBounds.minZ,
                    Math.min(this.townBounds.maxZ, transform.position.z));
                transform.position.y = this.getTerrainHeightAt(transform.position.x, transform.position.z);
            }
        }

        // Update all other players - keep on terrain (query ECS)
        const playerEntities = this.game.getEntitiesWith('playerCharacter', 'transform');
        for (const entityId of playerEntities) {
            if (entityId === this.localPlayerEntityId) continue;

            const transform = this.game.getComponent(entityId, 'transform');
            if (transform?.position) {
                transform.position.y = this.getTerrainHeightAt(transform.position.x, transform.position.z);
            }
        }

        this.checkPortalProximity();
        this.checkNPCProximity();
    }

    checkPortalProximity() {
        if (!this.localPlayerEntityId) return;

        const transform = this.game.getComponent(this.localPlayerEntityId, 'transform');
        if (!transform) return;

        const nearestPortal = this.getNearestPortal(transform.position, 80);

        if (nearestPortal) {
            this.game.call('showInteractionPrompt', {
                type: 'portal',
                text: `Enter ${nearestPortal.name}`,
                adventureId: nearestPortal.adventureId,
                minLevel: nearestPortal.minLevel
            });
        } else {
            this.game.call('hideInteractionPrompt', 'portal');
        }
    }

    checkNPCProximity() {
        if (!this.localPlayerEntityId) return;

        const transform = this.game.getComponent(this.localPlayerEntityId, 'transform');
        if (!transform) return;

        // Query ECS for NPC entities
        const npcEntities = this.game.getEntitiesWith('npc', 'interactable', 'transform');

        for (const entityId of npcEntities) {
            const npc = this.game.getComponent(entityId, 'npc');
            const interactable = this.game.getComponent(entityId, 'interactable');
            const npcTransform = this.game.getComponent(entityId, 'transform');

            if (npc && interactable && npcTransform?.position) {
                const dx = npcTransform.position.x - transform.position.x;
                const dz = npcTransform.position.z - transform.position.z;
                const dist = Math.sqrt(dx * dx + dz * dz);

                if (dist <= interactable.interactionRadius) {
                    this.game.call('showInteractionPrompt', {
                        type: 'npc',
                        text: interactable.promptText,
                        npcType: npc.type,
                        entityId
                    });
                    return;
                }
            }
        }
    }

    onSceneUnload() {
        // Clean up local player
        if (this.localPlayerEntityId && this.game.entities.has(this.localPlayerEntityId)) {
            this.game.call('removeInstance', this.localPlayerEntityId);
            this.game.destroyEntity(this.localPlayerEntityId);
        }
        this.localPlayerEntityId = null;

        // Clean up other players (query ECS)
        const playerEntities = this.game.getEntitiesWith('playerCharacter');
        for (const entityId of playerEntities) {
            const pc = this.game.getComponent(entityId, 'playerCharacter');
            if (pc && !pc.isLocal && this.game.entities.has(entityId)) {
                this.game.call('removeInstance', entityId);
                this.game.destroyEntity(entityId);
            }
        }

        // Clean up portals (query ECS)
        const portalEntities = this.game.getEntitiesWith('adventurePortal');
        for (const entityId of portalEntities) {
            if (this.game.entities.has(entityId)) {
                this.game.call('removeInstance', entityId);
                this.game.destroyEntity(entityId);
            }
        }

        this.terrainReady = false;
    }
}
