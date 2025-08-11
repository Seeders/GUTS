class AnimationSystem {
    constructor(game){
        this.game = game;
        this.game.animationSystem = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();
        
    }
    update(deltaTime) {

        const entities = this.game.getEntitiesWith(this.componentTypes.ANIMATION);
        
        entities.forEach(entityId => {
            const animation = this.game.getComponent(entityId, this.componentTypes.ANIMATION);
            
            // Decay flash effect
            if (animation.flash > 0) {
                animation.flash -= deltaTime * 2;
                if (animation.flash < 0) animation.flash = 0;
            }
        });
    }
}
