class Game extends engine.Component {
   
    constructor(game, parent, params) {
        super(game, parent, params);
        this.physicsAccumulator = 0;
        this.lastTime = Date.now();
    }
   
    init() {
        this.physics = this.getComponent('Physics');
        this.gridSize = this.game.config.configs.game.gridSize;      
        this.world = this.getComponent('InfiniWorld');
        this.fpsDiv = document.createElement('div');
        this.fpsDiv.style.position = "absolute";
        this.fpsDiv.style.top = '10px';
        this.fpsDiv.style.left = '10px';
        this.fpsDiv.style.zIndex = '10000';
        document.body.append(this.fpsDiv);
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
                this.fpsDiv.textContent = this.fps.fpsValue;
            }
            
            // Fixed physics update
          //  const physicsStep = 1/60; // 60 Hz physics update
           // this.physicsAccumulator += this.game.deltaTime;
         
            // Single entity loop
            const entitiesToKeep = [];
           // let shouldUpdatePhysics = true;
           // if(this.physicsAccumulator >= physicsStep) {
                this.physics.startPhysicsUpdate( this.game.deltaTime );
            //    shouldUpdatePhysics = true;
           // }
            
            for (let i = 0; i < this.game.state.entities.length; i++) {
                let e = this.game.state.entities[i];
                let result = e.update();
                if (result) {
                    entitiesToKeep.push(e);
                    e.draw();
                    e.postUpdate();                  
                }
            }
            

            this.physics.setStaticAABBs(this.world.getStaticAABBs());
          //  if (this.physicsAccumulator >= physicsStep) {
            //    if (shouldUpdatePhysics) {
            this.physics.sendToWorker(this.world);
             //   }
             //   this.physicsAccumulator -= physicsStep;
           // }
            this.game.state.entities = entitiesToKeep;
            
            this.postUpdate();
            this.game.entitiesToAdd.forEach((entity) => this.game.state.addEntity(entity));
            this.game.entitiesToAdd = [];
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