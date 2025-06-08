class FollowPath extends engine.Component {

    init({ pathIndex = 0 }) {
        this.gridSize = this.game.getCollections().configs.game.gridSize;
        this.pathIndex = pathIndex;
        this.indexInPath = 0;
        // Store grid coordinates
        this.x = this.game.state.paths[this.pathIndex][this.indexInPath].x;
        this.y = this.game.state.paths[this.pathIndex][this.indexInPath].y;
        // Convert to pixel position
        this.parent.transform.position.x = this.x * this.gridSize + this.gridSize / 2;
        this.parent.transform.position.y = this.y * this.gridSize + this.gridSize / 2;

        this.progress = 0; // Progress between grid points (0 to 1)
        this.gridSize = this.game.getCollections().configs.game.gridSize;
        
        // Convert pixel-based speed to grid-based speed
    }

    update() {
        this.stats = this.getComponent('stats').stats;

        if (this.indexInPath < this.game.state.paths[this.pathIndex].length - 1) {
            const target = this.game.state.paths[this.pathIndex][this.indexInPath + 1];
            
            // Use converted grid-based speed
            this.progress += (this.stats.speed / this.gridSize) * this.game.deltaTime * 100;
            
            if (this.progress >= 1) {
                this.indexInPath++;
                this.progress = 0;
                this.x = target.x;
                this.y = target.y;
            } else {
                // Interpolate between current and target grid positions
                this.x = this.game.state.paths[this.pathIndex][this.indexInPath].x * (1 - this.progress) + 
                        target.x * this.progress;
                this.y = this.game.state.paths[this.pathIndex][this.indexInPath].y * (1 - this.progress) + 
                        target.y * this.progress;
            }
            
            // Convert grid coordinates to pixel coordinates
            this.parent.transform.position.x = this.x * this.gridSize + this.gridSize / 2;
            this.parent.transform.position.y = this.y * this.gridSize + this.gridSize / 2;
            this.parent.transform.position.z = this.game.gameEntity.getComponent('game').getTerrainHeight(this.parent.transform.gridPosition);
        } else {
            this.game.state.bloodCoreHP -= this.stats.value;
            this.parent.destroy();
            return false;
        }
    }
}