class ShieldWallAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
        super(game, {
            id: 'shield_wall',
            name: 'Shield Wall',
            description: 'Form a defensive stance, reducing damage and taunting enemies',
            cooldown: 12.0,
            range: 0, // Self-buff with taunt radius
            manaCost: 30,
            targetType: 'self',
            animation: 'cast',
            priority: 4,
            castTime: 1.0,
            ...params
        });
        
        this.wallDuration = 10.0;
        this.damageReduction = 0.75; // 75% damage reduction
        this.tauntRadius = 200;
        this.originalArmorMultiplier = 1.0;
        this.element = 'physical';
    }
    
    defineEffects() {
        return {
            cast: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0x708090,
                    colorRange: { start: 0x708090, end: 0xC0C0C0 },
                    scaleMultiplier: 1.5,
                    speedMultiplier: 1.0
                }
            },
            shield_formation: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0x4682B4,
                    scaleMultiplier: 2.0,
                    speedMultiplier: 0.8
                }
            },
            defensive_stance: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0x2F4F4F,
                    scaleMultiplier: 1.8,
                    speedMultiplier: 0.6
                }
            },
            taunt_aura: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0xFF6347,
                    scaleMultiplier: 1.2,
                    speedMultiplier: 1.5
                }
            }
        };
    }
    
    canExecute(casterEntity) {
        // Check if already has shield wall to prevent stacking
        const existingWall = this.game.getComponent(casterEntity, this.componentTypes.SHIELD_WALL);
        if (existingWall && existingWall.isActive) return false;
        
        // Use when enemies are nearby and threatening
        const enemies = this.getEnemiesInRange(casterEntity, this.tauntRadius);
        return enemies.length > 0;
    }
    
    execute(casterEntity) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!casterPos) return null;
        
        // Show immediate cast effect
        this.createVisualEffect(casterPos, 'cast');
        this.logAbilityUsage(casterEntity, `Soldier prepares to form a shield wall...`);
        
        // Schedule the shield wall formation after cast time
        this.game.schedulingSystem.scheduleAction(() => {
            this.formShieldWall(casterEntity);
        }, this.castTime, casterEntity);
    }
    
    formShieldWall(casterEntity) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        const casterCombat = this.game.getComponent(casterEntity, this.componentTypes.COMBAT);
        
        if (!casterPos) return;
        
        // Create shield formation effect
        this.createVisualEffect(casterPos, 'shield_formation');
        
        // Store original armor for restoration later
        const originalArmor = casterCombat ? casterCombat.armor : 0;
        
        // Apply shield wall component with proper timing
        const Components = this.game.componentManager.getComponents();
        const currentTime = this.game.state.now || this.game.state.now || 0;
        const endTime = currentTime + this.wallDuration;
        
        this.game.addComponent(casterEntity, this.componentTypes.SHIELD_WALL, 
            Components.ShieldWall(
                this.damageReduction,
                endTime,
                this.tauntRadius,
                originalArmor
            )
        );
        
        // Schedule defensive stance visual effect
        this.game.schedulingSystem.scheduleAction(() => {
            const pos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
            if (pos) {
                this.createVisualEffect(pos, 'defensive_stance');
            }
        }, 0.5, casterEntity);
        
        // Apply taunt effect to nearby enemies
        this.applyTauntToEnemies(casterEntity);
        
        // Screen effects for dramatic formation
        if (this.game.effectsSystem) {
            this.game.effectsSystem.playScreenShake(0.3, 1);
        }
        
        // Enhanced logging
        this.logAbilityUsage(casterEntity, 
            `Soldier forms a shield wall, gaining ${Math.round((1 - this.damageReduction) * 100)}% damage resistance!`);
            
        // Battle log integration
        if (this.game.battleLogSystem) {
            const unitType = this.game.getComponent(casterEntity, this.componentTypes.UNIT_TYPE);
            const team = this.game.getComponent(casterEntity, this.componentTypes.TEAM);
            
            if (unitType && team) {
                this.game.battleLogSystem.add(
                    `${team.team} ${unitType.type} forms a protective shield wall!`,
                    'log-defense'
                );
            }
        }
        
        // Schedule shield wall expiration warning
        this.game.schedulingSystem.scheduleAction(() => {
            this.warnShieldWallEnding(casterEntity);
        }, this.wallDuration - 1.5, casterEntity);
        
        // Schedule shield wall removal (failsafe)
        this.game.schedulingSystem.scheduleAction(() => {
            this.removeShieldWall(casterEntity);
        }, this.wallDuration, casterEntity);
    }
    
    applyTauntToEnemies(casterEntity) {
        const enemies = this.getEnemiesInRange(casterEntity, this.tauntRadius);
        if (enemies.length === 0) return;
        
        // Sort enemies deterministically for consistent processing
        const sortedEnemies = enemies.slice().sort((a, b) => String(a).localeCompare(String(b)));
        
        let tauntedCount = 0;
        
        sortedEnemies.forEach((enemyId, index) => {
            const enemyPos = this.game.getComponent(enemyId, this.componentTypes.POSITION);
            const enemyAI = this.game.getComponent(enemyId, this.componentTypes.AI_STATE);
            
            if (!enemyPos || !enemyAI) return;
            
            // Apply taunt component
            const Components = this.game.componentManager.getComponents();
            const currentTime = this.game.state.now || this.game.state.now || 0;
            const tauntEndTime = currentTime + (this.wallDuration * 0.8); // Taunt lasts 80% of shield wall
            
            this.game.addComponent(enemyId, this.componentTypes.TAUNT, 
                Components.Taunt(
                    casterEntity,     // Taunter
                    tauntEndTime,     // End time
                    this.tauntRadius, // Radius
                    true              // Is taunted
                )
            );
            
            // Force AI to target the shield wall user
  
            enemyAI.target = casterEntity;
            enemyAI.targetPosition = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        
        
            // Schedule staggered taunt effects for visual appeal
            this.game.schedulingSystem.scheduleAction(() => {
                const pos = this.game.getComponent(enemyId, this.componentTypes.POSITION);
                if (pos) {
                    this.createVisualEffect(pos, 'taunt_aura');
                }
            }, index * 0.1, enemyId);
            
            tauntedCount++;
        });
        
        if (tauntedCount > 0) {
            this.logAbilityUsage(casterEntity, 
                `Shield wall taunts ${tauntedCount} enemies to attack!`);
        }
    }
    
    // FIXED: Shield wall ending warning
    warnShieldWallEnding(casterEntity) {
        const shieldWall = this.game.getComponent(casterEntity, this.componentTypes.SHIELD_WALL);
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        
        // Check if shield wall still exists and is active
        if (!shieldWall || !shieldWall.isActive || !casterPos) return;
        
        // Create warning effect
        this.createVisualEffect(casterPos, 'cast', { 
            count: 4, 
            color: 0x708090,
            scaleMultiplier: 0.8 
        });
        
        if (this.game.battleLogSystem) {
            const unitType = this.game.getComponent(casterEntity, this.componentTypes.UNIT_TYPE);
            const team = this.game.getComponent(casterEntity, this.componentTypes.TEAM);
            
            if (unitType && team) {
                this.game.battleLogSystem.add(
                    `${team.team} ${unitType.type}'s shield wall begins to weaken...`,
                    'log-defense'
                );
            }
        }
    }
    
    // FIXED: Proper shield wall removal
    removeShieldWall(casterEntity) {
        const shieldWall = this.game.getComponent(casterEntity, this.componentTypes.SHIELD_WALL);
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        
        if (!shieldWall) return;
        
        // Create dissolution effect
        if (casterPos) {
            this.createVisualEffect(casterPos, 'defensive_stance', { 
                count: 6, 
                scaleMultiplier: 0.6 
            });
        }
        
        // Remove shield wall component
        this.game.removeComponent(casterEntity, this.componentTypes.SHIELD_WALL);
        
        if (this.game.battleLogSystem) {
            const unitType = this.game.getComponent(casterEntity, this.componentTypes.UNIT_TYPE);
            const team = this.game.getComponent(casterEntity, this.componentTypes.TEAM);
            
            if (unitType && team) {
                this.game.battleLogSystem.add(
                    `${team.team} ${unitType.type}'s shield wall dissolves.`,
                    'log-defense'
                );
            }
        }
    }
}