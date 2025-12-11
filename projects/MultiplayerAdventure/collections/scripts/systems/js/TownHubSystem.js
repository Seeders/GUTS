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
 * Uses numeric entity IDs for performance (deterministic lockstep compatible)
 */
class TownHubSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.townHubSystem = this;

        // Player tracking (uses numeric entity IDs)
        this.localPlayerEntityId = null;
        this.otherPlayerEntities = new Map(); // playerId -> numeric entityId

        // Town configuration (will be set from terrain)
        this.spawnPoint = { x: 0, y: 0, z: 0 };
        this.townBounds = null;
        this.gridSize = 48;

        // Adventure portals
        this.adventurePortals = new Map(); // portalIndex -> { entityId, position, adventureId, name }
        this.portalDefinitions = [
            {
                adventureId: 'forest_dungeon',
                name: 'Forest Dungeon',
                description: 'A mysterious forest filled with goblins',
                minLevel: 1,
                maxPlayers: 4,
                terrainLevel: 'forest_instance',
                gridPosition: { x: 15, z: 4 } // North road
            },
            {
                adventureId: 'cave_dungeon',
                name: 'Crystal Caves',
                description: 'Deep caves with valuable crystals and dangers',
                minLevel: 5,
                maxPlayers: 4,
                terrainLevel: 'cave_instance',
                gridPosition: { x: 27, z: 15 } // East road
            },
            {
                adventureId: 'castle_dungeon',
                name: 'Haunted Castle',
                description: 'An ancient castle overrun by undead',
                minLevel: 10,
                maxPlayers: 4,
                terrainLevel: 'hell',
                gridPosition: { x: 15, z: 27 } // South road
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

        // Portal management
        this.game.register('getAdventurePortals', () => this.adventurePortals);
        this.game.register('getNearestPortal', this.getNearestPortal.bind(this));
        this.game.register('getPortalByAdventureId', this.getPortalByAdventureId.bind(this));
    }

    onSceneLoad(sceneData) {
        // Check if this is a town hub scene
        if (sceneData.title?.includes('Town Hub')) {
            // Wait for terrain to be ready
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

        // Get terrain bounds
        this.setupTerrainBounds();

        // Calculate spawn point at town center
        this.calculateSpawnPoint();

        // Create adventure portals
        this.createAdventurePortals();

        // Spawn local player at terrain-aware position
        this.spawnLocalPlayer();

        // Notify server we entered town
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

        this.spawnPoint = {
            x: centerX,
            y: height,
            z: centerZ
        };

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

            // Calculate world position from grid position
            const worldX = def.gridPosition.x * this.gridSize + this.gridSize / 2;
            const worldZ = def.gridPosition.z * this.gridSize + this.gridSize / 2;
            const worldY = this.getTerrainHeightAt(worldX, worldZ);

            const position = { x: worldX, y: worldY, z: worldZ };

            // Create entity with numeric ID
            const entityId = this.game.createEntity();

            // Use addComponents for batch operation (single cache invalidation)
            this.game.addComponents(entityId, {
                transform: {
                    position: { x: position.x, y: position.y, z: position.z },
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

            this.adventurePortals.set(i, {
                entityId,
                position,
                adventureId: def.adventureId,
                name: def.name,
                description: def.description,
                minLevel: def.minLevel,
                maxPlayers: def.maxPlayers,
                terrainLevel: def.terrainLevel
            });

            // Spawn visual marker
            this.game.call('spawnInstance', entityId, 'effects', 'portal_effect', position);

            console.log('[TownHubSystem] Created portal:', def.name, 'at', position, 'entityId:', entityId);
        }
    }

    spawnLocalPlayer(position = null) {
        let spawnPos = position || { ...this.spawnPoint };
        spawnPos.y = this.getTerrainHeightAt(spawnPos.x, spawnPos.z);

        const playerId = this.game.call('getPlayerId');
        const playerName = this.game.call('getPlayerName') || 'Adventurer';

        // Create entity with numeric ID
        const entityId = this.game.createEntity();

        // Use addComponents for batch operation (single cache invalidation)
        this.game.addComponents(entityId, {
            transform: {
                position: { x: spawnPos.x, y: spawnPos.y, z: spawnPos.z },
                rotation: { x: 0, y: 0, z: 0 },
                scale: { x: 1, y: 1, z: 1 }
            },
            velocity: {
                vx: 0,
                vy: 0,
                vz: 0,
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
            health: {
                current: 100,
                max: 100
            },
            movement: {
                speed: 150,
                acceleration: 500,
                friction: 0.9
            },
            controllable: {
                isControlled: true
            },
            team: {
                team: 'player'
            },
            collision: {
                radius: 10,
                height: 50
            },
            renderable: {
                objectType: 'units',
                spawnType: 'peasant',
                capacity: 128
            }
        });

        this.localPlayerEntityId = entityId;

        // Spawn render instance
        this.game.call('spawnInstance', entityId, 'units', 'peasant', spawnPos);

        console.log('[TownHubSystem] Spawned local player at:', spawnPos, 'entityId:', entityId);

        return entityId;
    }

    spawnOtherPlayer(playerId, playerName, position) {
        if (this.otherPlayerEntities.has(playerId)) {
            console.warn('[TownHubSystem] Player already spawned:', playerId);
            return this.otherPlayerEntities.get(playerId);
        }

        let spawnPos = position || { ...this.spawnPoint };
        spawnPos.y = this.getTerrainHeightAt(spawnPos.x, spawnPos.z);

        // Create entity with numeric ID
        const entityId = this.game.createEntity();

        // Use addComponents for batch operation
        this.game.addComponents(entityId, {
            transform: {
                position: { x: spawnPos.x, y: spawnPos.y, z: spawnPos.z },
                rotation: { x: 0, y: 0, z: 0 },
                scale: { x: 1, y: 1, z: 1 }
            },
            velocity: {
                vx: 0,
                vy: 0,
                vz: 0,
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
            health: {
                current: 100,
                max: 100
            },
            team: {
                team: 'player'
            },
            collision: {
                radius: 10,
                height: 50
            },
            renderable: {
                objectType: 'units',
                spawnType: 'peasant',
                capacity: 128
            },
            networkSynced: {
                lastUpdate: 0
            }
        });

        this.otherPlayerEntities.set(playerId, entityId);

        // Spawn render instance
        this.game.call('spawnInstance', entityId, 'units', 'peasant', spawnPos);

        console.log('[TownHubSystem] Spawned other player:', playerName, 'at:', spawnPos, 'entityId:', entityId);

        return entityId;
    }

    removeOtherPlayer(playerId) {
        const entityId = this.otherPlayerEntities.get(playerId);
        if (!entityId) return;

        this.game.call('removeInstance', entityId);
        this.game.destroyEntity(entityId);

        this.otherPlayerEntities.delete(playerId);
        console.log('[TownHubSystem] Removed other player:', playerId);
    }

    updateOtherPlayerPosition(playerId, position, velocity) {
        const entityId = this.otherPlayerEntities.get(playerId);
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

    getPortalByAdventureId(adventureId) {
        for (const [index, portalData] of this.adventurePortals) {
            if (portalData.adventureId === adventureId) {
                return { portalIndex: index, ...portalData };
            }
        }
        return null;
    }

    getNearestPortal(position, maxDistance = 100) {
        let nearest = null;
        let nearestDist = Infinity;

        for (const [index, portalData] of this.adventurePortals) {
            const dx = portalData.position.x - position.x;
            const dz = portalData.position.z - position.z;
            const dist = Math.sqrt(dx * dx + dz * dz);

            if (dist < nearestDist && dist <= maxDistance) {
                nearestDist = dist;
                nearest = { portalIndex: index, ...portalData, distance: dist };
            }
        }

        return nearest;
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

        // Keep local player in bounds and on terrain
        if (this.localPlayerEntityId) {
            const transform = this.game.getComponent(this.localPlayerEntityId, 'transform');
            if (transform && transform.position && this.townBounds) {
                transform.position.x = Math.max(this.townBounds.minX,
                    Math.min(this.townBounds.maxX, transform.position.x));
                transform.position.z = Math.max(this.townBounds.minZ,
                    Math.min(this.townBounds.maxZ, transform.position.z));

                const terrainY = this.getTerrainHeightAt(transform.position.x, transform.position.z);
                transform.position.y = terrainY;
            }
        }

        // Check for portal proximity
        this.checkPortalProximity();

        // Check for NPC proximity
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

        for (const [entityId, entity] of this.game.entities) {
            const npc = this.game.getComponent(entityId, 'npc');
            const interactable = this.game.getComponent(entityId, 'interactable');
            const npcTransform = this.game.getComponent(entityId, 'transform');

            if (npc && interactable && npcTransform) {
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

        // Clean up other players
        for (const [playerId, entityId] of this.otherPlayerEntities) {
            if (this.game.entities.has(entityId)) {
                this.game.call('removeInstance', entityId);
                this.game.destroyEntity(entityId);
            }
        }
        this.otherPlayerEntities.clear();

        // Clean up portals
        for (const [index, portalData] of this.adventurePortals) {
            if (this.game.entities.has(portalData.entityId)) {
                this.game.call('removeInstance', portalData.entityId);
                this.game.destroyEntity(portalData.entityId);
            }
        }
        this.adventurePortals.clear();

        this.terrainReady = false;
    }
}
