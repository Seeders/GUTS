class MultiShotAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
        super(game, {
            id: 'multi_shot',
            name: 'Multi Shot',
            description: 'Fire multiple arrows at different targets',
            cooldown: 7.0,
            range: 180,
            manaCost: 25,
            targetType: 'enemies',
            animation: 'attack',
            priority: 6,
            castTime: 1.0,
            ...params
        });
        this.maxTargets = 3;
        this.arrowDamage = 35;
    }
    
    execute(casterEntity) {
        const enemies = this.getEnemiesInRange(casterEntity);
        const targets = enemies.slice(0, this.maxTargets);
        
        targets.forEach((targetId, index) => {
            setTimeout(() => {
                if (this.game.projectileSystem) {
                    this.game.projectileSystem.fireProjectile(casterEntity, targetId, {
                        id: 'arrow',
                        damage: this.arrowDamage,
                        speed: 120,
                        element: 'physical'
                    });
                }
            }, index * 200); // Stagger shots
        });
        
        this.logAbilityUsage(casterEntity, `Archer fires ${targets.length} arrows!`);
    }
}