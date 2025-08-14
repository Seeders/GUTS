class CombatAISystem {
    constructor(game){
        this.game = game;
        this.game.combatAISystems = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();
        
        // Configuration variables (adjusted for world coordinates)
        this.DEFAULT_UNIT_RADIUS = 15;
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
        this.MIN_ATTACK_ANIMATION_TIME = 0.4; // Minimum time to play attack animation
        this.STATE_CHANGE_COOLDOWN = 0.1; // Prevent rapid state changes
        
        // Battle end checking
        this.lastBattleEndCheck = 0;
        this.BATTLE_END_CHECK_INTERVAL = 1.0; // Check every second as backup
    }
    
    update(deltaTime) {
        if (this.game.state.phase !== 'battle') return;
        
        const now = Date.now() / 1000;
        
        // Periodic battle end check as backup
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
            const unitType = this.game.getComponent(entityId, this.componentTypes.UNIT_TYPE);
            
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
            const unitRadius = this.getUnitRadius(unitType);
            
            // Find enemies
            const enemies = combatUnits.filter(otherId => {
                const otherTeam = this.game.getComponent(otherId, this.componentTypes.TEAM);
                return otherId !== entityId && otherTeam && otherTeam.team !== team.team;
            });
            
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
                this.makeAIDecision(entityId, pos, combat, team, aiState, enemies, unitRadius, now);
                aiBehavior.lastDecisionTime = now;
            }
            
            // Handle combat
            this.handleCombat(entityId, pos, combat, aiState, unitRadius, now);
        });
    }
    
    changeAIState(aiState, newState, now) {
        const aiBehavior = aiState.aiBehavior;
        
        // Prevent rapid state changes
        if (now - aiBehavior.lastStateChange < this.STATE_CHANGE_COOLDOWN) {
            return false;
        }
        
        // Special handling for attack state transitions
        if (aiState.state === 'attacking') {
            const attackDuration = now - aiBehavior.lastAttackStart;
            
            // Don't interrupt attack animation too early
            if (attackDuration < this.MIN_ATTACK_ANIMATION_TIME) {
                return false;
            }
        }
        
        // Only change if it's actually different
        if (aiState.state !== newState) {
            aiState.state = newState;
            aiBehavior.lastStateChange = now;
            
            // Track when attack states start for animation coordination
            if (newState === 'attacking') {
                aiBehavior.lastAttackStart = now;
            }
            
            return true;
        }
        
        return false;
    }
    
    makeAIDecision(entityId, pos, combat, team, aiState, enemies, unitRadius, now) {
        const aiBehavior = aiState.aiBehavior;
        
        // Find best target (with target stickiness)
        let targetEnemy = this.findBestTarget(pos, enemies, aiBehavior, now);
        
        if (!targetEnemy) return;
        
        const enemyPos = this.game.getComponent(targetEnemy, this.componentTypes.POSITION);
        const enemyUnitType = this.game.getComponent(targetEnemy, this.componentTypes.UNIT_TYPE);
        const enemyRadius = this.getUnitRadius(enemyUnitType);
        
        if (!enemyPos) return;
        
        // Store target info
        aiBehavior.currentTarget = targetEnemy;
        aiBehavior.targetPosition = { x: enemyPos.x, y: enemyPos.y, z: enemyPos.z };
        
        // Calculate 3D distance (ignoring Y for ground units)
        const dx = enemyPos.x - pos.x;
        const dz = enemyPos.z - pos.z;
        const centerToCenterDistance = Math.sqrt(dx * dx + dz * dz);
        
        // Calculate distance from attacker center to target edge
        const distanceToTargetEdge = Math.max(0, centerToCenterDistance - enemyRadius);
        
        // Calculate attack range (weapon range plus buffer)
        const scaledRange = Math.max(combat.range, 20);
        const effectiveAttackRange = scaledRange + this.ATTACK_RANGE_BUFFER;
        
        if (distanceToTargetEdge <= effectiveAttackRange) {
            // In range - try to change to attacking state
            this.changeAIState(aiState, 'attacking', now);
        } else {
            // Need to chase target - try to change to chasing state
            this.changeAIState(aiState, 'chasing', now);
        }
    }
    
    findBestTarget(pos, enemies, aiBehavior, now) {
        let bestTarget = null;
        let bestScore = -1;
        
        enemies.forEach(enemyId => {
            const enemyPos = this.game.getComponent(enemyId, this.componentTypes.POSITION);
            if (!enemyPos) return;
            
            // Use 3D distance (ignoring Y for ground units)
            const dx = enemyPos.x - pos.x;
            const dz = enemyPos.z - pos.z;
            const distance = Math.sqrt(dx * dx + dz * dz);
            
            // Score based on distance (closer = better)
            let score = 1000 - distance;
            
            // Bonus for current target to prevent switching
            if (aiBehavior.currentTarget === enemyId && 
                now - aiBehavior.targetLockTime < this.TARGET_SWITCH_COOLDOWN) {
                score += 300; // Bonus to stick with current target
            }
            
            if (score > bestScore) {
                bestScore = score;
                bestTarget = enemyId;
            }
        });
        
        // If we're switching targets, reset the lock time
        if (bestTarget !== aiBehavior.currentTarget) {
            aiBehavior.targetLockTime = now;
        }
        
        return bestTarget;
    }
    
    handleCombat(entityId, pos, combat, aiState, unitRadius, now) {
        const aiBehavior = aiState.aiBehavior;
        
        if (!aiBehavior.currentTarget || aiState.state !== 'attacking') return;
        
        // Check if target still exists and is in range
        const targetPos = this.game.getComponent(aiBehavior.currentTarget, this.componentTypes.POSITION);
        if (!targetPos) {
            aiBehavior.currentTarget = null;
            aiBehavior.targetPosition = null;
            this.changeAIState(aiState, 'idle', now);
            return;
        }
        
        // Calculate 3D distance (ignoring Y for ground units)
        const dx = targetPos.x - pos.x;
        const dz = targetPos.z - pos.z;
        const centerToCenterDistance = Math.sqrt(dx * dx + dz * dz);
        
        // Calculate distance from attacker center to target edge
        const targetUnitType = this.game.getComponent(aiBehavior.currentTarget, this.componentTypes.UNIT_TYPE);
        const targetRadius = this.getUnitRadius(targetUnitType);
        const distanceToTargetEdge = Math.max(0, centerToCenterDistance - targetRadius);
        
        // Calculate attack range (weapon range plus buffer)
        const scaledRange = Math.max(combat.range, 20);
        const effectiveAttackRange = scaledRange + this.ATTACK_RANGE_BUFFER;
        
        // If target moved out of range, switch to chasing
        if (distanceToTargetEdge > effectiveAttackRange) {
            this.changeAIState(aiState, 'chasing', now);
            return;
        }
        
        // Attack if cooldown is ready
        if (now - combat.lastAttack >= 1 / combat.attackSpeed) {
            // Check if this unit uses projectiles
            if (combat.projectile && this.game.projectileSystem) {
                this.fireProjectileAttack(entityId, aiBehavior.currentTarget, combat.projectile);
            } else {
                this.attack(entityId, aiBehavior.currentTarget); // Keep melee attack
            }
            combat.lastAttack = now;
            
            // Reset attack start time for animation coordination
            aiBehavior.lastAttackStart = now;
        }
        
        // Update target position for MovementSystem to use (full 3D)
        aiBehavior.targetPosition = { x: targetPos.x, y: targetPos.y, z: targetPos.z };
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
        
        // Fire the projectile
        const projectileInstanceId = this.game.projectileSystem.fireProjectile(attackerId, targetId, {
            id: projectileTypeId,
            ...projectileData
        });
        
        if (projectileInstanceId && this.game.battleLogSystem) {
            this.game.battleLogSystem.add(
                `${attackerTeam.team} ${attackerType.type} fires projectile!`, 
                'log-attack'
            );
        }
        
        return projectileInstanceId;
    }
    
    getUnitRadius(unitType) {
        if (unitType && unitType.size) {
            return Math.max(this.DEFAULT_UNIT_RADIUS, unitType.size);
        }
        
        const collections = this.game.getCollections && this.game.getCollections();
        if (collections && collections.units && unitType) {
            const unitDef = collections.units[unitType.id];
            if (unitDef && unitDef.size) {
                return Math.max(this.DEFAULT_UNIT_RADIUS, unitDef.size);
            }
        }
        
        return this.DEFAULT_UNIT_RADIUS;
    }
    
    attack(attackerId, targetId) {
        const attackerCombat = this.game.getComponent(attackerId, this.componentTypes.COMBAT);
        const targetHealth = this.game.getComponent(targetId, this.componentTypes.HEALTH);
        const targetTeam = this.game.getComponent(targetId, this.componentTypes.TEAM);
        const attackerTeam = this.game.getComponent(attackerId, this.componentTypes.TEAM);
        
        if (!targetHealth) return;
        
        targetHealth.current -= attackerCombat.damage;
        
        const targetAnimation = this.game.getComponent(targetId, this.componentTypes.ANIMATION);
        if (targetAnimation) {
            targetAnimation.flash = 0.5;
        }
        
        const attackerType = this.game.getComponent(attackerId, this.componentTypes.UNIT_TYPE);
        const targetType = this.game.getComponent(targetId, this.componentTypes.UNIT_TYPE);
        
        if (this.game.battleLogSystem) {
            this.game.battleLogSystem.add(`${attackerTeam.team} ${attackerType.type} deals ${attackerCombat.damage} damage to ${targetTeam.team} ${targetType.type}`, 'log-damage');
        }
        
        if (targetHealth.current <= 0) {
            if (this.game.battleLogSystem) {
                this.game.battleLogSystem.add(`${targetTeam.team} ${targetType.type} defeated!`, 'log-death');
            }
            this.game.destroyEntity(targetId);
            this.checkBattleEnd();
        }
    }
    
    checkBattleEnd() {
        // Use the team health system for round end checking
        if (this.game.phaseSystem) {
            this.game.phaseSystem.checkForRoundEnd();
        }
    }

    performBattleEndCheck() {
        // Get all entities that have both team and health components (living units)
        const allLivingEntities = this.game.getEntitiesWith(
            this.componentTypes.TEAM, 
            this.componentTypes.HEALTH,
            this.componentTypes.UNIT_TYPE
        );
        
        // Filter for units that are actually alive (health > 0)
        const aliveEntities = allLivingEntities.filter(id => {
            const health = this.game.getComponent(id, this.componentTypes.HEALTH);
            return health && health.current > 0;
        });
        
        const playerUnits = aliveEntities.filter(id => {
            const team = this.game.getComponent(id, this.componentTypes.TEAM);
            return team && team.team === 'player';
        });
        
        const enemyUnits = aliveEntities.filter(id => {
            const team = this.game.getComponent(id, this.componentTypes.TEAM);
            return team && team.team === 'enemy';
        });
        
        
        // Only end battle if we're actually in battle phase
        if (this.game.state.phase !== 'battle') {
            return;
        }
        
        if (playerUnits.length === 0 && enemyUnits.length > 0) {
            console.log('Battle ending: Defeat');
            if (this.game.battleLogSystem) {
                this.game.battleLogSystem.add('DEFEAT! Enemy army victorious!', 'log-death');
            }
            if (this.game.phaseSystem) {
                this.game.phaseSystem.endBattle('defeat');
            }
        } else if (enemyUnits.length === 0 && playerUnits.length > 0) {
            console.log('Battle ending: Victory');
            if (this.game.battleLogSystem) {
                this.game.battleLogSystem.add('VICTORY! Your army prevails!', 'log-victory');
            }
            if (this.game.phaseSystem) {
                this.game.phaseSystem.endBattle('victory');
            }
        } else if (playerUnits.length === 0 && enemyUnits.length === 0) {
            console.log('Battle ending: Draw');
            if (this.game.battleLogSystem) {
                this.game.battleLogSystem.add('DRAW! All units defeated!', 'log-death');
            }
            if (this.game.phaseSystem) {
                this.game.phaseSystem.endBattle('draw');
            }
        }
        // If both teams still have units, battle continues
    }
}