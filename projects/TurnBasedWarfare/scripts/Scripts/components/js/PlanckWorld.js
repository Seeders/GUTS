class PlanckWorld extends engine.Component {
    
    constructor(game, parent, params) {
        super(game, parent, params);
    }
    
    
//planckWorld component
init({gravity = 10, gravityX = 0, gravityY = 0}) {
  this.velocityIterations = 6;
  this.positionIterations = 2;
  this.physicsUpdateTimer = 0;
  this.timeStep = 1 / 60; // Fixed timestep of 60fps
  
   const { World } = planck;
    this.game.planckWorld = new World();
}

postUpdate() {
    this.game.planckWorld.step(this.timeStep, this.velocityIterations, this.positionIterations);
}
}