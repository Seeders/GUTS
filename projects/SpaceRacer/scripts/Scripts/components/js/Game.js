class Game extends engine.Component {
     
    constructor(game, parent, params) {
        super(game, parent, params);
        this.physicsAccumulator = 0;
        this.lastTime = Date.now();
        this.physicsStep = 1/60; // 60 Hz physics update
        this.lastPhysicsTime = 0;
    }
   
    init() {
        this.physics = this.getComponent('Physics');
        this.gridSize = this.game.getCollections().configs.game.gridSize;      
        this.world = this.getComponent('InfiniWorld');
        this.debugDiv = document.createElement('div');
        this.debugDiv.style.position = "absolute";
        this.debugDiv.style.top = '10px';
        this.debugDiv.style.left = '10px';
        this.debugDiv.style.zIndex = '10000';
        document.body.append(this.debugDiv);
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
                this.debugDiv.textContent = `fps:${this.fps.fpsValue}  entityCount:${this.game.state.entities.length}`;
            }
            
            // Store physics timing info for interpolation
            const physicsDidUpdate = this.physicsAccumulator >= this.physicsStep && (this.game.isServer || this.game.isSinglePlayer);
            
            // Fixed physics update with proper timing
            this.physicsAccumulator += this.game.deltaTime;
            if (physicsDidUpdate) {    
                this.lastPhysicsTime = performance.now();
                this.physics.sendToWorker(this.world);           
                this.physicsAccumulator -= this.physicsStep;
                
                // Notify all entities that physics updated
                for (let i = 0; i < this.game.state.entities.length; i++) {
                    let e = this.game.state.entities[i];
                    if (e.onPhysicsUpdate) {
                        e.onPhysicsUpdate(this.lastPhysicsTime, this.physicsStep * 1000); // Convert to ms
                    }
                }
            }
            
            // Calculate interpolation alpha for all entities
            const timeSincePhysics = performance.now() - this.lastPhysicsTime;
            const physicsStepMs = this.physicsStep * 1000;
            this.physicsInterpolationAlpha = Math.min(timeSincePhysics / physicsStepMs, 1.0);
            
            let entitiesToRemove = [];
            for (let i = 0; i < this.game.state.entities.length; i++) {
                let e = this.game.state.entities[i];
                e.update();
                if(!e.destroyed){
                    if(!this.game.isServer){
                        e.draw();
                    }
                    e.postUpdate();  
                } else {
                    entitiesToRemove.push(i);
                }     
            }
            for(let i = entitiesToRemove.length - 1; i >= 0; i--){
                this.game.state.entities.splice(entitiesToRemove[i], 1);
            }
            
            this.postUpdate();
        }
    }


    getTerrainHeight(position) {
        return this.world ? this.world.getTerrainHeight(position) : 0;
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