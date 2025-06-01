class Transform extends engine.Component {
    init({position, scaleX, scaleY, scaleZ, rotationX, rotationY, rotationZ}) {

        this.position = new THREE.Vector3(position.x, position.y, position.z);
        this.lastPosition = new THREE.Vector3(position.x, position.y, position.z);
        this.gridPosition = new THREE.Vector2(position.x, position.y);
        this.drawPosition = new THREE.Vector2(position.x, position.y);
        this.scale = new THREE.Vector3(scaleX, scaleY, scaleZ);
        this.quaternion = new THREE.Quaternion();
        this.quaternion.setFromAxisAngle( new THREE.Vector3( rotationX, rotationY, rotationZ ), Math.PI / 2 );
        
        this.parent.transform = this;
        if(this.game.gameEntity){
            this.position.y = this.parent.getCurrentTerrainHeight();
        }     
    }

    update() {
    }

    postUpdate() {
        this.lastPosition.x = this.position.x;
        this.lastPosition.y = this.position.y;
        this.lastPosition.z = this.position.z;
    }
    draw() {

    }
    
}