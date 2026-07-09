class ChainLightningAbility extends GUTS.BaseAbility {
    static serviceDependencies = [
        ...GUTS.BaseAbility.serviceDependencies,
        'playEffect',
        'getWorldScene'
    ];

    constructor(game, abilityData = {}) {
        super(game, abilityData);

        this.initialDamage   = abilityData.initialDamage   ?? 60;
        this.maxJumps        = abilityData.maxJumps        ?? 5;
        this.jumpRange       = abilityData.jumpRange       ?? 70;
        this.damageReduction = abilityData.damageReduction ?? 0.8;
        this.element         = this.enums.element[abilityData.element || 'lightning'] ?? this.enums.element.lightning;
    }

    canExecute(casterEntity) {
        const enemies = this.getEnemiesInRange(casterEntity);
        return enemies.length >= 1;
    }
    
    execute(casterEntity) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        if (!casterPos) return;
        
        // DESYNC SAFE: Get and sort enemies deterministically
        const enemies = this.getEnemiesInRange(casterEntity);
        if (enemies.length === 0) return;
        
        // Initial cast effect
        this.playConfiguredEffects('cast', casterPos);
   
        // DESYNC SAFE: Find closest enemy deterministically
        const firstTarget = this.findClosestEnemy(casterEntity, enemies);
        if (!firstTarget) return;
               
        this.startChainLightning(casterEntity, firstTarget, enemies);
    }
    
    // DESYNC SAFE: Start the chain lightning sequence deterministically
    startChainLightning(sourceId, firstTarget, availableTargets) {
        const hitTargets = []; // Track which targets have been hit
        
        // Process the entire chain synchronously to avoid timing issues
        this.processLightningChain(sourceId, firstTarget, availableTargets, hitTargets, this.maxJumps, this.initialDamage, 0);
    }
    
    // DESYNC SAFE: Process the entire lightning chain deterministically
    processLightningChain(sourceId, currentTarget, availableTargets, hitTargets, remainingJumps, damage, jumpIndex) {
        if (remainingJumps <= 0 || !currentTarget || hitTargets.includes(currentTarget)) {
            return;
        }

        const transform = this.game.getComponent(currentTarget, "transform");
        const targetPos = transform?.position;
        if (!targetPos) return;
        
        // Add target to hit list
        hitTargets.push(currentTarget);
        
        // Schedule this jump's effects with a small delay for visual appeal
        const jumpDelay = jumpIndex * 0.15; // 150ms between jumps
        
        this.game.schedulingSystem.scheduleAction(() => {
            // Lightning strike effect
            this.playConfiguredEffects('chain', targetPos);

            // Apply damage
            this.dealDamageWithEffects(sourceId, currentTarget, Math.floor(damage), this.element);

            // Screen flash for dramatic effect (only on first hit)
            if (this.game.effectsSystem && jumpIndex === 0) {
                this.game.effectsSystem.playScreenFlash('#00aaff', 0.3);
            }

            // Create visual arc effect if there was a previous target
            if (jumpIndex > 0) {
                const previousTarget = hitTargets[jumpIndex - 1];
                const transform = this.game.getComponent(previousTarget, "transform");
                const previousPos = transform?.position;
                if (previousPos) {
                    this.createLightningArc(previousPos, targetPos);
                }
            }
        }, jumpDelay, sourceId);
        
        // DESYNC SAFE: Find next target deterministically
        const nextTarget = this.findNextChainTarget(currentTarget, availableTargets, hitTargets);
        
        if (nextTarget && remainingJumps > 1) {
            // Recursively process the next jump
            this.processLightningChain(
                sourceId, 
                nextTarget, 
                availableTargets, 
                hitTargets, 
                remainingJumps - 1, 
                damage * this.damageReduction, 
                jumpIndex + 1
            );
        }
    }
    
    // DESYNC SAFE: Find closest enemy deterministically
    findClosestEnemy(casterEntity, enemies) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        if (!casterPos) return null;
        
        // Sort enemies deterministically first
        const sortedEnemies = enemies.slice().sort((a, b) => a - b);
        
        let closest = null;
        let closestDistance = Infinity;
        
        sortedEnemies.forEach(enemyId => {
            const transform = this.game.getComponent(enemyId, "transform");
            const enemyPos = transform?.position;
            if (!enemyPos) return;
            
            const distance = Math.sqrt(
                Math.pow(enemyPos.x - casterPos.x, 2) + 
                Math.pow(enemyPos.z - casterPos.z, 2)
            );
            
            // Use < for consistent tie-breaking (first in sorted order wins)
            if (distance < closestDistance) {
                closestDistance = distance;
                closest = enemyId;
            }
        });
        
        return closest;
    }
    
    // DESYNC SAFE: Find next chain target deterministically
    findNextChainTarget(fromTarget, availableTargets, hitTargets) {
        const transform = this.game.getComponent(fromTarget, "transform");
        const fromPos = transform?.position;
        if (!fromPos) return null;
        
        // Sort targets deterministically first
        const sortedTargets = availableTargets.slice().sort((a, b) => a - b);
        
        let closest = null;
        let closestDistance = Infinity;
        
        sortedTargets.forEach(targetId => {
            if (targetId === fromTarget || hitTargets.includes(targetId)) return;

            const transform = this.game.getComponent(targetId, "transform");
            const targetPos = transform?.position;
            if (!targetPos) return;
            
            const distance = Math.sqrt(
                Math.pow(targetPos.x - fromPos.x, 2) + 
                Math.pow(targetPos.z - fromPos.z, 2)
            );
            
            // Use < for consistent tie-breaking
            if (distance <= this.jumpRange && distance < closestDistance) {
                closestDistance = distance;
                closest = targetId;
            }
        });
        
        return closest;
    }
    
    // The ONE lightning look lives in EffectsSystem's 'lightning' line config —
    // no hand-rolled geometry/animation here (the old local version drew its
    // own bolt and leaked lines when the game clock reset mid-animation).
    createLightningArc(fromPos, toPos) {
        if (!this.game.effectsSystem?.createLightningBolt) return;
        this.game.effectsSystem.createLightningBolt(
            new THREE.Vector3(fromPos.x, fromPos.y + 10, fromPos.z),
            new THREE.Vector3(toPos.x, toPos.y + 10, toPos.z)
        );

        // Add bright points at connection points
        this.createLightningPoints(fromPos, toPos);
    }

    createLightningPoints(fromPos, toPos) {
        // Create bright particle effects at connection points using presets
        if (!this.game.isServer) {
            // Source point sparks
            this.call.playEffect( 'lightning_sparks',
                new THREE.Vector3(fromPos.x, fromPos.y + 50, fromPos.z));

            // Target point sparks
            this.game.schedulingSystem.scheduleAction(() => {
                this.call.playEffect( 'lightning_sparks',
                    new THREE.Vector3(toPos.x, toPos.y + 50, toPos.z));
            }, 0.05, null);
        }
    }
}
