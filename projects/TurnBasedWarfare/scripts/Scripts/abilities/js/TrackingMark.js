class TrackingMarkAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
        super(game, {
            id: 'tracking_mark',
            name: 'Tracking Mark',
            description: 'Mark an enemy for increased damage - multiple Rangers can mark the same target for stacking effect',
            cooldown: 8.0,
            range: 200,
            manaCost: 20,
            targetType: 'enemy',
            animation: 'cast',
            priority: 7,
            castTime: 1.0,
            ...params
        });
        
        this.markDamageIncrease = 0.25; // 25% per mark
        this.maxMarks = 4; // Cap at 4 marks (100% bonus)
        this.markDuration = 15.0;
        this.element = 'physical';
    }
    
    defineEffects() {
        return {
            cast: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0xFF6347,
                    colorRange: { start: 0xFF6347, end: 0xFF4500 },
                    scaleMultiplier: 1.2,
                    speedMultiplier: 1.5
                }
            },
            mark_target: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0xDC143C,
                    scaleMultiplier: 1.8,
                    speedMultiplier: 2.0
                }
            },
            tracking_beam: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0xFF0000,
                    scaleMultiplier: 1.0,
                    speedMultiplier: 3.0
                }
            },
            mark_stack: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0x8B0000,
                    scaleMultiplier: 1.5,
                    speedMultiplier: 1.8
                }
            }
        };
    }
    
    canExecute(casterEntity) {
        // Need at least one enemy to mark
        const enemies = this.getEnemiesInRange(casterEntity);
        return enemies.length > 0;
    }
    
    execute(casterEntity) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!casterPos) return null;
        
        const enemies = this.getEnemiesInRange(casterEntity);
        if (enemies.length === 0) return null;
        
        // Select target deterministically
        const target = this.selectMarkTarget(enemies, casterEntity);
        if (!target) return null;
        
        // Show immediate cast effect
        this.createVisualEffect(casterPos, 'cast');
        this.logAbilityUsage(casterEntity, `Ranger takes aim at their prey...`);
        
        // Schedule the mark application after cast time
        this.game.schedulingSystem.scheduleAction(() => {
            this.applyTrackingMark(casterEntity, target);
        }, this.castTime, casterEntity);
    }
    
    applyTrackingMark(casterEntity, targetId) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        const targetPos = this.game.getComponent(targetId, this.componentTypes.POSITION);
        
        // Validate target still exists
        const targetHealth = this.game.getComponent(targetId, this.componentTypes.HEALTH);
        if (!targetHealth || targetHealth.current <= 0 || !targetPos) {
            this.logAbilityUsage(casterEntity, `Target has vanished from sight!`);
            return;
        }
        
        // Create marking beam effect if caster still exists
        if (casterPos) {
            this.createTrackingBeamEffect(casterPos, targetPos);
        }
        
        // Apply or stack the tracking mark
        const markResult = this.applyOrStackMark(casterEntity, targetId);
        
        // Create appropriate visual effect based on result
        if (markResult.isNewMark) {
            this.createVisualEffect(targetPos, 'mark_target');
        } else if (markResult.wasStacked) {
            this.createVisualEffect(targetPos, 'mark_stack');
        } else {
            // Mark refreshed
            this.createVisualEffect(targetPos, 'tracking_beam');
        }
        
        // Enhanced logging
        this.logMarkResult(casterEntity, targetId, markResult);
    }
    
    applyOrStackMark(casterEntity, targetId) {
        const Components = this.game.componentManager.getComponents();
        const currentTime = this.game.state.now || this.game.state.now || 0;
        const endTime = currentTime + this.markDuration;
        
        // Check for existing tracking mark
        let existingMark = this.game.getComponent(targetId, this.componentTypes.BUFF);
        
        if (existingMark && existingMark.buffType === 'marked') {
            // Stack the mark up to the maximum
            if (existingMark.stacks < this.maxMarks) {
                existingMark.stacks++;
                existingMark.damageTakenMultiplier = 1 + (this.markDamageIncrease * existingMark.stacks);
                existingMark.endTime = endTime; // Refresh duration
                existingMark.appliedTime = currentTime; // Update applied time
                
                // Track who applied this stack (for potential future features)
                if (!existingMark.appliedBy) {
                    existingMark.appliedBy = [];
                }
                if (!existingMark.appliedBy.includes(casterEntity)) {
                    existingMark.appliedBy.push(casterEntity);
                }
                
                return {
                    isNewMark: false,
                    wasStacked: true,
                    wasRefreshed: false,
                    currentStacks: existingMark.stacks,
                    damageMultiplier: existingMark.damageTakenMultiplier
                };
            } else {
                // Just refresh duration if at max stacks
                existingMark.endTime = endTime;
                existingMark.appliedTime = currentTime;
                
                return {
                    isNewMark: false,
                    wasStacked: false,
                    wasRefreshed: true,
                    currentStacks: existingMark.stacks,
                    damageMultiplier: existingMark.damageTakenMultiplier
                };
            }
        } else {
            // Apply new tracking mark
            this.game.addComponent(targetId, this.componentTypes.BUFF, 
                Components.Buff(
                    'marked', 
                    { 
                        damageTakenMultiplier: 1 + this.markDamageIncrease,
                        revealed: true,
                        markedBy: casterEntity,
                        appliedBy: [casterEntity]
                    }, 
                    endTime,      // End time
                    true,         // Stackable
                    1,            // Initial stack count
                    currentTime   // Applied time
                )
            );
            
            return {
                isNewMark: true,
                wasStacked: false,
                wasRefreshed: false,
                currentStacks: 1,
                damageMultiplier: 1 + this.markDamageIncrease
            };
        }
    }
    
    createTrackingBeamEffect(casterPos, targetPos) {
        // Create a visual connection between ranger and target
        this.createVisualEffect(casterPos, 'tracking_beam');
        this.createVisualEffect(targetPos, 'tracking_beam');
        
        // Create energy beam if effects system supports it
        if (this.game.effectsSystem && this.game.effectsSystem.createEnergyBeam) {
            this.game.effectsSystem.createEnergyBeam(
                new THREE.Vector3(casterPos.x, casterPos.y + 15, casterPos.z),
                new THREE.Vector3(targetPos.x, targetPos.y + 10, targetPos.z),
                {
                    style: { color: 0xFF6347, linewidth: 3 },
                    animation: { duration: 600, flickerCount: 2 }
                }
            );
        }
    }
    
    logMarkResult(casterEntity, targetId, markResult) {
        const targetUnitType = this.game.getComponent(targetId, this.componentTypes.UNIT_TYPE);
        const targetTeam = this.game.getComponent(targetId, this.componentTypes.TEAM);
        
        if (markResult.isNewMark) {
            this.logAbilityUsage(casterEntity, 
                `Ranger marks their prey for the hunt! (+${Math.round((markResult.damageMultiplier - 1) * 100)}% damage)`);
        } else if (markResult.wasStacked) {
            this.logAbilityUsage(casterEntity, 
                `Target marked ${markResult.currentStacks} times! (+${Math.round((markResult.damageMultiplier - 1) * 100)}% damage)`);
        } else if (markResult.wasRefreshed) {
            this.logAbilityUsage(casterEntity, 
                `Mark refreshed (max stacks reached)! (+${Math.round((markResult.damageMultiplier - 1) * 100)}% damage)`);
        }
        
        // Battle log integration
        if (this.game.battleLogSystem && targetUnitType && targetTeam) {
            const casterUnitType = this.game.getComponent(casterEntity, this.componentTypes.UNIT_TYPE);
            const casterTeam = this.game.getComponent(casterEntity, this.componentTypes.TEAM);
            
            if (casterUnitType && casterTeam) {
                let actionText = markResult.isNewMark ? 'marks' : 
                               markResult.wasStacked ? `stacks mark on` : 'refreshes mark on';
                               
                this.game.battleLogSystem.add(
                    `${casterTeam.team} ${casterUnitType.type} ${actionText} ${targetTeam.team} ${targetUnitType.type} (${markResult.currentStacks} stacks)!`,
                    'log-mark'
                );
            }
        }
    }
    
    // FIXED: Deterministic target selection
    selectMarkTarget(enemies, casterEntity) {
        if (enemies.length === 0) return null;
        
        // Sort enemies deterministically first for consistent processing
        const sortedEnemies = enemies.slice().sort((a, b) => String(a).localeCompare(String(b)));
        
        // Priority 1: Unmarked enemies (new marks are more valuable)
        const unmarkedEnemies = sortedEnemies.filter(enemyId => {
            const buff = this.game.getComponent(enemyId, this.componentTypes.BUFF);
            return !buff || buff.buffType !== 'marked';
        });
        
        if (unmarkedEnemies.length > 0) {
            // Among unmarked enemies, prioritize by distance (closest first)
            return this.selectClosestEnemy(unmarkedEnemies, casterEntity);
        }
        
        // Priority 2: Marked enemies that can be stacked further
        const stackableEnemies = sortedEnemies.filter(enemyId => {
            const buff = this.game.getComponent(enemyId, this.componentTypes.BUFF);
            return buff && buff.buffType === 'marked' && buff.stacks < this.maxMarks;
        });
        
        if (stackableEnemies.length > 0) {
            // Among stackable enemies, prioritize by current stacks (higher first for focused fire)
            return this.selectHighestStackedEnemy(stackableEnemies);
        }
        
        // Priority 3: Any marked enemy (for duration refresh)
        return this.selectClosestEnemy(sortedEnemies, casterEntity);
    }
    
    selectClosestEnemy(enemies, casterEntity) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!casterPos || enemies.length === 0) return null;
        
        let closest = null;
        let closestDistance = Infinity;
        
        enemies.forEach(enemyId => {
            const enemyPos = this.game.getComponent(enemyId, this.componentTypes.POSITION);
            if (!enemyPos) return;
            
            const distance = Math.sqrt(
                Math.pow(enemyPos.x - casterPos.x, 2) + 
                Math.pow(enemyPos.z - casterPos.z, 2)
            );
            
            // Use <= for consistent tie-breaking (first in sorted order wins)
            if (distance <= closestDistance) {
                closestDistance = distance;
                closest = enemyId;
            }
        });
        
        return closest;
    }
    
    selectHighestStackedEnemy(enemies) {
        let highestStacked = null;
        let highestStacks = 0;
        
        enemies.forEach(enemyId => {
            const buff = this.game.getComponent(enemyId, this.componentTypes.BUFF);
            if (!buff || buff.buffType !== 'marked') return;
            
            // Use >= for consistent tie-breaking (first in sorted order wins)
            if (buff.stacks >= highestStacks) {
                highestStacks = buff.stacks;
                highestStacked = enemyId;
            }
        });
        
        return highestStacked;
    }
}