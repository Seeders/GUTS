class GameUtils {
    static DEFAULT_UNIT_RADIUS = 25;
    static MIN_MOVEMENT_THRESHOLD = 0.1;

    static getUnitRadius(collision) {
        return collision?.radius ? Math.max(this.DEFAULT_UNIT_RADIUS, collision.radius) : this.DEFAULT_UNIT_RADIUS;
    }

    /**
     * Get collision radius from entity, returns 0 if no collision component
     */
    static getCollisionRadius(game, entityId) {
        const collision = game.getComponent(entityId, 'collision');
        return collision?.radius || 0;
    }

    /**
     * Calculate effective attack/ability range accounting for collision radii
     * Effective range = base range + attacker radius + target radius
     */
    static getEffectiveRange(game, attackerId, targetId, baseRange) {
        const attackerRadius = this.getCollisionRadius(game, attackerId);
        const targetRadius = this.getCollisionRadius(game, targetId);
        return baseRange + attackerRadius + targetRadius;
    }

    /**
     * Calculate center-to-center distance between two entities
     */
    static getDistanceBetweenEntities(game, entityId1, entityId2) {
        const transform1 = game.getComponent(entityId1, 'transform');
        const transform2 = game.getComponent(entityId2, 'transform');
        const pos1 = transform1?.position;
        const pos2 = transform2?.position;

        if (!pos1 || !pos2) return Infinity;

        const dx = pos2.x - pos1.x;
        const dz = pos2.z - pos1.z;
        return Math.sqrt(dx * dx + dz * dz);
    }

    /**
     * Check if target is within effective range of attacker
     * Accounts for collision radii of both entities
     */
    static isInRange(game, attackerId, targetId, baseRange) {
        const distance = this.getDistanceBetweenEntities(game, attackerId, targetId);
        const effectiveRange = this.getEffectiveRange(game, attackerId, targetId, baseRange);
        return distance <= effectiveRange;
    }

    static calculateDistance(pos1, pos2, collision1 = null, collision2 = null) {
        const dx = pos2.x - pos1.x;
        const dz = pos2.z - pos2.z;
        const centerDistance = Math.sqrt(dx * dx + dz * dz);

        if (!collision1 || !collision2) return centerDistance;

        const radius1 = this.getUnitRadius(collision1);
        const radius2 = this.getUnitRadius(collision2);

        return {
            center: centerDistance,
            edge: Math.max(0, centerDistance - radius1 - radius2),
            toTargetEdge: Math.max(0, centerDistance - radius2)
        };
    }

    static lerp(a, b, t) {
        return a + (b - a) * t;
    }
}



// Assign to global.GUTS for server
if (typeof global !== 'undefined' && global.GUTS) {
    global.GUTS.GameUtils = GameUtils;
}

// ES6 exports for webpack bundling
export default GameUtils;
export { GameUtils };
