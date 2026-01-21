/**
 * ProjectCloneAbility - Creates a controllable clone of the player
 *
 * Press Q to create a clone at current position and immediately transfer control to it.
 * While clone exists, press Q to toggle control between clone and original body.
 * Clone lasts for 10 seconds, then control returns to original body.
 * Original body stays stationary while controlling the clone.
 */
class ProjectCloneAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, {
            name: 'Project Clone',
            description: 'Create a controllable clone of yourself',
            cooldown: 0,
            range: 0,
            manaCost: 0,
            targetType: 'self',
            animation: 'cast',
            priority: 10,
            castTime: 0,
            autoTrigger: 'none',
            ...abilityData
        });

        this.CLONE_DURATION = 10.0; // seconds
    }

    canExecute(casterEntity, params = {}) {
        return true;
    }

    execute(casterEntity, params = {}) {
        const transform = this.game.getComponent(casterEntity, 'transform');
        const casterPos = transform?.position;
        if (!casterPos) {
            return null;
        }

        // Check if player already has an active clone
        const playerController = this.game.getComponent(casterEntity, 'playerController');
        if (!playerController) {
            return null;
        }

        // If clone already exists, just toggle control (handled by PlayerControlSystem)
        if (playerController.activeCloneId && this.game.hasEntity(playerController.activeCloneId)) {
            return { success: true, action: 'toggle' };
        }

        // Create new clone
        const cloneId = this.createClone(casterEntity, casterPos, transform.rotation);
        if (!cloneId) {
            return null;
        }

        // Store clone reference on player
        playerController.activeCloneId = cloneId;
        playerController.controllingClone = true;

        // Play spawn effect
        this.createVisualEffect(casterPos, 'cast', { count: 25 });

        this.logAbilityUsage(casterEntity, `Created projection clone!`);
        this.game.triggerEvent('onCloneCreated', {
            entityId: casterEntity,
            cloneId,
            position: casterPos
        });

        return { success: true, cloneId, action: 'create' };
    }

    createClone(creatorEntity, position, rotation) {
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

        const cloneTransform = {
            position: { x: position.x, y: terrainHeight, z: position.z },
            rotation: { x: rotation?.x || 0, y: rotation?.y || 0, z: rotation?.z || 0 },
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
            console.error('[ProjectCloneAbility] Failed to add clone components:', error);
            return cloneId;
        }
    }

    removeClone(cloneId, creatorEntity) {
        if (!this.game.hasEntity(cloneId)) {
            return;
        }

        const transform = this.game.getComponent(cloneId, 'transform');
        const clonePos = transform?.position;

        // Create fade effect
        if (clonePos) {
            this.createVisualEffect(clonePos, 'impact', { count: 20 });
        }

        this.game.triggerEvent('onCloneExpired', { cloneId, creatorEntity });

        // Remove the entity
        this.game.destroyEntity(cloneId);

        // Clear clone reference from player
        if (creatorEntity) {
            const playerController = this.game.getComponent(creatorEntity, 'playerController');
            if (playerController) {
                playerController.activeCloneId = null;
                playerController.controllingClone = false;
            }
        }
    }

    defineEffects() {
        return {
            cast: { type: 'magic', options: { count: 25, scaleMultiplier: 1.0, speedMultiplier: 0.8 } },
            impact: { type: 'sparkle', options: { count: 20, scaleMultiplier: 1.0 } }
        };
    }
}
