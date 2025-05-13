class Transform extends engine.Component {
    init({x, y, z, scaleX, scaleY, scaleZ, rotationX, rotationY, rotationZ}) {

        this.position = new THREE.Vector3(x, y, z);
        this.velocity = new THREE.Vector3();
        this.physicsVelocity = new THREE.Vector3();
        this.lastPosition = new THREE.Vector3(x, y, z);
        this.physicsPosition = new THREE.Vector3(x, y, z);
        this.gridPosition = new THREE.Vector2(x, y);
        this.drawPosition = new THREE.Vector2(x, y);
        this.scale = new THREE.Vector3(scaleX, scaleY, scaleZ);
        this.quaternion = new THREE.Quaternion();
        this.quaternion.setFromAxisAngle( new THREE.Vector3( rotationX, rotationY, rotationZ ), Math.PI / 2 );        
        this.parent.transform = this;         
        this.groundHeight = 0;
    }
    update() {
        this.groundHeight = this.getGroundHeight();
    }

    getGroundHeight(position) {
        const p = position ? position : this.position;
        if(!this.world && this.game?.gameEntity){
            this.world = this.game.gameEntity.getComponent("InfiniWorld");            
        }
        if(this.world){
            return this.world.getTerrainHeight(p);
        }
        return 0;
    }

    isGrounded(position) {
        const p = position ? position : this.position;
        return p.y <= this.groundHeight;
    }

    postUpdate() {
        
        // Update grid and draw positions
        this.lastPosition.x = this.position.x;
        this.lastPosition.y = this.position.y;
        this.lastPosition.z = this.position.z;

    }
    
}