class EnchantWeaponAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
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
            ...abilityData
        });
        
        this.elementalDamage = 15;
        this.duration = 30.0; // 30 seconds
        // Use numeric enum values for elements
        this.availableElements = [
            this.enums.element.fire,
            this.enums.element.cold,
            this.enums.element.lightning
        ];
    }

    canExecute(casterEntity) {
        const allies = this.getAlliesInRange(casterEntity);
        // Only use if there are allies to enchant (excluding self)
        return allies.length >= 1;
    }
    
    execute(casterEntity) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        if (!casterPos) return;
        
        // Immediate cast effect
        this.playConfiguredEffects('cast', casterPos);
        this.logAbilityUsage(casterEntity, `Enchanter begins weaving magical enhancements!`);
        
        // DESYNC SAFE: Use scheduling system for enchantment application
        this.game.schedulingSystem.scheduleAction(() => {
            this.applyWeaponEnchantments(casterEntity);
        }, this.castTime, casterEntity);
    }
    
    applyWeaponEnchantments(casterEntity) {
        // Check if caster is still alive
        const casterHealth = this.game.getComponent(casterEntity, "health");
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        
        if (!casterHealth || casterHealth.current <= 0 || !casterPos) return;
        
        // DESYNC SAFE: Get and sort allies deterministically
        const allies = this.getAlliesInRange(casterEntity);
        const sortedAllies = allies.slice().sort((a, b) => a - b);
        
        let enchantedCount = 0;
        
        sortedAllies.forEach((allyId, index) => {
            const transform = this.game.getComponent(allyId, "transform");
            const allyPos = transform?.position;
            const allyHealth = this.game.getComponent(allyId, "health");
            
            // Only enchant living allies
            if (!allyPos || !allyHealth || allyHealth.current <= 0) return;
            
            // DESYNC SAFE: Check if already enchanted - don't stack enchantments
            const enums = this.game.getEnums();
            const existingBuff = this.game.getComponent(allyId, "buff");

            // DESYNC SAFE: Select element deterministically based on ally index and game time
            const selectedElement = this.selectDeterministicElement(allyId, index);

            if (existingBuff && existingBuff.buffType === enums.buffTypes.enchant_weapon) {
                // DESYNC SAFE: Refresh duration and update element
                existingBuff.endTime = this.game.state.now + this.duration;
                existingBuff.appliedTime = this.game.state.now;
                existingBuff.weaponElement = selectedElement;
            } else {
                // Apply new weapon enchantment - modifiers from buffTypes/enchant_weapon.json
                this.game.addComponent(allyId, "buff", {
                    buffType: enums.buffTypes.enchant_weapon,
                    endTime: this.game.state.now + this.duration,
                    appliedTime: this.game.state.now,
                    stacks: 1,
                    sourceEntity: casterEntity,
                    weaponElement: selectedElement
                });

                // DESYNC SAFE: Schedule enchantment removal
                this.game.schedulingSystem.scheduleAction(() => {
                    this.removeEnchantment(allyId);
                }, this.duration, allyId);
            }
            
            // Visual enchantment effect based on element
            this.playConfiguredEffects(this.getElementEffectName(selectedElement), allyPos);

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
        const enums = this.game.getEnums();
        if (this.game.hasComponent(allyId, "buff")) {
            const buff = this.game.getComponent(allyId, "buff");
            if (buff && buff.buffType === enums.buffTypes.enchant_weapon) {
                this.game.removeComponent(allyId, "buff");

                // Visual effect when enchantment expires
                const transform = this.game.getComponent(allyId, "transform");
                const allyPos = transform?.position;
                if (allyPos) {
                    this.playConfiguredEffects('expiration', allyPos);
                }
            }
        }
    }
    
    // Helper method to get effect name from numeric element enum
    getElementEffectName(element) {
        if (element === this.enums.element.fire) return 'enchant_fire';
        if (element === this.enums.element.cold) return 'enchant_cold';
        if (element === this.enums.element.lightning) return 'enchant_lightning';
        return 'enchant_fire';
    }

    // Helper method to get enchantment color for UI/effects
    getElementColor(element) {
        if (element === this.enums.element.fire) return 0xFF4500;
        if (element === this.enums.element.cold) return 0x00BFFF;
        if (element === this.enums.element.lightning) return 0xFFFF00;
        return 0xFFD700;
    }

    // Helper method to get element damage type for combat system integration
    // Returns the numeric enum value for the element
    getElementDamageType(element) {
        // element is already a numeric enum, just return it
        // Default to physical if invalid
        if (element === this.enums.element.fire ||
            element === this.enums.element.cold ||
            element === this.enums.element.lightning) {
            return element;
        }
        return this.enums.element.physical;
    }
}
