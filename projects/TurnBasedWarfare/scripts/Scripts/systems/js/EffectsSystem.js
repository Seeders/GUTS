class EffectsSystem extends engine.BaseSystem {
    constructor(game) {
        super(game); 
        this.game.effectsSystem = this;
        
        // Screen effect tracking
        this.screenEffects = [];
        this.shakeActive = false;
        this.flashActive = false;
        
        // UI notifications
        this.notifications = [];
        
        // Line effects tracking
        this.activeLineEffects = [];
        
        this.effectOffset = { x: 0, y: 75, z: 0 };
    }
    
    initialize() {
        this.addEffectsCSS();
        console.log('EffectsSystem initialized');
    }
    
    // === LINE EFFECTS SYSTEM ===
    
    /**
     * Create a line effect between two points
     * @param {Object} config - Line effect configuration
     * @param {THREE.Vector3} config.startPos - Starting position
     * @param {THREE.Vector3} config.endPos - Ending position
     * @param {string} config.type - Effect type ('lightning', 'beam', 'arc', 'chain')
     * @param {Object} config.style - Visual styling options
     * @param {Object} config.animation - Animation properties
     */
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
        
        // Create geometry and material
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({
            color: mergedStyle.color || 0xffffff,
            linewidth: mergedStyle.linewidth || 2,
            transparent: true,
            opacity: mergedStyle.opacity || 1.0,
            blending: mergedStyle.blending || THREE.AdditiveBlending
        });
        
        // Create line object
        const lineEffect = new THREE.Line(geometry, material);
        this.game.scene.add(lineEffect);
        
        // Store effect data
        const effectData = {
            line: lineEffect,
            material: material,
            geometry: geometry,
            type: type,
            startTime: Date.now(),
            duration: mergedAnimation.duration || 1000,
            animation: mergedAnimation
        };
        
        this.activeLineEffects.push(effectData);
        
        // Start animation
        this.animateLineEffect(effectData);
        
        return effectData;
    }
    
    getLineEffectConfig(type) {
        const configs = {
            lightning: {
                style: {
                    color: 0x00ddff,
                    linewidth: 3,
                    opacity: 1.0,
                    blending: THREE.AdditiveBlending,
                    segments: 8,
                    deviation: 15,
                    jaggedIntensity: 1.0
                },
                animation: {
                    duration: 800,
                    flickerCount: 6,
                    flickerSpeed: 80,
                    fadeOut: true,
                    colorFlicker: true,
                    opacityFlicker: true
                }
            },
            beam: {
                style: {
                    color: 0xff4400,
                    linewidth: 4,
                    opacity: 0.8,
                    blending: THREE.AdditiveBlending,
                    segments: 3,
                    deviation: 2,
                    jaggedIntensity: 0.1
                },
                animation: {
                    duration: 500,
                    flickerCount: 0,
                    flickerSpeed: 0,
                    fadeOut: true,
                    colorFlicker: false,
                    opacityFlicker: false,
                    pulseEffect: true
                }
            },
            arc: {
                style: {
                    color: 0x8800ff,
                    linewidth: 2,
                    opacity: 0.9,
                    blending: THREE.AdditiveBlending,
                    segments: 12,
                    deviation: 8,
                    jaggedIntensity: 0.3,
                    arcHeight: 20
                },
                animation: {
                    duration: 1200,
                    flickerCount: 3,
                    flickerSpeed: 100,
                    fadeOut: true,
                    colorFlicker: false,
                    opacityFlicker: true
                }
            },
            chain: {
                style: {
                    color: 0x00ffaa,
                    linewidth: 2,
                    opacity: 0.7,
                    blending: THREE.AdditiveBlending,
                    segments: 6,
                    deviation: 5,
                    jaggedIntensity: 0.5
                },
                animation: {
                    duration: 600,
                    flickerCount: 4,
                    flickerSpeed: 60,
                    fadeOut: true,
                    colorFlicker: true,
                    opacityFlicker: true,
                    travelEffect: true
                }
            }
        };
        
        return configs[type] || configs.lightning;
    }
    
    generateLinePath(startPos, endPos, type, style) {
        const points = [];
        const segments = style.segments || 8;
        const deviation = style.deviation || 10;
        const jaggedIntensity = style.jaggedIntensity || 1.0;
        const arcHeight = style.arcHeight || 0;
        
        // Apply effect offset
        const start = new THREE.Vector3(
            startPos.x + this.effectOffset.x,
            startPos.y + this.effectOffset.y,
            startPos.z + this.effectOffset.z
        );
        
        const end = new THREE.Vector3(
            endPos.x + this.effectOffset.x,
            endPos.y + this.effectOffset.y,
            endPos.z + this.effectOffset.z
        );
        
        points.push(start.clone());
        
        // Generate intermediate points
        for (let i = 1; i < segments; i++) {
            const progress = i / segments;
            
            // Base interpolated position
            const basePos = new THREE.Vector3().lerpVectors(start, end, progress);
            
            // Add arc height (parabolic curve)
            if (arcHeight > 0) {
                const arcOffset = Math.sin(progress * Math.PI) * arcHeight;
                basePos.y += arcOffset;
            }
            
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
    
    animateLineEffect(effectData) {
        const { animation, material, startTime } = effectData;
        let flickerCount = 0;
        
        const animate = () => {
            const elapsed = Date.now() - startTime;
            const progress = elapsed / animation.duration;
            
            // Check if effect should end
            if (progress >= 1) {
                this.removeLineEffect(effectData);
                return;
            }
            
            // Flickering animation
            if (animation.flickerCount > 0 && flickerCount < animation.flickerCount) {
                if (elapsed % animation.flickerSpeed < animation.flickerSpeed / 2) {
                    if (animation.opacityFlicker) {
                        material.opacity = Math.random() * 0.6 + 0.4;
                    }
                    if (animation.colorFlicker) {
                        const colors = [0x00ddff, 0x88aaff, 0xaaffff];
                        material.color.setHex(colors[Math.floor(Math.random() * colors.length)]);
                    }
                    flickerCount++;
                }
            }
            
            // Pulse effect
            if (animation.pulseEffect) {
                const pulseIntensity = Math.sin(elapsed * 0.01) * 0.3 + 0.7;
                material.opacity = pulseIntensity;
            }
            
            // Fade out
            if (animation.fadeOut && progress > 0.7) {
                const fadeProgress = (progress - 0.7) / 0.3;
                material.opacity *= (1 - fadeProgress);
            }
            
            requestAnimationFrame(animate);
        };
        
        animate();
    }
    
    removeLineEffect(effectData) {
        // Remove from scene
        this.game.scene.remove(effectData.line);
        
        // Dispose resources
        effectData.geometry.dispose();
        effectData.material.dispose();
        
        // Remove from active effects
        const index = this.activeLineEffects.indexOf(effectData);
        if (index > -1) {
            this.activeLineEffects.splice(index, 1);
        }
    }
    
    // Convenience methods for common line effects
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
    
    // === EXISTING PARTICLE EFFECTS ===
    // (keeping all existing particle effect methods unchanged)
    
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
                count: 2,
                shape: 'circle',
                color: 0xff4444,
                colorRange: { start: 0xff4444, end: 0xff0000 },
                lifetime: 10,
                velocity: { speed: 6, spread: 0.8, pattern: 'burst' },
                scale: 2,
                scaleVariation: 0.4,
                physics: { gravity: 0.8, drag: 0.98 },
                rotation: { enabled: false, speed: 0 },
                visual: { fadeOut: true, scaleOverTime: true, blending: 'additive' }
            },
            explosion: {
                count: 3,
                shape: 'circle',
                color: 0xffaa00,
                colorRange: { start: 0xffaa00, end: 0xff0000 },
                lifetime: 1.2,
                velocity: { speed: 10, spread: 0.6, pattern: 'sphere' },
                scale: 2,
                scaleVariation: 0.5,
                physics: { gravity: 1.0, drag: 0.96 },
                rotation: { enabled: true, speed: 8 },
                visual: { fadeOut: true, scaleOverTime: true, blending: 'additive' }
            },
            heal: {
                count: 5,
                shape: 'cross',
                color: 0x00ff88,
                colorRange: { start: 0x00ff88, end: 0x88ffaa },
                lifetime: 1.0,
                velocity: { speed: 3, spread: 0.2, pattern: 'cone' },
                scale: 2,
                scaleVariation: 0.3,
                physics: { gravity: -0.8, drag: 0.99 },
                rotation: { enabled: true, speed: 3 },
                visual: { fadeOut: true, scaleOverTime: true, blending: 'additive' }
            },
            magic: {
                count: 1,
                shape: 'star',
                color: 0x8800ff,
                colorRange: { start: 0x8800ff, end: 0xff88ff },
                lifetime: 2.0,
                velocity: { speed: 5, spread: 0.4, pattern: 'sphere' },
                scale: 2,
                scaleVariation: 0.4,
                physics: { gravity: 0.3, drag: 0.98 },
                rotation: { enabled: true, speed: 6 },
                visual: { fadeOut: true, scaleOverTime: true, blending: 'additive' }
            },
            damage: {
                count: 8,
                shape: 'circle',
                color: 0xff0000,
                lifetime: 6,
                velocity: { speed: 2, spread: 0.5, pattern: 'burst' },
                scale: 1,
                scaleVariation: 0.2,
                physics: { gravity: 0.5, drag: 0.98 },
                rotation: { enabled: false, speed: 0 },
                visual: { fadeOut: true, scaleOverTime: true, blending: 'additive' }
            },
            levelup: {
                count: 4,
                shape: 'star',
                color: 0xffd700,
                colorRange: { start: 0xffd700, end: 0xffa500 },
                lifetime: 2.5,
                velocity: { speed: 8, spread: 0.6, pattern: 'cone' },
                scale: 5,
                scaleVariation: 0.5,
                physics: { gravity: -0.4, drag: 0.98 },
                rotation: { enabled: true, speed: 4 },
                visual: { fadeOut: true, scaleOverTime: true, blending: 'additive' }
            }
        };
        
        return configs[effectType] || configs.damage;
    }
    
    // All existing particle effect methods remain unchanged...
    createParticleEffect(x, y, z, effectType, options = {}) {
        if (!this.game.particleSystem) return;
        
        const baseConfig = this.getEffectConfig(effectType);
        
        const config = {
            ...baseConfig,
            position: new THREE.Vector3(x + this.effectOffset.x, y + this.effectOffset.y, z + this.effectOffset.z),
            ...options
        };
        
        if (options.count !== undefined) config.count = options.count;
        if (options.speedMultiplier !== undefined) {
            config.velocity.speed *= options.speedMultiplier;
        }
        if (options.scaleMultiplier !== undefined) {
            config.scale *= options.scaleMultiplier;
        }
        if (options.color !== undefined) {
            config.color = options.color;
            config.colorRange = null;
        }
        
        this.game.particleSystem.createParticles(config);
    }
    
    // All other existing methods remain the same...
    showVictoryEffect(x, y, z, options = {}) {
        this.createParticleEffect(x, y, z, 'victory', options);
        this.playScreenShake(300, 2);
        this.showNotification('Victory!', 'victory', 2000);
    }
    
    showDefeatEffect(x, y, z, options = {}) {
        this.createParticleEffect(x, y, z, 'defeat', options);
        this.playScreenFlash('#ff4444', 500);
        this.showNotification('Defeat!', 'defeat', 2000);
    }
    
    showExplosionEffect(x, y, z, options = {}) {
        this.createParticleEffect(x, y, z, 'explosion', options);
        this.playScreenShake(200, 3);
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
        this.playScreenShake(400, 1);
        this.showNotification('Level Up!', 'levelup', 3000);
    }
    
    // Screen effects and other methods remain unchanged...
    playScreenShake(duration = 300, intensity = 2) {
        if (this.shakeActive) return;
        
        const gameContainer = document.getElementById('gameContainer');
        if (!gameContainer) return;
        
        this.shakeActive = true;
        const originalTransform = gameContainer.style.transform;
        let startTime = Date.now();
        
        const shake = () => {
            const elapsed = Date.now() - startTime;
            const progress = elapsed / duration;
            
            if (progress < 1) {
                const diminishingIntensity = intensity * (1 - progress);
                const shakeX = (Math.random() - 0.5) * diminishingIntensity;
                const shakeY = (Math.random() - 0.5) * diminishingIntensity;
                gameContainer.style.transform = `translate(${shakeX}px, ${shakeY}px)`;
                requestAnimationFrame(shake);
            } else {
                gameContainer.style.transform = originalTransform;
                this.shakeActive = false;
            }
        };
        
        shake();
    }
    
    playScreenFlash(color = '#ffffff', duration = 300) {
        if (this.flashActive) return;
        
        this.flashActive = true;
        const flash = document.createElement('div');
        flash.className = 'screen-flash';
        flash.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: ${color};
            pointer-events: none;
            z-index: 999;
            opacity: 0.6;
            animation: flashFade ${duration}ms ease-out forwards;
        `;
        
        document.body.appendChild(flash);
        
        setTimeout(() => {
            if (document.body.contains(flash)) {
                document.body.removeChild(flash);
            }
            this.flashActive = false;
        }, duration);
    }
    
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
    
    showDamageNumber(x, y, z, damage, type = 'damage') {
        if (this.game.particleSystem) {
            const config = this.getEffectConfig(type);
            const options = {
                ...config,
                position: new THREE.Vector3(x + this.effectOffset.x, y + this.effectOffset.y, z + this.effectOffset.z),
                count: 1,
                velocity: { ...config.velocity, speed: config.velocity.speed * 0.5 },
                scale: config.scale * 1.5
            };
            
            switch (type) {
                case 'heal':
                    options.shape = 'cross';
                    options.color = 0x00ff88;
                    break;
                case 'critical':
                    options.count = 5;
                    options.velocity.speed *= 0.6;
                    options.color = 0xff0044;
                    break;
            }
            
            this.game.particleSystem.createParticles(options);
        }
        
        this.createFloatingText(x, y, z, damage.toString(), type);
    }
    
    createFloatingText(worldX, worldY, worldZ, text, type = 'damage') {
        if (!this.game.camera) return;
        
        const vector = new THREE.Vector3(worldX, worldY, worldZ);
        vector.project(this.game.camera);
        
        const screenX = (vector.x * 0.5 + 0.5) * window.innerWidth;
        const screenY = (vector.y * -0.5 + 0.5) * window.innerHeight;
        
        const textElement = document.createElement('div');
        textElement.textContent = text;
        textElement.style.cssText = `
            position: fixed;
            left: ${screenX}px;
            top: ${screenY}px;
            font-family: 'Courier New', monospace;
            font-weight: bold;
            font-size: 18px;
            pointer-events: none;
            z-index: 500;
            text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.8);
            animation: floatingText 2s ease-out forwards;
            transform: translate(-50%, -50%);
        `;
        
        switch (type) {
            case 'heal':
                textElement.style.color = '#00ff88';
                textElement.textContent = `+${text}`;
                break;
            case 'critical':
                textElement.style.color = '#ff0044';
                textElement.style.fontSize = '24px';
                textElement.textContent = `${text}!`;
                break;
            case 'damage':
                textElement.style.color = '#ff4444';
                break;
            default:
                textElement.style.color = '#ffffff';
        }
        
        document.body.appendChild(textElement);
        
        setTimeout(() => {
            if (document.body.contains(textElement)) {
                document.body.removeChild(textElement);
            }
        }, 2000);
    }
    
    createAuraEffect(x, y, z, type = 'magic', duration = 3000) {
        if (!this.game.particleSystem) return;
        
        const config = this.getEffectConfig(type);
        const startTime = Date.now();
        const interval = 1000;
        
        const createAura = () => {
            if (Date.now() - startTime > duration) return;
            
            const auraConfig = {
                ...config,
                position: new THREE.Vector3(x + this.effectOffset.x, y + this.effectOffset.y, z + this.effectOffset.z),
                count: 4,
                velocity: { ...config.velocity, speed: config.velocity.speed * 0.3 },
                scale: config.scale
            };
            
            this.game.particleSystem.createParticles(auraConfig);
            
            setTimeout(createAura, interval);
        };
        
        createAura();
    }
    
    // === CLEANUP ===
    
    clearAllEffects() {
        // Clear particle effects
        if (this.game.particleSystem) {
            this.game.particleSystem.clearAllParticles();
        }
        
        // Clear line effects
        [...this.activeLineEffects].forEach(effectData => {
            this.removeLineEffect(effectData);
        });
        
        // Clear notifications
        this.notifications.forEach(notification => {
            this.removeNotification(notification);
        });
        
        this.shakeActive = false;
        this.flashActive = false;
    }
    
    addEffectsCSS() {
        if (document.querySelector('#effects-styles')) return;
        
        const style = document.createElement('style');
        style.id = 'effects-styles';
        style.textContent = `
            .battle-transition {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: linear-gradient(45deg, transparent, rgba(255, 255, 0, 0.1), transparent);
                pointer-events: none;
                z-index: 100;
                animation: battleStartTransition 2s ease-out;
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
            
            @keyframes floatingText {
                0% { 
                    transform: translate(-50%, -50%) scale(0.8);
                    opacity: 0;
                }
                20% { 
                    transform: translate(-50%, -50%) scale(1.2);
                    opacity: 1;
                }
                100% { 
                    transform: translate(-50%, -150%) scale(1);
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
    
    update(deltaTime) {
        // Line effects are self-managing through requestAnimationFrame
        // Particle system handles its own updates
    }

    destroyLineEffect(effectData) {
        if (!effectData) return;
        try {
            // stop tracking so any animator stops touching it
            const idx = this.activeLineEffects?.indexOf?.(effectData) ?? -1;
            if (idx >= 0) this.activeLineEffects.splice(idx, 1);

            if (this.game?.scene && effectData.line) {
            this.game.scene.remove(effectData.line);
            }
            effectData.geometry?.dispose?.();
            effectData.material?.dispose?.();
        } catch (e) {
            console.warn('destroyLineEffect error:', e);
        }
    }

    destroy() {
        this.clearAllEffects();
        
        const styleElement = document.querySelector('#effects-styles');
        if (styleElement) {
            styleElement.remove();
        }
        
        console.log('EffectsSystem destroyed');
    }
}