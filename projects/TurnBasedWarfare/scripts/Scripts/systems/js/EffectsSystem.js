class EffectsSystem {
    constructor(game) {
        this.game = game;  
        this.game.effectsSystem = this;
        
        // Screen effect tracking
        this.screenEffects = [];
        this.shakeActive = false;
        this.flashActive = false;
        
        // UI notifications
        this.notifications = [];
    }
    
    initialize() {
        this.addEffectsCSS();
        console.log('EffectsSystem initialized');
    }
    
    // === PARTICLE EFFECTS ===
    // Particle effect configurations for different game events
    
    getEffectConfig(effectType) {
        const configs = {
            victory: {
                count: 25,
                shape: 'star',
                color: 0x00ff00,
                colorRange: { start: 0x00ff00, end: 0xffff00 },
                lifetime: 1.5,
                velocity: { speed: 8, spread: 0.5, pattern: 'burst' },
                scale: 0.8,
                scaleVariation: 0.3,
                physics: { gravity: -0.5, drag: 0.99 },
                rotation: { enabled: true, speed: 5 },
                visual: { fadeOut: true, scaleOverTime: true, blending: 'additive' }
            },
            defeat: {
                count: 20,
                shape: 'circle',
                color: 0xff4444,
                colorRange: { start: 0xff4444, end: 0xff0000 },
                lifetime: 1.0,
                velocity: { speed: 6, spread: 0.8, pattern: 'burst' },
                scale: 0.6,
                scaleVariation: 0.4,
                physics: { gravity: 0.8, drag: 0.98 },
                rotation: { enabled: false, speed: 0 },
                visual: { fadeOut: true, scaleOverTime: true, blending: 'additive' }
            },
            placement: {
                count: 15,
                shape: 'circle',
                color: 0x00ff44,
                colorRange: { start: 0x00ff44, end: 0x88ff88 },
                lifetime: 1.2,
                velocity: { speed: 160, spread: 0.4, pattern: 'cone' },
                scale: 2,
                scaleVariation: 0.3,
                physics: { gravity: -1, drag: 0.98 }, // Float upward
                rotation: { enabled: false, speed: 0 },
                visual: { fadeOut: true, scaleOverTime: true, blending: 'additive' }
            },
            explosion: {
                count: 30,
                shape: 'circle',
                color: 0xffaa00,
                colorRange: { start: 0xffaa00, end: 0xff0000 },
                lifetime: 1.2,
                velocity: { speed: 10, spread: 0.6, pattern: 'sphere' },
                scale: 1.0,
                scaleVariation: 0.5,
                physics: { gravity: 1.0, drag: 0.96 },
                rotation: { enabled: true, speed: 8 },
                visual: { fadeOut: true, scaleOverTime: true, blending: 'additive' }
            },
            heal: {
                count: 15,
                shape: 'cross',
                color: 0x00ff88,
                colorRange: { start: 0x00ff88, end: 0x88ffaa },
                lifetime: 1.0,
                velocity: { speed: 3, spread: 0.2, pattern: 'cone' },
                scale: 0.5,
                scaleVariation: 0.3,
                physics: { gravity: -0.8, drag: 0.99 },
                rotation: { enabled: true, speed: 3 },
                visual: { fadeOut: true, scaleOverTime: true, blending: 'additive' }
            },
            magic: {
                count: 20,
                shape: 'star',
                color: 0x8800ff,
                colorRange: { start: 0x8800ff, end: 0xff88ff },
                lifetime: 2.0,
                velocity: { speed: 5, spread: 0.4, pattern: 'sphere' },
                scale: 0.6,
                scaleVariation: 0.4,
                physics: { gravity: -0.3, drag: 0.98 },
                rotation: { enabled: true, speed: 6 },
                visual: { fadeOut: true, scaleOverTime: true, blending: 'additive' }
            },
            damage: {
                count: 8,
                shape: 'circle',
                color: 0xff0000,
                lifetime: 0.6,
                velocity: { speed: 2, spread: 0.5, pattern: 'burst' },
                scale: 0.3,
                scaleVariation: 0.2,
                physics: { gravity: 0.5, drag: 0.98 },
                rotation: { enabled: false, speed: 0 },
                visual: { fadeOut: true, scaleOverTime: true, blending: 'additive' }
            },
            levelup: {
                count: 40,
                shape: 'star',
                color: 0xffd700,
                colorRange: { start: 0xffd700, end: 0xffa500 },
                lifetime: 2.5,
                velocity: { speed: 8, spread: 0.6, pattern: 'cone' },
                scale: 1.2,
                scaleVariation: 0.5,
                physics: { gravity: -0.4, drag: 0.98 },
                rotation: { enabled: true, speed: 4 },
                visual: { fadeOut: true, scaleOverTime: true, blending: 'additive' }
            }
        };
        
        return configs[effectType] || configs.damage;
    }
    
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
    
    showPlacementEffect(x, y, z, options = {}) {
        this.createParticleEffect(x, y, z, 'placement', options);
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
    
    // Generic particle effect creation
    createParticleEffect(x, y, z, effectType, options = {}) {
        if (!this.game.particleSystem) return;
        
        const baseConfig = this.getEffectConfig(effectType);
        
        // Merge options with base config
        const config = {
            ...baseConfig,
            position: new THREE.Vector3(x, y, z),
            ...options
        };
        
        // Apply option overrides
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
    
    // === ENTITY-BASED EFFECTS ===
    // Convenience methods for entity-based effects
    
    showEffectAtEntity(entityId, effectType, options = {}) {
        if (!this.game.particleSystem) return;
        
        const pos = this.game.getComponent(entityId, this.game.componentManager.getComponentTypes().POSITION);
        if (pos) {
            const height = this.game.particleSystem.getWorldHeight(pos.x, pos.z);
            const effectHeight = height + (options.heightOffset || 10);
            
            switch (effectType) {
                case 'victory':
                    this.showVictoryEffect(pos.x, effectHeight, pos.z, options);
                    break;
                case 'defeat':
                    this.showDefeatEffect(pos.x, effectHeight, pos.z, options);
                    break;
                case 'placement':
                    this.showPlacementEffect(pos.x, effectHeight, pos.z, options);
                    break;
                case 'explosion':
                    this.showExplosionEffect(pos.x, effectHeight, pos.z, options);
                    break;
                case 'heal':
                    this.showHealEffect(pos.x, effectHeight, pos.z, options);
                    break;
                case 'magic':
                    this.showMagicEffect(pos.x, effectHeight, pos.z, options);
                    break;
                case 'damage':
                    this.showDamageEffect(pos.x, effectHeight, pos.z, options);
                    break;
                case 'levelup':
                    this.showLevelUpEffect(pos.x, effectHeight, pos.z, options);
                    break;
                default:
                    console.warn(`EffectsSystem: Unknown effect type: ${effectType}`);
            }
        }
    }
    
    // === SCREEN EFFECTS ===
    
    playBattleStartAnimation() {
        const transition = document.createElement('div');
        transition.className = 'battle-transition';
        document.body.appendChild(transition);

        // Play sound effect if available
        this.playSound('battle-start');

        setTimeout(() => {
            if (document.body.contains(transition)) {
                document.body.removeChild(transition);
            }
        }, 2000);
    }
    
    playScreenShake(duration = 300, intensity = 2) {
        if (this.shakeActive) return; // Prevent multiple shakes
        
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
        if (this.flashActive) return; // Prevent multiple flashes
        
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
    
    // === UI NOTIFICATIONS ===
    
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
        
        // Set type-specific styles
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
        
        // Position multiple notifications
        this.repositionNotifications();
        
        // Auto-remove after duration
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
    
    // === COMBAT FEEDBACK ===
    
    showDamageNumber(x, y, z, damage, type = 'damage') {
        // Create floating damage number using particle system
        if (this.game.particleSystem) {
            const config = this.getEffectConfig(type);
            const options = {
                ...config,
                position: new THREE.Vector3(x, y + 5, z),
                count: 1,
                velocity: { ...config.velocity, speed: config.velocity.speed * 0.5 },
                scale: config.scale * 1.5
            };
            
            // Show particle effect based on damage type
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
        
        // Create floating text element
        this.createFloatingText(x, y, z, damage.toString(), type);
    }
    
    createFloatingText(worldX, worldY, worldZ, text, type = 'damage') {
        if (!this.game.camera) return;
        
        // Convert world position to screen position
        const vector = new THREE.Vector3(worldX, worldY, worldZ);
        vector.project(this.game.camera);
        
        const screenX = (vector.x * 0.5 + 0.5) * window.innerWidth;
        const screenY = (vector.y * -0.5 + 0.5) * window.innerHeight;
        
        // Create floating text element
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
        
        // Set color based on type
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
        
        // Remove after animation
        setTimeout(() => {
            if (document.body.contains(textElement)) {
                document.body.removeChild(textElement);
            }
        }, 2000);
    }
    
    // === ENVIRONMENTAL EFFECTS ===
    
    createTrailEffect(startPos, endPos, type = 'magic') {
        if (!this.game.particleSystem) return;
        
        const config = this.getEffectConfig(type);
        const distance = startPos.distanceTo(endPos);
        const particleCount = Math.ceil(distance / 20); // One particle every 20 units
        
        for (let i = 0; i < particleCount; i++) {
            const progress = i / (particleCount - 1);
            const position = new THREE.Vector3().lerpVectors(startPos, endPos, progress);
            
            setTimeout(() => {
                const trailConfig = {
                    ...config,
                    position: position,
                    count: 3,
                    velocity: { ...config.velocity, speed: config.velocity.speed * 0.5 }
                };
                this.game.particleSystem.createParticles(trailConfig);
            }, i * 50); // Stagger the trail
        }
    }
    
    createAuraEffect(x, y, z, type = 'magic', duration = 3000) {
        if (!this.game.particleSystem) return;
        
        const config = this.getEffectConfig(type);
        const startTime = Date.now();
        const interval = 200; // Create effect every 200ms
        
        const createAura = () => {
            if (Date.now() - startTime > duration) return;
            
            // Create particles in a circle around the position
            const auraConfig = {
                ...config,
                position: new THREE.Vector3(x, y, z),
                count: 8,
                velocity: { ...config.velocity, speed: config.velocity.speed * 0.3 },
                scale: config.scale * 0.8
            };
            
            this.game.particleSystem.createParticles(auraConfig);
            
            setTimeout(createAura, interval);
        };
        
        createAura();
    }
    
    // === SOUND INTEGRATION ===
    
    playSound(soundId, options = {}) {
        // Integrate with your sound system here
        console.log(`Playing sound: ${soundId}`, options);
        
        // Example integration:
        // if (this.game.soundSystem) {
        //     this.game.soundSystem.playSound(soundId, options);
        // }
    }
    
    // === UTILITY METHODS ===
    
    update(deltaTime) {
        // Update any time-based screen effects if needed
        // The particle system handles its own updates
    }
    
    // Convert screen coordinates to world position
    screenToWorldPosition(screenX, screenY, depth = 0) {
        if (this.game.particleSystem) {
            return this.game.particleSystem.screenToWorld(screenX, screenY, depth);
        }
        return new THREE.Vector3(0, 0, 0);
    }
    
    // Create effect at screen position (useful for UI interactions)
    createEffectAtScreenPosition(screenX, screenY, type, options = {}) {
        const worldPos = this.screenToWorldPosition(screenX, screenY, options.depth || 0);
        this.createParticleEffect(worldPos.x, worldPos.y, worldPos.z, type, options);
    }
    
    // Create custom particle effect with full control
    createCustomParticleEffect(config) {
        if (this.game.particleSystem) {
            this.game.particleSystem.createParticles(config);
        }
    }
    
    // === CSS AND STYLES ===
    
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
            
            .victory-notification, .defeat-notification {
                position: fixed;
                bottom: 50px;
                left: 50%;
                transform: translate(-50%, 0);
                background: linear-gradient(145deg, #001100, #003300);
                border: 2px solid #00ff00;
                border-radius: 10px;
                padding: 2rem;
                text-align: center;
                z-index: 2000;
                color: #00ff00;
                font-family: 'Courier New', monospace;
                animation: victoryAppear 0.5s ease-out;
            }

            .defeat-notification {
                background: linear-gradient(145deg, #110000, #330000);
                border-color: #ff0000;
                color: #ff4444;
            }

            .victory-notification h2, .defeat-notification h2 {
                margin-bottom: 1rem;
                font-size: 1.5rem;
            }
            
            @keyframes victoryAppear {
                from { 
                    transform: translate(-50%, 100%) scale(0.8); 
                    opacity: 0; 
                }
                to { 
                    transform: translate(-50%, 0) scale(1); 
                    opacity: 1; 
                }
            }
            
            .stat-good { 
                color: #00ff00; 
                font-weight: bold; 
                text-shadow: 0 0 5px rgba(0, 255, 0, 0.5);
            }
            .stat-ok { 
                color: #ffff00; 
                text-shadow: 0 0 3px rgba(255, 255, 0, 0.3);
            }
            .stat-poor { 
                color: #ff4444; 
                font-weight: bold; 
                text-shadow: 0 0 5px rgba(255, 68, 68, 0.5);
            }
            
            .game-notification {
                box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
                backdrop-filter: blur(5px);
            }
        `;
        document.head.appendChild(style);
    }
    
    // === CLEANUP ===
    
    clearAllEffects() {
        // Clear particle effects
        if (this.game.particleSystem) {
            this.game.particleSystem.clearAllParticles();
        }
        
        // Clear notifications
        this.notifications.forEach(notification => {
            this.removeNotification(notification);
        });
        
        // Clear any active screen effects
        this.shakeActive = false;
        this.flashActive = false;
    }
    
    destroy() {
        this.clearAllEffects();
        
        // Remove CSS
        const styleElement = document.querySelector('#effects-styles');
        if (styleElement) {
            styleElement.remove();
        }
        
        console.log('EffectsSystem destroyed');
    }
}