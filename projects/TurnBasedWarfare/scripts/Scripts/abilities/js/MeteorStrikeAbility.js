class MeteorStrikeAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
        super(game, {
            id: 'meteor_strike',
            name: 'Meteor Strike',
            description: 'Devastating strike on the densest enemy formation',
            cooldown: 45.0,
            range: 300,
            manaCost: 100,
            targetType: 'auto',
            animation: 'cast',
            priority: 10,
            castTime: 4.0,
            autoTrigger: 'enemy_cluster_large',
            ...params
        });
        
        this.damage = 200;
        this.splashRadius = 120;
        this.delay = 3.0;
        this.element = 'fire';
        this.minTargets = 4;
    }
    
    canExecute(casterEntity) {
        const enemies = this.getEnemiesInRange(casterEntity);
        const clusterPos = this.findBestClusterPosition(enemies, this.minTargets);
        return clusterPos !== null;
    }
    
    execute(casterEntity) {
        const enemies = this.getEnemiesInRange(casterEntity);
        const targetPos = this.findBestClusterPosition(enemies, this.minTargets);
        
        if (!targetPos) return;
        
        // Create warning indicator
        this.createMeteorWarning(targetPos);
        
        // Schedule meteor impact
        setTimeout(() => {
            this.meteorImpact(casterEntity, targetPos);
        }, this.delay * 1000);
        
        this.logAbilityUsage(casterEntity, 
            `A massive meteor approaches from the heavens!`);
    }
    
    createMeteorWarning(position) {
        const warningId = this.game.createEntity();
        const components = this.game.componentManager.getComponents();
        const componentTypes = this.game.componentManager.getComponentTypes();
        
        this.game.addComponent(warningId, componentTypes.POSITION, 
            components.Position(position.x, position.y + 5, position.z));
        
        this.game.addComponent(warningId, componentTypes.RENDERABLE, 
            components.Renderable("effects", "meteor_warning"));
        
        this.game.addComponent(warningId, componentTypes.LIFETIME, 
            components.Lifetime(this.delay, Date.now() / 1000));
        
        this.game.addComponent(warningId, componentTypes.ANIMATION, 
            components.Animation(4, 0, 1));
    }
    
    meteorImpact(casterEntity, position) {
        if (this.game.damageSystem) {
            const results = this.game.damageSystem.applySplashDamage(
                casterEntity,
                position,
                this.damage,
                this.element,
                this.splashRadius,
                { allowFriendlyFire: false, isSpell: true }
            );
            
            if (this.game.battleLogSystem) {
                this.game.battleLogSystem.add(
                    `Meteor strike devastates ${results.length} enemies!`,
                    'log-explosion'
                );
            }
        }
        
        this.createVisualEffect(position, 'meteor_explosion');
    }
}