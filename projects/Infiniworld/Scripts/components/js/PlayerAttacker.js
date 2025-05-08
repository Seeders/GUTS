class PlayerAttacker extends engine.Component {

    init() {
        this.stats = this.parent.getComponent("stats").stats;
        this.camera = this.game.camera;
        // Bind mouse click event
        this.cooldown = this.stats.attackSpeed;
        this.onMouseDown = this.handleMouseDown.bind(this);
        document.addEventListener('mousedown', this.onMouseDown);
    }

    update() {
        if (this.cooldown > 0) {
            this.cooldown -= this.game.deltaTime;
        }
        return true;
    }

    handleMouseDown(event) {
        if (event.button !== 0 || this.cooldown > 0) return; // Left click only

        this.launchProjectile();
    }

    launchProjectile() {
        const projectileType = this.stats.projectile;
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
        const spawnPos = this.parent.transform.position.clone().add(direction.clone().multiplyScalar(5));

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