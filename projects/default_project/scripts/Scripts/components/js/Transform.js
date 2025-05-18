class Transform extends engine.Component {
    init({x, y, z, scaleX, scaleY, scaleZ, rotationX, rotationY, rotationZ}) {

        this.position = new THREE.Vector3(x, y, z);
        this.lastPosition = new THREE.Vector3(x, y, z);
        this.drawPosition = new THREE.Vector2(x, y);
        this.scale = new THREE.Vector3(scaleX, scaleY, scaleZ);
        this.quaternion = new THREE.Quaternion();
        this.quaternion.setFromAxisAngle( new THREE.Vector3( rotationX, rotationY, rotationZ ), Math.PI / 2 );
        
        this.parent.transform = this;
        this.setGridPosition(); 
    }

    update() {
    }

    postUpdate() {
        this.lastPosition.x = this.position.x;
        this.lastPosition.y = this.position.y;
        this.lastPosition.z = this.position.z;
        this.setGridPosition(); 
    }
    draw() {

    }
    setGridPosition() {
        if(this.game.translator){
            let gridPosition = this.game.translator.pixelToGrid( this.position.x, this.position.y ); 
            this.gridPosition = this.game.translator.snapToGrid(gridPosition.x, gridPosition.y);   
            return;
        }
        this.gridPosition = { x: 0, y: 0 };
    }
}