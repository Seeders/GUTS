import BaseMovementSystem from '../../../../../../global/collections/scripts/systems/js/BaseMovementSystem.js';

/**
 * MovementSystem for HeroArena
 * Extends BaseMovementSystem with:
 *  - battle phase gating
 *  - LAYERED collision: flying units pass freely over ground units, but
 *    air/air and ground/ground never stack
 *  - hard overlap resolution: soft separation forces steer units apart while
 *    marching, but converging melee (which the base marks "anchored" while
 *    attacking, zeroing its separation force) could still end up standing in
 *    the same spot. A positional relaxation pass after movement pushes
 *    same-layer overlaps apart deterministically.
 */
class MovementSystem extends BaseMovementSystem {
    constructor(game) {
        super(game);
        // Collision radii are placement-tile-derived (~11 for a 1-cell unit,
        // see UnitCreationSystem.collisionRadiusFor). The base's 25 floor
        // would blow every unit back up to 2 tiles wide — keep the floor
        // BELOW the smallest real radius so it's only a fallback for
        // entities with no collision component.
        this.DEFAULT_UNIT_RADIUS = 10;
    }

    /**
     * Only process movement during battle phase
     */
    shouldProcessUpdate() {
        return this.game.state.phase === this.enums.gamePhase.battle;
    }

    // Soft separation only applies within the same collision layer:
    // air pushes air, ground pushes ground, air ignores ground entirely.
    shouldSeparate(entityId, otherEntityId) {
        return (this._flyHeightForEntity(entityId) > 0) ===
               (this._flyHeightForEntity(otherEntityId) > 0);
    }

    update() {
        super.update();
        if (this.shouldProcessUpdate()) {
            this._resolveUnitOverlaps();
        }
    }

    // Fraction of the remaining penetration resolved per tick. <1 keeps the
    // push smooth (converges over several ticks) instead of teleporting units.
    static OVERLAP_RELAXATION = 0.3;
    static MAX_OVERLAP_CHECKS = 8;
    // Penetration below this is left alone — stops packed melee from
    // micro-jittering as neighbors trade sub-unit pushes every tick.
    static OVERLAP_DEADBAND = 1.0;

    // Hard de-stacking: for every pair of living, same-layer units whose
    // collision circles overlap, push them apart along the line between
    // their centers. Anchored entities (buildings, tower emplacements) never
    // move — the other unit takes the full push. Deterministic: entities are
    // processed in ascending id order, each pair handled once (a < b), and
    // perfectly-stacked pairs break symmetry with an id-derived angle.
    _resolveUnitOverlaps() {
        const aliveState = this.enums.deathState?.alive;
        const relax = MovementSystem.OVERLAP_RELAXATION;

        const entities = this.getMovementEntities();
        entities.sort((a, b) => a - b);

        for (const entityId of entities) {
            if (!this._isSolidUnit(entityId, aliveState)) continue;

            const transform = this.game.getComponent(entityId, 'transform');
            const pos = transform?.position;
            if (!pos) continue;
            const vel = this.game.getComponent(entityId, 'velocity');
            const myRadius = this.getUnitRadius(this.game.getComponent(entityId, 'collision'));
            const myFlying = this._flyHeightForEntity(entityId) > 0;

            // Search radius covers my circle + the largest plausible neighbor.
            const nearby = this.call.getNearbyUnits(pos, myRadius + 60, entityId);
            if (!nearby || nearby.length === 0) continue;

            let checks = 0;
            for (const otherId of nearby) {
                if (checks >= MovementSystem.MAX_OVERLAP_CHECKS) break;
                // Each pair once: the lower id owns the resolution.
                if (otherId <= entityId) continue;
                if (!this._isSolidUnit(otherId, aliveState)) continue;
                if ((this._flyHeightForEntity(otherId) > 0) !== myFlying) continue;

                const otherTransform = this.game.getComponent(otherId, 'transform');
                const otherPos = otherTransform?.position;
                if (!otherPos) continue;
                checks++;

                const otherRadius = this.getUnitRadius(this.game.getComponent(otherId, 'collision'));
                const minDist = myRadius + otherRadius;

                let dx = otherPos.x - pos.x;
                let dz = otherPos.z - pos.z;
                const dist = Math.sqrt(dx * dx + dz * dz);
                const penetration = minDist - dist;
                if (penetration <= MovementSystem.OVERLAP_DEADBAND) continue;

                // Direction to push `other` away from `entity`. Perfectly
                // stacked pair: derive a stable angle from the ids so both
                // clients break the tie identically.
                let dirX, dirZ;
                if (dist > 0.1) {
                    dirX = dx / dist;
                    dirZ = dz / dist;
                } else {
                    const angle = ((entityId * 2654435761 + otherId * 40503) % 6283) / 1000;
                    dirX = Math.cos(angle);
                    dirZ = Math.sin(angle);
                }

                const push = penetration * relax;
                const otherVel = this.game.getComponent(otherId, 'velocity');
                // Yield priority: anchored (buildings) never move; a unit
                // mid-attack holds its ground against a unit that's merely
                // walking — the arriving unit flows around the fighter
                // instead of bumping it off its target.
                const iMove = !vel?.anchored;
                const otherMoves = !otherVel?.anchored;
                const iFight = iMove && this._isAttackingNow(entityId);
                const otherFights = otherMoves && this._isAttackingNow(otherId);

                if (!iMove && !otherMoves) {
                    // both anchored: overlapping buildings are a placement
                    // problem, not a movement one
                    continue;
                } else if (!iMove || (iFight && otherMoves && !otherFights)) {
                    otherPos.x += dirX * push;
                    otherPos.z += dirZ * push;
                } else if (!otherMoves || (otherFights && !iFight)) {
                    pos.x -= dirX * push;
                    pos.z -= dirZ * push;
                } else {
                    pos.x      -= dirX * push * 0.5;
                    pos.z      -= dirZ * push * 0.5;
                    otherPos.x += dirX * push * 0.5;
                    otherPos.z += dirZ * push * 0.5;
                }
            }
        }
    }

    // Currently executing its attack action (cheap check — no range
    // validation; good enough for yield priority in the overlap pass).
    _isAttackingNow(entityId) {
        const aiState = this.game.getComponent(entityId, 'aiState');
        return !!aiState &&
            aiState.currentActionCollection === this.enums.behaviorCollection?.behaviorActions &&
            aiState.currentAction === this.enums.behaviorActions?.AttackEnemyBehaviorAction;
    }

    // Solid = a living, non-projectile, non-leaping unit that occupies space.
    // NOTE: `vel.anchored` does NOT make a unit non-solid — anchored units
    // (buildings) block others; they just never get pushed themselves. The
    // base's "anchored while attacking" only mutes separation FORCES; the
    // overlap pass here still de-stacks attackers.
    _isSolidUnit(entityId, aliveState) {
        if (this.game.getComponent(entityId, 'projectile')) return false;
        if (!this.game.getComponent(entityId, 'unitType')) return false;

        const health = this.game.getComponent(entityId, 'health');
        if (!health || health.current <= 0) return false;
        const ds = this.game.getComponent(entityId, 'deathState');
        if (ds && aliveState != null && ds.state !== aliveState) return false;

        const leaping = this.game.getComponent(entityId, 'leaping');
        if (leaping && leaping.isLeaping) return false;

        return true;
    }
}
