class CombatAISystem {
    constructor(game){
        this.game = game;
        this.game.combatAISystems = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();
        
        this.DEFAULT_UNIT_RADIUS = 25;
        this.ATTACK_RANGE_BUFFER = 10;
        this.ALLY_SPACING_DISTANCE = 10;
        this.ENEMY_SPACING_DISTANCE = 5;
        this.AVOIDANCE_RADIUS_MULTIPLIER = 1;
        this.STRONG_AVOIDANCE_FORCE = 50;
        this.GENTLE_AVOIDANCE_FORCE = 10;

        this.TARGET_SWITCH_COOLDOWN = 0.3;
        this.MOVEMENT_DECISION_INTERVAL = 0.05;

        this.MIN_ATTACK_ANIMATION_TIME = 0.4;
        this.STATE_CHANGE_COOLDOWN = 0.1;

        this.DAMAGE_TIMING_RATIO = 0.5;
    }

    update(deltaTime) {
        if (this.game.state.phase !== 'battle') return;

        const combatUnits = this.game.getEntitiesWith(
            this.componentTypes.POSITION,
            this.componentTypes.COMBAT,
            this.componentTypes.TEAM,
            this.componentTypes.AI_STATE
        );

        combatUnits.forEach(entityId => {
            const pos = this.game.getComponent(entityId, this.componentTypes.POSITION);
            const combat = this.game.getComponent(entityId, this.componentTypes.COMBAT);
            const team = this.game.getComponent(entityId, this.componentTypes.TEAM);
            const aiState = this.game.getComponent(entityId, this.componentTypes.AI_STATE);
            const vel = this.game.getComponent(entityId, this.componentTypes.VELOCITY);
            const collision = this.game.getComponent(entityId, this.componentTypes.COLLISION);
            if(!pos || !vel) return;

            if (!aiState.aiBehavior) {
                aiState.aiBehavior = {
                    lastDecisionTime: 0,
                    currentTarget: null,
                    targetLockTime: 0,
                    targetPosition: null,
                    lastStateChange: 0,
                    lastAttackStart: 0
                };
            }
            const aiBehavior = aiState.aiBehavior;
            const now = Date.now() / 1000;

            const enemies = combatUnits.filter(otherId => {
                const otherTeam = this.game.getComponent(otherId, this.componentTypes.TEAM);
                const otherHealth = this.game.getComponent(otherId, this.componentTypes.HEALTH);
                const otherDeathState = this.game.getComponent(otherId, this.componentTypes.DEATH_STATE);
                if (otherId === entityId || !otherTeam || otherTeam.team === team.team) return false;
                if (!otherHealth || otherHealth.current <= 0) return false;
                if (otherDeathState && otherDeathState.isDying) return false;
                return true;
            });

            if (aiBehavior.currentTarget) {
                const targetHealth = this.game.getComponent(aiBehavior.currentTarget, this.componentTypes.HEALTH);
                const targetDeathState = this.game.getComponent(aiBehavior.currentTarget, this.componentTypes.DEATH_STATE);
                if (!targetHealth || targetHealth.current <= 0 || (targetDeathState && targetDeathState.isDying)) {
                    aiBehavior.currentTarget = null;
                    aiBehavior.targetPosition = null;
                }
            }

            if (enemies.length === 0) {
                this.changeAIState(aiState, 'idle', now);
                aiBehavior.currentTarget = null;
                aiBehavior.targetPosition = null;
                return;
            }

            if (aiBehavior.currentTarget) {
                const targetPos = this.game.getComponent(aiBehavior.currentTarget, this.componentTypes.POSITION);
                if (targetPos) {
                    aiBehavior.targetPosition = { x: targetPos.x, y: targetPos.y, z: targetPos.z };
                }
            }

            const shouldMakeDecision = (aiBehavior.lastDecisionTime === 0) ||
                (now - aiBehavior.lastDecisionTime > this.MOVEMENT_DECISION_INTERVAL);

            if (shouldMakeDecision) {
                this.makeAIDecision(entityId, pos, combat, team, aiState, enemies, collision, now);
                aiBehavior.lastDecisionTime = now;
            }

            this.handleCombat(entityId, pos, combat, aiState, collision, now);
        });
    }

