class EnchantWeaponAbility extends engine.app.appClasses['BaseAbility'] {
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
    }
    
    execute(casterEntity) {
        const allies = this.getAlliesInRange(casterEntity);
        let enchantedCount = 0;
        
        allies.forEach(allyId => {
            // Check if already enchanted - don't stack enchantments
            const existingBuff = this.game.getComponent(allyId, this.game.componentManager.getComponentTypes().BUFF);
            if (existingBuff && existingBuff.buffType === 'enchant_weapon') {
                // Refresh duration instead of stacking
                existingBuff.endTime = Date.now() / 1000 + 30;
                return;
            }
            
            const Components = this.game.componentManager.getComponents();
            const randomElement = ['fire', 'cold', 'lightning'][Math.floor(Math.random() * 3)];
            
            this.game.addComponent(allyId, this.game.componentManager.getComponentTypes().BUFF, 
                Components.Buff('enchant_weapon', { 
                    weaponElement: randomElement,
                    elementalDamage: 15,
                    glowing: true
                }, Date.now() / 1000 + 30, false, 1, 0));
            enchantedCount++;
        });
        
        this.logAbilityUsage(casterEntity, `Enchanter enhances ${enchantedCount} weapons with magic!`);
    }
}