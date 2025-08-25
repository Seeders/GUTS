class SummonWolfAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
        super(game, {
            id: 'summon_wolf',
            name: 'Summon Wolf',
            description: 'Call forth a loyal wolf companion (max 1 per Beast Master)',
            cooldown: 0.0,
            range: 0,
            manaCost: 50,
            targetType: 'self',
            animation: 'cast',
            priority: 5,
            castTime: 1.0,
            ...params
        });
        this.hasSummon = false;
        this.summonId = '0_skeleton';
    }
    
    canExecute(casterEntity) {
        // Check if this Beast Master already has a summoned wolf
        return !this.hasSummon;
    }
    
    execute(casterEntity) {
        const pos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        const team = this.game.getComponent(casterEntity, this.componentTypes.TEAM);
        if (!pos || !team) return;        
        // Create wolf companion
        const wolfId = this.createSummonedCreature(pos, this.summonId, team.team, casterEntity);
        this.hasSummon = true;
        this.logAbilityUsage(casterEntity, "Beast Master summons a faithful wolf!");
    }
    
    createSummonedCreature(pos, unitDef, team, summoner) {
        const creatureId = this.game.createEntity();
        const components = this.game.componentManager.getComponents();
        const componentTypes = this.game.componentManager.getComponentTypes();
        
        // Add all standard unit components
        this.game.addComponent(creatureId, componentTypes.POSITION, 
            components.Position(pos.x + 30, pos.y, pos.z));
        this.game.addComponent(creatureId, componentTypes.VELOCITY, 
            components.Velocity(0, 0, 0, (unitDef.speed || 40) * 20));
        this.game.addComponent(creatureId, componentTypes.RENDERABLE, 
            components.Renderable("units", this.summonId));
        this.game.addComponent(creatureId, componentTypes.HEALTH, 
            components.Health(unitDef.hp || 60));
        this.game.addComponent(creatureId, componentTypes.COMBAT, 
            components.Combat(unitDef.damage || 25, unitDef.range || 30, unitDef.attackSpeed || 1.2));
        this.game.addComponent(creatureId, componentTypes.COLLISION, 
            components.Collision(unitDef.size || 20));
        this.game.addComponent(creatureId, componentTypes.TEAM, components.Team(team));
        this.game.addComponent(creatureId, componentTypes.UNIT_TYPE, 
            components.UnitType(this.summonId, 'Summoned Wolf', 0));
        this.game.addComponent(creatureId, componentTypes.AI_STATE, components.AIState('idle'));
        this.game.addComponent(creatureId, componentTypes.ANIMATION, components.Animation());
        this.game.addComponent(creatureId, componentTypes.FACING, components.Facing(0));
        this.game.addComponent(creatureId, componentTypes.SUMMONED, 
            components.Summoned(summoner, this.summonId, null, 0));
        
        return creatureId;
    }
}
