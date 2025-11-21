class Transform extends GUTS.Component {
    init({position, scale, rotation}) {
        let x, y, z = 0;
        if(position){
            x = position.x;
            y = position.y;
            z = position.z;
        }
        this.position = new THREE.Vector3(x, y, z);
        this.lastPosition = new THREE.Vector3(x, y, z);
        this.gridPosition = new THREE.Vector2(x, y);
        this.drawPosition = new THREE.Vector2(x, y);
        this.scale = scale ? new THREE.Vector3(scale.x, scale.y, scale.z) : new THREE.Vector3(1,1,1);
        this.quaternion = new THREE.Quaternion();  
        if(rotation){
            let euler = new THREE.Euler(rotation.x, rotation.y, rotation.z);
            this.quaternion.setFromEuler(euler);
        }
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