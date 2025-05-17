class Transform extends engine.Component {
    init({x, y, z, scaleX, scaleY, scaleZ, rotationX, rotationY, rotationZ}) {

        this.position = new THREE.Vector3(x, y, z);
        this.velocity = new THREE.Vector3();
        this.physicsVelocity = new THREE.Vector3();
        this.lastPosition = new THREE.Vector3(x, y, z);
        this.physicsPosition = new THREE.Vector3(x, y, z);
        this.gridPosition = new THREE.Vector2(x, y);
        this.drawPosition = new THREE.Vector2(x, y);
        this.scale = new THREE.Vector3(scaleX || 1, scaleY || 1, scaleZ || 1);
        this.quaternion = new THREE.Quaternion();
        this.quaternion.setFromAxisAngle( new THREE.Vector3( rotationX, rotationY, rotationZ ), Math.PI / 2 );        
        this.parent.transform = this;         

    }
  

    postUpdate() {
        
        // Update grid and draw positions
        this.lastPosition.x = this.position.x;
        this.lastPosition.y = this.position.y;
        this.lastPosition.z = this.position.z;

    }
    
}