    changeAIState(aiState, newState, now) {
        const aiBehavior = aiState.aiBehavior;
        if (now - aiBehavior.lastStateChange < this.STATE_CHANGE_COOLDOWN) return false;
        if (aiState.state === 'attacking') {
            const attackDuration = now - aiBehavior.lastAttackStart;
            if (attackDuration < this.MIN_ATTACK_ANIMATION_TIME) return false;
        }
        if (aiState.state !== newState) {
            aiState.state = newState;
            aiBehavior.lastStateChange = now;
            if (newState === 'attacking') aiBehavior.lastAttackStart = now;
            return true;
        }
        return false;
    }

    makeAIDecision(entityId, pos, combat, team, aiState, enemies, collision, now) {
        const aiBehavior = aiState.aiBehavior;
        let targetEnemy = this.findBestTarget(pos, enemies, aiBehavior, now);
        if (!targetEnemy) {
            aiBehavior.currentTarget = null;
            aiBehavior.targetPosition = null;
            return;
        }
        const targetHealth = this.game.getComponent(targetEnemy, this.componentTypes.HEALTH);
        const targetDeathState = this.game.getComponent(targetEnemy, this.componentTypes.DEATH_STATE);
        if (!targetHealth || targetHealth.current <= 0 || (targetDeathState && targetDeathState.isDying)) {
            aiBehavior.currentTarget = null;
            aiBehavior.targetPosition = null;
            return;
        }
        const enemyPos = this.game.getComponent(targetEnemy, this.componentTypes.POSITION);
        if (!enemyPos) return;
        aiBehavior.currentTarget = targetEnemy;
        aiBehavior.targetPosition = { x: enemyPos.x, y: enemyPos.y, z: enemyPos.z };
        if (this.isInAttackRange(entityId, targetEnemy, combat)) {
            this.changeAIState(aiState, 'attacking', now);
        } else {
            this.changeAIState(aiState, 'chasing', now);
        }
    }

    findBestTarget(pos, enemies, aiBehavior, now) {
        let bestTarget = null;
        let bestScore = -1;
        
        // If unit is currently attacking, stick with current target unless it's dead/invalid
        if (aiBehavior.currentTarget) {
            const currentTargetHealth = this.game.getComponent(aiBehavior.currentTarget, this.componentTypes.HEALTH);
            const currentTargetDeathState = this.game.getComponent(aiBehavior.currentTarget, this.componentTypes.DEATH_STATE);
            
            // Only switch if current target is dead/dying or not in enemy list anymore
            const isCurrentTargetValid = enemies.includes(aiBehavior.currentTarget) && 
                                       currentTargetHealth && 
                                       currentTargetHealth.current > 0 && 
                                       (!currentTargetDeathState || !currentTargetDeathState.isDying);
            
            if (isCurrentTargetValid) {
                return aiBehavior.currentTarget; // Keep attacking current target
            }
        }
        
        // Find new target only if we don't have a valid current target
        enemies.forEach(enemyId => {
            const enemyPos = this.game.getComponent(enemyId, this.componentTypes.POSITION);
            const enemyHealth = this.game.getComponent(enemyId, this.componentTypes.HEALTH);
            const enemyDeathState = this.game.getComponent(enemyId, this.componentTypes.DEATH_STATE);
            if (!enemyPos || !enemyHealth || enemyHealth.current <= 0) return;
            if (enemyDeathState && enemyDeathState.isDying) return;
            const dx = enemyPos.x - pos.x;
            const dz = enemyPos.z - pos.z;
            const distance = Math.sqrt(dx * dx + dz * dz);
            let score = 1000 - distance;
            
            if (score > bestScore) {
                bestScore = score;
                bestTarget = enemyId;
            }
        });
        
        if (bestTarget !== aiBehavior.currentTarget) aiBehavior.targetLockTime = now;
        return bestTarget;
    }

