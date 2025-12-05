class EffectsSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game); 
        this.game.effectsSystem = this;
        
        // Screen effect tracking
        this.screenEffects = [];
        this.shakeActive = false;
        this.flashActive = false;
        
        // UI notifications
        this.notifications = [];
        
        // Single array for all active effects with unified update loop
        this.activeEffects = [];
        
        // Object pools for reuse
        this.geometryPool = new Map(); // type -> geometry[]
        this.materialPool = new Map(); // key -> material[]
        this.effectPool = []; // Reusable effect objects        
        this.activeAuras = new Map();
        
        // Batching system
        this.batchedEffects = new Map(); // type -> effects[]
        
        this.shakeData = null;
        this.flashData = null;
        // Performance tracking
        this.stats = {
            activeEffects: 0,
            pooledObjects: 0
        };
    }

    init() {
        // Register methods with GameManager
        this.game.gameManager.register('createParticleEffect', this.createParticleEffect.bind(this));
        this.game.gameManager.register('clearAllEffects', this.clearAllEffects.bind(this));
        this.game.gameManager.register('showNotification', this.showNotification.bind(this));
        this.game.gameManager.register('createLineEffect', this.createLineEffect.bind(this));
        this.game.gameManager.register('createLightningBolt', this.createLightningBolt.bind(this));
        this.game.gameManager.register('createEnergyBeam', this.createEnergyBeam.bind(this));
        this.game.gameManager.register('playScreenShake', this.playScreenShake.bind(this));
        this.game.gameManager.register('playScreenFlash', this.playScreenFlash.bind(this));
        this.game.gameManager.register('initializeEffectsSystem', this.initialize.bind(this));
    }

    initialize() {
        this.addEffectsCSS();
    }
    
    // Batch process all effects using game time
    updateAllEffects() {
        if (!this.game.state) return;
        
        const currentTime = this.game.state.now;
        if (!currentTime) return;
        
        const toRemove = [];
        
        for (let i = this.activeEffects.length - 1; i >= 0; i--) {
            const effect = this.activeEffects[i];
            const elapsed = currentTime - effect.startTime;
            const progress = elapsed / effect.duration;
            
            if (progress >= 1) {
                toRemove.push(i);
                continue;
            }
            
            this.updateEffect(effect, elapsed, progress);
        }
        
        // Remove completed effects and return to pool
        toRemove.forEach(index => {
            const effect = this.activeEffects[index];
            this.recycleEffect(effect);
            this.activeEffects.splice(index, 1);
        });
        
        this.stats.activeEffects = this.activeEffects.length;
    }
    
    updateEffect(effect, elapsed, progress) {
        const { material, animation } = effect;
        
        // Batch similar updates together
        switch (effect?.animationType) {
            case 'flicker':
                this.updateFlickerEffect(effect, elapsed, animation);
                break;
            case 'pulse':
                this.updatePulseEffect(effect, elapsed, animation);
                break;
            case 'fade':
                this.updateFadeEffect(effect, progress, animation);
                break;
        }
    }
    
    updateFlickerEffect(effect, elapsed, animation) {
        if (animation?.flickerCount > 0 && effect?.flickerCount < animation?.flickerCount) {
            if (elapsed % animation.flickerSpeed < animation.flickerSpeed / 2) {
                if (animation.opacityFlicker) {
                    effect.material.opacity = Math.random() * 0.6 + 0.4;
                }
                if (animation.colorFlicker) {
                    const colors = [0x00ddff, 0x88aaff, 0xaaffff];
                    effect.material.color.setHex(colors[Math.floor(Math.random() * colors.length)]);
                }
                effect.flickerCount++;
            }
        }
    }
    
    updatePulseEffect(effect, elapsed, animation) {
        if (animation?.pulseEffect) {
            const pulseIntensity = Math.sin(elapsed * 0.01) * 0.3 + 0.7;
            effect.material.opacity = pulseIntensity;
        }
    }
    
    updateFadeEffect(effect, progress, animation) {
        if (animation?.fadeOut && progress > 0.7) {
            const fadeProgress = (progress - 0.7) / 0.3;
            effect.material.opacity = effect.originalOpacity * (1 - fadeProgress);
        }
    }
    
    // Object pooling system
    getPooledGeometry(type, points) {
        const poolKey = `${type}_${points.length}`;
        let pool = this.geometryPool.get(poolKey);
        
        if (!pool) {
            pool = [];
            this.geometryPool.set(poolKey, pool);
        }
        
        if (pool.length > 0) {
            const geometry = pool.pop();
            geometry.setFromPoints(points);
            geometry.computeBoundingSphere();
            return geometry;
        }
        
        return new THREE.BufferGeometry().setFromPoints(points);
    }
    
    getPooledMaterial(config) {
        const poolKey = `${config.color}_${config.linewidth}_${config.blending}`;
        let pool = this.materialPool.get(poolKey);
        
        if (!pool) {
            pool = [];
            this.materialPool.set(poolKey, pool);
        }
        
        if (pool.length > 0) {
            const material = pool.pop();
            material.opacity = config.opacity || 1.0;
            material.color.setHex(config.color || 0xffffff);
            return material;
        }
        
        return new THREE.LineBasicMaterial({
            color: config.color || 0xffffff,
            linewidth: config.linewidth || 2,
            transparent: true,
            opacity: config.opacity || 1.0,
            blending: config.blending || THREE.AdditiveBlending
        });
    }
    
    getPooledEffect() {
        if (this.effectPool.length > 0) {
            return this.effectPool.pop();
        }
        
        return {
            line: null,
            geometry: null,
            material: null,
            startTime: 0,
            duration: 0,
            flickerCount: 0,
            originalOpacity: 1,
            animationType: null
        };
    }
    
    recycleEffect(effect) {
        if (!effect) return;
        
        try {
            // Remove from scene
            if (this.game?.scene && effect.line) {
                this.game.scene.remove(effect.line);
            }
            
            // Return to pools
            if (effect.geometry) {
                const poolKey = `${effect.type}_${effect.geometry.attributes.position.count}`;
                let pool = this.geometryPool.get(poolKey);
                if (!pool) {
                    pool = [];
                    this.geometryPool.set(poolKey, pool);
                }
                if (pool.length < 10) { // Limit pool size
                    pool.push(effect.geometry);
                }
            }
            
            if (effect.material) {
                const poolKey = `${effect.material.color.getHex()}_${effect.material.linewidth}_${effect.material.blending}`;
                let pool = this.materialPool.get(poolKey);
                if (!pool) {
                    pool = [];
                    this.materialPool.set(poolKey, pool);
                }
                if (pool.length < 10) { // Limit pool size
                    pool.push(effect.material);
                }
            }
            
            // Reset effect object and return to pool
            effect.line = null;
            effect.geometry = null;
            effect.material = null;
            effect.startTime = 0;
            effect.duration = 0;
            effect.flickerCount = 0;
            effect.originalOpacity = 1;
            effect.animationType = null;
            
            if (this.effectPool.length < 50) { // Limit pool size
                this.effectPool.push(effect);
            }
            
        } catch (e) {
            console.warn('recycleEffect error:', e);
        }
    }
    
    // Main line effect creation (same interface, better performance)
    createLineEffect(config) {
        if (!this.game.scene) return null;
        
        const {
            startPos,
            endPos,
            type = 'lightning',
            style = {},
            animation = {}
        } = config;
        
        const lineConfig = this.getLineEffectConfig(type);
        const mergedStyle = { ...lineConfig.style, ...style };
        const mergedAnimation = { ...lineConfig.animation, ...animation };
        
        // Generate path based on type
        const points = this.generateLinePath(startPos, endPos, type, mergedStyle);
        
        // Use pooled objects
        const geometry = this.getPooledGeometry(type, points);
        const material = this.getPooledMaterial(mergedStyle);
        const effect = this.getPooledEffect();
        
        // Create line object
        const lineEffect = new THREE.Line(geometry, material);
        this.game.scene.add(lineEffect);
        
        // Setup effect tracking
        effect.line = lineEffect;
        effect.geometry = geometry;
        effect.material = material;
        effect.startTime = this.game.state.now;
        effect.duration = mergedAnimation.duration || 1000;
        effect.originalOpacity = material.opacity;
        effect.type = type;
        
        // Determine animation type for efficient batching
        if (mergedAnimation.flickerCount > 0) {
            effect.animationType = 'flicker';
        } else if (mergedAnimation.pulseEffect) {
            effect.animationType = 'pulse';
        } else if (mergedAnimation.fadeOut) {
            effect.animationType = 'fade';
        }
        
        this.activeEffects.push(effect);
        
        return effect;
    }
    
    // Batch creation for multiple effects
    createBatchedEffects(effects) {
        const results = [];
        
        for (const config of effects) {
            const effect = this.createLineEffect(config);
            if (effect) {
                results.push(effect);
            }
        }
        
        return results;
    }
    
    // Keep existing interface methods unchanged
    createLightningBolt(startPos, endPos, options = {}) {
        return this.createLineEffect({
            startPos,
            endPos,
            type: 'lightning',
            style: options.style || {},
            animation: options.animation || {}
        });
    }
    
    createEnergyBeam(startPos, endPos, options = {}) {
        return this.createLineEffect({
            startPos,
            endPos,
            type: 'beam',
            style: options.style || {},
            animation: options.animation || {}
        });
    }
    
    createMagicArc(startPos, endPos, options = {}) {
        return this.createLineEffect({
            startPos,
            endPos,
            type: 'arc',
            style: options.style || {},
            animation: options.animation || {}
        });
    }
    
    createChainLink(startPos, endPos, options = {}) {
        return this.createLineEffect({
            startPos,
            endPos,
            type: 'chain',
            style: options.style || {},
            animation: options.animation || {}
        });
    }
    
    // Line effect configuration (unchanged)
    getLineEffectConfig(type) {
        const configs = {
            lightning: {
                style: {
                    color: 0x88aaff,
                    linewidth: 3,
                    opacity: 0.9,
                    blending: THREE.AdditiveBlending,
                    segments: 8,
                    deviation: 15,
                    jaggedIntensity: 1.2
                },
                animation: {
                    duration: 0.3,
                    flickerCount: 3,
                    flickerSpeed: 50,
                    opacityFlicker: true,
                    colorFlicker: true,
                    fadeOut: true
                }
            },
            beam: {
                style: {
                    color: 0xff4444,
                    linewidth: 4,
                    opacity: 0.8,
                    blending: THREE.AdditiveBlending,
                    segments: 3,
                    deviation: 2,
                    jaggedIntensity: 0.1
                },
                animation: {
                    duration: 0.5,
                    pulseEffect: true,
                    fadeOut: true
                }
            },
            arc: {
                style: {
                    color: 0x44ff44,
                    linewidth: 2,
                    opacity: 0.7,
                    blending: THREE.AdditiveBlending,
                    segments: 12,
                    deviation: 25,
                    jaggedIntensity: 0.3,
                    arcHeight: 30
                },
                animation: {
                    duration: 0.8,
                    fadeOut: true
                }
            },
            chain: {
                style: {
                    color: 0xffaa00,
                    linewidth: 3,
                    opacity: 0.9,
                    blending: THREE.AdditiveBlending,
                    segments: 6,
                    deviation: 8,
                    jaggedIntensity: 0.8
                },
                animation: {
                    duration: 0.6,
                    flickerCount: 2,
                    flickerSpeed: 80,
                    fadeOut: true
                }
            }
        };
        
        return configs[type] || configs.lightning;
    }
    
    // Path generation (unchanged but more efficient)
    generateLinePath(start, end, type, style) {
        const points = [start.clone()];
        const segments = style.segments || 5;
        const deviation = style.deviation || 10;
        const jaggedIntensity = style.jaggedIntensity || 1;
        
        // Different path generation based on type
        if (type === 'arc') {
            return this.generateArcPath(start, end, style.arcHeight || 20, segments);
        }
        
        for (let i = 1; i < segments; i++) {
            const t = i / segments;
            const basePos = start.clone().lerp(end, t);
            
            // Add jagged deviation
            if (deviation > 0 && jaggedIntensity > 0) {
                const actualDeviation = deviation * jaggedIntensity;
                basePos.x += (Math.random() - 0.5) * actualDeviation;
                basePos.y += (Math.random() - 0.5) * actualDeviation * 0.5;
                basePos.z += (Math.random() - 0.5) * actualDeviation;
            }
            
            points.push(basePos);
        }
        
        points.push(end.clone());
        return points;
    }
    
    generateArcPath(start, end, height, segments) {
        const points = [];
        const midPoint = start.clone().lerp(end, 0.5);
        midPoint.y += height;
        
        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            const point = this.quadraticBezier(start, midPoint, end, t);
            points.push(point);
        }
        
        return points;
    }
    
    quadraticBezier(p0, p1, p2, t) {
        const point = new THREE.Vector3();
        point.x = (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * p1.x + t * t * p2.x;
        point.y = (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * p1.y + t * t * p2.y;
        point.z = (1 - t) * (1 - t) * p0.z + 2 * (1 - t) * t * p1.z + t * t * p2.z;
        return point;
    }
    
    // Clear effects efficiently
    clearAllEffects() {
        // Clear all active line effects
        for (const effect of this.activeEffects) {
            this.recycleEffect(effect);
        }
        this.activeEffects = [];
        
        // Clear all active auras
        if (this.activeAuras) {
            this.activeAuras.clear();
        }

        // Clear particle effects
        this.game.gameManager.call('clearAllParticles');

        // Clear notifications
        this.notifications.forEach(notification => {
            this.removeNotification(notification);
        });
        
        this.shakeActive = false;
        this.flashActive = false;
    }
    
    // Force cleanup with pool clearing
    forceCleanup() {
        this.clearAllEffects();
        
        // Clear pools
        for (const [key, pool] of this.geometryPool) {
            pool.forEach(geo => geo.dispose());
            pool.length = 0;
        }
        
        for (const [key, pool] of this.materialPool) {
            pool.forEach(mat => mat.dispose());
            pool.length = 0;
        }
        
        this.effectPool.length = 0;
        this.stats.pooledObjects = 0;
    }
    
    // Performance monitoring
    getPerformanceStats() {
        const poolSize = Array.from(this.geometryPool.values()).reduce((sum, pool) => sum + pool.length, 0) +
                        Array.from(this.materialPool.values()).reduce((sum, pool) => sum + pool.length, 0) +
                        this.effectPool.length;
        
        this.stats.pooledObjects = poolSize;
        
        return {
            ...this.stats,
            memoryUsage: {
                geometryPools: this.geometryPool.size,
                materialPools: this.materialPool.size,
                effectPool: this.effectPool.length
            }
        };
    }
    
    // Keep all existing particle and screen effect methods unchanged
    getEffectConfig(effectType) {
        const configs = {
            victory: {
                count: 5,
                shape: 'star',
                color: 0x00ff00,
                colorRange: { start: 0x00ff00, end: 0xffff00 },
                lifetime: 1.5,
                velocity: { speed: 8, spread: 0.5, pattern: 'burst' },
                scale: 2,
                scaleVariation: 0.3,
                physics: { gravity: -0.5, drag: 0.99 },
                rotation: { enabled: true, speed: 5 },
                visual: { fadeOut: true, scaleOverTime: true, blending: 'additive' }
            },
            defeat: {
                count: 8,
                shape: 'spark',
                color: 0xff0000,
                colorRange: { start: 0xff0000, end: 0x440000 },
                lifetime: 2,
                velocity: { speed: 6, spread: 0.8, pattern: 'burst' },
                scale: 1.5,
                scaleVariation: 0.4,
                physics: { gravity: 0.3, drag: 0.95 },
                rotation: { enabled: true, speed: 3 },
                visual: { fadeOut: true, scaleOverTime: false, blending: 'normal' }
            },
            levelup: {
                count: 12,
                shape: 'glow',
                color: 0xffaa00,
                colorRange: { start: 0xffaa00, end: 0xffffff },
                lifetime: 2.5,
                velocity: { speed: 4, spread: 0.3, pattern: 'fountain' },
                scale: 3,
                scaleVariation: 0.2,
                physics: { gravity: -0.2, drag: 0.98 },
                rotation: { enabled: false },
                visual: { fadeOut: true, scaleOverTime: true, blending: 'additive' }
            }
        };
        
        return configs[effectType] || configs.victory;
    }
    
    // Screen effects (unchanged)
    playScreenShake(duration = 0.3, intensity = 2) {
        if (this.shakeActive) return;
        
        const gameContainer = document.getElementById('gameContainer');
        if (!gameContainer) return;
        
        this.shakeActive = true;
        this.shakeData = {
            startTime: this.game.state.now,
            duration: duration, 
            intensity: intensity,
            originalTransform: gameContainer.style.transform
        };
    }

    playScreenFlash(color = '#ffffff', duration = 0.3) {
        // Disabled for now
        // if (this.flashActive) return;
        // return;
        // this.flashActive = true;
        // const flash = document.createElement('div');
        // flash.className = 'screen-flash';
        // flash.style.cssText = `
        //     position: fixed;
        //     top: 0;
        //     left: 0;
        //     width: 100%;
        //     height: 100%;
        //     background-color: ${color};
        //     pointer-events: none;
        //     z-index: 999;
        //     opacity: 0.6;
        // `;
        
        // document.body.appendChild(flash);
        
        // // Store flash data for game loop processing
        // this.flashData = {
        //     element: flash,
        //     startTime: this.game.state.now,
        //     duration: duration,
        //     startOpacity: 0.6
        // };
    }
    
    // Particle effects - delegate to particle system
    createParticleEffect(x, y, z, type, options = {}) {
        // Convert to the config format that ParticleSystem.createParticles expects
        const config = {
            position: new THREE.Vector3(x, y, z),
            count: options.count || 3,
            shape: options.shape || 'circle',
            color: options.color || 0xffffff,
            colorRange: options.colorRange || null,
            lifetime: options.lifetime || 1.5,
            velocity: options.velocity || { speed: 5, spread: 1, pattern: 'burst' },
            scale: (options.scaleMultiplier || 1) * 1.0,
            scaleVariation: options.scaleVariation || 0.5,
            physics: options.physics || { gravity: 0.5, drag: 0.98 },
            rotation: options.rotation || { enabled: false, speed: 0 },
            visual: options.visual || { fadeOut: true, scaleOverTime: true, blending: 'additive' }
        };

        this.game.gameManager.call('createParticles', config);
    }
    
    showVictoryEffect(x, y, z, options = {}) {
        this.createParticleEffect(x, y, z, 'victory', options);
        this.playScreenFlash('#44ff44', 0.3);
        this.showGameNotification('Victory!', 'You won!', 'success', 2000);
    }
    
    showDefeatEffect(x, y, z, options = {}) {
        this.createParticleEffect(x, y, z, 'defeat', options);
        this.playScreenFlash('#ff4444', 0.5);
        this.showGameNotification('Defeat!', 'You lost!', 'error', 2000);
    }
    
    showExplosionEffect(x, y, z, options = {}) {
        this.createParticleEffect(x, y, z, 'explosion', options);
        this.playScreenShake(0.2, 3);
    }
    
    showHealEffect(x, y, z, options = {}) {
        this.createParticleEffect(x, y, z, 'heal', options);
    }
    
    showMagicEffect(x, y, z, options = {}) {
        this.createParticleEffect(x, y, z, 'magic', options);
    }
    
    showDamageEffect(x, y, z, options = {}) {
        this.createParticleEffect(x, y, z, 'damage', options);
    }
    
    showLevelUpEffect(x, y, z, options = {}) {
        this.createParticleEffect(x, y, z, 'levelup', options);
        this.playScreenShake(0.4, 1);
        this.showGameNotification('Level Up!', 'Character advanced!', 'success', 3000);
    }
    
    // Missing method that abilities are calling
    createAuraEffect(x, y, z, type, duration) {
        if (!this.game.particleSystem) return;
        const auraId = `aura_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const startTime = this.game.state.now;
        const position = new THREE.Vector3(x, y, z);
        
        // Create aura configuration
        const config = this.getEffectConfig(type);
        const auraData = {
            id: auraId,
            position: position.clone(),
            type: type,
            startTime: startTime,
            duration: duration,
            lastParticleTime: startTime,
            particleInterval: 1, // 1 second between particle bursts
            isActive: true,
            config: {
                count: 4,
                shape: 'circle',
                color: config.color || 0xffffff,
                colorRange: config.colorRange || null,
                lifetime: 2.0,
                velocity: { speed: 2, spread: 0.8, pattern: 'burst' },
                scale: (config.scale || 1) * 0.8,
                scaleVariation: 0.3,
                physics: { gravity: -0.1, drag: 0.98 },
                rotation: { enabled: true, speed: 1 },
                visual: { fadeOut: true, scaleOverTime: true, blending: 'additive' }
            }
        };
        
        // Add to active auras tracking
        if (!this.activeAuras) {
            this.activeAuras = new Map();
        }
        this.activeAuras.set(auraId, auraData);
        
        return auraId;
    }
    
    // Missing methods that were in the original EffectsSystem
    showNotification(message, type = 'info', duration = 3000) {
        const notification = document.createElement('div');
        notification.className = `game-notification notification-${type}`;
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 1rem 1.5rem;
            border-radius: 8px;
            color: white;
            font-family: 'Courier New', monospace;
            font-weight: bold;
            z-index: 1000;
            animation: notificationSlideIn 0.5s ease-out;
            max-width: 300px;
            word-wrap: break-word;
        `;
        
        switch (type) {
            case 'victory':
                notification.style.background = 'linear-gradient(145deg, #001100, #003300)';
                notification.style.border = '2px solid #00ff00';
                notification.style.color = '#00ff00';
                notification.style.textShadow = '0 0 10px rgba(0, 255, 0, 0.5)';
                break;
            case 'defeat':
                notification.style.background = 'linear-gradient(145deg, #110000, #330000)';
                notification.style.border = '2px solid #ff0000';
                notification.style.color = '#ff4444';
                notification.style.textShadow = '0 0 10px rgba(255, 68, 68, 0.5)';
                break;
            case 'levelup':
                notification.style.background = 'linear-gradient(145deg, #111100, #333300)';
                notification.style.border = '2px solid #ffd700';
                notification.style.color = '#ffd700';
                notification.style.textShadow = '0 0 10px rgba(255, 215, 0, 0.5)';
                break;
            default:
                notification.style.background = 'linear-gradient(145deg, #001122, #003344)';
                notification.style.border = '2px solid #00aaff';
                notification.style.color = '#00aaff';
                notification.style.textShadow = '0 0 10px rgba(0, 170, 255, 0.5)';
        }
        
        document.body.appendChild(notification);
        this.notifications.push(notification);
        this.repositionNotifications();
        
        setTimeout(() => {
            this.removeNotification(notification);
        }, duration);
    }
    
    showGameNotification(title, message, type = 'info', duration = 3000) {
        const notification = document.createElement('div');
        notification.className = `game-notification notification-${type}`;
        notification.innerHTML = `
            <div style="font-weight: bold; margin-bottom: 5px;">${title}</div>
            <div>${message}</div>
        `;
        
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 15px;
            border-radius: 8px;
            border-left: 4px solid ${this.getNotificationColor(type)};
            max-width: 300px;
            z-index: 1001;
            animation: notificationSlideIn 0.3s ease-out;
        `;
        
        document.body.appendChild(notification);
        this.notifications.push(notification);
        
        setTimeout(() => {
            notification.style.animation = 'notificationSlideOut 0.3s ease-out forwards';
            setTimeout(() => {
                if (document.body.contains(notification)) {
                    document.body.removeChild(notification);
                    const index = this.notifications.indexOf(notification);
                    if (index > -1) {
                        this.notifications.splice(index, 1);
                    }
                }
            }, 300);
        }, duration);
    }
    
    getNotificationColor(type) {
        const colors = {
            info: '#4444ff',
            success: '#44ff44',
            warning: '#ffaa00',
            error: '#ff4444'
        };
        return colors[type] || '#4444ff';
    }
    
    removeNotification(notification) {
        if (document.body.contains(notification)) {
            notification.style.animation = 'notificationSlideOut 0.3s ease-out forwards';
            setTimeout(() => {
                if (document.body.contains(notification)) {
                    document.body.removeChild(notification);
                }
                const index = this.notifications.indexOf(notification);
                if (index > -1) {
                    this.notifications.splice(index, 1);
                }
                this.repositionNotifications();
            }, 300);
        }
    }
    
    repositionNotifications() {
        this.notifications.forEach((notification, index) => {
            notification.style.top = `${20 + index * 80}px`;
        });
    }
    
    getDamageColor(type) {
        switch (type) {
            case 'heal': return 0x00ff88;
            case 'critical': return 0xff0044;
            case 'poison': return 0x8a2be2;
            case 'fire': return 0xff4400;
            case 'cold': return 0x00bfff;
            case 'lightning': return 0xffff00;
            case 'divine': return 0xffd700;
            default: return 0xff4444;
        }
    }
    
    addEffectsCSS() {
        const style = document.createElement('style');
        style.id = 'effects-styles';
        style.textContent = `
            .screen-flash {
                transition: opacity 0.3s ease-out;
            }
            
            @keyframes battleStartTransition {
                0% { transform: translateX(-100%); }
                100% { transform: translateX(100%); }
            }
            
            @keyframes flashFade {
                0% { opacity: 0.6; }
                100% { opacity: 0; }
            }
            
            @keyframes notificationSlideIn {
                from { 
                    transform: translateX(100%);
                    opacity: 0; 
                }
                to { 
                    transform: translateX(0);
                    opacity: 1; 
                }
            }
            
            @keyframes notificationSlideOut {
                from { 
                    transform: translateX(0);
                    opacity: 1; 
                }
                to { 
                    transform: translateX(100%);
                    opacity: 0; 
                }
            }
            
            .game-notification {
                box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
                backdrop-filter: blur(5px);
            }
        `;
        document.head.appendChild(style);
    }
    
    // Main update method called by game loop
    update() {
        this.updateAllEffects();
        this.updateAuras(); 
        this.updateScreenEffects();
    }
    
    updateAuras() {
        if (!this.activeAuras || !this.game.state) return;
        
        const currentTime = this.game.state.now;
        const aurasToRemove = [];
        
        for (const [auraId, auraData] of this.activeAuras) {
            const elapsed = currentTime - auraData.startTime;
            
            // Check if aura has expired
            if (elapsed >= auraData.duration) {
                aurasToRemove.push(auraId);
                continue;
            }
            
            // Check if it's time to create new particles
            const timeSinceLastParticle = currentTime - auraData.lastParticleTime;
            if (timeSinceLastParticle >= auraData.particleInterval) {
                this.createAuraParticles(auraData);
                auraData.lastParticleTime = currentTime;
            }
        }
        
        // Remove expired auras
        aurasToRemove.forEach(auraId => {
            this.activeAuras.delete(auraId);
        });
    }
    
    updateScreenEffects() {
        // Handle screen shake
        if (this.shakeActive && this.shakeData) {
            const gameContainer = document.getElementById('gameContainer');
            if (!gameContainer) {
                this.shakeActive = false;
                return;
            }
            
            const elapsed = this.game.state.now - this.shakeData.startTime;
            const progress = elapsed / this.shakeData.duration;
            
            if (progress >= 1) {
                gameContainer.style.transform = this.shakeData.originalTransform;
                this.shakeActive = false;
                this.shakeData = null;
            } else {
                const diminishingIntensity = this.shakeData.intensity * (1 - progress);
                const shakeX = (Math.random() - 0.5) * diminishingIntensity;
                const shakeY = (Math.random() - 0.5) * diminishingIntensity;
                gameContainer.style.transform = `translate(${shakeX}px, ${shakeY}px)`;
            }
        }
        
        // Handle screen flash
        if (this.flashActive && this.flashData) {
            const elapsed = this.game.state.now - this.flashData.startTime;
            const progress = elapsed / this.flashData.duration;
            
            if (progress >= 1) {
                // Flash finished
                if (document.body.contains(this.flashData.element)) {
                    document.body.removeChild(this.flashData.element);
                }
                this.flashActive = false;
                this.flashData = null;
            } else {
                // Fade out the flash
                const opacity = this.flashData.startOpacity * (1 - progress);
                this.flashData.element.style.opacity = opacity;
            }
        }
    }
    
    createAuraParticles(auraData) {
        const particleConfig = {
            position: auraData.position,
            ...auraData.config
        };

        this.game.gameManager.call('createParticles', particleConfig);
    }
    
    destroy() {
        this.forceCleanup();
        
        // Clean up damage number system
        if (this.damageNumberMesh) {
            this.game.scene.remove(this.damageNumberMesh);
            this.damageTextGeometry.dispose();
            this.damageTextMaterial.dispose();
            this.damageTexture.dispose();
        }
        
        const styleElement = document.querySelector('#effects-styles');
        if (styleElement) {
            styleElement.remove();
        }
        
    }
    
    entityDestroyed(entityId) {
        // Clean up any auras associated with this entity
        if (this.activeAuras) {
            const aurasToRemove = [];
            for (const [auraId, auraData] of this.activeAuras) {
                if (auraData.sourceEntityId === entityId || auraData.targetEntityId === entityId) {
                    aurasToRemove.push(auraId);
                }
            }
            aurasToRemove.forEach(auraId => this.activeAuras.delete(auraId));
        }

        // Clean up any particle effects tracking
        if (this.entityEffects) {
            this.entityEffects.delete(entityId);
        }
    }

    /**
     * Called when scene is unloaded - cleanup all effect resources
     */
    onSceneUnload() {
        this.forceCleanup();

        // Clear notifications
        this.notifications.forEach(notification => {
            if (document.body.contains(notification)) {
                document.body.removeChild(notification);
            }
        });
        this.notifications = [];

        // Reset screen effects
        this.shakeActive = false;
        this.flashActive = false;
        this.shakeData = null;
        this.flashData = null;

        // Remove CSS styles
        const styleElement = document.querySelector('#effects-styles');
        if (styleElement) {
            styleElement.remove();
        }

        console.log('[EffectsSystem] Scene unloaded - resources cleaned up');
    }
}