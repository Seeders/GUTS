class PiercingShotAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
        super(game, {
            id: 'piercing_shot',
            name: 'Piercing Shot',
            description: 'Fire a bolt that pierces through multiple enemies',
            cooldown: 6.0,
            range: 200,
            manaCost: 25,
            targetType: 'line',
            animation: 'attack',
            priority: 6,
            castTime: 1.5,
            ...params
        });
        this.piercingDamage = 45;
    }
    
    execute(casterEntity) {
        const pos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        const facing = this.game.getComponent(casterEntity, this.componentTypes.FACING);
        if (!pos || !facing) return;
        
        // Create piercing line effect
        const endPos = {
            x: pos.x + Math.cos(facing.angle) * this.range,
            y: pos.y,
            z: pos.z + Math.sin(facing.angle) * this.range
        };
        
        if (this.game.effectsSystem) {
            this.game.effectsSystem.createEnergyBeam(
                new THREE.Vector3(pos.x, pos.y + 15, pos.z),
                new THREE.Vector3(endPos.x, endPos.y + 15, endPos.z)
            );
        }
        
        // Hit all enemies in line
        const enemies = this.getEnemiesInRange(casterEntity, this.range);
        const hitEnemies = enemies.filter(enemyId => {
            const enemyPos = this.game.getComponent(enemyId, this.componentTypes.POSITION);
            return this.isInLine(pos, endPos, enemyPos, 20); // 20 unit width
        });
        
        hitEnemies.forEach(enemyId => {
            this.dealDamageWithEffects(casterEntity, enemyId, this.piercingDamage, 'physical');
        });
        
        this.logAbilityUsage(casterEntity, `Crossbow bolt pierces ${hitEnemies.length} enemies!`);
    }
    
    isInLine(start, end, point, width) {
        // Simple line-point distance calculation
        const A = end.z - start.z;
        const B = start.x - end.x;
        const C = end.x * start.z - start.x * end.z;
        const distance = Math.abs(A * point.x + B * point.z + C) / Math.sqrt(A * A + B * B);
        return distance <= width;
    }
}