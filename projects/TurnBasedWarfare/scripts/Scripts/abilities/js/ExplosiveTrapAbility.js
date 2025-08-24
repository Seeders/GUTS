class ExplosiveTrapAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
        super(game, {
            id: 'explosive_trap',
            name: 'Explosive Trap',
            description: 'Place a hidden trap that explodes when enemies approach (max 2 per Trapper)',
            cooldown: 15.0,
            range: 100,
            manaCost: 35,
            targetType: 'ground',
            animation: 'cast',
            priority: 6,
            castTime: 1.5,
            ...params
        });
        this.maxTrapsPerTrapper = 2;
    }
    
    canExecute(casterEntity) {
        // Check how many traps this trapper already has active
        const existingTraps = this.game.getEntitiesWith(
            this.game.componentManager.getComponentTypes().TRAP,
            this.game.componentManager.getComponentTypes().POSITION
        );
        
        const myTraps = existingTraps.filter(trapId => {
            const trap = this.game.getComponent(trapId, this.game.componentManager.getComponentTypes().TRAP);
            return trap && trap.caster === casterEntity;
        });
        
        return myTraps.length < this.maxTrapsPerTrapper;
    }
    
    execute(casterEntity) {
        const pos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!pos) return;
        
        // Place trap ahead of caster
        const facing = this.game.getComponent(casterEntity, this.componentTypes.FACING) || { angle: 0 };
        const trapPos = {
            x: pos.x + Math.cos(facing.angle) * 60,
            y: pos.y,
            z: pos.z + Math.sin(facing.angle) * 60
        };
        
        const trapId = this.game.createEntity();
        const Components = this.game.componentManager.getComponents();
        
        this.game.addComponent(trapId, this.game.componentManager.getComponentTypes().POSITION, 
            Components.Position(trapPos.x, trapPos.y, trapPos.z));
        this.game.addComponent(trapId, this.game.componentManager.getComponentTypes().TRAP, 
            Components.Trap(80, 100, 40, 'physical', casterEntity, false, 1)); // Stronger single trap
        
        // Add visual indicator (hidden from enemies)
        this.game.addComponent(trapId, this.game.componentManager.getComponentTypes().RENDERABLE, 
            Components.Renderable("effects", "hidden_trap"));
        
        this.logAbilityUsage(casterEntity, "Trapper sets an explosive trap!");
    }
} 