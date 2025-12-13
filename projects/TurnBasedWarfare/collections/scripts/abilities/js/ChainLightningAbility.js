class ChainLightningAbility extends GUTS.BaseAbility {
    constructor(game, params = {}) {
        super(game, {
            id: 'chain_lightning',
            name: 'Chain Lightning',
            description: 'Lightning that jumps between multiple enemies',
            cooldown: 4.0,
            range: 250,
            manaCost: 40,
            targetType: 'enemy',
            animation: 'cast',
            priority: 7,
            castTime: 1,
            ...params
        });
        
        this.initialDamage = 60;
        this.maxJumps = 5;
        this.jumpRange = 70;
        this.damageReduction = 0.8;
        this.element = this.enums.element.lightning;
    }
    
    defineEffects() {
        return {
            cast: {
                type: 'magic',
                options: {
                    count: 15,
                    color: 0x00ccff,
                    colorRange: { start: 0xffffff, end: 0x0088ff },
                    scaleMultiplier: 2.0,
                    speedMultiplier: 3.0
                }
            },
            lightning: {
                type: 'explosion',
                options: {
                    count: 20,
                    color: 0x00ddff,
                    colorRange: { start: 0xffffff, end: 0x0066ff },
                    scaleMultiplier: 2.5,
                    speedMultiplier: 4.0
                }
            },
            arc: {
                type: 'magic',
                options: {
                    count: 10,
                    color: 0x88ccff,
                    colorRange: { start: 0xffffff, end: 0x4488ff },
                    scaleMultiplier: 1.2,
                    speedMultiplier: 3.5
                }
            },
            sparks: {
                type: 'damage',
                options: {
                    count: 12,
                    color: 0xffff00,
                    colorRange: { start: 0xffffff, end: 0x00aaff },
                    scaleMultiplier: 0.5,
                    speedMultiplier: 4.0
                }
            },
            impact: {
                type: 'damage',
                options: {
                    count: 8,
                    color: 0x00aaff,
                    colorRange: { start: 0xffffff, end: 0x0066ff },
                    scaleMultiplier: 1.5
                }
            }
        };
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
        this.createVisualEffect(casterPos, 'cast');
   
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
            this.createVisualEffect(targetPos, 'lightning');
            this.createVisualEffect(targetPos, 'sparks');

            // Enhanced electric burst at impact
            if (!this.game.isServer) {
                const impactPos = new THREE.Vector3(targetPos.x, targetPos.y + 50, targetPos.z);

                this.game.call('createLayeredEffect', {
                    position: impactPos,
                    layers: [
                        // Bright flash
                        {
                            count: 10,
                            lifetime: 0.2,
                            color: 0xffffff,
                            colorRange: { start: 0xffffff, end: 0x00ddff },
                            scale: 30,
                            scaleMultiplier: 2.0,
                            velocityRange: { x: [-50, 50], y: [-20, 80], z: [-50, 50] },
                            gravity: 0,
                            drag: 0.8,
                            blending: 'additive'
                        },
                        // Electric sparks
                        {
                            count: 15,
                            lifetime: 0.4,
                            color: 0x00ddff,
                            colorRange: { start: 0xffffff, end: 0x0066ff },
                            scale: 8,
                            scaleMultiplier: 0.6,
                            velocityRange: { x: [-80, 80], y: [20, 100], z: [-80, 80] },
                            gravity: 150,
                            drag: 0.95,
                            blending: 'additive'
                        }
                    ]
                });
            }

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
            fromPos.x,
            fromPos.y + 10,
            fromPos.z
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
                jaggedX,
                jaggedY,
                jaggedZ
            ));
        }
        
        points.push(new THREE.Vector3(
            toPos.x,
            toPos.y + 10,
            toPos.z
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
        if (!this.game.isServer) {
            // Source point sparks
            this.game.call('createParticles', {
                position: new THREE.Vector3(fromPos.x, fromPos.y + 50, fromPos.z),
                count: 8,
                lifetime: 0.3,
                visual: {
                    color: 0x00ddff,
                    colorRange: { start: 0xffffff, end: 0x0088ff },
                    scale: 12,
                    scaleMultiplier: 0.8,
                    fadeOut: true,
                    blending: 'additive'
                },
                velocityRange: { x: [-40, 40], y: [20, 60], z: [-40, 40] },
                gravity: 100,
                drag: 0.95
            });

            // Target point sparks
            this.game.schedulingSystem.scheduleAction(() => {
                this.game.call('createParticles', {
                    position: new THREE.Vector3(toPos.x, toPos.y + 50, toPos.z),
                    count: 10,
                    lifetime: 0.4,
                    visual: {
                        color: 0x00ddff,
                        colorRange: { start: 0xffffff, end: 0x0088ff },
                        scale: 15,
                        scaleMultiplier: 1.0,
                        fadeOut: true,
                        blending: 'additive'
                    },
                    velocityRange: { x: [-50, 50], y: [30, 80], z: [-50, 50] },
                    gravity: 120,
                    drag: 0.95
                });
            }, 0.05, null);
        }
    }
}
