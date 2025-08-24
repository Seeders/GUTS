class ShieldWallAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
        super(game, {
            id: 'shield_wall',
            name: 'Shield Wall',
            description: 'Form a defensive stance, reducing damage and taunting enemies',
            cooldown: 12.0,
            range: 0,
            manaCost: 30,
            targetType: 'self',
            animation: 'cast',
            priority: 4,
            castTime: 1.0,
            ...params
        });
    }
    
    execute(casterEntity) {
        const pos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!pos) return;
        
        const Components = this.game.componentManager.getComponents();
        this.game.addComponent(casterEntity, this.game.componentManager.getComponentTypes().SHIELD_WALL, 
            Components.ShieldWall());
        
        this.logAbilityUsage(casterEntity, "Soldier forms a protective shield wall!");
    }
}