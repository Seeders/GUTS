class MindControlAbility extends GUTS.BaseAbility {
    constructor(game, params = {}) {
        super(game, {
            id: 'mind_control',
            name: 'Mind Control',
            description: 'Charms enemy to fight for you',
            cooldown: 5.0,
            range: 190,
            manaCost: 0,
            targetType: 'enemy',
            animation: 'cast',
            priority: 8,
            castTime: 3.0,
            ...params
        });

        // How long control lasts once applied
        this.controlDuration = 5.0;

        // DESYNC SAFE: Track pending controls deterministically
        // Map<targetId, { team, contributors: Set<casterId>, progress: number, startTime: number, scheduledActionId: string }>
        this.pendingControls = new Map();

        // DESYNC SAFE: Track active beams for cleanup
        // Map<targetId, { team, beams: Map<casterId, effectData> }>
        this.beamRegistry = new Map();
    }

    defineEffects() {
        return {
            cast: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0x8A2BE2,
                    colorRange: { start: 0x8A2BE2, end: 0xDDA0DD },
                    scaleMultiplier: 1.5,
                    speedMultiplier: 1.8
                }
            },
            control: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0x9932CC,
                    scaleMultiplier: 2.0,
                    speedMultiplier: 2.0
                }
            },
            charm: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0xDA70D6,
                    scaleMultiplier: 1.8,
                    speedMultiplier: 1.5
                }
            }
        };
    }

    canExecute(casterEntity) {
        const enemies = this.getEnemiesInRange(casterEntity);
        
        // Filter out enemies that are already being controlled or targeted
        const validTargets = enemies.filter(enemyId => {
            const enemyTeam = this.game.getComponent(enemyId, "team");
            const casterTeam = this.game.getComponent(casterEntity, "team");
            
            if (!enemyTeam || !casterTeam) return false;
            
            // Don't target enemies that are already controlled by our team
            if (enemyTeam.team === casterTeam.team) return false;
            
            // Don't target enemies that are already being mind controlled
            return !this.pendingControls.has(enemyId);
        });
        
        return validTargets.length > 0;
    }

    execute(casterEntity) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        const casterTeam = this.game.getComponent(casterEntity, "team");
        
        if (!casterPos || !casterTeam) return;

        // DESYNC SAFE: Get and sort enemies deterministically
        const enemies = this.getEnemiesInRange(casterEntity);
        const validTargets = enemies.filter(enemyId => {
            const enemyTeam = this.game.getComponent(enemyId, "team");
            return enemyTeam && enemyTeam.team !== casterTeam.team && !this.pendingControls.has(enemyId);
        });

        if (validTargets.length === 0) return;

        // DESYNC SAFE: Select target deterministically (closest enemy)
        const target = this.findClosestEnemy(casterEntity, validTargets);
        if (!target) return;

        // Immediate cast effect
        this.createVisualEffect(casterPos, 'cast');
        this.logAbilityUsage(casterEntity, `${this.name} begins to dominate an enemy mind!`);

        // DESYNC SAFE: Use scheduling system for mind control process
        this.game.schedulingSystem.scheduleAction(() => {
            this.startMindControl(casterEntity, target);
        }, this.castTime, casterEntity);
    }

    // DESYNC SAFE: Find closest enemy deterministically
    findClosestEnemy(casterEntity, enemies) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        if (!casterPos) return null;

        // Sort enemies deterministically first
        const sortedEnemies = enemies.slice().sort((a, b) => String(a).localeCompare(String(b)));

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

            if (distance < closestDistance) {
                closestDistance = distance;
                closest = enemyId;
            }
        });

        return closest;
    }

    // DESYNC SAFE: Start mind control process
    startMindControl(casterId, targetId) {
        const casterTeam = this.game.getComponent(casterId, "team");
        const targetTeam = this.game.getComponent(targetId, "team");
        const transform = this.game.getComponent(targetId, "transform");
        const targetPos = transform?.position;
        
        if (!casterTeam || !targetTeam || !targetPos) return;

        // Check if target is already being controlled
        if (this.pendingControls.has(targetId)) {
            // Add this caster as a contributor to existing control attempt
            const existing = this.pendingControls.get(targetId);
            existing.contributors.add(casterId);
            this.createBeam(casterId, targetId);
            return;
        }

        // Start new mind control attempt
        const controlData = {
            team: casterTeam.team,
            contributors: new Set([casterId]),
            progress: 0,
            startTime: this.game.state.now,
            originalTeam: targetTeam.team
        };

        this.pendingControls.set(targetId, controlData);

        // Create visual beam effect
        this.createBeam(casterId, targetId);

        // Visual effect on target
        this.createVisualEffect(targetPos, 'control');

        // DESYNC SAFE: Schedule the mind control completion check
        const completionTime = 2.0; // 2 seconds to complete mind control
        const actionId = this.game.schedulingSystem.scheduleAction(() => {
            this.completeMindControl(targetId);
        }, completionTime, casterId);

        controlData.scheduledActionId = actionId;
    }

    // DESYNC SAFE: Complete mind control process
    completeMindControl(targetId) {
        const controlData = this.pendingControls.get(targetId);
        if (!controlData) return;

        const targetTeam = this.game.getComponent(targetId, "team");
        const transform = this.game.getComponent(targetId, "transform");
        const targetPos = transform?.position;
        
        if (!targetTeam || !targetPos) {
            this.cancelMindControl(targetId);
            return;
        }

        // Check if any contributors are still alive and in range
        const validContributors = Array.from(controlData.contributors).filter(casterId => {
            const casterHealth = this.game.getComponent(casterId, "health");
            const transform = this.game.getComponent(casterId, "transform");
            const casterPos = transform?.position;
            
            if (!casterHealth || casterHealth.current <= 0 || !casterPos) return false;
            
            const distance = Math.sqrt(
                Math.pow(casterPos.x - targetPos.x, 2) + 
                Math.pow(casterPos.z - targetPos.z, 2)
            );
            
            return distance <= this.range;
        });

        if (validContributors.length === 0) {
            this.cancelMindControl(targetId);
            return;
        }

        // Apply mind control
        this.applyMindControl(targetId, controlData);
    }

    // DESYNC SAFE: Apply mind control effect
    applyMindControl(targetId, controlData) {
        const targetTeam = this.game.getComponent(targetId, "team");
        const transform = this.game.getComponent(targetId, "transform");
        const targetPos = transform?.position;
        
        if (!targetTeam || !targetPos) return;

        // Change team
        targetTeam.team = controlData.team;

        // Visual charm effect
        this.createVisualEffect(targetPos, 'charm');

        // Enhanced mind control success burst (client only)
        if (!this.game.isServer && this.game.gameManager) {
            this.game.gameManager.call('createLayeredEffect', {
                position: new THREE.Vector3(targetPos.x, targetPos.y + 35, targetPos.z),
                layers: [
                    // Psychic shockwave
                    {
                        count: 25,
                        lifetime: 0.6,
                        color: 0x9932cc,
                        colorRange: { start: 0xda70d6, end: 0x8a2be2 },
                        scale: 20,
                        scaleMultiplier: 2.5,
                        velocityRange: { x: [-100, 100], y: [30, 100], z: [-100, 100] },
                        gravity: -30,
                        drag: 0.9,
                        blending: 'additive'
                    },
                    // Purple mind energy
                    {
                        count: 18,
                        lifetime: 0.5,
                        color: 0x8a2be2,
                        colorRange: { start: 0xdda0dd, end: 0x4b0082 },
                        scale: 15,
                        scaleMultiplier: 2.0,
                        velocityRange: { x: [-60, 60], y: [60, 140], z: [-60, 60] },
                        gravity: -50,
                        drag: 0.88,
                        blending: 'additive'
                    },
                    // White sparkles
                    {
                        count: 12,
                        lifetime: 0.7,
                        color: 0xffffff,
                        colorRange: { start: 0xffffff, end: 0xdda0dd },
                        scale: 6,
                        scaleMultiplier: 0.6,
                        velocityRange: { x: [-80, 80], y: [80, 160], z: [-80, 80] },
                        gravity: 50,
                        drag: 0.95,
                        blending: 'additive'
                    }
                ]
            });

            // Mind control ring around target
            this.game.gameManager.call('createParticles', {
                position: new THREE.Vector3(targetPos.x, targetPos.y + 10, targetPos.z),
                count: 20,
                lifetime: 0.8,
                visual: {
                    color: 0x9932cc,
                    colorRange: { start: 0xda70d6, end: 0x8a2be2 },
                    scale: 10,
                    scaleMultiplier: 1.2,
                    fadeOut: true,
                    blending: 'additive'
                },
                velocityRange: { x: [-15, 15], y: [20, 60], z: [-15, 15] },
                gravity: -40,
                drag: 0.94,
                emitterShape: 'ring',
                emitterRadius: 30
            });
        }

        // Clean up beams
        this.clearAllBeamsForTarget(targetId);

        // Remove from pending controls
        this.pendingControls.delete(targetId);

        // DESYNC SAFE: Schedule the mind control to expire
        this.game.schedulingSystem.scheduleAction(() => {
            this.expireMindControl(targetId, controlData.originalTeam);
        }, this.controlDuration, null);
    }

    // DESYNC SAFE: Cancel mind control attempt
    cancelMindControl(targetId) {
        const controlData = this.pendingControls.get(targetId);
        if (!controlData) return;

        // Cancel scheduled completion if it exists
        if (controlData.scheduledActionId) {
            this.game.schedulingSystem.cancelAction(controlData.scheduledActionId);
        }

        // Clean up beams
        this.clearAllBeamsForTarget(targetId);

        // Remove from pending controls
        this.pendingControls.delete(targetId);
    }

    // DESYNC SAFE: Expire mind control effect
    expireMindControl(targetId, originalTeam) {
        const targetTeam = this.game.getComponent(targetId, "team");
        const transform = this.game.getComponent(targetId, "transform");
        const targetPos = transform?.position;
        
        if (!targetTeam) return; // Target might be dead

        // Restore original team
        targetTeam.team = originalTeam;

        // Visual effect for mind control ending
        if (targetPos) {
            this.createVisualEffect(targetPos, 'control', { count: 2 });
        }

    
    }

    // DESYNC SAFE: Create visual beam effect
    createBeam(casterId, targetId) {
        // Only create visual beams on client
        if (this.game.isServer) return;

        const casterTransform = this.game.getComponent(casterId, "transform");
        const casterPos = casterTransform?.position;
        const targetTransform = this.game.getComponent(targetId, "transform");
        const targetPos = targetTransform?.position;

        if (!casterPos || !targetPos || !this.game.effectsSystem) return;

        // Create beam using the effects system
        const beamEffect = this.game.effectsSystem.createEnergyBeam(
            new THREE.Vector3(casterPos.x, casterPos.y + 15, casterPos.z),
            new THREE.Vector3(targetPos.x, targetPos.y + 10, targetPos.z),
            {
                style: { color: 0x8A2BE2, linewidth: 3 },
                animation: { duration: 2000, pulseEffect: true }
            }
        );

        // Track beam for cleanup
        if (!this.beamRegistry.has(targetId)) {
            this.beamRegistry.set(targetId, { beams: new Map() });
        }

        this.beamRegistry.get(targetId).beams.set(casterId, beamEffect);
    }

    // DESYNC SAFE: Clear all beams for a target
    clearAllBeamsForTarget(targetId) {
        const entry = this.beamRegistry.get(targetId);
        if (!entry) return;

        // Clean up all beams for this target
        for (const [casterId, beamEffect] of entry.beams.entries()) {
            if (beamEffect && this.game.scene) {
                try {
                    this.game.scene.remove(beamEffect);
                    if (beamEffect.geometry) beamEffect.geometry.dispose();
                    if (beamEffect.material) beamEffect.material.dispose();
                } catch (error) {
                    console.warn('Error cleaning up beam:', error);
                }
            }
        }

        this.beamRegistry.delete(targetId);
    }

    // DESYNC SAFE: Clear specific beam
    clearBeam(casterId, targetId) {
        const entry = this.beamRegistry.get(targetId);
        if (!entry) return;

        const beamEffect = entry.beams.get(casterId);
        if (beamEffect && this.game.scene) {
            try {
                this.game.scene.remove(beamEffect);
                if (beamEffect.geometry) beamEffect.geometry.dispose();
                if (beamEffect.material) beamEffect.material.dispose();
            } catch (error) {
                console.warn('Error cleaning up specific beam:', error);
            }
        }

        entry.beams.delete(casterId);
        
        // If no more beams for this target, remove the entry
        if (entry.beams.size === 0) {
            this.beamRegistry.delete(targetId);
        }
    }

    // DESYNC SAFE: Handle when a caster dies or becomes invalid
    onCasterDeath(casterId) {
        // Remove from all pending controls
        for (const [targetId, controlData] of this.pendingControls.entries()) {
            if (controlData.contributors.has(casterId)) {
                controlData.contributors.delete(casterId);
                
                // Clear the beam for this caster
                this.clearBeam(casterId, targetId);
                
                // If no contributors left, cancel the mind control
                if (controlData.contributors.size === 0) {
                    this.cancelMindControl(targetId);
                }
            }
        }
    }

    // DESYNC SAFE: Handle when a target dies
    onTargetDeath(targetId) {
        // Clean up any pending mind control
        this.cancelMindControl(targetId);
    }

    // DESYNC SAFE: System cleanup
    destroy() {
        // Cancel all pending controls
        for (const [targetId, controlData] of this.pendingControls.entries()) {
            if (controlData.scheduledActionId) {
                this.game.schedulingSystem.cancelAction(controlData.scheduledActionId);
            }
        }
        this.pendingControls.clear();

        // Clean up all beams
        for (const [targetId] of this.beamRegistry.entries()) {
            this.clearAllBeamsForTarget(targetId);
        }
        this.beamRegistry.clear();
    }
}