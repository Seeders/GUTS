class Animator extends engine.Component {
    
    
    init({ objectType, spawnType}) {
        if(!this.animations) this.animations = {};
        this.currentAnimation = "idle";
        this.currentFrame = 0;
        this.frameDuration = .166; // 10 frames per animation frame (~0.166s at 60 FPS)
        this.frameTimer = 0;

        this.baseSpeed = this.parent.getComponent("stats")?.stats.speed || 1;
    }

    update() {
        
        this.frameTimer += this.game.deltaTime;
        let currentSpeedPercent = this.parent.getComponent("stats")?.stats.speed / this.baseSpeed || 1;

        if (this.frameTimer >= this.frameDuration / currentSpeedPercent && this.animations[this.currentAnimation]) {
            this.frameTimer = 0;
            const animFrames = this.animations[this.currentAnimation];
            this.currentFrame = (this.currentFrame + 1) % animFrames.length;
        }
        // Sync direction with Renderer (if separate)
        const renderer = this.parent.getComponent("Renderer");
        if (renderer && this.animations[this.currentAnimation] && this.animations[this.currentAnimation][this.currentFrame]) {
            renderer.images = this.animations[this.currentAnimation][this.currentFrame];
        }
    }

    setAnimation(animationType) {
        if (this.animations[animationType] && this.currentAnimation !== animationType) {
            this.currentAnimation = animationType;
            this.currentFrame = 0;
            this.frameTimer = 0;
        }
    }
    
}