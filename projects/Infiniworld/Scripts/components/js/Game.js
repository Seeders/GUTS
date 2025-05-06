class Game extends engine.Component {
    
    constructor(game, parent, params) {
        super(game, parent, params);
    }
    
    
        
    init() {
        this.physics = this.getComponent('Physics');
        this.gridSize = this.game.config.configs.game.gridSize;       
        this.infiniWorld = this.getComponent('InfiniWorld');
    }
    update() {
        if (!this.game.state.isPaused) {
            this.currentTime = Date.now();

            const timeSinceLastUpdate = this.currentTime - this.lastTime;
            if (timeSinceLastUpdate > 1000) {
                this.lastTime = this.currentTime;
                return;
            }

            this.game.deltaTime = Math.min(1/30, timeSinceLastUpdate / 1000);
            this.lastTime = this.currentTime;

            // Update FPS counter
            if (!this.fps) {
                this.fps = {
                    frameCount: 0,
                    lastFpsUpdate: this.currentTime,
                    fpsValue: 0
                };
            }
            this.fps.frameCount++;
            if (this.currentTime - this.fps.lastFpsUpdate >= 1000) {
                this.fps.fpsValue = Math.round((this.fps.frameCount * 1000) / (this.currentTime - this.fps.lastFpsUpdate));
                this.fps.frameCount = 0;
                this.fps.lastFpsUpdate = this.currentTime;
            }

            // Check if physics update is needed
            this.physicsAccumulator += Math.min(timeSinceLastUpdate, 0.1);
            const physicsStep = 1/60;
            const shouldUpdatePhysics = this.physics.startPhysicsUpdate(physicsStep);

            // Single entity loop
            const entitiesToKeep = [];
            for (let i = 0; i < this.game.state.entities.length; i++) {
                let e = this.game.state.entities[i];
                let result = e.update();
                if (result) {
                    entitiesToKeep.push(e);
                    e.draw();
                    e.postUpdate();
                    // Collect physics data for this entity
                    if (shouldUpdatePhysics && e.getComponent('collider')) {
                        this.physics.collectPhysicsData(e, this.infiniWorld);
                    }
                }
            }
            this.game.state.entities = entitiesToKeep;

            // Send physics data to worker
            if (shouldUpdatePhysics) {
                this.physics.sendToWorker(this.infiniWorld);
            }

            this.postUpdate();
            this.game.entitiesToAdd.forEach((entity) => this.game.state.addEntity(entity));
            this.game.entitiesToAdd = [];
        }
    }

    getTerrainHeight(position) {
        
        return this.infiniWorld ? this.infiniWorld.getTerrainHeight(position.x, position.z) : 0;
    }
    postUpdate() {
        
            if (this.game.state.gameOver || this.game.state.victory || this.game.state.isLevelingUp) return;
                    
            // Game over check
            if (this.game.state.bloodCoreHP <= 0 && !this.game.state.gameOver) {
                this.gameOver();
            }
    }


    // Game-over and victory functions
    gameOver() {
        this.game.state.gameOver = true;
        this.game.state.isPaused = true;
        gameOverWave.textContent = this.game.state.round + 1;
        gameOverMenu.style.display = 'block';
        overlay.style.display = 'block';
    }

    gameVictory() {
        this.game.state.victory = true;
        this.game.state.isPaused = true;
        victoryMenu.style.display = 'block';
        overlay.style.display = 'block';
    }

}