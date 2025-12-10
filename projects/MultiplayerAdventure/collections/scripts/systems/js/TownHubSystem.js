/**
 * TownHubSystem - Manages the town hub social area
 *
 * Handles:
 * - Player spawning in town
 * - Other player entity management
 * - NPC interactions
 * - Adventure portal management
 * - Town-specific game logic
 */
class TownHubSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.townHubSystem = this;

        // Player tracking
        this.localPlayerEntityId = null;
        this.otherPlayerEntities = new Map(); // playerId -> entityId

        // Town configuration
        this.spawnPoint = { x: 0, y: 0, z: 0 };
        this.townBounds = {
            minX: -500, maxX: 500,
            minZ: -500, maxZ: 500
        };

        // Adventure portals
        this.adventurePortals = new Map(); // portalId -> { position, adventureId, name }
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

        // Portal management
        this.game.register('registerAdventurePortal', this.registerAdventurePortal.bind(this));
        this.game.register('getAdventurePortals', () => this.adventurePortals);
        this.game.register('getNearestPortal', this.getNearestPortal.bind(this));
    }

    onSceneLoad(sceneData) {
        // Check if this is a town hub scene
        if (sceneData.title?.includes('Town Hub')) {
            this.initializeTown();
        }
    }

    initializeTown() {
        console.log('[TownHubSystem] Initializing town hub...');

        // Set up default adventure portals
        this.setupDefaultPortals();

        // Spawn local player
        this.spawnLocalPlayer();

        // Notify server we entered town
        const playerName = localStorage.getItem('playerName') || 'Adventurer';
        this.game.call('enterTown', playerName, (success, data) => {
            if (success) {
                console.log('[TownHubSystem] Successfully entered town');
            }
        });
    }

    setupDefaultPortals() {
        // Forest Adventure Portal
        this.registerAdventurePortal('portal_forest', {
            position: { x: 200, y: 0, z: 0 },
            adventureId: 'forest_dungeon',
            name: 'Forest Dungeon',
            description: 'A mysterious forest filled with danger',
            minLevel: 1,
            maxPlayers: 4
        });

        // Cave Adventure Portal
        this.registerAdventurePortal('portal_cave', {
            position: { x: -200, y: 0, z: 0 },
            adventureId: 'cave_dungeon',
            name: 'Crystal Caves',
            description: 'Deep caves with valuable crystals',
            minLevel: 5,
            maxPlayers: 4
        });

        // Castle Adventure Portal
        this.registerAdventurePortal('portal_castle', {
            position: { x: 0, y: 0, z: 200 },
            adventureId: 'castle_dungeon',
            name: 'Haunted Castle',
            description: 'An ancient castle overrun by undead',
            minLevel: 10,
            maxPlayers: 4
        });
    }

    spawnLocalPlayer(position = null) {
        const spawnPos = position || this.spawnPoint;
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

        const spawnPos = position || this.spawnPoint;

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
            transform.position.y = position.y;
            transform.position.z = position.z;
        }

        if (vel && velocity) {
            vel.vx = velocity.vx || 0;
            vel.vy = velocity.vy || 0;
            vel.vz = velocity.vz || 0;
        }

        // Update render transform
        this.game.call('updateInstanceTransform', entityId, position);
    }

    registerAdventurePortal(portalId, portalData) {
        this.adventurePortals.set(portalId, portalData);

        // Create portal entity
        const entityId = portalId;
        if (!this.game.entities.has(entityId)) {
            this.game.createEntity(entityId);
        }

        this.game.addComponent(entityId, 'transform', {
            position: portalData.position,
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 }
        });

        this.game.addComponent(entityId, 'adventurePortal', {
            adventureId: portalData.adventureId,
            name: portalData.name,
            description: portalData.description,
            minLevel: portalData.minLevel || 1,
            maxPlayers: portalData.maxPlayers || 4
        });

        this.game.addComponent(entityId, 'interactable', {
            interactionType: 'portal',
            interactionRadius: 50,
            promptText: `Enter ${portalData.name}`
        });
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
        return position.x >= this.townBounds.minX &&
               position.x <= this.townBounds.maxX &&
               position.z >= this.townBounds.minZ &&
               position.z <= this.townBounds.maxZ;
    }

    update() {
        // Keep local player in bounds
        if (this.localPlayerEntityId) {
            const transform = this.game.getComponent(this.localPlayerEntityId, 'transform');
            if (transform && transform.position) {
                // Clamp to town bounds
                transform.position.x = Math.max(this.townBounds.minX,
                    Math.min(this.townBounds.maxX, transform.position.x));
                transform.position.z = Math.max(this.townBounds.minZ,
                    Math.min(this.townBounds.maxZ, transform.position.z));
            }
        }

        // Check for portal proximity
        this.checkPortalProximity();
    }

    checkPortalProximity() {
        if (!this.localPlayerEntityId) return;

        const transform = this.game.getComponent(this.localPlayerEntityId, 'transform');
        if (!transform) return;

        const nearestPortal = this.getNearestPortal(transform.position, 60);

        if (nearestPortal) {
            // Show portal interaction prompt
            this.game.call('showInteractionPrompt', nearestPortal.promptText || `Enter ${nearestPortal.name}`);
        } else {
            this.game.call('hideInteractionPrompt');
        }
    }

    onSceneUnload() {
        // Clean up all player entities
        if (this.localPlayerEntityId && this.game.entities.has(this.localPlayerEntityId)) {
            this.game.destroyEntity(this.localPlayerEntityId);
        }
        this.localPlayerEntityId = null;

        for (const [playerId, entityId] of this.otherPlayerEntities) {
            if (this.game.entities.has(entityId)) {
                this.game.destroyEntity(entityId);
            }
        }
        this.otherPlayerEntities.clear();

        // Clean up portals
        for (const [portalId] of this.adventurePortals) {
            if (this.game.entities.has(portalId)) {
                this.game.destroyEntity(portalId);
            }
        }
        this.adventurePortals.clear();
    }
}
