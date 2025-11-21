class EnchantWeaponAbility extends GUTS.BaseAbility {
    constructor(game, params = {}) {
        super(game, {
            id: 'enchant_weapon',
            name: 'Enchant Weapon',
            description: 'Enchant ally weapons with elemental damage (does not stack, refreshes duration)',
            cooldown: 12.0,
            range: 100,
            manaCost: 35,
            targetType: 'allies',
            animation: 'cast',
            priority: 5,
            castTime: 1.5,
            ...params
        });
        
        this.elementalDamage = 15;
        this.duration = 30.0; // 30 seconds
        this.availableElements = ['fire', 'cold', 'lightning'];
    }
    
    defineEffects() {
        return {
            cast: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0xFFD700,
                    colorRange: { start: 0xFFD700, end: 0xFFA500 },
                    scaleMultiplier: 1.8,
                    speedMultiplier: 1.5
                }
            },
            enchant_fire: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0xFF4500,
                    scaleMultiplier: 1.3,
                    speedMultiplier: 1.2
                }
            },
            enchant_cold: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0x00BFFF,
                    scaleMultiplier: 1.3,
                    speedMultiplier: 1.2
                }
            },
            enchant_lightning: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0xFFFF00,
                    scaleMultiplier: 1.3,
                    speedMultiplier: 1.2
                }
            }
        };
    }
    
    canExecute(casterEntity) {
        const allies = this.getAlliesInRange(casterEntity);
        // Only use if there are allies to enchant (excluding self)
        return allies.length >= 1;
    }
    
    execute(casterEntity) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!casterPos) return;
        
        // Immediate cast effect
        this.createVisualEffect(casterPos, 'cast');
        this.logAbilityUsage(casterEntity, `Enchanter begins weaving magical enhancements!`);
        
        // DESYNC SAFE: Use scheduling system for enchantment application
        this.game.schedulingSystem.scheduleAction(() => {
            this.applyWeaponEnchantments(casterEntity);
        }, this.castTime, casterEntity);
    }
    
    applyWeaponEnchantments(casterEntity) {
        // Check if caster is still alive
        const casterHealth = this.game.getComponent(casterEntity, this.componentTypes.HEALTH);
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        
        if (!casterHealth || casterHealth.current <= 0 || !casterPos) return;
        
        // DESYNC SAFE: Get and sort allies deterministically
        const allies = this.getAlliesInRange(casterEntity);
        const sortedAllies = allies.slice().sort((a, b) => String(a).localeCompare(String(b)));
        
        let enchantedCount = 0;
        
        sortedAllies.forEach((allyId, index) => {
            const allyPos = this.game.getComponent(allyId, this.componentTypes.POSITION);
            const allyHealth = this.game.getComponent(allyId, this.componentTypes.HEALTH);
            
            // Only enchant living allies
            if (!allyPos || !allyHealth || allyHealth.current <= 0) return;
            
            // DESYNC SAFE: Check if already enchanted - don't stack enchantments
            const existingBuff = this.game.getComponent(allyId, this.componentTypes.BUFF);
            
            // DESYNC SAFE: Select element deterministically based on ally index and game time
            const selectedElement = this.selectDeterministicElement(allyId, index);
            
            if (existingBuff && existingBuff.buffType === 'enchant_weapon') {
                // DESYNC SAFE: Refresh duration and update element
                existingBuff.endTime = this.game.state.now + this.duration;
                existingBuff.appliedTime = this.game.state.now;
                existingBuff.modifiers.weaponElement = selectedElement;
            } else {
                // Apply new weapon enchantment
                const Components = this.game.componentManager.getComponents();
                this.game.addComponent(allyId, this.componentTypes.BUFF, 
                    Components.Buff('enchant_weapon', { 
                        weaponElement: selectedElement,
                        elementalDamage: this.elementalDamage,
                        glowing: true
                    }, this.game.state.now + this.duration, false, 1, this.game.state.now));
                
                // DESYNC SAFE: Schedule enchantment removal
                this.game.schedulingSystem.scheduleAction(() => {
                    this.removeEnchantment(allyId);
                }, this.duration, allyId);
            }
            
            // Visual enchantment effect based on element
            this.createVisualEffect(allyPos, `enchant_${selectedElement}`);
            
            enchantedCount++;
        });
        
        // Screen effect for successful enchantment
        if (this.game.effectsSystem && enchantedCount > 0) {
            this.game.effectsSystem.playScreenFlash('#FFD700', 0.4);
        }
        
     
    }
    
    // DESYNC SAFE: Select element deterministically instead of randomly
    selectDeterministicElement(allyId, allyIndex) {
        // Create a deterministic "random" value based on ally ID, game time, and index
        const seed = parseInt(allyId) + Math.floor(this.game.state.now * 100) + allyIndex;
        const pseudoRandom = (seed * 9301 + 49297) % 233280; // Simple PRNG
        const elementIndex = Math.floor((pseudoRandom / 233280) * this.availableElements.length);
        
        return this.availableElements[elementIndex];
    }
    
    // Alternative deterministic selection method (cycle through elements)
    selectCyclicElement(allyIndex) {
        return this.availableElements[allyIndex % this.availableElements.length];
    }
    
    // DESYNC SAFE: Remove enchantment effect
    removeEnchantment(allyId) {
        // Check if ally still exists and has the enchantment buff
        if (this.game.hasComponent(allyId, this.componentTypes.BUFF)) {
            const buff = this.game.getComponent(allyId, this.componentTypes.BUFF);
            if (buff && buff.buffType === 'enchant_weapon') {
                const element = buff.modifiers.weaponElement || 'fire';
                
                this.game.removeComponent(allyId, this.componentTypes.BUFF);
                
                // Visual effect when enchantment expires
                const allyPos = this.game.getComponent(allyId, this.componentTypes.POSITION);
                if (allyPos) {
                    this.createVisualEffect(allyPos, `enchant_${element}`, { 
                        count: 3, 
                        scaleMultiplier: 0.6,
                        speedMultiplier: 0.8
                    });
                }
                
              
            }
        }
    }
    
    // Helper method to get enchantment color for UI/effects
    getElementColor(element) {
        switch (element) {
            case 'fire': return 0xFF4500;
            case 'cold': return 0x00BFFF;
            case 'lightning': return 0xFFFF00;
            default: return 0xFFD700;
        }
    }
    
    // Helper method to get element damage type for combat system integration
    getElementDamageType(element) {
        switch (element) {
            case 'fire': return 'fire';
            case 'cold': return 'cold';
            case 'lightning': return 'lightning';
            default: return 'magic';
        }
    }
}