    handleCombat(entityId, pos, combat, aiState, collision, now) {
        const aiBehavior = aiState.aiBehavior;
        if (!aiBehavior.currentTarget || aiState.state !== 'attacking') return;
        const targetPos = this.game.getComponent(aiBehavior.currentTarget, this.componentTypes.POSITION);
        const targetHealth = this.game.getComponent(aiBehavior.currentTarget, this.componentTypes.HEALTH);
        const targetDeathState = this.game.getComponent(aiBehavior.currentTarget, this.componentTypes.DEATH_STATE);
        if (!targetPos || !targetHealth || targetHealth.current <= 0 || (targetDeathState && targetDeathState.isDying)) {
            aiBehavior.currentTarget = null;
            aiBehavior.targetPosition = null;
            this.changeAIState(aiState, 'idle', now);
            return;
        }
        if (!this.isInAttackRange(entityId, aiBehavior.currentTarget, combat, 5)) {
            this.changeAIState(aiState, 'chasing', now);
            return;
        }
        
        // Check if unit is in the middle of an attack animation
        if (this.isUnitCurrentlyAttacking(entityId)) {
            // Don't start new attack while animation is playing
            aiBehavior.targetPosition = { x: targetPos.x, y: targetPos.y, z: targetPos.z };
            return;
        }
        
        if (now - combat.lastAttack >= 1 / combat.attackSpeed && combat.damage > 0) {
            this.initiateAttack(entityId, aiBehavior.currentTarget, combat, now);
            combat.lastAttack = now;
            aiBehavior.lastAttackStart = now;
        }
        aiBehavior.targetPosition = { x: targetPos.x, y: targetPos.y, z: targetPos.z };
    }

    isUnitCurrentlyAttacking(entityId) {
        if (!this.game.animationSystem) return false;
        
        const animState = this.game.animationSystem.entityAnimationStates.get(entityId);
        if (!animState) return false;
        
        const currentAnim = animState.currentAnimation;
        if (!currentAnim) return false;
        
        // Check if currently playing an attack animation
        const attackAnimations = ['attack', 'shoot', 'bow', 'cast', 'throw', 'combat', 'fight', 'swing', 'strike', 'aim', 'fire'];
        if (!attackAnimations.includes(currentAnim.toLowerCase())) return false;
        
        // Check if it's a single-play animation that's still running
        const isSinglePlay = this.game.animationSystem.SINGLE_PLAY_ANIMATIONS.has(currentAnim.toLowerCase());
        if (!isSinglePlay) return false;
        
        // Check if animation is still playing
        const isFinished = this.game.animationSystem.isAnimationFinished(entityId, currentAnim);
        return !isFinished;
    }

    initiateAttack(attackerId, targetId, combat, now) {
        const targetHealth = this.game.getComponent(targetId, this.componentTypes.HEALTH);
        const targetDeathState = this.game.getComponent(targetId, this.componentTypes.DEATH_STATE);
        if (!targetHealth || targetHealth.current <= 0 || (targetDeathState && targetDeathState.isDying)) return;
        
        if (this.game.animationSystem) {
            const animationSpeed = this.calculateAttackAnimationSpeed(attackerId, combat);
            const minAnimationTime = 1 / combat.attackSpeed * 0.8; // 80% of attack interval
            
            this.game.animationSystem.triggerSinglePlayAnimation(attackerId, 'attack', animationSpeed, minAnimationTime);
        }
        
        if (combat.projectile && this.game.projectileSystem) {
            this.scheduleProjectileLaunch(attackerId, targetId, combat, now);
        } else {
            this.scheduleMeleeDamage(attackerId, targetId, combat, now);
        }
    }

    calculateAttackAnimationSpeed(attackerId, combat) {
        const attackInterval = 1 / combat.attackSpeed;
        
        // Get the base animation duration
        let baseAnimationDuration = 0.8; // Default fallback
        
        if (this.game.animationSystem) {
            const animationActions = this.game.animationSystem.entityAnimations.get(attackerId);
            if (animationActions && animationActions.attack) {
                const attackAction = animationActions.attack;
                if (attackAction.getClip) {
                    baseAnimationDuration = attackAction.getClip().duration;
                }
            }
        }
        
        // Calculate speed to fit animation into attack interval (leaving some buffer)
        const targetAnimationDuration = Math.max(attackInterval * 0.9, 0.2);
        let animationSpeed = baseAnimationDuration / targetAnimationDuration;
        
        return animationSpeed;
    }

