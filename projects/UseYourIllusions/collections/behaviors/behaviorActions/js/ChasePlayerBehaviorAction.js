/**
 * ChasePlayerBehaviorAction - Moves toward and attacks the player
 *
 * When in attack range, attacks the player using the combat system.
 * When player health reaches 0, triggers onPlayerCaught event for defeat.
 * If player escapes vision range, goes to last known position then gives up.
 *
 * Uses shared.playerTarget set by FindPlayerBehaviorAction
 * Returns RUNNING while chasing/attacking, SUCCESS when player is defeated, FAILURE if lost target
 */
class ChasePlayerBehaviorAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        const transform = game.getComponent(entityId, 'transform');
        const pos = transform?.position;
        if (!pos) {
            return this.failure();
        }

        // Get the target from shared state
        const shared = this.getShared(entityId, game);
        const playerId = shared.playerTarget;

        // Get memory for tracking investigation state
        const memory = this.getMemory(entityId) || {};

        // If no player target, check if we're investigating last known position
        if (playerId === null || playerId === undefined) {
            return this.handleNoTarget(entityId, game, shared, memory, pos);
        }

        // Check if player still exists
        if (!game.hasEntity(playerId)) {
            shared.playerTarget = null;
            shared.target = null;
            return this.failure();
        }

        // Check if player is dead (no health component, health <= 0, or dying/corpse state)
        const playerHealth = game.getComponent(playerId, 'health');
        const playerDeathState = game.getComponent(playerId, 'deathState');
        const enums = game.getEnums();
        const isDead = !playerHealth ||
                       playerHealth.current <= 0 ||
                       (playerDeathState && playerDeathState.state !== enums.deathState?.alive);

        if (isDead) {
            console.log(`[ChasePlayerBehaviorAction] Guard ${entityId} - player ${playerId} is dead, stopping chase`);

            // Clear the targets
            shared.playerTarget = null;
            shared.target = null;
            this.clearMemory(entityId);

            // Only trigger onPlayerCaught if we haven't already (player just died)
            // Check if this is the first frame detecting death
            if (playerHealth && playerHealth.current <= 0) {
                const playerTransform = game.getComponent(playerId, 'transform');
                const playerPos = playerTransform?.position || pos;

                game.triggerEvent('onPlayerCaught', {
                    guardId: entityId,
                    playerId: playerId,
                    position: { x: playerPos.x, y: playerPos.y, z: playerPos.z }
                });
            }

            return this.success({
                defeated: true,
                playerId: playerId
            });
        }

        const playerTransform = game.getComponent(playerId, 'transform');
        const playerPos = playerTransform?.position;
        if (!playerPos) {
            shared.playerTarget = null;
            shared.target = null;
            return this.failure();
        }

        // Calculate distance to player
        const dx = playerPos.x - pos.x;
        const dz = playerPos.z - pos.z;
        const distance = Math.sqrt(dx * dx + dz * dz);

        // Get vision range from unit type
        const unitTypeComp = game.getComponent(entityId, 'unitType');
        const unitTypeDef = game.call('getUnitTypeDef', unitTypeComp);
        const combat = game.getComponent(entityId, 'combat');
        const visionRange = unitTypeDef?.visionRange || combat?.visionRange || 250;

        // Check if player is still in vision range with line of sight
        const hasLOS = game.call('hasLineOfSight', pos, playerPos);
        const inVisionRange = distance <= visionRange;

        if (!inVisionRange || !hasLOS) {
            // Lost sight of player - remember last known position
            console.log(`[ChasePlayerBehaviorAction] Guard ${entityId} lost sight of player (dist: ${distance.toFixed(0)}, LOS: ${hasLOS})`);

            memory.lastKnownPosition = { x: playerPos.x, z: playerPos.z };
            memory.investigateStartTime = game.state.now;
            memory.investigating = true;
            // Memory is modified in place (getMemory returns a mutable reference)

            // Clear player target - we've lost them
            shared.playerTarget = null;
            shared.target = null;

            // Continue to investigate last known position
            shared.targetPosition = memory.lastKnownPosition;
            return this.running({
                state: 'investigating',
                lastKnownPosition: memory.lastKnownPosition
            });
        }

        // Player is visible - update last known position
        memory.lastKnownPosition = { x: playerPos.x, z: playerPos.z };
        memory.investigating = false;
        // Memory is modified in place (getMemory returns a mutable reference)

        // Get attack range from combat component
        const attackRange = combat?.range || 50;

        // Check if in attack range
        if (distance <= attackRange) {
            // Set target for compatibility with other systems
            shared.target = playerId;

            // Clear target position so movement system stops moving us
            shared.targetPosition = null;

            // Attack the player using the combat system
            if (combat) {
                this.performAttack(entityId, playerId, game, combat, transform, playerPos);
            }

            return this.running({
                state: 'attacking',
                targetId: playerId,
                distance: distance
            });
        }

        // Not in attack range - chase the player
        shared.target = playerId;
        shared.targetPosition = { x: playerPos.x, z: playerPos.z };

        return this.running({
            state: 'chasing',
            targetPosition: shared.targetPosition,
            distance: distance
        });
    }

    handleNoTarget(entityId, game, shared, memory, pos) {
        // Check if we're investigating a last known position
        if (!memory.investigating || !memory.lastKnownPosition) {
            return this.failure();
        }

        const lastKnown = memory.lastKnownPosition;
        const dx = lastKnown.x - pos.x;
        const dz = lastKnown.z - pos.z;
        const distToLastKnown = Math.sqrt(dx * dx + dz * dz);

        // Check if we've reached the last known position (within 30 units)
        const reachedLastKnown = distToLastKnown < 30;

        // Check investigation timeout (2 seconds after starting investigation)
        const investigationDuration = game.state.now - memory.investigateStartTime;
        const investigationTimeout = investigationDuration > 2.0;

        if (reachedLastKnown || investigationTimeout) {
            // Give up - player escaped
            console.log(`[ChasePlayerBehaviorAction] Guard ${entityId} giving up chase (reached: ${reachedLastKnown}, timeout: ${investigationTimeout})`);

            memory.investigating = false;
            memory.lastKnownPosition = null;
            // Memory is modified in place (getMemory returns a mutable reference)

            shared.targetPosition = null;
            return this.failure();
        }

        // Continue investigating - move to last known position
        shared.targetPosition = lastKnown;
        return this.running({
            state: 'investigating',
            lastKnownPosition: lastKnown,
            distanceToLastKnown: distToLastKnown
        });
    }

    performAttack(attackerId, targetId, game, combat, attackerTransform, targetPos) {
        // Face the target
        const attackerPos = attackerTransform?.position;
        if (attackerPos && targetPos && attackerTransform) {
            const dx = targetPos.x - attackerPos.x;
            const dz = targetPos.z - attackerPos.z;
            if (!attackerTransform.rotation) attackerTransform.rotation = { x: 0, y: 0, z: 0 };
            attackerTransform.rotation.y = Math.atan2(dz, dx);
        }

        // Stop movement while attacking
        const vel = game.getComponent(attackerId, 'velocity');
        if (vel) {
            vel.vx = 0;
            vel.vz = 0;
        }

        // Check attack cooldown
        if (!combat.lastAttack) combat.lastAttack = 0;
        const attackSpeed = combat.attackSpeed || 1;
        const timeSinceLastAttack = game.state.now - combat.lastAttack;
        if (timeSinceLastAttack < 1 / attackSpeed) {
            return; // Still on cooldown
        }

        combat.lastAttack = game.state.now;
        console.log(`[ChasePlayerBehaviorAction] Guard ${attackerId} attacking player ${targetId} at time ${game.state.now}, isPaused: ${game.state.isPaused}`);

        // Trigger attack animation
        if (!game.isServer && game.hasService('triggerSinglePlayAnimation')) {
            const enums = game.call('getEnums');
            const minAnimationTime = 1 / attackSpeed * 0.8;
            game.call('triggerSinglePlayAnimation', attackerId, enums.animationType.attack, attackSpeed, minAnimationTime);
        }

        // Play attack sound via AudioSystem service
        if (game.hasService('playSynthSound')) {
            const soundConfig = game.getCollections()?.sounds?.guard_attack?.audio;
            if (soundConfig) {
                // Calculate distance-based volume
                const camera = game.hasService('getCamera') ? game.call('getCamera') : null;
                let volume = soundConfig.volume || 0.25;
                if (camera?.position && attackerPos) {
                    const dx = attackerPos.x - camera.position.x;
                    const dz = attackerPos.z - camera.position.z;
                    const distToCamera = Math.sqrt(dx * dx + dz * dz);
                    const refDistance = 50;
                    const maxDistance = 400;
                    if (distToCamera >= maxDistance) {
                        volume = 0;
                    } else if (distToCamera > refDistance) {
                        volume *= 1.0 - (distToCamera - refDistance) / (maxDistance - refDistance);
                    }
                }
                if (volume > 0) {
                    game.call('playSynthSound', `guard_attack_${attackerId}_${game.state.now}`, soundConfig, { volume });
                }
            }
        }

        // Schedule melee damage (50% through attack animation)
        const damageDelay = (1 / attackSpeed) * 0.5;
        const element = combat.element || game.getEnums().element?.physical;

        game.call('scheduleDamage',
            attackerId,
            targetId,
            combat.damage,
            element,
            damageDelay,
            {
                isMelee: true,
                weaponRange: (combat.range || 50) + 10
            }
        );
    }

    onEnd(entityId, game) {
        const shared = this.getShared(entityId, game);
        if (shared) {
            shared.target = null;
        }
        this.clearMemory(entityId);
    }
}
