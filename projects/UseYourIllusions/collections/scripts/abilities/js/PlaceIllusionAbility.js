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
        this.CLONE_DURATION = 20.0; // seconds for player clones
    }

    canExecute(casterEntity, params = {}) {
        // Check if player has belt with item in selected slot
        const belt = this.game.getComponent(casterEntity, 'magicBelt');
        if (!belt) return false;

        const selectedSlot = belt.selectedSlot;
        if (selectedSlot < 0) return false; // No slot active

        const slotKey = `slot${selectedSlot}`;
        const selectedItem = belt[slotKey];

        return selectedItem !== null;
    }

    execute(casterEntity, params = {}) {
        const transform = this.game.getComponent(casterEntity, 'transform');
        const casterPos = transform?.position;
        if (!casterPos) {
            return null;
        }

        const belt = this.game.getComponent(casterEntity, 'magicBelt');
        if (!belt) {
            return null;
        }

        const selectedSlot = belt.selectedSlot;
        const slotKey = `slot${selectedSlot}`;
        const itemTypeIndex = belt[slotKey];

        // null means empty slot
        if (itemTypeIndex === null) {
            return null;
        }

        // Convert index to string name
        const reverseEnums = this.game.getReverseEnums();
        const itemType = reverseEnums.worldObjects?.[itemTypeIndex];
        if (!itemType) {
            return null;
        }

        // Get target position from params
        const targetPosition = params.targetPosition;
        if (!targetPosition) {
            return null;
        }

        // Check range
        const dx = targetPosition.x - casterPos.x;
        const dz = targetPosition.z - casterPos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist > this.range) {
            return null;
        }

        // Special handling for clone item
        if (itemType === 'clone') {
            return this.executeClonePlacement(casterEntity, targetPosition, selectedSlot, belt);
        }

        // Destroy any existing illusion for this slot (each slot can only have one active illusion)
        const illusionKey = `illusion${selectedSlot}`;
        const existingIllusionId = belt[illusionKey];
        if (existingIllusionId !== null && existingIllusionId !== undefined) {
            this.removeIllusion(existingIllusionId);
            belt[illusionKey] = null;
        }

        // Create the illusion
        const illusionId = this.createIllusion(casterEntity, itemType, targetPosition, selectedSlot);
        if (!illusionId) {
            return null;
        }

        // Track the active illusion for this slot
        belt[illusionKey] = illusionId;

        // Deactivate the belt slot after placing
        belt.selectedSlot = -1;
        this.game.triggerEvent('onBeltSelectionChanged', { entityId: casterEntity, slotIndex: -1 });

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

    /**
     * Handle placing a clone from the belt
     * Creates a controllable player clone at the target position
     */
    executeClonePlacement(casterEntity, targetPosition, selectedSlot, belt) {
        const playerController = this.game.getComponent(casterEntity, 'playerController');
        if (!playerController) {
            return null;
        }

        // Check if player already has an active clone
        if (playerController.activeCloneId && this.game.hasEntity(playerController.activeCloneId)) {
            console.log('[PlaceIllusionAbility] Already have an active clone');
            return null;
        }

        // Create the clone at target position
        const cloneId = this.createPlayerClone(casterEntity, targetPosition);
        if (!cloneId) {
            return null;
        }

        // Store clone reference on player (but don't auto-switch control)
        playerController.activeCloneId = cloneId;
        playerController.controllingClone = false; // User must press Q to switch

        // Consume the belt item
        const slotKey = `slot${selectedSlot}`;
        belt[slotKey] = null;
        this.game.triggerEvent('onBeltUpdated', { entityId: casterEntity, slotIndex: selectedSlot, objectType: null });

        // Deactivate the belt slot after placing
        belt.selectedSlot = -1;
        this.game.triggerEvent('onBeltSelectionChanged', { entityId: casterEntity, slotIndex: -1 });

        // Play spawn effect
        this.playConfiguredEffects('cast', targetPosition);
        this.createVisualEffect(targetPosition, 'cast', { count: 25 });

        // Play clone create sound
        this.game.call('playSound', 'sounds', 'clone_create');

        this.logAbilityUsage(casterEntity, `Placed projection clone!`);
        this.game.triggerEvent('onCloneCreated', {
            entityId: casterEntity,
            cloneId,
            position: targetPosition
        });

        return { success: true, cloneId, objectType: 'clone' };
    }

    /**
     * Create a controllable clone of the player at the specified position
     */
    createPlayerClone(creatorEntity, position) {
        const enums = this.game.getEnums();

        // Get the creator's unit type to clone their appearance
        const creatorUnitType = this.game.getComponent(creatorEntity, 'unitType');
        if (!creatorUnitType) {
            return null;
        }

        // Get terrain height at position
        let terrainHeight = position.y || 0;
        if (this.game.hasService('getTerrainHeightAtPosition')) {
            terrainHeight = this.game.call('getTerrainHeightAtPosition', position.x, position.z) ?? terrainHeight;
        }

        const creatorTransform = this.game.getComponent(creatorEntity, 'transform');
        const cloneTransform = {
            position: { x: position.x, y: terrainHeight, z: position.z },
            rotation: { x: creatorTransform?.rotation?.x || 0, y: creatorTransform?.rotation?.y || 0, z: creatorTransform?.rotation?.z || 0 },
            scale: { x: 1, y: 1, z: 1 }
        };

        // Get creator's team
        const creatorTeam = this.game.getComponent(creatorEntity, 'team');
        const teamValue = creatorTeam?.team ?? enums.team?.player ?? 0;

        // Create unit using the same type as the creator
        const cloneId = this.game.call('createUnit',
            creatorUnitType.collection,
            creatorUnitType.type,
            cloneTransform,
            teamValue
        );

        if (cloneId === null || cloneId === undefined) {
            return null;
        }

        try {
            // Add clone marker component
            this.game.addComponent(cloneId, 'playerClone', {
                originalEntity: creatorEntity,
                createdTime: this.game.state.now || 0,
                duration: this.CLONE_DURATION,
                expiresAt: (this.game.state.now || 0) + this.CLONE_DURATION
            });

            // Remove AI components so clone doesn't act on its own
            if (this.game.hasComponent(cloneId, 'aiState')) {
                this.game.removeComponent(cloneId, 'aiState');
            }

            // Add velocity component if not present (for movement)
            if (!this.game.hasComponent(cloneId, 'velocity')) {
                this.game.addComponent(cloneId, 'velocity', {
                    vx: 0, vy: 0, vz: 0,
                    maxSpeed: 60,
                    affectedByGravity: true,
                    anchored: false
                });
            }

            // Make clone semi-transparent with blue tint
            const renderable = this.game.getComponent(cloneId, 'renderable');
            if (renderable) {
                renderable.tint = 0x4080FF; // Blue tint
                renderable.opacity = 0.7;
            }

            return cloneId;

        } catch (error) {
            console.error('[PlaceIllusionAbility] Failed to add clone components:', error);
            return cloneId;
        }
    }

    createIllusion(creatorEntity, objectType, position, slotIndex) {
        // Get the prefab data for this object type
        const prefabData = this.getPrefabData(objectType);
        if (!prefabData) {
            return null;
        }

        // Get enums for collection and type indices
        const enums = this.game.getEnums();
        const collectionIndex = enums.objectTypeDefinitions?.worldObjects;
        const spawnTypeIndex = enums.worldObjects?.[objectType];

        if (collectionIndex === undefined || spawnTypeIndex === undefined) {
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

        if (illusionId === null || illusionId === undefined) {
            return null;
        }

        try {
            // Add illusion marker component
            this.game.addComponent(illusionId, 'illusion', {
                sourcePrefab: objectType,
                creatorEntity: creatorEntity,
                createdTime: this.game.state.now || 0,
                duration: this.ILLUSION_DURATION,
                slotIndex: slotIndex
            });

            // Add lifetime component for automatic removal after duration
            this.game.addComponent(illusionId, 'lifetime', {
                duration: this.ILLUSION_DURATION,
                startTime: this.game.state.now
            });

            // Make illusion semi-transparent with purple tint to distinguish from real objects
            // Set on the renderable component - RenderSystem will apply during spawn
            const renderable = this.game.getComponent(illusionId, 'renderable');
            if (renderable) {
                renderable.tint = 0x8040FF; // Strong purple tint
                renderable.opacity = 0.7;
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
        if (!this.game.hasEntity(illusionId)) {
            return;
        }

        // Get illusion data to clear the belt reference
        const illusion = this.game.getComponent(illusionId, 'illusion');
        if (illusion && illusion.creatorEntity !== null && illusion.slotIndex !== null) {
            const belt = this.game.getComponent(illusion.creatorEntity, 'magicBelt');
            if (belt) {
                const illusionKey = `illusion${illusion.slotIndex}`;
                // Only clear if this is still the tracked illusion for that slot
                if (belt[illusionKey] === illusionId) {
                    belt[illusionKey] = null;
                }
            }
        }

        const transform = this.game.getComponent(illusionId, 'transform');
        const illusionPos = transform?.position;

        // Create fade effect
        if (illusionPos) {
            this.playConfiguredEffects('expiration', illusionPos);
            this.createVisualEffect(illusionPos, 'impact', { count: 15 });
        }

        this.game.triggerEvent('onIllusionExpired', { illusionId });

        // Remove the entity
        this.game.destroyEntity(illusionId);
    }

    getPrefabData(objectType) {
        // Try to get from collections
        const collections = this.game.getCollections();

        // Check world objects first (collectable items are now in worldObjects)
        if (collections.worldObjects && collections.worldObjects[objectType]) {
            return collections.worldObjects[objectType];
        }

        // Check units
        if (collections.units && collections.units[objectType]) {
            return collections.units[objectType];
        }

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
