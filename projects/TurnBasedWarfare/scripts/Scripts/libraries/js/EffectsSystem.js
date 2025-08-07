class EffectsSystem {
    constructor(app) {
        this.game = app;  
        this.particles = [];
        this.particleCanvas = null;
        this.particleContext = null;
        this.animationId = null;
    }
    
    initialize() {
        this.setupParticleSystem();
        this.addEffectsCSS();
    }
    
    setupParticleSystem() {
        this.particleCanvas = document.createElement('canvas');
        this.particleCanvas.id = 'particle-canvas';
        this.particleCanvas.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 10;
        `;
        
        // Add to game container when available
        setTimeout(() => {
            const gameContainer = document.getElementById('gameContainer');
            if (gameContainer && !this.particleCanvas.parentElement) {
                gameContainer.appendChild(this.particleCanvas);
                this.particleContext = this.particleCanvas.getContext('2d');
                this.startParticleAnimation();
            }
        }, 100);
    }
    
    startParticleAnimation() {
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
        this.animate();
    }
    
    resizeCanvas() {
        if (!this.particleCanvas || !this.particleCanvas.parentElement) return;
        
        const rect = this.particleCanvas.parentElement.getBoundingClientRect();
        this.particleCanvas.width = rect.width;
        this.particleCanvas.height = rect.height;
    }
    
    animate() {
        if (!this.particleContext || !this.particleCanvas) return;
        
        // Clear canvas
        this.particleContext.clearRect(0, 0, this.particleCanvas.width, this.particleCanvas.height);
        
        // Update and draw particles
        this.particles = this.particles.filter(particle => {
            // Update particle physics
            particle.x += particle.vx;
            particle.y += particle.vy;
            particle.vy += particle.gravity || 0.15;
            particle.vx *= particle.friction || 0.99;
            particle.life -= particle.decay;
            
            // Draw particle if still alive
            if (particle.life > 0) {
                this.drawParticle(particle);
                return true;
            }
            return false;
        });
        
        // Continue animation
        this.animationId = requestAnimationFrame(() => this.animate());
    }
    
    drawParticle(particle) {
        this.particleContext.save();
        
        // Set particle properties
        this.particleContext.globalAlpha = Math.max(0, particle.life);
        this.particleContext.fillStyle = particle.color;
        
        // Draw particle shape
        if (particle.shape === 'star') {
            this.drawStar(particle.x, particle.y, particle.size);
        } else {
            // Default circle
            this.particleContext.beginPath();
            this.particleContext.arc(particle.x, particle.y, particle.size * particle.life, 0, Math.PI * 2);
            this.particleContext.fill();
        }
        
        this.particleContext.restore();
    }
    
    drawStar(x, y, size) {
        const spikes = 5;
        const outerRadius = size;
        const innerRadius = size * 0.5;
        
        this.particleContext.beginPath();
        this.particleContext.moveTo(x, y - outerRadius);
        
        for (let i = 0; i < spikes * 2; i++) {
            const radius = i % 2 === 0 ? outerRadius : innerRadius;
            const angle = (i * Math.PI) / spikes;
            this.particleContext.lineTo(
                x + Math.cos(angle - Math.PI / 2) * radius,
                y + Math.sin(angle - Math.PI / 2) * radius
            );
        }
        
        this.particleContext.closePath();
        this.particleContext.fill();
    }
    
    createParticleEffect(x, y, type = 'victory', options = {}) {
        if (!this.particleContext) return;
        
        const effects = {
            victory: {
                count: 25,
                colors: ['#00ff00', '#ffff00', '#00ffff', '#88ff88'],
                shape: 'star',
                spread: 8,
                lifetime: 1.5
            },
            defeat: {
                count: 20,
                colors: ['#ff4444', '#ff8888', '#ff0000'],
                shape: 'circle',
                spread: 6,
                lifetime: 1.0
            },
            placement: {
                count: 12,
                colors: ['#00ff44', '#44ff44', '#88ff88'],
                shape: 'circle',
                spread: 4,
                lifetime: 0.8
            },
            explosion: {
                count: 30,
                colors: ['#ffaa00', '#ff6600', '#ff0000', '#ffff00'],
                shape: 'circle',
                spread: 10,
                lifetime: 1.2
            },
            heal: {
                count: 15,
                colors: ['#00ff88', '#44ff44', '#88ffaa'],
                shape: 'star',
                spread: 3,
                lifetime: 1.0
            }
        };
        
        const config = effects[type] || effects.victory;
        const particleCount = options.count || config.count;
        const spreadMultiplier = options.spread || 1;
        
        for (let i = 0; i < particleCount; i++) {
            const angle = (Math.PI * 2 * i) / particleCount + Math.random() * 0.5;
            const speed = (2 + Math.random() * 4) * spreadMultiplier;
            
            this.particles.push({
                x: x,
                y: y,
                vx: Math.cos(angle) * speed * config.spread,
                vy: Math.sin(angle) * speed * config.spread - Math.random() * 2,
                color: config.colors[Math.floor(Math.random() * config.colors.length)],
                size: 2 + Math.random() * 4,
                shape: config.shape,
                life: config.lifetime,
                decay: 0.01 + Math.random() * 0.02,
                gravity: type === 'heal' ? -0.05 : 0.15,
                friction: 0.98
            });
        }
    }
    
    // Public effect methods
    showVictoryEffect(x, y, options = {}) {
        this.createParticleEffect(x, y, 'victory', options);
        this.playScreenShake(300, 2);
    }
    
    showDefeatEffect(x, y, options = {}) {
        this.createParticleEffect(x, y, 'defeat', options);
        this.playScreenFlash('#ff4444', 500);
    }
    
    showPlacementEffect(x, y, options = {}) {
        this.createParticleEffect(x, y, 'placement', options);
    }
    
    showExplosionEffect(x, y, options = {}) {
        this.createParticleEffect(x, y, 'explosion', options);
        this.playScreenShake(200, 3);
    }
    
    showHealEffect(x, y, options = {}) {
        this.createParticleEffect(x, y, 'heal', options);
    }
    
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
        const gameContainer = document.getElementById('gameContainer');
        if (!gameContainer) return;
        
        const originalTransform = gameContainer.style.transform;
        let startTime = Date.now();
        
        const shake = () => {
            const elapsed = Date.now() - startTime;
            const progress = elapsed / duration;
            
            if (progress < 1) {
                const shakeX = (Math.random() - 0.5) * intensity * (1 - progress);
                const shakeY = (Math.random() - 0.5) * intensity * (1 - progress);
                gameContainer.style.transform = `translate(${shakeX}px, ${shakeY}px)`;
                requestAnimationFrame(shake);
            } else {
                gameContainer.style.transform = originalTransform;
            }
        };
        
        shake();
    }
    
    playScreenFlash(color = '#ffffff', duration = 300) {
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
        }, duration);
    }
    
    playSound(soundId) {
        // Placeholder for sound system integration
        console.log(`Playing sound: ${soundId}`);
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
            
            .victory-notification {
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: linear-gradient(145deg, #001100, #003300);
                border: 2px solid #00ff00;
                border-radius: 10px;
                padding: 2rem;
                text-align: center;
                z-index: 2000;
                color: #00ff00;
                font-family: 'Courier New', monospace;
                animation: victoryAppear 0.5s ease-out;
                box-shadow: 0 0 30px rgba(0, 255, 0, 0.3);
            }
            
            @keyframes victoryAppear {
                from { 
                    transform: translate(-50%, -50%) scale(0.8); 
                    opacity: 0; 
                }
                to { 
                    transform: translate(-50%, -50%) scale(1); 
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
        `;
        document.head.appendChild(style);
    }
    
    cleanup() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }
        if (this.particleCanvas && this.particleCanvas.parentElement) {
            this.particleCanvas.parentElement.removeChild(this.particleCanvas);
        }
        this.particles = [];
    }
}