class CombatAISystem {
    constructor(game){
        this.game = game;
        this.componentTypes = this.game.componentManager.getComponentTypes();
        
        // Configuration variables (adjusted for world coordinates)
        this.DEFAULT_UNIT_RADIUS = 15;
        this.ATTACK_RANGE_BUFFER = 5;
        this.ALLY_SPACING_DISTANCE = 10;
        this.ENEMY_SPACING_DISTANCE = 5;
        this.AVOIDANCE_RADIUS_MULTIPLIER = 1;
        this.STRONG_AVOIDANCE_FORCE = 50;
        this.GENTLE_AVOIDANCE_FORCE = 10;
        
        // AI decision parameters
        this.TARGET_SWITCH_COOLDOWN = 0.3;
        this.MOVEMENT_DECISION_INTERVAL = 0.05;
    }
    
    update(deltaTime) {
        if (this.game.state.phase !== 'battle') return;
        
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
                    targetPosition: null
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
                // No enemies - set AI state to idle, let MovementSystem handle stopping
                aiState.state = 'idle';
                aiBehavior.currentTarget = null;
                aiBehavior.targetPosition = null;
                return;
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
        aiBehavior.targetPosition = { x: enemyPos.x, y: enemyPos.y };
        
        // Calculate distance to target
        const dx = enemyPos.x - pos.x;
        const dy = enemyPos.y - pos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        const scaledRange = Math.max(combat.range * 0.1, 20);
        const attackDistance = Math.max(scaledRange, unitRadius + enemyRadius + this.ATTACK_RANGE_BUFFER);
        
        if (distance <= attackDistance) {
            // In range - set state to attacking (MovementSystem will handle stopping)
            aiState.state = 'attacking';
        } else {
            // Need to chase target (MovementSystem will handle movement)
            aiState.state = 'chasing';
        }
    }
    
    findBestTarget(pos, enemies, aiBehavior, now) {
        let bestTarget = null;
        let bestScore = -1;
        
        enemies.forEach(enemyId => {
            const enemyPos = this.game.getComponent(enemyId, this.componentTypes.POSITION);
            if (!enemyPos) return;
            
            const dx = enemyPos.x - pos.x;
            const dy = enemyPos.y - pos.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
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
            return;
        }
        
        const dx = targetPos.x - pos.x;
        const dy = targetPos.y - pos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        const targetUnitType = this.game.getComponent(aiBehavior.currentTarget, this.componentTypes.UNIT_TYPE);
        const targetRadius = this.getUnitRadius(targetUnitType);
        const scaledRange = Math.max(combat.range * 0.1, 20);
        const attackDistance = Math.max(scaledRange, unitRadius + targetRadius + this.ATTACK_RANGE_BUFFER);
        
        if (distance <= attackDistance) {
            // Attack if cooldown is ready
            if (now - combat.lastAttack >= 1 / combat.attackSpeed) {
                this.attack(entityId, aiBehavior.currentTarget);
                combat.lastAttack = now;
            }
        }
        
        // Update target position for MovementSystem to use
        aiBehavior.targetPosition = { x: targetPos.x, y: targetPos.y };
    }
    
    getUnitRadius(unitType) {
        if (unitType && unitType.size) {
            return Math.max(this.DEFAULT_UNIT_RADIUS, unitType.size * 0.1);
        }
        
        const collections = this.game.getCollections && this.game.getCollections();
        if (collections && collections.units && unitType) {
            const unitDef = collections.units[unitType.id || unitType.type];
            if (unitDef && unitDef.size) {
                return Math.max(this.DEFAULT_UNIT_RADIUS, unitDef.size * 0.1);
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
        
        if (this.game.uiManager) {
            this.game.uiManager.addBattleLog(`${attackerTeam.team} ${attackerType.type} deals ${attackerCombat.damage} damage to ${targetTeam.team} ${targetType.type}`, 'log-damage');
        }
        
        if (targetHealth.current <= 0) {
            if (this.game.uiManager) {
                this.game.uiManager.addBattleLog(`${targetTeam.team} ${targetType.type} defeated!`, 'log-death');
            }
            this.game.destroyEntity(targetId);
            this.checkBattleEnd();
        }
    }
    
    checkBattleEnd() {
        const allTeamEntities = this.game.getEntitiesWith(this.componentTypes.TEAM);
        
        const playerUnits = allTeamEntities.filter(id => {
            const team = this.game.getComponent(id, this.componentTypes.TEAM);
            return team && team.team === 'player';
        });
        
        const enemyUnits = allTeamEntities.filter(id => {
            const team = this.game.getComponent(id, this.componentTypes.TEAM);
            return team && team.team === 'enemy';
        });
        
        if (playerUnits.length === 0) {
            if (this.game.uiManager) {
                this.game.uiManager.addBattleLog('DEFEAT! Enemy army victorious!', 'log-death');
                this.game.uiManager.endBattle('defeat');
            }
        } else if (enemyUnits.length === 0) {
            if (this.game.uiManager) {
                this.game.uiManager.addBattleLog('VICTORY! Your army prevails!', 'log-victory');
                this.game.uiManager.endBattle('victory');
            }
        }
    }
}