    scheduleMeleeDamage(attackerId, targetId, combat, now) {
        if (!this.game.damageSystem) {
            console.warn('DamageSystem not found, cannot schedule melee damage');
            return;
        }

        const attackInterval = 1 / combat.attackSpeed;
        const damageDelay = attackInterval * this.DAMAGE_TIMING_RATIO;
        
        const element = this.getDamageElement(attackerId, combat);
        
        this.game.damageSystem.scheduleDamage(
            attackerId, 
            targetId, 
            combat.damage, 
            element, 
            damageDelay,
            {
                isMelee: true,
                weaponRange: combat.range + this.ATTACK_RANGE_BUFFER + 1
            }
        );
    }

    scheduleProjectileLaunch(attackerId, targetId, combat, now) {
        const attackInterval = 1 / combat.attackSpeed;
        const launchDelay = attackInterval * this.DAMAGE_TIMING_RATIO;
        
        setTimeout(() => {
            this.fireProjectileAttack(attackerId, targetId, combat.projectile);
        }, launchDelay * 1000);
    }

    fireProjectileAttack(attackerId, targetId, projectileTypeId) {
        if (!this.game.projectileSystem) return;
        const projectileData = this.game.getCollections().projectiles[projectileTypeId];
        if (!projectileData) return;
        this.game.projectileSystem.fireProjectile(attackerId, targetId, {
            id: projectileTypeId,
            ...projectileData
        });
    }

    getDamageElement(entityId, combat) {
        if (combat.element) {
            return combat.element;
        }
        
        const weaponElement = this.getWeaponElement(entityId);
        if (weaponElement) {
            return weaponElement;
        }
        
        return this.game.damageSystem?.ELEMENT_TYPES?.PHYSICAL || 'physical';
    }

    getWeaponElement(entityId) {
        if (!this.game.equipmentSystem) return null;
        
        const equipment = this.game.getComponent(entityId, this.componentTypes.EQUIPMENT);
        if (!equipment) return null;
        
        const mainHandItem = equipment.slots.mainHand;
        if (mainHandItem) {
            const itemData = this.game.equipmentSystem.getItemData(mainHandItem);
            if (itemData && itemData.stats && itemData.stats.element) {
                return itemData.stats.element;
            }
        }
        
        const offHandItem = equipment.slots.offHand;
        if (offHandItem) {
            const itemData = this.game.equipmentSystem.getItemData(offHandItem);
            if (itemData && itemData.stats && itemData.stats.element) {
                return itemData.stats.element;
            }
        }
        
        return null;
    }

    calculateDistances(pos1, pos2, collision1, collision2) {
        const dx = pos2.x - pos1.x;
        const dz = pos2.z - pos1.z;
        const centerToCenterDistance = Math.sqrt(dx * dx + dz * dz);
        const radius1 = this.getUnitRadius(collision1);
        const radius2 = this.getUnitRadius(collision2);
        const edgeToEdgeDistance = Math.max(0, centerToCenterDistance - radius1 - radius2);
        const distanceToTargetEdge = Math.max(0, centerToCenterDistance - radius2);
        return {
            centerToCenter: centerToCenterDistance,
            edgeToEdge: edgeToEdgeDistance,
            attackerCenterToTargetEdge: distanceToTargetEdge,
            attackerRadius: radius1,
            targetRadius: radius2
        };
    }

    isInAttackRange(attackerId, targetId, combat, extraBuffer = 0) {
        const attackerPos = this.game.getComponent(attackerId, this.componentTypes.POSITION);
        const targetPos = this.game.getComponent(targetId, this.componentTypes.POSITION);
        const attackerCollision = this.game.getComponent(attackerId, this.componentTypes.COLLISION);
        const targetCollision = this.game.getComponent(targetId, this.componentTypes.COLLISION);
        if (!attackerPos || !targetPos) return false;
        const distances = this.calculateDistances(attackerPos, targetPos, attackerCollision, targetCollision);
        const effectiveRange = combat.range + this.ATTACK_RANGE_BUFFER + extraBuffer;
        return distances.attackerCenterToTargetEdge <= effectiveRange;
    }

