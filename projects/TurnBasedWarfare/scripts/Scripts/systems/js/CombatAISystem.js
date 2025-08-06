class CombatAISystem {
    constructor(game){
        this.game = game;
        this.componentTypes = this.game.componentManager.getComponentTypes();
        
        // Configuration variables
        this.DEFAULT_UNIT_RADIUS = 150;              // Default radius when no size specified
        this.ATTACK_RANGE_BUFFER = 5;               // Extra distance added to attack range
        this.ALLY_SPACING_DISTANCE = 40;            // Minimum distance to maintain from allies
        this.ENEMY_SPACING_DISTANCE = 20;            // Minimum distance to maintain from enemies
        this.AVOIDANCE_RADIUS_MULTIPLIER = 1;     // How far to look for units to avoid (radius * multiplier)
        this.STRONG_AVOIDANCE_FORCE = 50;           // Force when units are overlapping
        this.GENTLE_AVOIDANCE_FORCE = 10;           // Force when units are nearby allies
        this.FACING_DIRECTION_OFFSET = Math.PI / 2; // Offset for 3D model facing direction
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
            
            if(!pos) return;
            
            // Get unit size
            const unitRadius = this.getUnitRadius(unitType);
            
            // Find enemies
            const enemies = combatUnits.filter(otherId => {
                const otherTeam = this.game.getComponent(otherId, this.componentTypes.TEAM);
                return otherId !== entityId && otherTeam && otherTeam.team !== team.team;
            });
            
            if (enemies.length === 0) {
                vel.vx = 0;
                vel.vy = 0;
                aiState.state = 'idle';
                return;
            }
            
            // Find nearest enemy
            let nearestEnemy = null;
            let nearestDistance = Infinity;
            
            enemies.forEach(enemyId => {
                const enemyPos = this.game.getComponent(enemyId, this.componentTypes.POSITION);
                const dx = enemyPos.x - pos.x;
                const dy = enemyPos.y - pos.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                if (distance < nearestDistance) {
                    nearestDistance = distance;
                    nearestEnemy = enemyId;
                }
            });
            
            if (!nearestEnemy) return;
            
            const enemyPos = this.game.getComponent(nearestEnemy, this.componentTypes.POSITION);
            const enemyUnitType = this.game.getComponent(nearestEnemy, this.componentTypes.UNIT_TYPE);
            const enemyRadius = this.getUnitRadius(enemyUnitType);
            
            const dx = enemyPos.x - pos.x;
            const dy = enemyPos.y - pos.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            // Calculate attack distance (unit radii + combat range)
            const attackDistance = Math.max(combat.range, unitRadius + enemyRadius + this.ATTACK_RANGE_BUFFER);
            
            // Make unit face the target
          //  this.faceTarget(entityId, dx, dy);
            
            // Combat logic
            if (distance <= attackDistance) {
                // In range - attack
                aiState.state = 'attacking';
                vel.vx = 0;
                vel.vy = 0;
                
                const now = Date.now() / 1000;
                if (now - combat.lastAttack >= 1 / combat.attackSpeed) {
                    this.attack(entityId, nearestEnemy);
                    combat.lastAttack = now;
                }
            } else {
                // Move towards enemy with collision avoidance
                aiState.state = 'chasing';
                
                // Basic movement towards enemy
                const moveSpeed = vel.maxSpeed;
                let moveX = (dx / distance) * moveSpeed;
                let moveY = (dy / distance) * moveSpeed;
                
                // Simple collision avoidance with allies
                const avoidance = this.calculateSimpleAvoidance(entityId, pos, unitRadius, combatUnits, team.team);
                
                // Blend movement with avoidance
                moveX += avoidance.x;
                moveY += avoidance.y;
                
                // Limit to max speed
                const finalSpeed = Math.sqrt(moveX * moveX + moveY * moveY);
                if (finalSpeed > moveSpeed) {
                    moveX = (moveX / finalSpeed) * moveSpeed;
                    moveY = (moveY / finalSpeed) * moveSpeed;
                }
                
                vel.vx = moveX;
                vel.vy = moveY;
            }
        });
    }
    
    calculateSimpleAvoidance(entityId, pos, unitRadius, allUnits, teamName) {
        let avoidX = 0;
        let avoidY = 0;
        let count = 0;
        
        const avoidRadius = unitRadius * this.AVOIDANCE_RADIUS_MULTIPLIER;
        
        allUnits.forEach(otherId => {
            if (otherId === entityId) return;
            
            const otherPos = this.game.getComponent(otherId, this.componentTypes.POSITION);
            const otherTeam = this.game.getComponent(otherId, this.componentTypes.TEAM);
            const otherUnitType = this.game.getComponent(otherId, this.componentTypes.UNIT_TYPE);
            
            if (!otherPos) return;
            
            const otherRadius = this.getUnitRadius(otherUnitType);
            
            const dx = pos.x - otherPos.x;
            const dy = pos.y - otherPos.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            const isAlly = otherTeam && otherTeam.team === teamName;
            const spacingDistance = isAlly ? this.ALLY_SPACING_DISTANCE : this.ENEMY_SPACING_DISTANCE;
            const minDistance = unitRadius + otherRadius + spacingDistance;
            
            if (distance < avoidRadius && distance > 0) {
                let strength = 0;
                
                if (distance < minDistance) {
                    // Too close - push away
                    strength = (minDistance - distance) / minDistance * this.STRONG_AVOIDANCE_FORCE;
                } else if (isAlly) {
                    // Nearby ally - gentle avoidance
                    strength = (avoidRadius - distance) / avoidRadius * this.GENTLE_AVOIDANCE_FORCE;
                }
                
                if (strength > 0) {
                    avoidX += (dx / distance) * strength;
                    avoidY += (dy / distance) * strength;
                    count++;
                }
            }
        });
        
        return { x: avoidX, y: avoidY };
    }
    
    faceTarget(entityId, dx, dy) {
        // Calculate the angle to face the target
        const angle = Math.atan2(dy, dx);
        
        // Try to update the 3D model rotation if RenderSystem exists
        if (this.game.renderSystem && this.game.renderSystem.entityModels) {
            const modelGroup = this.game.renderSystem.entityModels.get(entityId);
            if (modelGroup) {
                // For 3D models, rotate around Y-axis to face target
                // Add PI/2 to convert from movement direction to facing direction
                modelGroup.rotation.y = -angle + Math.PI / 2;
            }
        }
        
        // Also store the facing direction in a component if it exists
        const facing = this.game.getComponent(entityId, this.componentTypes.FACING);
        if (facing) {
            facing.angle = angle;
            facing.direction = { x: Math.cos(angle), y: Math.sin(angle) };
        } else {
            // Create a facing component if it doesn't exist
            try {
                this.game.addComponent(entityId, this.componentTypes.FACING, {
                    angle: angle,
                    direction: { x: Math.cos(angle), y: Math.sin(angle) }
                });
            } catch (e) {
                // FACING component type might not exist, that's okay
            }
        }
    }
    
    getUnitRadius(unitType) {
        if (unitType && unitType.size) {
            return unitType.size / 2;
        }
        
        const collections = this.game.getCollections && this.game.getCollections();
        if (collections && collections.units && unitType) {
            const unitDef = collections.units[unitType.id || unitType.type];
            if (unitDef && unitDef.size) {
                return unitDef.size / 2;
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
        
        // Deal damage
        targetHealth.current -= attackerCombat.damage;
        
        // Flash animation
        const targetAnimation = this.game.getComponent(targetId, this.componentTypes.ANIMATION);
        if (targetAnimation) {
            targetAnimation.flash = 0.5;
        }
        
        // Log damage
        const attackerType = this.game.getComponent(attackerId, this.componentTypes.UNIT_TYPE);
        const targetType = this.game.getComponent(targetId, this.componentTypes.UNIT_TYPE);
        
        if (this.game.uiManager) {
            this.game.uiManager.addBattleLog(`${attackerTeam.team} ${attackerType.type} deals ${attackerCombat.damage} damage to ${targetTeam.team} ${targetType.type}`, 'log-damage');
        }
        
        // Check for death
        if (targetHealth.current <= 0) {
            if (this.game.uiManager) {
                this.game.uiManager.addBattleLog(`${targetTeam.team} ${targetType.type} defeated!`, 'log-death');
            }
            this.game.destroyEntity(targetId);
            
            // Check win condition
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