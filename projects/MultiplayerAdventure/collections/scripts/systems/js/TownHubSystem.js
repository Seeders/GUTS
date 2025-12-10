/**
 * TownHubSystem - Manages the town hub social area
 *
 * Handles:
 * - Player spawning in town (terrain-aware)
 * - Other player entity management
 * - NPC interactions
 * - Adventure portal management from scene entities
 * - Town-specific game logic with terrain integration
 */
class TownHubSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.townHubSystem = this;

        // Player tracking
        this.localPlayerEntityId = null;
        this.otherPlayerEntities = new Map(); // playerId -> entityId

        // Town configuration (will be set from terrain)
        this.spawnPoint = { x: 0, y: 0, z: 0 };
        this.townBounds = null; // Will be set from terrain
        this.gridSize = 48; // Standard grid size

        // Adventure portals (loaded from scene entities)
        this.adventurePortals = new Map(); // portalId -> { position, adventureId, name }

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
        this.game.register('registerAdventurePortal', this.registerAdventurePortal.bind(this));
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
        // Wait for terrain system to initialize
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

        // Load portals from scene entities
        this.loadPortalsFromScene(sceneData);

        // Calculate spawn point at town center
        this.calculateSpawnPoint();

        // Spawn local player at terrain-aware position
        this.spawnLocalPlayer();

        // Notify server we entered town
        const playerName = localStorage.getItem('playerName') || 'Adventurer';
        this.game.call('enterTown', playerName, (success, data) => {
            if (success) {
                console.log('[TownHubSystem] Successfully entered town');
                // Spawn other players already in town
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
        const terrainSize = this.game.call('getTerrainSize') || 1536; // 32 * 48 default
        const extendedSize = this.game.call('getTerrainExtendedSize') || terrainSize;

        // Use the main terrain size for bounds, with a small margin
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
        // Spawn at the center of the terrain (on the plaza)
        const terrainSize = this.game.call('getTerrainSize') || 1536;
        const centerX = terrainSize / 2;
        const centerZ = terrainSize / 2;

        // Get terrain height at spawn point
        const height = this.getTerrainHeightAt(centerX, centerZ);

        this.spawnPoint = {
            x: centerX,
            y: height,
            z: centerZ
        };

        console.log('[TownHubSystem] Spawn point calculated:', this.spawnPoint);
    }

    getTerrainHeightAt(worldX, worldZ) {
        // Try smooth height first, then regular
        let height = this.game.call('getTerrainHeightAtPositionSmooth', worldX, worldZ);
        if (height === undefined || height === null) {
            height = this.game.call('getTerrainHeightAtPosition', worldX, worldZ);
        }
        return height || 0;
    }

    loadPortalsFromScene(sceneData) {
        // Load portals from scene entity definitions
        if (sceneData.entities) {
            for (const entityDef of sceneData.entities) {
                if (entityDef.components?.adventurePortal) {
                    const portalData = entityDef.components.adventurePortal;
                    const position = entityDef.transform?.position || { x: 0, y: 0, z: 0 };

                    // Get terrain height at portal position
                    position.y = this.getTerrainHeightAt(position.x, position.z);

                    this.registerAdventurePortal(entityDef.id, {
                        position,
                        adventureId: portalData.adventureId,
                        name: portalData.name,
                        description: portalData.description,
                        minLevel: portalData.minLevel || 1,
                        maxPlayers: portalData.maxPlayers || 4,
                        terrainLevel: portalData.terrainLevel
                    });
                }
            }
        }

        console.log('[TownHubSystem] Loaded', this.adventurePortals.size, 'portals from scene');
    }

    spawnLocalPlayer(position = null) {
        let spawnPos = position || { ...this.spawnPoint };

        // Ensure Y position is terrain-aware
        spawnPos.y = this.getTerrainHeightAt(spawnPos.x, spawnPos.z);

        const playerId = this.game.call('getPlayerId');
        const playerName = this.game.call('getPlayerName') || 'Adventurer';

        // Create player entity
        const entityId = `local_player`;

        if (!this.game.entities.has(entityId)) {
            this.game.createEntity(entityId);
        }

        // Add components
        this.game.addComponent(entityId, 'transform', {
            position: { x: spawnPos.x, y: spawnPos.y, z: spawnPos.z },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 }
        });

        this.game.addComponent(entityId, 'velocity', {
            vx: 0, vy: 0, vz: 0
        });

        this.game.addComponent(entityId, 'playerCharacter', {
            playerId: playerId,
            playerName: playerName,
            isLocal: true,
            characterClass: 'warrior', // Default class
            level: this.game.state.playerLevel || 1
        });

        this.game.addComponent(entityId, 'health', {
            current: 100,
            max: 100
        });

        this.game.addComponent(entityId, 'movement', {
            speed: 150,
            acceleration: 500,
            friction: 0.9
        });

        this.game.addComponent(entityId, 'controllable', {
            isControlled: true
        });

        // Team for combat system
        this.game.addComponent(entityId, 'team', {
            team: 'player'
        });

        // Visual representation
        this.game.addComponent(entityId, 'unitType', {
            id: 'player_character',
            collection: 'units'
        });

        this.localPlayerEntityId = entityId;

        // Spawn render instance
        this.game.call('spawnInstance', entityId, 'units', 'player_character', spawnPos);

        console.log('[TownHubSystem] Spawned local player at:', spawnPos);

        return entityId;
    }

    spawnOtherPlayer(playerId, playerName, position) {
        const entityId = `player_${playerId}`;

        if (this.otherPlayerEntities.has(playerId)) {
            console.warn('[TownHubSystem] Player already spawned:', playerId);
            return this.otherPlayerEntities.get(playerId);
        }

        let spawnPos = position || { ...this.spawnPoint };

        // Ensure Y position is terrain-aware
        spawnPos.y = this.getTerrainHeightAt(spawnPos.x, spawnPos.z);

        if (!this.game.entities.has(entityId)) {
            this.game.createEntity(entityId);
        }

        // Add components
        this.game.addComponent(entityId, 'transform', {
            position: { x: spawnPos.x, y: spawnPos.y, z: spawnPos.z },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 }
        });

        this.game.addComponent(entityId, 'velocity', {
            vx: 0, vy: 0, vz: 0
        });

        this.game.addComponent(entityId, 'playerCharacter', {
            playerId: playerId,
            playerName: playerName,
            isLocal: false,
            characterClass: 'warrior',
            level: 1
        });

        this.game.addComponent(entityId, 'health', {
            current: 100,
            max: 100
        });

        this.game.addComponent(entityId, 'team', {
            team: 'player'
        });

        this.game.addComponent(entityId, 'unitType', {
            id: 'player_character',
            collection: 'units'
        });

        // Mark as network synced (position comes from server)
        this.game.addComponent(entityId, 'networkSynced', {
            lastUpdate: 0
        });

        this.otherPlayerEntities.set(playerId, entityId);

        // Spawn render instance
        this.game.call('spawnInstance', entityId, 'units', 'player_character', spawnPos);

        console.log('[TownHubSystem] Spawned other player:', playerName, 'at:', spawnPos);

        return entityId;
    }

    removeOtherPlayer(playerId) {
        const entityId = this.otherPlayerEntities.get(playerId);
        if (!entityId) return;

        // Remove render instance
        this.game.call('removeInstance', entityId);

        // Destroy entity
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
            // Update Y to terrain height
            transform.position.y = this.getTerrainHeightAt(position.x, position.z);
            transform.position.z = position.z;
        }

        if (vel && velocity) {
            vel.vx = velocity.vx || 0;
            vel.vy = velocity.vy || 0;
            vel.vz = velocity.vz || 0;
        }

        // Update render transform
        if (transform) {
            this.game.call('updateInstanceTransform', entityId, transform.position);
        }
    }

    registerAdventurePortal(portalId, portalData) {
        this.adventurePortals.set(portalId, portalData);

        // Create portal entity if it doesn't exist
        const entityId = portalId;
        if (!this.game.entities.has(entityId)) {
            this.game.createEntity(entityId);
        }

        // Ensure position has proper terrain height
        const position = { ...portalData.position };
        position.y = this.getTerrainHeightAt(position.x, position.z);

        this.game.addComponent(entityId, 'transform', {
            position,
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 2, y: 2, z: 2 }
        });

        this.game.addComponent(entityId, 'adventurePortal', {
            adventureId: portalData.adventureId,
            name: portalData.name,
            description: portalData.description,
            minLevel: portalData.minLevel || 1,
            maxPlayers: portalData.maxPlayers || 4,
            terrainLevel: portalData.terrainLevel
        });

        this.game.addComponent(entityId, 'interactable', {
            interactionType: 'portal',
            interactionRadius: 80,
            promptText: `Enter ${portalData.name} (Lvl ${portalData.minLevel}+)`
        });

        // Spawn a visual marker for the portal
        this.game.call('spawnInstance', entityId, 'effects', 'portal_effect', position);

        console.log('[TownHubSystem] Registered portal:', portalData.name, 'at', position);
    }

    getPortalByAdventureId(adventureId) {
        for (const [portalId, portalData] of this.adventurePortals) {
            if (portalData.adventureId === adventureId) {
                return { portalId, ...portalData };
            }
        }
        return null;
    }

    getNearestPortal(position, maxDistance = 100) {
        let nearest = null;
        let nearestDist = Infinity;

        for (const [portalId, portalData] of this.adventurePortals) {
            const dx = portalData.position.x - position.x;
            const dz = portalData.position.z - position.z;
            const dist = Math.sqrt(dx * dx + dz * dz);

            if (dist < nearestDist && dist <= maxDistance) {
                nearestDist = dist;
                nearest = { portalId, ...portalData, distance: dist };
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
                // Clamp to town bounds
                transform.position.x = Math.max(this.townBounds.minX,
                    Math.min(this.townBounds.maxX, transform.position.x));
                transform.position.z = Math.max(this.townBounds.minZ,
                    Math.min(this.townBounds.maxZ, transform.position.z));

                // Update Y to match terrain height
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
            // Show portal interaction prompt
            this.game.call('showInteractionPrompt', {
                type: 'portal',
                text: nearestPortal.promptText || `Enter ${nearestPortal.name}`,
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

        // Check all entities with npc component
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
                    return; // Only show one prompt at a time
                }
            }
        }
    }

    onSceneUnload() {
        // Clean up all player entities
        if (this.localPlayerEntityId && this.game.entities.has(this.localPlayerEntityId)) {
            this.game.call('removeInstance', this.localPlayerEntityId);
            this.game.destroyEntity(this.localPlayerEntityId);
        }
        this.localPlayerEntityId = null;

        for (const [playerId, entityId] of this.otherPlayerEntities) {
            if (this.game.entities.has(entityId)) {
                this.game.call('removeInstance', entityId);
                this.game.destroyEntity(entityId);
            }
        }
        this.otherPlayerEntities.clear();

        // Clean up portals
        for (const [portalId] of this.adventurePortals) {
            if (this.game.entities.has(portalId)) {
                this.game.call('removeInstance', portalId);
                this.game.destroyEntity(portalId);
            }
        }
        this.adventurePortals.clear();

        this.terrainReady = false;
    }
}
