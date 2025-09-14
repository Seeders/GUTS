class ParticleSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.particleSystem = this;
        
        // Particle pools for different shapes
        this.particlePools = new Map();
        this.activeParticles = [];
        
        // Geometries for different shapes
        this.geometries = new Map();
        this.materials = new Map();
        
        // Update tracking
        this.lastUpdateTime = 0;
        
        this.initialized = false;
    }
    
    initialize() {
        if (this.initialized || !this.game.scene) return;
        
        this.createGeometries();
        this.initializeParticlePools();
        
        this.initialized = true;
        console.log('Three.js ParticleSystem initialized');
    }
    
    createGeometries() {
        // Circle/sphere geometry
        this.geometries.set('circle', new THREE.SphereGeometry(1, 8, 6));
        
        // Star geometry
        const starShape = new THREE.Shape();
        const spikes = 5;
        const outerRadius = 1;
        const innerRadius = 0.5;
        
        for (let i = 0; i < spikes * 2; i++) {
            const radius = i % 2 === 0 ? outerRadius : innerRadius;
            const angle = (i * Math.PI) / spikes;
            const x = Math.cos(angle - Math.PI / 2) * radius;
            const y = Math.sin(angle - Math.PI / 2) * radius;
            
            if (i === 0) {
                starShape.moveTo(x, y);
            } else {
                starShape.lineTo(x, y);
            }
        }
        starShape.closePath();
        
        const starGeometry = new THREE.ExtrudeGeometry(starShape, {
            depth: 0.1,
            bevelEnabled: false
        });
        this.geometries.set('star', starGeometry);
        
        // Cross geometry
        const crossShape = new THREE.Shape();
        crossShape.moveTo(-0.2, -1);
        crossShape.lineTo(0.2, -1);
        crossShape.lineTo(0.2, -0.2);
        crossShape.lineTo(1, -0.2);
        crossShape.lineTo(1, 0.2);
        crossShape.lineTo(0.2, 0.2);
        crossShape.lineTo(0.2, 1);
        crossShape.lineTo(-0.2, 1);
        crossShape.lineTo(-0.2, 0.2);
        crossShape.lineTo(-1, 0.2);
        crossShape.lineTo(-1, -0.2);
        crossShape.lineTo(-0.2, -0.2);
        crossShape.closePath();
        
        const crossGeometry = new THREE.ExtrudeGeometry(crossShape, {
            depth: 0.1,
            bevelEnabled: false
        });
        this.geometries.set('cross', crossGeometry);
        
        // Add more shapes as needed
        this.geometries.set('cube', new THREE.BoxGeometry(1, 1, 1));
        this.geometries.set('pyramid', new THREE.ConeGeometry(1, 2, 4));
    }
    
    initializeParticlePools() {
        // Create pools for each shape type
        this.geometries.forEach((geometry, shape) => {
            this.particlePools.set(shape, []);
            this.expandPool(shape, 50); // Initial pool size
        });
    }
    
    expandPool(shape, count) {
        const pool = this.particlePools.get(shape);
        const geometry = this.geometries.get(shape);
        
        if (!geometry) {
            console.warn(`ParticleSystem: Unknown shape: ${shape}`);
            return;
        }
        
        for (let i = 0; i < count; i++) {
            // Create mesh with basic material (will be updated when used)
            const material = new THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 1.0,
                depthWrite: false,
                blending: THREE.AdditiveBlending
            });
            
            const mesh = new THREE.Mesh(geometry, material);
            
            // Store particle data
            mesh.userData = {
                velocity: new THREE.Vector3(),
                angularVelocity: new THREE.Vector3(),
                life: 0,
                maxLife: 1,
                initialScale: 1,
                active: false,
                shape: shape,
                // Physics properties
                gravity: 0,
                drag: 1,
                // Visual properties
                fadeOut: true,
                scaleOverTime: true,
                colorStart: new THREE.Color(0xffffff),
                colorEnd: new THREE.Color(0xffffff)
            };
            
            mesh.visible = false;
            pool.push(mesh);
        }
    }
    
    getParticleFromPool(shape) {
        const pool = this.particlePools.get(shape);
        if (!pool || pool.length === 0) {
            this.expandPool(shape, 10);
        }
        
        const particle = pool.pop();
        if (particle) {
            this.activeParticles.push(particle);
            this.game.scene.add(particle);
        }
        return particle;
    }
    
    returnParticleToPool(particle) {
        const shape = particle.userData.shape;
        const pool = this.particlePools.get(shape);
        
        // Remove from active list
        const index = this.activeParticles.indexOf(particle);
        if (index > -1) {
            this.activeParticles.splice(index, 1);
        }
        
        // Reset particle state
        particle.visible = false;
        particle.userData.active = false;
        particle.userData.life = 0;
        particle.scale.set(1, 1, 1);
        particle.material.opacity = 1;
        particle.material.color.setHex(0xffffff);
        particle.rotation.set(0, 0, 0);
        
        // Remove from scene and return to pool
        this.game.scene.remove(particle);
        pool.push(particle);
    }
    
    /**
     * Create particles based on configuration
     * @param {Object} config - Particle configuration
     * @param {THREE.Vector3} config.position - World position
     * @param {number} config.count - Number of particles
     * @param {string} config.shape - Shape type ('circle', 'star', 'cross', 'cube', 'pyramid')
     * @param {number} config.color - Hex color (0xff0000)
     * @param {Object} config.colorRange - Optional color range {start: 0xff0000, end: 0x0000ff}
     * @param {number} config.lifetime - Particle lifetime in seconds
     * @param {Object} config.velocity - Velocity configuration
     * @param {number} config.velocity.speed - Base speed
     * @param {number} config.velocity.spread - Speed variation
     * @param {string} config.velocity.pattern - 'burst', 'cone', 'sphere', 'directional'
     * @param {THREE.Vector3} config.velocity.direction - Direction for directional pattern
     * @param {number} config.scale - Base scale
     * @param {number} config.scaleVariation - Scale variation (0-1)
     * @param {Object} config.physics - Physics properties
     * @param {number} config.physics.gravity - Gravity strength
     * @param {number} config.physics.drag - Drag coefficient
     * @param {Object} config.rotation - Rotation properties
     * @param {boolean} config.rotation.enabled - Enable rotation
     * @param {number} config.rotation.speed - Rotation speed
     * @param {Object} config.visual - Visual properties
     * @param {boolean} config.visual.fadeOut - Fade out over time
     * @param {boolean} config.visual.scaleOverTime - Scale over time
     * @param {string} config.visual.blending - Blending mode ('normal', 'additive', 'multiply')
     */
    createParticles(config) {
        if (!this.initialized) {
            this.initialize();
            if (!this.initialized) return;
        }
        
        const {
            position = new THREE.Vector3(0, 0, 0),
            count = 10,
            shape = 'circle',
            color = 0xffffff,
            colorRange = null,
            lifetime = 1.0,
            velocity = { speed: 5, spread: 1, pattern: 'burst' },
            scale = 1.0,
            scaleVariation = 0.5,
            physics = { gravity: 0.5, drag: 0.98 },
            rotation = { enabled: false, speed: 0 },
            visual = { fadeOut: true, scaleOverTime: true, blending: 'additive' }
        } = config;
        
        for (let i = 0; i < count; i++) {
            const particle = this.getParticleFromPool(shape);
            if (!particle) continue;
            
            // Set position
            particle.position.copy(position);
            
            // Set color
            if (colorRange) {
                const t = Math.random();
                const particleColor = new THREE.Color(colorRange.start).lerp(
                    new THREE.Color(colorRange.end), t
                );
                particle.material.color.copy(particleColor);
                particle.userData.colorStart.copy(particleColor);
                particle.userData.colorEnd.copy(particleColor);
            } else {
                particle.material.color.setHex(color);
                particle.userData.colorStart.setHex(color);
                particle.userData.colorEnd.setHex(color);
            }
            
            // Set velocity based on pattern
            this.setParticleVelocity(particle, velocity, i, count);
            
            // Set angular velocity
            if (rotation.enabled) {
                const rotSpeed = rotation.speed * (0.5 + Math.random() * 0.5);
                particle.userData.angularVelocity.set(
                    (Math.random() - 0.5) * rotSpeed,
                    (Math.random() - 0.5) * rotSpeed,
                    (Math.random() - 0.5) * rotSpeed
                );
            } else {
                particle.userData.angularVelocity.set(0, 0, 0);
            }
            
            // Set life and scale
            particle.userData.life = lifetime * (0.8 + Math.random() * 0.4);
            particle.userData.maxLife = particle.userData.life;
            particle.userData.initialScale = scale * (1 - scaleVariation * 0.5 + Math.random() * scaleVariation);
            particle.userData.active = true;
            
            // Set physics properties
            particle.userData.gravity = physics.gravity;
            particle.userData.drag = physics.drag;
            
            // Set visual properties
            particle.userData.fadeOut = visual.fadeOut;
            particle.userData.scaleOverTime = visual.scaleOverTime;
            
            // Set blending mode
            switch (visual.blending) {
                case 'additive':
                    particle.material.blending = THREE.AdditiveBlending;
                    break;
                case 'multiply':
                    particle.material.blending = THREE.MultiplyBlending;
                    break;
                default:
                    particle.material.blending = THREE.NormalBlending;
            }
            
            // Set initial scale and make visible
            const finalScale = particle.userData.initialScale;
            particle.scale.set(finalScale, finalScale, finalScale);
            particle.visible = true;
        }
    }
    
    setParticleVelocity(particle, velocityConfig, index, totalCount) {
        const { speed, spread, pattern, direction } = velocityConfig;
        const finalSpeed = speed * (1 - spread * 0.5 + Math.random() * spread);
        
        let velocityDirection = new THREE.Vector3();
        
        switch (pattern) {
            case 'burst':
                // Particles spread in all directions from center
                const angle = (Math.PI * 2 * index) / totalCount + Math.random() * 0.5;
                const elevation = (Math.random() - 0.5) * Math.PI * 0.5;
                velocityDirection.set(
                    Math.cos(angle) * Math.cos(elevation),
                    Math.sin(elevation),
                    Math.sin(angle) * Math.cos(elevation)
                );
                break;
                
            case 'cone':
                // Particles spread in a cone pattern (upward)
                const coneAngle = (Math.PI * 2 * index) / totalCount + Math.random() * 0.3;
                const coneSpread = Math.random() * 0.5; // 0 = straight up, 1 = horizontal
                velocityDirection.set(
                    Math.cos(coneAngle) * coneSpread,
                    1 - coneSpread * 0.5,
                    Math.sin(coneAngle) * coneSpread
                );
                break;
                
            case 'sphere':
                // Particles spread uniformly in a sphere
                const phi = Math.random() * Math.PI * 2;
                const costheta = Math.random() * 2 - 1;
                const theta = Math.acos(costheta);
                velocityDirection.set(
                    Math.sin(theta) * Math.cos(phi),
                    Math.sin(theta) * Math.sin(phi),
                    Math.cos(theta)
                );
                break;
                
            case 'directional':
                // Particles move in a specific direction with some spread
                const baseDirection = direction || new THREE.Vector3(0, 1, 0);
                const spreadVector = new THREE.Vector3(
                    (Math.random() - 0.5) * spread,
                    (Math.random() - 0.5) * spread,
                    (Math.random() - 0.5) * spread
                );
                velocityDirection.copy(baseDirection).add(spreadVector).normalize();
                break;
        }
        
        particle.userData.velocity.copy(velocityDirection.multiplyScalar(finalSpeed));
    }
    
    update() {
        if (!this.initialized) return;
        
        const particlesToRemove = [];
        this.activeParticles.forEach(particle => {
            
            if (!particle.userData.active) return;
            

            // Update life
            particle.userData.life -= this.game.state.deltaTime;
            
            if (particle.userData.life <= 0) {
                particlesToRemove.push(particle);
                return;
            }
            
            // Calculate life progress (1 = just born, 0 = about to die)
            const lifeProgress = particle.userData.life / particle.userData.maxLife;
            
            // Update position
            particle.position.add(
                particle.userData.velocity.clone().multiplyScalar(this.game.state.deltaTime)
            );
            
            // Apply gravity
            particle.userData.velocity.y += particle.userData.gravity * this.game.state.deltaTime * 60;
            
            // Apply drag
            particle.userData.velocity.multiplyScalar(particle.userData.drag);
            
            // Update rotation
            if (particle.userData.angularVelocity.length() > 0) {
                particle.rotation.x += particle.userData.angularVelocity.x * this.game.state.deltaTime;
                particle.rotation.y += particle.userData.angularVelocity.y * this.game.state.deltaTime;
                particle.rotation.z += particle.userData.angularVelocity.z * this.game.state.deltaTime;
            }
            
            // Update visual properties based on life
            if (particle.userData.fadeOut) {
                particle.material.opacity = lifeProgress;
            }
            
            if (particle.userData.scaleOverTime) {
                // Scale animation: start small, grow, then shrink
                let scaleMultiplier;
                if (lifeProgress > 0.8) {
                    scaleMultiplier = (1 - lifeProgress) * 5; // Growing phase
                } else if (lifeProgress > 0.2) {
                    scaleMultiplier = 1; // Stable phase
                } else {
                    scaleMultiplier = lifeProgress * 5; // Shrinking phase
                }
                
                const finalScale = particle.userData.initialScale * scaleMultiplier;
                particle.scale.set(finalScale, finalScale, finalScale);
            }
        });
        
        // Remove dead particles
        particlesToRemove.forEach(particle => {
            this.returnParticleToPool(particle);
        });
    }
    
    // Helper method to convert screen coordinates to world coordinates
    screenToWorld(screenX, screenY, depth = 0) {
        if (!this.game.camera) return new THREE.Vector3(0, 0, 0);
        
        const vector = new THREE.Vector3();
        vector.set(
            (screenX / window.innerWidth) * 2 - 1,
            -(screenY / window.innerHeight) * 2 + 1,
            0.5
        );
        
        vector.unproject(this.game.camera);
        
        const dir = vector.sub(this.game.camera.position).normalize();
        const distance = (depth - this.game.camera.position.y) / dir.y;
        const pos = this.game.camera.position.clone().add(dir.multiplyScalar(distance));
        
        return pos;
    }
    
    // Helper method to get terrain height at position
    getWorldHeight(worldX, worldZ) {
        if (this.game.worldSystem && this.game.worldSystem.getTerrainHeightAtPosition) {
            return this.game.worldSystem.getTerrainHeightAtPosition(worldX, worldZ);
        }
        return 0;
    }
    
    // Add a new shape geometry
    addShape(name, geometry) {
        this.geometries.set(name, geometry);
        this.particlePools.set(name, []);
        this.expandPool(name, 20);
    }
    
    // Clean up all particles
    clearAllParticles() {
        const particlesToRemove = [...this.activeParticles];
        particlesToRemove.forEach(particle => {
            this.returnParticleToPool(particle);
        });
    }
    entityDestroyed(entityId) {
        // Clean up any particles associated with this entity
        this.activeParticles = this.activeParticles.filter(particle => 
            particle.sourceEntityId !== entityId
        );
        
        // Clean up any entity-specific particle pools
        if (this.entityParticles) {
            this.entityParticles.delete(entityId);
        }
    }
    destroy() {
        // Clear all active particles
        this.clearAllParticles();
        
        // Dispose of geometries
        this.geometries.forEach(geometry => {
            geometry.dispose();
        });
        this.geometries.clear();
        
        // Clear pools
        this.particlePools.forEach((pool, shape) => {
            pool.forEach(particle => {
                if (particle.parent) {
                    particle.parent.remove(particle);
                }
                particle.geometry?.dispose();
                particle.material?.dispose();
            });
        });
        this.particlePools.clear();
        this.activeParticles = [];
        
        this.initialized = false;
        console.log('Three.js ParticleSystem destroyed');
    }
}