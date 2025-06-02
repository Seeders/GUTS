class PlayerAttacker extends engine.Component {
    init({isRemote = false}) {
        this.stats = this.parent.getComponent("stats").stats;
        this.camera = this.game.camera;
        this.isRemote = isRemote;
        // Bind mouse click event
        this.cooldown = .25;

        if(!this.isRemote){
            this.onMouseDown = this.handleMouseDown.bind(this);

            document.addEventListener('mousedown', this.onMouseDown);
        }
        // Throw state tracking
        this.isThrowAnimationPlaying = false;
        this.throwRequested = false;
        this.throwTimer = 0;
        this.animationLength = 2;
        this.throwDelay = this.animationLength * 0.6; // Keep your original delay
        this.throwSpeed = this.cooldown;
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
            if (this.throwTimer >= this.throwDelay * this.throwSpeed) {
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
        if (event.button !== 0) return;
        if (this.cooldown > 0 || this.isThrowAnimationPlaying) return;
        
        this.cooldown = this.throwSpeed;
        
        const modelRenderer = this.parent.getComponent("modelRenderer");
        if (modelRenderer) {            
            modelRenderer.throw(this.animationLength / this.throwSpeed, this.animationLength);
            this.isThrowAnimationPlaying = true;
            this.throwRequested = true;
            this.throwTimer = 0;
        }
    }
    launchProjectile() {
        const projectileType = this.stats.projectile;
        if (!projectileType) return;
        let projectileDef = this.game.getCollections().projectilePrefabs[projectileType];
       
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
        let projectileParams = this.game.getCollections().projectiles[projectileType];
           
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
                stats: projStats,
                position: spawnPos
            }
        );          
    }
    
    destroy() {
        document.removeEventListener('mousedown', this.onMouseDown);
    }
}