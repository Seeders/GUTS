class Transform extends engine.Component {
    init({position, scale, rotation}) {
        let x, y, z = 0;
        if(position){
            x = position.x;
            y = position.y;
            z = position.z;
        }   
        this.position = new THREE.Vector3(x, y, z);
        this.velocity = new THREE.Vector3();
        this.physicsVelocity = new THREE.Vector3();
        this.lastPosition = new THREE.Vector3(x, y, z);
        this.physicsPosition = new THREE.Vector3(x, y, z);
        this.gridPosition = new THREE.Vector2(x, y);
        this.drawPosition = new THREE.Vector2(x, y);
        this.scale = scale ? new THREE.Vector3(scale.x, scale.y, scale.z) : new THREE.Vector3(1,1,1);
        this.quaternion = new THREE.Quaternion();  
        if(rotation){
            let euler = new THREE.Euler(rotation.x, rotation.y, rotation.z);
            this.quaternion.setFromEuler(euler);
        }
        this.parent.transform = this;      
        this.networkPosition = this.position.clone();
        this.networkQuaternion = this.quaternion.clone();   
        this.networkVelocity = this.velocity.clone();   
        this.setGridPosition(); 

    }
  
    getNetworkData(){ 
        return {
            position: {
                x: this.position.x || 0, 
                y: this.position.y || 0,
                z: this.position.z || 0
            },
            quaternion: {
                x:  this.quaternion.x || 0,
                y:  this.quaternion.y || 0,
                z:  this.quaternion.z || 0,
                w:  this.quaternion.w || 0
            },
            velocity: {
                x: this.velocity.x || 0,
                y: this.velocity.y || 0,
                z: this.velocity.z || 0
            }
        }
        
    }

    setNetworkData(data, isRemote){
        if (data.position) {
            this.networkPosition.set(
                data.position.x,
                data.position.y,
                data.position.z
            );
        }
        
        if (data.quaternion) {               
            this.networkQuaternion.set(
                data.quaternion.x,
                data.quaternion.y,
                data.quaternion.z,
                data.quaternion.w
            );            
        }
        
        if (data.velocity) {
            this.networkVelocity.set(
                data.velocity.x,
                data.velocity.y,
                data.velocity.z
            );
        }
    }

    update() {        
        this.setGridPosition(); 
    }
    postUpdate() {
        
        // Update grid and draw positions
        this.lastPosition.x = this.position.x;
        this.lastPosition.y = this.position.y;
        this.lastPosition.z = this.position.z;

    }
    
    setGridPosition() {
        if(this.game.translator){
            let gridPosition = this.game.translator.pixelToGrid( this.position.x, this.position.z ); 
            this.gridPosition = this.game.translator.snapToGrid(gridPosition.x, gridPosition.y);   
            return;
        }
        this.gridPosition = { x: 0, y: 0 };
    }
}