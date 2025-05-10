class PlayerAttacker extends engine.Component {
    init() {
        this.stats = this.parent.getComponent("stats").stats;
        this.camera = this.game.camera;
        // Bind mouse click event
        this.cooldown = this.stats.attackSpeed;
        this.onMouseDown = this.handleMouseDown.bind(this);
        document.addEventListener('mousedown', this.onMouseDown);
        
        // Throw state tracking
        this.isThrowAnimationPlaying = false;
        this.throwRequested = false;
        this.throwTimer = 0;
        this.throwDelay = 1.2; // Keep your original delay
        this.throwDuration = 2;
    }
    
    update() {
        // Handle cooldown timer
        if (this.cooldown > 0) {
            this.cooldown -= this.game.deltaTime;
        }
        
        // Handle throw animation timing
        if (this.throwRequested) {
            this.throwTimer += this.game.deltaTime;
            
            // When we reach the throw delay, launch the projectile
            if (this.throwTimer >= this.throwDelay) {
                this.throwRequested = false;
                this.throwTimer = 0;
                this.launchProjectile();
                
                // Animation is still playing but projectile is launched
                this.isThrowAnimationPlaying = false;
            }
        }
        
        return true;
    }
    
    handleMouseDown(event) {
        // Only respond to left click
        if (event.button !== 0) return;
        
        // If cooldown is active or throw animation is still playing, ignore the click
        if (this.cooldown > 0 || this.isThrowAnimationPlaying) return;
        
        // Reset cooldown
        this.cooldown = this.throwDuration;
        
        // Start throw animation
        const modelRenderer = this.parent.getComponent("modelRenderer");
        if (modelRenderer) {
            modelRenderer.throw();
            this.isThrowAnimationPlaying = true;
            this.throwRequested = true;
            this.throwTimer = 0;
        }
    }
    
    launchProjectile() {
        const projectileType = this.stats.projectile;
        if (!projectileType) return;
        let projectileDef = this.game.config.projectilePrefabs[projectileType];
       
        let projStats = { ...projectileDef };
        delete projStats.render;
        projStats.baseDamage = this.stats.damage || 1;  
        projStats.piercing = this.stats.piercing || 0;
        projStats.splashRadius = this.stats.splashRadius || 0;
        projStats.critChance = this.stats.critChance || 0.05;
        projStats.critMultiplier = this.stats.critMultiplier || 2;
        
        // Calculate firing direction from camera
        const direction = new THREE.Vector3();
        this.camera.getWorldDirection(direction); // Camera's forward vector
        direction.normalize();
        
        // Spawn position: slightly offset from player
        let spawnPos = this.parent.transform.position.clone().add(direction.clone().multiplyScalar(5));
        let projectileParams = this.game.config.projectiles[projectileType];
           
        if (projectileParams.offset) {
            const offset = JSON.parse(projectileParams.offset);
            // Create offset vector
            const offsetVector = new THREE.Vector3(offset.x, offset.y, offset.z);
            // Apply player's rotation to the offset
            offsetVector.applyQuaternion(this.parent.transform.quaternion);
            // Add rotated offset to spawn position
            spawnPos.add(offsetVector);
        }
        
        // Spawn projectile entity
        const projectile = this.game.spawn(
            'projectile',
            {
                objectType: 'projectilePrefabs',
                spawnType: projectileType,
                direction: direction, // No specific target, uses direction
                owner: this.parent,
                stats: projStats
            },
            spawnPos
        );          
    }
    
    destroy() {
        document.removeEventListener('mousedown', this.onMouseDown);
    }
}