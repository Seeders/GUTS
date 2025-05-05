class MultishotProjectile extends engine.Component {
    
    constructor(game, parent, params) {
        super(game, parent, params);
    }
    
    
init({ spawnType, stats, target, owner }) {
  this.type = spawnType;
  this.stats = stats;
  this.target = target;
  const ownerStats = owner.getComponent('stats').stats;
  const spreadCount = ownerStats.projectileCount || 3; // Total projectiles (e.g., 3: center + 2 sides)
    const spreadAngleDegrees = ownerStats.projectileAngle || 45; // Default to 45 degrees
  const spreadAngle = spreadAngleDegrees * (Math.PI / 180); // Convert degrees to radians

 
  // Calculate the base direction to the target
  const dx = target.transform.position.x - this.parent.transform.position.x;
  const dy = target.transform.position.y - this.parent.transform.position.y;
  const baseAngle = Math.atan2(dy, dx); // Angle from parent to target in radians
  const distance = Math.sqrt(dx * dx + dy * dy);

  // Total spread angle (e.g., for 3 projectiles: -spreadAngle, 0, +spreadAngle)
  const totalSpread = spreadAngle * (spreadCount - 1); // Max angle covered by all projectiles

  // Spawn projectiles in a symmetrical fan
  for (let i = 0; i < spreadCount; i++) {
    // Calculate the angle offset from the center
    const offsetIndex = i - Math.floor(spreadCount / 2); // Center at 0 (e.g., -1, 0, 1 for 3)
    const currentAngle = baseAngle + (offsetIndex * spreadAngle);

    // Calculate the new target position based on the angle
    const deltaX = Math.cos(currentAngle) * distance;
    const deltaY = Math.sin(currentAngle) * distance;

    this.game.spawn(
      "projectile",
      {
        spawnType: ownerStats.projectile,
        objectType: "projectiles",
        owner: owner,
        stats: stats,
        target: target,
        targetPosition: {
          x: this.parent.transform.position.x + deltaX, // Start from parent, extend to new position
          y: this.parent.transform.position.y + deltaY
        }
      },
      this.parent.transform.position
    );
  }

  this.parent.destroy();
}
}