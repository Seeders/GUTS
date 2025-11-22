class PlanckBody extends GUTS.Component {
    
    constructor(game, parent, params) {
        super(game, parent, params);
    }
    
    
init({box2DBodySize = 1, density = 1, friction= 0, layer = 0x0001, collidesWith = 0x0001}) {
  
   const { Box } = planck;
  this.body = this.game.planckWorld.createBody({
    type: "dynamic",
    position: {x: this.parent.transform.position.x, y: this.parent.transform.position.y}
  });
  this.body.createFixture({
      shape: new Box(1.0, 1.0),
      density: density,
      friction: friction,
  });
  this.speedScale = 10;
}

update() {
  if (!this.body) return;
  const bodyPos = this.body.getTransform().p;

  // Update game object position
  this.parent.transform.position.x = bodyPos.x;
  this.parent.transform.position.y = bodyPos.y;

}

setVelocity(vel) {
	this.body.setLinearVelocity({ x: vel.x*this.speedScale, y: vel.y * this.speedScale });
}
getVelocity() {
  let vel = this.body.getLinearVelocity();
  return { x: vel.x / this.speedScale, y: vel.y / this.speedScale };
}
postUpdate() {
  //this.body.applyForce({ x: 10, y: 0}, { x: this.parent.transform.position.x, y: this.parent.transform.position.y});
}
}