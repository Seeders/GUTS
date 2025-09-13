class ChainLightningAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
        super(game, {
            id: 'chain_lightning',
            name: 'Chain Lightning',
            description: 'Lightning that jumps between multiple enemies',
            cooldown: 4.0,
            range: 250,
            manaCost: 40,
            targetType: 'auto',
            animation: 'cast',
            priority: 7,
            castTime: 1,
            autoTrigger: 'multiple_enemies',
            ...params
        });
        
        this.initialDamage = 60;
        this.maxJumps = 5;
        this.jumpRange = 70;
        this.damageReduction = 0.8;
        this.element = 'lightning';
    }
    
    defineEffects() {
        return {
            cast: {
                type: 'magic',
                options: {
                    count: 5,
                    color: 0x00aaff,
                    colorRange: { start: 0x00aaff, end: 0x88aaff },
                    scaleMultiplier: 1.2,
                    speedMultiplier: 2.0
                }
            },
            lightning: {
                type: 'magic',
                options: {
                    count: 5,
                    color: 0x00ccff,
                    scaleMultiplier: 1.5,
                    speedMultiplier: 3.0
                }
            },
            arc: {
                type: 'magic',
                options: {
                    count: 8,
                    color: 0x88aaff,
                    scaleMultiplier: 0.8,
                    speedMultiplier: 2.5
                }
            },
            impact: {
                type: 'damage',
                options: {
                    count: 4,
                    color: 0x00aaff,
                    scaleMultiplier: 1.0
                }
            }
        };
    }
    
    canExecute(casterEntity) {
        const enemies = this.getEnemiesInRange(casterEntity);
        return enemies.length >= 1;
    }
    
    execute(casterEntity) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!casterPos) return;
        
        // DESYNC SAFE: Get and sort enemies deterministically
        const enemies = this.getEnemiesInRange(casterEntity);
        if (enemies.length === 0) return;
        
        // Initial cast effect
        this.createVisualEffect(casterPos, 'cast');
   
        // DESYNC SAFE: Find closest enemy deterministically
        const firstTarget = this.findClosestEnemy(casterEntity, enemies);
        if (!firstTarget) return;
        
        // DESYNC SAFE: Use scheduling system instead of setTimeout for chain lightning
        this.game.schedulingSystem.scheduleAction(() => {
            this.startChainLightning(casterEntity, firstTarget, enemies);
        }, this.castTime, casterEntity);
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
        
        const targetPos = this.game.getComponent(currentTarget, this.componentTypes.POSITION);
        if (!targetPos) return;
        
        // Add target to hit list
        hitTargets.push(currentTarget);
        
        // Schedule this jump's effects with a small delay for visual appeal
        const jumpDelay = jumpIndex * 0.15; // 150ms between jumps
        
        this.game.schedulingSystem.scheduleAction(() => {
            // Lightning strike effect
            this.createVisualEffect(targetPos, 'lightning');
            
            // Apply damage
            this.dealDamageWithEffects(sourceId, currentTarget, Math.floor(damage), this.element);
            
            // Screen flash for dramatic effect (only on first hit)
            if (this.game.effectsSystem && jumpIndex === 0) {
                this.game.effectsSystem.playScreenFlash('#00aaff', 0.2);
            }
            
            // Create visual arc effect if there was a previous target
            if (jumpIndex > 0) {
                const previousTarget = hitTargets[jumpIndex - 1];
                const previousPos = this.game.getComponent(previousTarget, this.componentTypes.POSITION);
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
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!casterPos) return null;
        
        // Sort enemies deterministically first
        const sortedEnemies = enemies.slice().sort((a, b) => String(a).localeCompare(String(b)));
        
        let closest = null;
        let closestDistance = Infinity;
        
        sortedEnemies.forEach(enemyId => {
            const enemyPos = this.game.getComponent(enemyId, this.componentTypes.POSITION);
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
        const fromPos = this.game.getComponent(fromTarget, this.componentTypes.POSITION);
        if (!fromPos) return null;
        
        // Sort targets deterministically first
        const sortedTargets = availableTargets.slice().sort((a, b) => String(a).localeCompare(String(b)));
        
        let closest = null;
        let closestDistance = Infinity;
        
        sortedTargets.forEach(targetId => {
            if (targetId === fromTarget || hitTargets.includes(targetId)) return;
            
            const targetPos = this.game.getComponent(targetId, this.componentTypes.POSITION);
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
    
    createLightningArc(fromPos, toPos) {
        if (!this.game.scene) return;
        
        // Create lightning bolt geometry with deterministic path (no random)
        const points = this.generateDeterministicLightningPath(fromPos, toPos);
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        
        // Create lightning material
        const material = new THREE.LineBasicMaterial({
            color: 0x00ddff,
            linewidth: 3,
            transparent: true,
            opacity: 1.0,
            blending: THREE.AdditiveBlending
        });
        
        // Create the lightning line
        const lightningLine = new THREE.Line(geometry, material);
        this.game.scene.add(lightningLine);
        
        // Animate the lightning arc
        this.animateLightningArc(lightningLine, material);
        
        // Add bright points at connection points
        this.createLightningPoints(fromPos, toPos);
    }
    
    // DESYNC SAFE: Generate deterministic lightning path (no random)
    generateDeterministicLightningPath(fromPos, toPos) {
        const points = [];
        const segments = 3; // Number of lightning segments
        
        points.push(new THREE.Vector3(
            fromPos.x + (this.game.effectsSystem?.effectOffset?.x || 0),
            fromPos.y + (this.game.effectsSystem?.effectOffset?.y || 0) + 10,
            fromPos.z + (this.game.effectsSystem?.effectOffset?.z || 0)
        ));
        
        // Create jagged lightning path using deterministic values
        for (let i = 1; i < segments; i++) {
            const progress = i / segments;
            
            // Linear interpolation between start and end
            const baseX = fromPos.x + (toPos.x - fromPos.x) * progress;
            const baseY = fromPos.y + (toPos.y - fromPos.y) * progress + 10;
            const baseZ = fromPos.z + (toPos.z - fromPos.z) * progress;
            
            // Add deterministic jagged deviation based on segment index
            const deviation = 15; // Maximum deviation from straight line
            const jaggedX = baseX + (((i * 37) % 100) / 100 - 0.5) * deviation; // Deterministic "random"
            const jaggedY = baseY + (((i * 73) % 100) / 100 - 0.5) * deviation * 0.5;
            const jaggedZ = baseZ + (((i * 91) % 100) / 100 - 0.5) * deviation;
            
            points.push(new THREE.Vector3(
                jaggedX + (this.game.effectsSystem?.effectOffset?.x || 0),
                jaggedY + (this.game.effectsSystem?.effectOffset?.y || 0),
                jaggedZ + (this.game.effectsSystem?.effectOffset?.z || 0)
            ));
        }
        
        points.push(new THREE.Vector3(
            toPos.x + (this.game.effectsSystem?.effectOffset?.x || 0),
            toPos.y + (this.game.effectsSystem?.effectOffset?.y || 0) + 10,
            toPos.z + (this.game.effectsSystem?.effectOffset?.z || 0)
        ));
        
        return points;
    }
    
    animateLightningArc(lightningLine, material) {
        // Use game time for deterministic animation instead of real time
        const startTime = this.game.state.now;
        const animationDuration = 0.48; // 480ms in game time
        const flickerInterval = 0.08; // 80ms in game time
        
        // DESYNC SAFE: Use scheduling system for animation frames
        const animateFrame = (frameIndex) => {
            const currentTime = this.game.state.now;
            const elapsed = currentTime - startTime;
            
            if (elapsed >= animationDuration) {
                // Fade out and remove
                this.fadeLightningArc(lightningLine, material);
                return;
            }
            
            // Deterministic flicker effect based on frame index
            material.opacity = 0.2 + 0.6 * ((frameIndex % 3) / 2); // Cycles between 0.2, 0.5, 0.8
            material.color.setHex((frameIndex % 2) === 0 ? 0x00ddff : 0x88aaff);
            
            // Schedule next frame
            this.game.schedulingSystem.scheduleAction(() => {
                animateFrame(frameIndex + 1);
            }, flickerInterval, null);
        };
        
        animateFrame(0);
    }
    
    fadeLightningArc(lightningLine, material) {
        // Quick cleanup instead of complex fade animation for multiplayer safety
        if (this.game.scene && lightningLine.parent) {
            this.game.scene.remove(lightningLine);
            lightningLine.geometry.dispose();
            lightningLine.material.dispose();
        }
    }
    
    createLightningPoints(fromPos, toPos) {
        // Create bright particle effects at connection points
        if (this.game.effectsSystem) {
            this.game.effectsSystem.createParticleEffect(
                fromPos.x, fromPos.y + 10, fromPos.z, 'magic', {
                    count: 5,
                    color: 0x00ddff,
                    scaleMultiplier: 0.8,
                    speedMultiplier: 2.0,
                    heightOffset: 0
                }
            );
            
            // DESYNC SAFE: Use scheduling system for delayed effect
            this.game.schedulingSystem.scheduleAction(() => {
                if (this.game.effectsSystem) {
                    this.game.effectsSystem.createParticleEffect(
                        toPos.x, toPos.y + 10, toPos.z, 'magic', {
                            count: 5,
                            color: 0x00ddff,
                            scaleMultiplier: 0.8,
                            speedMultiplier: 2.0,
                            heightOffset: 0
                        }
                    );
                }
            }, 0.1, null);
        }
    }
}