class CombatAISystem {
    constructor(game){
        this.game = game;
        this.game.combatAISystems = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();
        
        // Configuration variables
        this.DEFAULT_UNIT_RADIUS = 25;
        this.ATTACK_RANGE_BUFFER = 10;
        this.ALLY_SPACING_DISTANCE = 10;
        this.ENEMY_SPACING_DISTANCE = 5;
        this.AVOIDANCE_RADIUS_MULTIPLIER = 1;
        this.STRONG_AVOIDANCE_FORCE = 50;
        this.GENTLE_AVOIDANCE_FORCE = 10;
        
        // AI decision parameters
        this.TARGET_SWITCH_COOLDOWN = 0.3;
        this.MOVEMENT_DECISION_INTERVAL = 0.05;
        
        // Animation coordination
        this.MIN_ATTACK_ANIMATION_TIME = 0.4;
        this.STATE_CHANGE_COOLDOWN = 0.1;
        
        // Battle end checking
        this.lastBattleEndCheck = 0;
        this.BATTLE_END_CHECK_INTERVAL = 1.0;
        
        // Damage timing system
        this.pendingDamageEvents = new Map();
        this.DAMAGE_TIMING_RATIO = 0.5;
    }
    
    update(deltaTime) {
        if (this.game.state.phase !== 'battle') return;
        
        const now = Date.now() / 1000;
        
        this.processPendingDamage(now);
        
        if (now - this.lastBattleEndCheck > this.BATTLE_END_CHECK_INTERVAL) {
            this.performBattleEndCheck();
            this.lastBattleEndCheck = now;
        }
        
        const combatUnits = this.game.getEntitiesWith(
            this.componentTypes.POSITION, this.componentTypes.COMBAT, this.componentTypes.TEAM, this.componentTypes.AI_STATE
        );
        
        combatUnits.forEach(entityId => {
            const pos = this.game.getComponent(entityId, this.componentTypes.POSITION);
            const combat = this.game.getComponent(entityId, this.componentTypes.COMBAT);
            const team = this.game.getComponent(entityId, this.componentTypes.TEAM);
            const aiState = this.game.getComponent(entityId, this.componentTypes.AI_STATE);
            const vel = this.game.getComponent(entityId, this.componentTypes.VELOCITY);
            const collision = this.game.getComponent(entityId, this.componentTypes.COLLISION);
            
            if(!pos || !vel) return;
            
            // Get or create AI behavior tracking
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
            
            // Find enemies - FIXED: Exclude dying units
            const enemies = combatUnits.filter(otherId => {
                const otherTeam = this.game.getComponent(otherId, this.componentTypes.TEAM);
                const otherHealth = this.game.getComponent(otherId, this.componentTypes.HEALTH);
                const otherDeathState = this.game.getComponent(otherId, this.componentTypes.DEATH_STATE);
                
                // Skip if same entity or different team
                if (otherId === entityId || !otherTeam || otherTeam.team === team.team) {
                    return false;
                }
                
                // Skip if unit is dead or dying
                if (!otherHealth || otherHealth.current <= 0) {
                    return false;
                }
                
                // Skip if unit is in dying state
                if (otherDeathState && otherDeathState.isDying) {
                    return false;
                }
                
                return true;
            });
            
            // Clear current target if it's no longer valid
            if (aiBehavior.currentTarget) {
                const targetHealth = this.game.getComponent(aiBehavior.currentTarget, this.componentTypes.HEALTH);
                const targetDeathState = this.game.getComponent(aiBehavior.currentTarget, this.componentTypes.DEATH_STATE);
                
                // Clear target if it's dead or dying
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
            
            // Always update target position if we have a target
            if (aiBehavior.currentTarget) {
                const targetPos = this.game.getComponent(aiBehavior.currentTarget, this.componentTypes.POSITION);
                if (targetPos) {
                    aiBehavior.targetPosition = { x: targetPos.x, y: targetPos.y, z: targetPos.z };
                }
            }
            
            // Only make new decisions at intervals to reduce jitter
            const shouldMakeDecision = (aiBehavior.lastDecisionTime === 0) || 
                                    (now - aiBehavior.lastDecisionTime > this.MOVEMENT_DECISION_INTERVAL);
            
            if (shouldMakeDecision) {
                this.makeAIDecision(entityId, pos, combat, team, aiState, enemies, collision, now);
                aiBehavior.lastDecisionTime = now;
            }
            
            this.handleCombat(entityId, pos, combat, aiState, collision, now);
        });
    }
    
    // CONSOLIDATED: Calculate distances between two entities
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
    
    // CONSOLIDATED: Check if attacker is in range of target
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
    
    // CONSOLIDATED: Check if units are within edge-to-edge range
    isWithinEdgeToEdgeRange(attackerId, targetId, maxRange) {
        const attackerPos = this.game.getComponent(attackerId, this.componentTypes.POSITION);
        const targetPos = this.game.getComponent(targetId, this.componentTypes.POSITION);
        const attackerCollision = this.game.getComponent(attackerId, this.componentTypes.COLLISION);
        const targetCollision = this.game.getComponent(targetId, this.componentTypes.COLLISION);
        
        if (!attackerPos || !targetPos) return false;
        
        const distances = this.calculateDistances(attackerPos, targetPos, attackerCollision, targetCollision);
        return distances.edgeToEdge <= maxRange;
    }
    
    changeAIState(aiState, newState, now) {
        const aiBehavior = aiState.aiBehavior;
        
        if (now - aiBehavior.lastStateChange < this.STATE_CHANGE_COOLDOWN) {
            return false;
        }
        
        if (aiState.state === 'attacking') {
            const attackDuration = now - aiBehavior.lastAttackStart;
            if (attackDuration < this.MIN_ATTACK_ANIMATION_TIME) {
                return false;
            }
        }
        
        if (aiState.state !== newState) {
            aiState.state = newState;
            aiBehavior.lastStateChange = now;
            
            if (newState === 'attacking') {
                aiBehavior.lastAttackStart = now;
            }
            
            return true;
        }
        
        return false;
    }
    
    makeAIDecision(entityId, pos, combat, team, aiState, enemies, collision, now) {
        const aiBehavior = aiState.aiBehavior;
        
        let targetEnemy = this.findBestTarget(pos, enemies, aiBehavior, now);
        
        if (!targetEnemy) {
            // Clear target if no valid enemies found
            aiBehavior.currentTarget = null;
            aiBehavior.targetPosition = null;
            return;
        }
        
        // Additional validation: make sure target is still alive and not dying
        const targetHealth = this.game.getComponent(targetEnemy, this.componentTypes.HEALTH);
        const targetDeathState = this.game.getComponent(targetEnemy, this.componentTypes.DEATH_STATE);
        
        if (!targetHealth || targetHealth.current <= 0 || (targetDeathState && targetDeathState.isDying)) {
            aiBehavior.currentTarget = null;
            aiBehavior.targetPosition = null;
            return;
        }
        
        const enemyPos = this.game.getComponent(targetEnemy, this.componentTypes.POSITION);
        if (!enemyPos) return;
        
        // Store target info
        aiBehavior.currentTarget = targetEnemy;
        aiBehavior.targetPosition = { x: enemyPos.x, y: enemyPos.y, z: enemyPos.z };
        
        // SIMPLIFIED: Use consolidated range checking
        if (this.isInAttackRange(entityId, targetEnemy, combat)) {
            this.changeAIState(aiState, 'attacking', now);
        } else {
            this.changeAIState(aiState, 'chasing', now);
        }
    }
    
    findBestTarget(pos, enemies, aiBehavior, now) {
        let bestTarget = null;
        let bestScore = -1;
        
        enemies.forEach(enemyId => {
            const enemyPos = this.game.getComponent(enemyId, this.componentTypes.POSITION);
            const enemyHealth = this.game.getComponent(enemyId, this.componentTypes.HEALTH);
            const enemyDeathState = this.game.getComponent(enemyId, this.componentTypes.DEATH_STATE);
            
            if (!enemyPos || !enemyHealth || enemyHealth.current <= 0) return;
            
            // Skip dying enemies
            if (enemyDeathState && enemyDeathState.isDying) return;
            
            const dx = enemyPos.x - pos.x;
            const dz = enemyPos.z - pos.z;
            const distance = Math.sqrt(dx * dx + dz * dz);
            
            let score = 1000 - distance;
            
            if (aiBehavior.currentTarget === enemyId && 
                now - aiBehavior.targetLockTime < this.TARGET_SWITCH_COOLDOWN) {
                score += 300;
            }
            
            if (score > bestScore) {
                bestScore = score;
                bestTarget = enemyId;
            }
        });
        
        if (bestTarget !== aiBehavior.currentTarget) {
            aiBehavior.targetLockTime = now;
        }
        
        return bestTarget;
    }
    
    handleCombat(entityId, pos, combat, aiState, collision, now) {
        const aiBehavior = aiState.aiBehavior;
        
        if (!aiBehavior.currentTarget || aiState.state !== 'attacking') return;
        
        // Check if target still exists and is alive
        const targetPos = this.game.getComponent(aiBehavior.currentTarget, this.componentTypes.POSITION);
        const targetHealth = this.game.getComponent(aiBehavior.currentTarget, this.componentTypes.HEALTH);
        const targetDeathState = this.game.getComponent(aiBehavior.currentTarget, this.componentTypes.DEATH_STATE);
        
        if (!targetPos || !targetHealth || targetHealth.current <= 0 || (targetDeathState && targetDeathState.isDying)) {
            aiBehavior.currentTarget = null;
            aiBehavior.targetPosition = null;
            this.changeAIState(aiState, 'idle', now);
            return;
        }
        
        // SIMPLIFIED: Use consolidated range checking with small buffer for combat
        if (!this.isInAttackRange(entityId, aiBehavior.currentTarget, combat, 5)) {
            this.changeAIState(aiState, 'chasing', now);
            return;
        }
        
        // Attack if cooldown is ready
        if (now - combat.lastAttack >= 1 / combat.attackSpeed) {
            this.initiateAttack(entityId, aiBehavior.currentTarget, combat, now);
            combat.lastAttack = now;
            aiBehavior.lastAttackStart = now;
        }
        
        // Update target position for MovementSystem
        aiBehavior.targetPosition = { x: targetPos.x, y: targetPos.y, z: targetPos.z };
    }

    initiateAttack(attackerId, targetId, combat, now) {
        // Additional safety check before initiating attack
        const targetHealth = this.game.getComponent(targetId, this.componentTypes.HEALTH);
        const targetDeathState = this.game.getComponent(targetId, this.componentTypes.DEATH_STATE);
        
        if (!targetHealth || targetHealth.current <= 0 || (targetDeathState && targetDeathState.isDying)) {
            return; // Don't attack dead or dying targets
        }
        
        if (combat.projectile && this.game.projectileSystem) {
            this.scheduleProjectileLaunch(attackerId, targetId, combat, now);
        } else {
            this.scheduleMeleeDamage(attackerId, targetId, combat, now);
        }
    }

    scheduleMeleeDamage(attackerId, targetId, combat, now) {
        const attackInterval = 1 / combat.attackSpeed;
        const damageDelay = attackInterval * this.DAMAGE_TIMING_RATIO;
        const damageTime = now + damageDelay;
        
        const eventId = `${attackerId}_${targetId}_${now}`;
        this.pendingDamageEvents.set(eventId, {
            type: 'melee',
            attackerId: attackerId,
            targetId: targetId,
            damage: combat.damage,
            triggerTime: damageTime,
            eventId: eventId
        });
        
        this.logAttackStart(attackerId, targetId, 'attacks');
    }

    scheduleProjectileLaunch(attackerId, targetId, combat, now) {
        const attackInterval = 1 / combat.attackSpeed;
        const launchDelay = attackInterval * this.DAMAGE_TIMING_RATIO;
        const launchTime = now + launchDelay;
        
        const eventId = `${attackerId}_${targetId}_${now}`;
        this.pendingDamageEvents.set(eventId, {
            type: 'projectile',
            attackerId: attackerId,
            targetId: targetId,
            projectileTypeId: combat.projectile,
            triggerTime: launchTime,
            eventId: eventId
        });
        
        this.logAttackStart(attackerId, targetId, 'prepares to fire');
    }

    // CONSOLIDATED: Attack logging
    logAttackStart(attackerId, targetId, actionText) {
        if (!this.game.battleLogSystem) return;
        
        const attackerTeam = this.game.getComponent(attackerId, this.componentTypes.TEAM);
        const attackerType = this.game.getComponent(attackerId, this.componentTypes.UNIT_TYPE);
        const targetTeam = this.game.getComponent(targetId, this.componentTypes.TEAM);
        const targetType = this.game.getComponent(targetId, this.componentTypes.UNIT_TYPE);
        
        this.game.battleLogSystem.add(
            `${attackerTeam.team} ${attackerType.type} ${actionText} ${targetTeam.team} ${targetType.type}!`, 
            'log-attack'
        );
    }

    processPendingDamage(now) {
        const eventsToRemove = [];
        
        for (const [eventId, event] of this.pendingDamageEvents.entries()) {
            if (now >= event.triggerTime) {
                // Additional validation before executing damage
                const targetHealth = this.game.getComponent(event.targetId, this.componentTypes.HEALTH);
                const targetDeathState = this.game.getComponent(event.targetId, this.componentTypes.DEATH_STATE);
                
                // Skip damage if target is already dead or dying
                if (!targetHealth || targetHealth.current <= 0 || (targetDeathState && targetDeathState.isDying)) {
                    eventsToRemove.push(eventId);
                    continue;
                }
                
                if (event.type === 'melee') {
                    this.executeMeleeDamage(event);
                } else if (event.type === 'projectile') {
                    this.executeProjectileLaunch(event);
                }
                
                eventsToRemove.push(eventId);
            }
        }
        
        eventsToRemove.forEach(eventId => {
            this.pendingDamageEvents.delete(eventId);
        });
    }

    // SIMPLIFIED: Execute melee damage using consolidated methods
    executeMeleeDamage(event) {
        
        const attackerPos = this.game.getComponent(event.attackerId, this.componentTypes.POSITION);
        const targetPos = this.game.getComponent(event.targetId, this.componentTypes.POSITION);
        const targetHealth = this.game.getComponent(event.targetId, this.componentTypes.HEALTH);
        const targetDeathState = this.game.getComponent(event.targetId, this.componentTypes.DEATH_STATE);
        const attackerCombat = this.game.getComponent(event.attackerId, this.componentTypes.COMBAT);
        
        if (!attackerPos || !targetPos || !targetHealth || !attackerCombat) {
            console.log('Missing components - damage cancelled');
            return;
        }
        
        // Skip if target is dying
        if (targetDeathState && targetDeathState.isDying) {
            console.log('Target is dying - damage cancelled');
            return;
        }
        
        // SIMPLIFIED: Use consolidated edge-to-edge range checking
        const maxRange = attackerCombat.range + this.ATTACK_RANGE_BUFFER + 1;
        
        if (this.isWithinEdgeToEdgeRange(event.attackerId, event.targetId, maxRange)) {
            this.applyDamage(event.attackerId, event.targetId, event.damage);
        }
    }

    executeProjectileLaunch(event) {
        const attackerPos = this.game.getComponent(event.attackerId, this.componentTypes.POSITION);
        const targetHealth = this.game.getComponent(event.targetId, this.componentTypes.HEALTH);
        const targetDeathState = this.game.getComponent(event.targetId, this.componentTypes.DEATH_STATE);
        
        if (!attackerPos || !targetHealth || targetHealth.current <= 0) {
            return;
        }
        
        // Skip if target is dying
        if (targetDeathState && targetDeathState.isDying) {
            return;
        }
        
        this.fireProjectileAttack(event.attackerId, event.targetId, event.projectileTypeId);
    }

    applyDamage(attackerId, targetId, damage) {
        const targetHealth = this.game.getComponent(targetId, this.componentTypes.HEALTH);
        const targetDeathState = this.game.getComponent(targetId, this.componentTypes.DEATH_STATE);
        const targetTeam = this.game.getComponent(targetId, this.componentTypes.TEAM);
        const attackerTeam = this.game.getComponent(attackerId, this.componentTypes.TEAM);
        
        if (!targetHealth) return;
        
        // Skip if target is already dying
        if (targetDeathState && targetDeathState.isDying) return;
        
        targetHealth.current -= damage;
        
        const targetAnimation = this.game.getComponent(targetId, this.componentTypes.ANIMATION);
        if (targetAnimation) {
            targetAnimation.flash = 0.5;
        }
        
        const attackerType = this.game.getComponent(attackerId, this.componentTypes.UNIT_TYPE);
        const targetType = this.game.getComponent(targetId, this.componentTypes.UNIT_TYPE);
        
        if (this.game.battleLogSystem) {
            this.game.battleLogSystem.add(
                `${attackerTeam.team} ${attackerType.type} deals ${damage} damage to ${targetTeam.team} ${targetType.type}`, 
                'log-damage'
            );
        }
        
        if (targetHealth.current <= 0) {
            if (this.game.battleLogSystem) {
                this.game.battleLogSystem.add(`${targetTeam.team} ${targetType.type} defeated!`, 'log-death');
            }
            
            // Instead of immediately destroying, start death process
            this.startDeathProcess(targetId);
            this.checkBattleEnd();
        }
    }
    
    startDeathProcess(entityId) {
        const ComponentTypes = this.game.componentManager.getComponentTypes();
        const Components = this.game.componentManager.getComponents();
        
        // Check if already dying to prevent restarting death process
        const existingDeathState = this.game.getComponent(entityId, ComponentTypes.DEATH_STATE);
        if (existingDeathState && existingDeathState.isDying) {
            return; // Already dying, don't restart the process
        }
        
        // Add death state component
        this.game.addComponent(entityId, ComponentTypes.DEATH_STATE, Components.DeathState(true, Date.now() / 1000, 2.0));
        
        // Remove AI state to stop all AI behavior
        if (this.game.hasComponent(entityId, ComponentTypes.AI_STATE)) {
            this.game.removeComponent(entityId, ComponentTypes.AI_STATE);
        }
        
        // Stop all movement
        const velocity = this.game.getComponent(entityId, ComponentTypes.VELOCITY);
        if (velocity) {
            velocity.vx = 0;
            velocity.vy = 0;
            velocity.vz = 0;
        }
        
        // Remove combat ability
        if (this.game.hasComponent(entityId, ComponentTypes.COMBAT)) {
            this.game.removeComponent(entityId, ComponentTypes.COMBAT);
        }
        
        // Clean up any pending damage events for this entity
        this.cleanupPendingEventsForEntity(entityId);
        
        // Play death animation if animation system exists
        if (this.game.animationSystem && this.game.animationSystem.playDeathAnimation) {
            this.game.animationSystem.playDeathAnimation(entityId);
        }
    }
    
    fireProjectileAttack(attackerId, targetId, projectileTypeId) {
        if (!this.game.projectileSystem) return;
        
        const projectileData = this.game.getCollections().projectiles[projectileTypeId];

        if(!projectileData){
            console.warn("No projectile data found for ", projectileTypeId, "attackerId: " , attackerId);
            return;
        }

        const attackerTeam = this.game.getComponent(attackerId, this.componentTypes.TEAM);
        const attackerType = this.game.getComponent(attackerId, this.componentTypes.UNIT_TYPE);
        
        const projectileInstanceId = this.game.projectileSystem.fireProjectile(attackerId, targetId, {
            id: projectileTypeId,
            ...projectileData
        });
        
        if (projectileInstanceId && this.game.battleLogSystem) {
            this.game.battleLogSystem.add(
                `${attackerTeam.team} ${attackerType.type} fires projectile!`, 
                'log-projectile'
            );
        }
        
        return projectileInstanceId;
    }

    attack(attackerId, targetId) {
        console.warn("Direct attack() method is deprecated. Use scheduleMeleeDamage() instead.");
        const attackerCombat = this.game.getComponent(attackerId, this.componentTypes.COMBAT);
        if (attackerCombat) {
            this.applyDamage(attackerId, targetId, attackerCombat.damage);
        }
    }

    cleanupPendingEventsForEntity(entityId) {
        const eventsToRemove = [];
        
        for (const [eventId, event] of this.pendingDamageEvents.entries()) {
            if (event.attackerId === entityId || event.targetId === entityId) {
                eventsToRemove.push(eventId);
            }
        }
        
        eventsToRemove.forEach(eventId => {
            this.pendingDamageEvents.delete(eventId);
        });
    }
    
    getUnitRadius(collision) {
        if (collision && collision.radius) {
            return Math.max(this.DEFAULT_UNIT_RADIUS, collision.radius);
        }
        return this.DEFAULT_UNIT_RADIUS;
    }
    
    checkBattleEnd() {
        if (this.game.phaseSystem) {
            this.game.phaseSystem.checkForRoundEnd();
        }
    }

    performBattleEndCheck() {
        const allLivingEntities = this.game.getEntitiesWith(
            this.componentTypes.TEAM, 
            this.componentTypes.HEALTH, // Only entities with health (excludes corpses)
            this.componentTypes.UNIT_TYPE
        );
        
        const aliveEntities = allLivingEntities.filter(id => {
            const health = this.game.getComponent(id, this.componentTypes.HEALTH);
            // Also exclude entities that are currently dying
            const deathState = this.game.getComponent(id, this.componentTypes.DEATH_STATE);
            return health && health.current > 0 && (!deathState || !deathState.isDying);
        });
        
        const playerUnits = aliveEntities.filter(id => {
            const team = this.game.getComponent(id, this.componentTypes.TEAM);
            return team && team.team === 'player';
        });
        
        const enemyUnits = aliveEntities.filter(id => {
            const team = this.game.getComponent(id, this.componentTypes.TEAM);
            return team && team.team === 'enemy';
        });
        
        if (this.game.state.phase !== 'battle') {
            return;
        }
        
        if (playerUnits.length === 0 && enemyUnits.length > 0) {
            if (this.game.battleLogSystem) {
                this.game.battleLogSystem.add('DEFEAT! Enemy army victorious!', 'log-death');
            }
            if (this.game.phaseSystem) {
                this.game.phaseSystem.endBattle('defeat');
            }
        } else if (enemyUnits.length === 0 && playerUnits.length > 0) {
            if (this.game.battleLogSystem) {
                this.game.battleLogSystem.add('VICTORY! Your army prevails!', 'log-victory');
            }
            if (this.game.phaseSystem) {
                this.game.phaseSystem.endBattle('victory');
            }
        } else if (playerUnits.length === 0 && enemyUnits.length === 0) {
            if (this.game.battleLogSystem) {
                this.game.battleLogSystem.add('DRAW! All units defeated!', 'log-death');
            }
            if (this.game.phaseSystem) {
                this.game.phaseSystem.endBattle('draw');
            }
        }
    }
}