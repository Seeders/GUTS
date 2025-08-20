class ChainLightningAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
        super(game, {
            id: 'chain_lightning',
            name: 'Chain Lightning',
            description: 'Lightning that jumps between multiple enemies',
            cooldown: 2.0,
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
                    count: 25,
                    color: 0x00aaff,
                    colorRange: { start: 0x00aaff, end: 0x88aaff },
                    scaleMultiplier: 1.2,
                    speedMultiplier: 2.0
                }
            },
            lightning: {
                type: 'magic',
                options: {
                    count: 15,
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
                    count: 12,
                    color: 0x00aaff,
                    scaleMultiplier: 1.0
                }
            }
        };
    }
    
    canExecute(casterEntity) {
        const enemies = this.getEnemiesInRange(casterEntity);
        return enemies.length >= 2;
    }
    
    execute(casterEntity) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!casterPos) return;
        
        // Cast effect at caster
        this.createVisualEffect(casterPos, 'cast');
        
        const enemies = this.getEnemiesInRange(casterEntity);
        if (enemies.length === 0) return;
        
        // Start with closest enemy
        const startTarget = this.findClosestEnemy(casterEntity, enemies);
        if (!startTarget) return;
        
        // Create initial lightning arc from caster to first target
        const targetPos = this.game.getComponent(startTarget, this.componentTypes.POSITION);
        if (targetPos && this.game.effectsSystem) {
            this.game.effectsSystem.createLightningBolt(
                new THREE.Vector3(casterPos.x, casterPos.y + 15, casterPos.z),
                new THREE.Vector3(targetPos.x, targetPos.y + 10, targetPos.z),
                {
                    style: {
                        color: 0x00ddff,
                        linewidth: 4, // Slightly thicker for initial cast
                        segments: 8,
                        deviation: 15,
                        jaggedIntensity: 1.3
                    },
                    animation: {
                        duration: 700,
                        flickerCount: 5,
                        flickerSpeed: 75,
                        colorFlicker: true,
                        opacityFlicker: true
                    }
                }
            );
        }
        
        // Start the chain lightning from the first target (with reduced jumps since we used one)
        setTimeout(() => {
            this.chainLightning(casterEntity, startTarget, enemies, this.maxJumps - 1, this.initialDamage);
        }, 100); // Small delay to see the initial arc
        
        this.logAbilityUsage(casterEntity, 
            `Chain lightning crackles through enemy ranks!`, true);
    }
    
    findClosestEnemy(casterEntity, enemies) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!casterPos) return null;
        
        let closest = null;
        let closestDistance = Infinity;
        
        enemies.forEach(enemyId => {
            const enemyPos = this.game.getComponent(enemyId, this.componentTypes.POSITION);
            if (!enemyPos) return;
            
            const distance = Math.sqrt(
                Math.pow(enemyPos.x - casterPos.x, 2) + 
                Math.pow(enemyPos.z - casterPos.z, 2)
            );
            
            if (distance < closestDistance) {
                closestDistance = distance;
                closest = enemyId;
            }
        });
        
        return closest;
    }
    
    createLightningArc(fromPos, toPos) {
        if (!this.game.scene) return;
        
        // Create lightning bolt geometry with jagged path
        const points = this.generateLightningPath(fromPos, toPos);
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
    
    generateLightningPath(fromPos, toPos) {
        const points = [];
        const segments = 3; // Number of lightning segments
        
        points.push(new THREE.Vector3(
            fromPos.x + this.game.effectsSystem.effectOffset.x,
            fromPos.y + this.game.effectsSystem.effectOffset.y + 10,
            fromPos.z + this.game.effectsSystem.effectOffset.z
        ));
        
        // Create jagged lightning path
        for (let i = 1; i < segments; i++) {
            const progress = i / segments;
            
            // Linear interpolation between start and end
            const baseX = fromPos.x + (toPos.x - fromPos.x) * progress;
            const baseY = fromPos.y + (toPos.y - fromPos.y) * progress + 10;
            const baseZ = fromPos.z + (toPos.z - fromPos.z) * progress;
            
            // Add random jagged deviation
            const deviation = 15; // Maximum deviation from straight line
            const jaggedX = baseX + (Math.random() - 0.5) * deviation;
            const jaggedY = baseY + (Math.random() - 0.5) * deviation * 0.5;
            const jaggedZ = baseZ + (Math.random() - 0.5) * deviation;
            
            points.push(new THREE.Vector3(
                jaggedX + this.game.effectsSystem.effectOffset.x,
                jaggedY + this.game.effectsSystem.effectOffset.y,
                jaggedZ + this.game.effectsSystem.effectOffset.z
            ));
        }
        
        points.push(new THREE.Vector3(
            toPos.x + this.game.effectsSystem.effectOffset.x,
            toPos.y + this.game.effectsSystem.effectOffset.y + 10,
            toPos.z + this.game.effectsSystem.effectOffset.z
        ));
        
        return points;
    }
    
    animateLightningArc(lightningLine, material) {
        let flickerCount = 0;
        const maxFlickers = 6;
        const flickerInterval = 80; // ms
        
        const flicker = () => {
            if (flickerCount >= maxFlickers) {
                // Fade out and remove
                this.fadeLightningArc(lightningLine, material);
                return;
            }
            
            // Flicker effect
            material.opacity = Math.random() * 0.8 + 0.2;
            material.color.setHex(Math.random() > 0.5 ? 0x00ddff : 0x88aaff);
            
            flickerCount++;
            setTimeout(flicker, flickerInterval);
        };
        
        flicker();
    }
    
    fadeLightningArc(lightningLine, material) {
        const fadeStart = Date.now();
        const fadeDuration = 300; // ms
        const initialOpacity = material.opacity;
        
        const fade = () => {
            const elapsed = Date.now() - fadeStart;
            const progress = elapsed / fadeDuration;
            
            if (progress >= 1) {
                // Remove the lightning line
                this.game.scene.remove(lightningLine);
                lightningLine.geometry.dispose();
                lightningLine.material.dispose();
                return;
            }
            
            material.opacity = initialOpacity * (1 - progress);
            requestAnimationFrame(fade);
        };
        
        fade();
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
            
            setTimeout(() => {
                this.game.effectsSystem.createParticleEffect(
                    toPos.x, toPos.y + 10, toPos.z, 'magic', {
                        count: 5,
                        color: 0x00ddff,
                        scaleMultiplier: 0.8,
                        speedMultiplier: 2.0,
                        heightOffset: 0
                    }
                );
            }, 100);
        }
    }
    
    chainLightning(sourceId, currentTarget, availableTargets, remainingJumps, damage) {
        if (remainingJumps <= 0 || !currentTarget) return;
        
        const targetPos = this.game.getComponent(currentTarget, this.componentTypes.POSITION);
        if (!targetPos) return;
        
        // Lightning strike effect
        this.createVisualEffect(targetPos, 'lightning');
        
        // Apply damage with effects
        this.dealDamageWithEffects(sourceId, currentTarget, Math.floor(damage), this.element);
        
        // Screen flash for dramatic effect
        if (this.game.effectsSystem && remainingJumps === this.maxJumps) {
            this.game.effectsSystem.playScreenFlash('#00aaff', 200);
        }
        
        // Find next target
        const nextTarget = this.findNextChainTarget(currentTarget, availableTargets);
        if (nextTarget && remainingJumps > 1) {
            // Create enhanced arc effect between targets
            const nextPos = this.game.getComponent(nextTarget, this.componentTypes.POSITION);
            if (nextPos && this.game.effectsSystem) {
                // Create multiple lightning arc effects for visibility
                this.createLightningArc(targetPos, nextPos);
            }
            
            setTimeout(() => {
                this.chainLightning(sourceId, nextTarget, availableTargets, 
                    remainingJumps - 1, damage * this.damageReduction);
            }, 150); // Quick succession for lightning effect
        }
    }
    
    findNextChainTarget(fromTarget, availableTargets) {
        const fromPos = this.game.getComponent(fromTarget, this.componentTypes.POSITION);
        if (!fromPos) return null;
        
        let closest = null;
        let closestDistance = Infinity;
        
        availableTargets.forEach(targetId => {
            if (targetId === fromTarget) return;
            
            const targetPos = this.game.getComponent(targetId, this.componentTypes.POSITION);
            if (!targetPos) return;
            
            const distance = Math.sqrt(
                Math.pow(targetPos.x - fromPos.x, 2) + 
                Math.pow(targetPos.z - fromPos.z, 2)
            );
            
            if (distance <= this.jumpRange && distance < closestDistance) {
                closestDistance = distance;
                closest = targetId;
            }
        });
        
        return closest;
    }
}