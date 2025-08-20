class GameUtils {
    static DEFAULT_UNIT_RADIUS = 25;
    static MIN_MOVEMENT_THRESHOLD = 0.1;
    
    static getUnitRadius(collision) {
        return collision?.radius ? Math.max(this.DEFAULT_UNIT_RADIUS, collision.radius) : this.DEFAULT_UNIT_RADIUS;
    }
    
    static calculateDistance(pos1, pos2, collision1 = null, collision2 = null) {
        const dx = pos2.x - pos1.x;
        const dz = pos2.z - pos2.z;
        const centerDistance = Math.sqrt(dx * dx + dz * dz);
        
        if (!collision1 || !collision2) return centerDistance;
        
        const radius1 = this.getUnitRadius(collision1);
        const radius2 = this.getUnitRadius(collision2);
        
        return {
            center: centerDistance,
            edge: Math.max(0, centerDistance - radius1 - radius2),
            toTargetEdge: Math.max(0, centerDistance - radius2)
        };
    }
    
    static lerp(a, b, t) {
        return a + (b - a) * t;
    }    
}