/**
 * PlaceIllusionAbility - Places an illusion of a stored object at a target location
 *
 * Triggered by clicking when a belt slot with an item is selected.
 * Creates a full copy of the stored object prefab at the clicked location.
 * The illusion has a limited duration and then fades away.
 */
class PlaceIllusionAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, {
            name: 'Place Illusion',
            description: 'Create an illusion of a stored object',
            cooldown: 1.0,
            range: 300,
            manaCost: 0,
            targetType: 'position',
            animation: 'cast',
            priority: 10,
            castTime: 0,
            autoTrigger: 'none',
            ...abilityData
        });

        this.ILLUSION_DURATION = 30.0; // seconds
    }

    canExecute(casterEntity, params = {}) {
        // Check if player has belt with item in selected slot
        const belt = this.game.getComponent(casterEntity, 'magicBelt');
        if (!belt) return false;

        const selectedSlot = belt.selectedSlot;
        const slotKey = `slot${selectedSlot}`;
        const selectedItem = belt[slotKey];

        return selectedItem !== null;
    }

    execute(casterEntity, params = {}) {
        console.log('[PlaceIllusionAbility] execute called with params:', JSON.stringify(params));

        const transform = this.game.getComponent(casterEntity, 'transform');
        const casterPos = transform?.position;
        if (!casterPos) {
            console.log('[PlaceIllusionAbility] No caster position');
            return null;
        }

        const belt = this.game.getComponent(casterEntity, 'magicBelt');
        if (!belt) {
            console.log('[PlaceIllusionAbility] No belt component');
            return null;
        }

        const selectedSlot = belt.selectedSlot;
        const slotKey = `slot${selectedSlot}`;
        const itemTypeIndex = belt[slotKey];
        console.log('[PlaceIllusionAbility] Belt state:', { selectedSlot, slotKey, itemTypeIndex, belt: { slot0: belt.slot0, slot1: belt.slot1, slot2: belt.slot2 } });

        // null means empty slot
        if (itemTypeIndex === null) {
            console.log('[PlaceIllusionAbility] No item in selected slot');
            return null;
        }

        // Convert index to string name
        const reverseEnums = this.game.getReverseEnums();
        const itemType = reverseEnums.collectibles?.[itemTypeIndex];
        if (!itemType) {
            console.log('[PlaceIllusionAbility] Could not resolve item type from index:', itemTypeIndex);
            return null;
        }

        // Get target position from params
        const targetPosition = params.targetPosition;
        if (!targetPosition) {
            console.log('[PlaceIllusionAbility] No target position provided');
            return null;
        }

        // Check range
        const dx = targetPosition.x - casterPos.x;
        const dz = targetPosition.z - casterPos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist > this.range) {
            console.log('[PlaceIllusionAbility] Target out of range');
            return null;
        }

        // Create the illusion
        const illusionId = this.createIllusion(casterEntity, itemType, targetPosition);
        if (!illusionId) {
            console.log('[PlaceIllusionAbility] Failed to create illusion');
            return null;
        }

        // Consume item from belt
        this.game.call('consumeBeltItem', casterEntity, selectedSlot);

        // Play spawn effect
        this.playConfiguredEffects('cast', targetPosition);
        this.createVisualEffect(targetPosition, 'cast', { count: 25 });

        this.logAbilityUsage(casterEntity, `Created illusion of ${itemType}!`);
        this.game.triggerEvent('onIllusionCreated', {
            entityId: casterEntity,
            illusionId,
            objectType: itemType,
            position: targetPosition
        });

        return { success: true, illusionId, objectType: itemType };
    }

    createIllusion(creatorEntity, objectType, position) {
        console.log('[PlaceIllusionAbility] createIllusion called:', { objectType, position });

        // Get the prefab data for this object type
        const prefabData = this.getPrefabData(objectType);
        console.log('[PlaceIllusionAbility] prefabData:', prefabData);
        if (!prefabData) {
            console.log(`[PlaceIllusionAbility] Prefab not found for ${objectType}`);
            return null;
        }

        // Get enums for collection and type indices
        const enums = this.game.getEnums();
        const collectionIndex = enums.objectTypeDefinitions?.collectibles;
        const spawnTypeIndex = enums.collectibles?.[objectType];

        console.log('[PlaceIllusionAbility] Spawn indices:', { collectionIndex, spawnTypeIndex, objectType });

        if (collectionIndex === undefined || spawnTypeIndex === undefined) {
            console.log(`[PlaceIllusionAbility] Could not find enum indices for ${objectType}`);
            return null;
        }

        // Get terrain height at position
        let terrainHeight = 0;
        if (this.game.hasService('getTerrainHeightAtPosition')) {
            terrainHeight = this.game.call('getTerrainHeightAtPosition', position.x, position.z) ?? 0;
        }

        const transform = {
            position: { x: position.x, y: terrainHeight, z: position.z },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 }
        };

        // Use neutral team for illusions (or could use creator's team)
        const neutralTeam = enums.team?.neutral ?? 0;

        // Use createUnit to properly set up the entity with all rendering components
        const illusionId = this.game.call('createUnit', collectionIndex, spawnTypeIndex, transform, neutralTeam);
        console.log('[PlaceIllusionAbility] Created illusion entity:', illusionId);

        if (illusionId === null || illusionId === undefined) {
            console.log('[PlaceIllusionAbility] createUnit returned null');
            return null;
        }

        try {
            // Add illusion marker component
            this.game.addComponent(illusionId, 'illusion', {
                sourcePrefab: objectType,
                creatorEntity: creatorEntity,
                createdTime: this.game.state.now || 0,
                duration: this.ILLUSION_DURATION
            });

            // Schedule removal
            if (this.game.schedulingSystem) {
                this.game.schedulingSystem.scheduleAction(() => {
                    this.removeIllusion(illusionId);
                }, this.ILLUSION_DURATION, illusionId);
            }

            return illusionId;

        } catch (error) {
            console.error('[PlaceIllusionAbility] Failed to add illusion components:', error);
            return illusionId; // Still return the entity even if illusion component failed
        }
    }

    createUnitIllusion(illusionId, prefabData, creatorEntity) {
        // Get creator team
        const creatorTeam = this.game.getComponent(creatorEntity, 'team');

        // Add unit-like components
        this.game.addComponent(illusionId, 'health', {
            max: 1,
            current: 1
        });

        this.game.addComponent(illusionId, 'velocity', {
            vx: 0,
            vy: 0,
            vz: 0,
            maxSpeed: 0,
            affectedByGravity: true,
            anchored: true
        });

        // Set to opposite team so enemies attack it
        if (creatorTeam) {
            this.game.addComponent(illusionId, 'team', {
                team: creatorTeam.team === 0 ? 1 : 0
            });
        }

        // Add renderable for visual appearance
        // Use existing unitType enum if available
        if (prefabData.spriteAnimationSet) {
            const enums = this.game.getEnums();
            const collection = enums.entityCollection?.units || 0;
            const typeIndex = enums.units?.[prefabData.spriteAnimationSet] || 0;

            this.game.addComponent(illusionId, 'unitType', {
                collection: collection,
                type: typeIndex
            });

            this.game.addComponent(illusionId, 'renderable', {
                objectType: collection,
                spawnType: typeIndex,
                capacity: 128
            });
        }

        this.game.addComponent(illusionId, 'animation', {
            scale: 1,
            rotation: 0,
            flash: 0
        });
    }

    createWorldObjectIllusion(illusionId, prefabData) {
        // Add world object component
        this.game.addComponent(illusionId, 'worldObject', {
            objectType: prefabData.title || 'illusion'
        });

        // Add renderable for sprites
        if (prefabData.renderTexture) {
            const enums = this.game.getEnums();
            const collection = enums.entityCollection?.worldObjects || 2;

            this.game.addComponent(illusionId, 'renderable', {
                objectType: collection,
                spawnType: 0,
                capacity: 1
            });

            // Store visual info
            this.game.addComponent(illusionId, 'visual', {
                texture: prefabData.renderTexture,
                scale: prefabData.spriteScale || 64,
                offset: prefabData.spriteOffset || 0
            });
        }
    }

    removeIllusion(illusionId) {
        if (!this.game.hasEntity || !this.game.hasEntity(illusionId)) return;

        const transform = this.game.getComponent(illusionId, 'transform');
        const illusionPos = transform?.position;

        // Create fade effect
        if (illusionPos) {
            this.playConfiguredEffects('expiration', illusionPos);
            this.createVisualEffect(illusionPos, 'impact', { count: 15 });
        }

        this.game.triggerEvent('onIllusionExpired', { illusionId });

        // Remove the entity
        if (this.game.removeEntity) {
            this.game.removeEntity(illusionId);
        } else if (this.game.destroyEntity) {
            this.game.destroyEntity(illusionId);
        }
    }

    getPrefabData(objectType) {
        // Try to get from collections
        const collections = this.game.getCollections();
        console.log('[PlaceIllusionAbility] getPrefabData for:', objectType);
        console.log('[PlaceIllusionAbility] Available collections:', Object.keys(collections));

        // Check collectibles collection first
        if (collections.collectibles && collections.collectibles[objectType]) {
            console.log('[PlaceIllusionAbility] Found in collectibles');
            return collections.collectibles[objectType];
        }

        // Check world objects
        if (collections.worldObjects && collections.worldObjects[objectType]) {
            console.log('[PlaceIllusionAbility] Found in worldObjects');
            return collections.worldObjects[objectType];
        }

        // Check units
        if (collections.units && collections.units[objectType]) {
            console.log('[PlaceIllusionAbility] Found in units');
            return collections.units[objectType];
        }

        console.log('[PlaceIllusionAbility] Not found in any collection');
        return null;
    }

    defineEffects() {
        return {
            cast: { type: 'magic', options: { count: 25, scaleMultiplier: 1.0, speedMultiplier: 0.8 } },
            expiration: { type: 'smoke', options: { count: 20, scaleMultiplier: 1.2 } },
            impact: { type: 'sparkle', options: { count: 15, scaleMultiplier: 0.8 } }
        };
    }
}