    isWithinEdgeToEdgeRange(attackerId, targetId, maxRange) {
        const attackerPos = this.game.getComponent(attackerId, this.componentTypes.POSITION);
        const targetPos = this.game.getComponent(targetId, this.componentTypes.POSITION);
        const attackerCollision = this.game.getComponent(attackerId, this.componentTypes.COLLISION);
        const targetCollision = this.game.getComponent(targetId, this.componentTypes.COLLISION);
        if (!attackerPos || !targetPos) return false;
        const distances = this.calculateDistances(attackerPos, targetPos, attackerCollision, targetCollision);
        return distances.edgeToEdge <= maxRange;
    }

    getUnitRadius(collision) {
        if (collision && collision.radius) {
            return Math.max(this.DEFAULT_UNIT_RADIUS, collision.radius);
        }
        return this.DEFAULT_UNIT_RADIUS;
    }

    startDeathProcess(entityId) {
        const ComponentTypes = this.game.componentManager.getComponentTypes();
        const Components = this.game.componentManager.getComponents();
        const existingDeathState = this.game.getComponent(entityId, ComponentTypes.DEATH_STATE);
        if (existingDeathState && existingDeathState.isDying) return;
        
        if (this.game.damageSystem) {
            this.game.damageSystem.clearAllStatusEffects(entityId);
        }
        
        this.game.addComponent(entityId, ComponentTypes.DEATH_STATE, Components.DeathState(true, Date.now() / 1000, 2.0));
        if (this.game.hasComponent(entityId, ComponentTypes.AI_STATE)) {
            this.game.removeComponent(entityId, ComponentTypes.AI_STATE);
        }
        const velocity = this.game.getComponent(entityId, ComponentTypes.VELOCITY);
        if (velocity) { velocity.x = 0; velocity.y = 0; velocity.z = 0; }
        
        if (this.game.hasComponent(entityId, ComponentTypes.COMBAT)) {
            this.game.removeComponent(entityId, ComponentTypes.COMBAT);
        }
        
        if (this.game.animationSystem && this.game.animationSystem.playDeathAnimation) {
            this.game.animationSystem.playDeathAnimation(entityId);
        }
    }
    
    applyDamage(sourceId, targetId, damage, element, options = {}) {
        if (!this.game.damageSystem) {
            console.warn('DamageSystem not found, cannot apply damage');
            return { damage: 0, prevented: true, reason: 'no_damage_system' };
        }
        
        return this.game.damageSystem.applyDamage(sourceId, targetId, damage, element, options);
    }

    applySplashDamage(sourceId, centerPos, damage, element, radius, options = {}) {
        if (!this.game.damageSystem) {
            console.warn('DamageSystem not found, cannot apply splash damage');
            return [];
        }
        
        return this.game.damageSystem.applySplashDamage(sourceId, centerPos, damage, element, radius, options);
    }

    curePoison(targetId, stacksToRemove = null) {
        if (!this.game.damageSystem) {
            console.warn('DamageSystem not found, cannot cure poison');
            return false;
        }
        
        return this.game.damageSystem.curePoison(targetId, stacksToRemove);
    }

    getPoisonStacks(entityId) {
        if (!this.game.damageSystem) {
            return 0;
        }
        
        return this.game.damageSystem.getPoisonStacks(entityId);
    }

    hasResistance(entityId, element, threshold = 0.5) {
        if (!this.game.damageSystem) {
            return false;
        }
        
        return this.game.damageSystem.hasResistance(entityId, element, threshold);
    }

    getStatusEffects(entityId) {
        if (!this.game.damageSystem) {
            return { poison: [] };
        }
        
        return this.game.damageSystem.getStatusEffects(entityId);
    }

    debugStatusEffects() {
        if (!this.game.damageSystem) {
            console.log('DamageSystem not found');
            return;
        }
        
        this.game.damageSystem.debugStatusEffects();
    }
}