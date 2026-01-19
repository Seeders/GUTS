class ShieldWallAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, {
            name: 'Shield Wall',
            description: 'Form a defensive stance, reducing damage and taunting enemies',
            cooldown: 12.0,
            range: 0, // Self-buff with taunt radius
            manaCost: 30,
            targetType: 'self',
            animation: 'cast',
            priority: 4,
            castTime: 1.0,
            ...abilityData
        });
        
        this.wallDuration = 10.0;
        this.damageReduction = 0.75; // 75% damage reduction
        this.tauntRadius = 200;
        this.originalArmorMultiplier = 1.0;
        this.element = this.enums.element.physical;
    }
    
    canExecute(casterEntity) {
        // Check if already has shield wall to prevent stacking
        const existingWall = this.game.getComponent(casterEntity, "shieldWall");
        if (existingWall && existingWall.isActive) return false;
        
        // Use when enemies are nearby and threatening
        const enemies = this.getEnemiesInRange(casterEntity, this.tauntRadius);
        return enemies.length > 0;
    }
    
    execute(casterEntity) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        if (!casterPos) return null;
        
        // Show immediate cast effect
        this.playConfiguredEffects('cast', casterPos);
        this.logAbilityUsage(casterEntity, `Soldier prepares to form a shield wall...`);
        
        // Schedule the shield wall formation after cast time
        this.game.schedulingSystem.scheduleAction(() => {
            this.formShieldWall(casterEntity);
        }, this.castTime, casterEntity);
    }
    
    formShieldWall(casterEntity) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        const casterCombat = this.game.getComponent(casterEntity, "combat");
        
        if (!casterPos) return;
        
        // Create shield formation effect
        this.playConfiguredEffects('burst', casterPos);
        
        // Store original armor for restoration later
        const originalArmor = casterCombat ? casterCombat.armor : 0;
        
        // Apply shield wall component with proper timing
        const currentTime = this.game.state.now || this.game.state.now || 0;
        const endTime = currentTime + this.wallDuration;

        this.game.addComponent(casterEntity, "shieldWall", {
            damageReduction: this.damageReduction,
            endTime: endTime,
            tauntRadius: this.tauntRadius,
            originalArmor: originalArmor,
            isActive: 1
        });
        
        // Schedule defensive stance visual effect
        this.game.schedulingSystem.scheduleAction(() => {
            const transform = this.game.getComponent(casterEntity, "transform");
            const pos = transform?.position;
            if (pos) {
                this.playConfiguredEffects('buff', pos);
            }
        }, 0.5, casterEntity);
        
        // Apply taunt effect to nearby enemies
        this.applyTauntToEnemies(casterEntity);
        
        // Screen effects for dramatic formation (client only)
        if (!this.game.isServer && this.game.effectsSystem) {
            this.game.effectsSystem.playScreenShake(0.3, 1);
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
        const sortedEnemies = enemies.slice().sort((a, b) => a - b);
        
        let tauntedCount = 0;
        
        sortedEnemies.forEach((enemyId, index) => {
            const enemyTransform = this.game.getComponent(enemyId, "transform");
            const enemyPos = enemyTransform?.position;
            const enemyAI = this.game.getComponent(enemyId, "aiState");
            
            if (!enemyPos || !enemyAI) return;
            
            // Apply taunt component
            const currentTime = this.game.state.now || this.game.state.now || 0;
            const tauntEndTime = currentTime + (this.wallDuration * 0.8); // Taunt lasts 80% of shield wall

            this.game.addComponent(enemyId, "taunt", {
                taunter: casterEntity,
                endTime: tauntEndTime,
                radius: this.tauntRadius,
                isTaunted: 1
            });
            
            // Force AI to target the shield wall user via behavior state
            const casterTransform = this.game.getComponent(casterEntity, "transform");
            this.game.call('setBehaviorMeta', enemyId, {
                target: casterEntity,
                targetPosition: casterTransform?.position
            });
            this.game.call('clearEntityPath', enemyId);
        
            // Schedule staggered taunt effects for visual appeal
            this.game.schedulingSystem.scheduleAction(() => {
                const pos = enemyTransform?.position;
                if (pos) {
                    this.playConfiguredEffects('debuff', pos);
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
        const shieldWall = this.game.getComponent(casterEntity, "shieldWall");
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        
        // Check if shield wall still exists and is active
        if (!shieldWall || !shieldWall.isActive || !casterPos) return;
        
        // Create warning effect
        this.playConfiguredEffects('sustained', casterPos);
     
    }
    
    // FIXED: Proper shield wall removal
    removeShieldWall(casterEntity) {
        const shieldWall = this.game.getComponent(casterEntity, "shieldWall");
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        
        if (!shieldWall) return;
        
        // Create dissolution effect
        if (casterPos) {
            this.playConfiguredEffects('expiration', casterPos);
        }
        
        // Remove shield wall component
        this.game.removeComponent(casterEntity, "shieldWall");
        
       
    }
}
