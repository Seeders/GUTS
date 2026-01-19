/**
 * CollectAbility - Copies the essence of a nearby object into the player's magic belt
 *
 * Triggered by pressing E when near a collectible object.
 * Reads the object type and stores it in the first available belt slot.
 * The original object remains in the world (copy, not cut).
 */
class CollectAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, {
            name: 'Collect',
            description: 'Collect a nearby object into your magic belt',
            cooldown: 0.5,
            range: 50,
            manaCost: 0,
            targetType: 'self',
            animation: 'cast',
            priority: 10,
            castTime: 0,
            autoTrigger: 'none',
            ...abilityData
        });

        this.COLLECTION_RADIUS = 60;
    }

    canExecute(casterEntity) {
        // Check if player has belt with empty slot
        const belt = this.game.getComponent(casterEntity, 'magicBelt');
        if (!belt) {
            console.log('[CollectAbility] No belt');
            return false;
        }

        // Check for empty slot (null means empty)
        const hasEmptySlot = belt.slot0 === null || belt.slot1 === null || belt.slot2 === null;
        if (!hasEmptySlot) {
            console.log('[CollectAbility] Belt full:', belt.slot0, belt.slot1, belt.slot2);
            return false;
        }

        // Check for nearby collectible
        const nearbyCollectible = this.findNearbyCollectible(casterEntity);
        if (nearbyCollectible === null) {
            console.log('[CollectAbility] No nearby collectible');
            return false;
        }

        return true;
    }

    execute(casterEntity) {
        const transform = this.game.getComponent(casterEntity, 'transform');
        const casterPos = transform?.position;
        if (!casterPos) return null;

        // Find nearest collectible
        const collectibleId = this.findNearbyCollectible(casterEntity);
        if (!collectibleId) return null;

        const collectible = this.game.getComponent(collectibleId, 'collectible');
        if (!collectible) return null;

        // objectType is stored as enum index, convert back to string name
        const objectTypeIndex = collectible.objectType;
        const reverseEnums = this.game.getReverseEnums();
        const objectType = reverseEnums.worldObjects?.[objectTypeIndex];

        if (!objectType) return null;

        // Store in belt
        const stored = this.game.call('storeBeltItem', casterEntity, objectType);
        if (!stored) return null;

        // Get collectible position for effects
        const collectibleTransform = this.game.getComponent(collectibleId, 'transform');
        const collectiblePos = collectibleTransform?.position;

        // Play collection effect at the collectible's position
        if (collectiblePos) {
            this.playConfiguredEffects('cast', collectiblePos);
            this.createVisualEffect(collectiblePos, 'cast', { count: 20 });
        }

        // The collectible stays in the world - we just copied its essence

        this.logAbilityUsage(casterEntity, `Copied essence of ${objectType}!`);
        this.game.triggerEvent('onCollectibleCollected', { entityId: casterEntity, objectType, collectibleId });

        return { success: true, objectType };
    }

    findNearbyCollectible(casterEntity) {
        const transform = this.game.getComponent(casterEntity, 'transform');
        const casterPos = transform?.position;
        if (!casterPos) return null;

        const playerController = this.game.getComponent(casterEntity, 'playerController');
        const radius = playerController?.interactionRadius || this.COLLECTION_RADIUS;

        // Get all entities with collectible component
        const collectibles = this.game.getEntitiesWith('collectible', 'transform');

        let nearestId = null;
        let nearestDist = Infinity;

        for (const entityId of collectibles) {
            const collectibleTransform = this.game.getComponent(entityId, 'transform');
            const collectiblePos = collectibleTransform?.position;
            if (!collectiblePos) continue;

            const dx = collectiblePos.x - casterPos.x;
            const dz = collectiblePos.z - casterPos.z;
            const dist = Math.sqrt(dx * dx + dz * dz);

            if (dist < radius && dist < nearestDist) {
                nearestDist = dist;
                nearestId = entityId;
            }
        }

        return nearestId;
    }

    defineEffects() {
        return {
            cast: { type: 'sparkle', options: { count: 20, scaleMultiplier: 0.8, speedMultiplier: 1.2 } },
            impact: { type: 'magic', options: { count: 15, scaleMultiplier: 1.0 } }
        };
    }
}
