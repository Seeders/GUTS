    init( { pathIndex = 0 }) {
        this.gridSize = this.game.config.configs.game.gridSize;
        this.pathIndex = pathIndex;
        this.indexInPath = 0;
        this.x = this.game.state.paths[this.pathIndex][this.indexInPath].x;
        this.y = this.game.state.paths[this.pathIndex][this.indexInPath].y;
        this.parent.position = { x: this.x * this.gridSize + this.gridSize / 2, y: this.y * this.gridSize + this.gridSize / 2 };        
    }

    update() {
        this.stats = this.getComponent('stats').stats;
        this.gridSize = this.game.config.configs.game.gridSize;
        if (this.indexInPath < this.game.state.paths[this.pathIndex].length - 1) {
            const target = this.game.state.paths[this.pathIndex][this.indexInPath + 1];
            const dx = target.x * this.gridSize + (this.gridSize / 2) - this.parent.position.x;
            const dy = target.y * this.gridSize + (this.gridSize / 2) - this.parent.position.y;
            const dist = Math.hypot(dx, dy);

            if (dist > this.stats.speed) {
                this.parent.position.x += (dx / dist) * this.stats.speed;
                this.parent.position.y += (dy / dist) * this.stats.speed;
            } else {
                this.indexInPath++;
            }
            this.x = parseInt(this.parent.position.x / this.gridSize);
            this.y = parseInt(this.parent.position.y / this.gridSize);
        } else {
            this.game.state.bloodCoreHP -= this.stats.value;
            this.parent.destroy();
            return false;
        }
    }