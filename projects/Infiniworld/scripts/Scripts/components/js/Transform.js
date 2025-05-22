class Transform extends engine.Component {
    init({position, scaleX, scaleY, scaleZ, rotationX, rotationY, rotationZ}) {
        let x = position.x;
        let y = position.y;
        let z = position.z;
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
        this.networkPosition = this.position.clone();
        this.networkQuaternion = this.quaternion.clone();   
        this.networkVelocity = this.velocity.clone();   

    }
  
    getNetworkData(){        
        return {
            position: {
                x: this.position.x, 
                y: this.position.y,
                z: this.position.z
            },
            quaternion: {
                x:  this.quaternion.x,
                y:  this.quaternion.y,
                z:  this.quaternion.z,
                w:  this.quaternion.w
            },
            velocity: {
                x: this.velocity.x,
                y: this.velocity.y,
                z: this.velocity.z
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
            if(this.game.isServer || isRemote){  //dont override local quaternion              
                this.networkQuaternion.set(
                    data.quaternion.x,
                    data.quaternion.y,
                    data.quaternion.z,
                    data.quaternion.w
                );
            }
        }
        
        if (data.velocity) {
            this.networkVelocity.set(
                data.velocity.x,
                data.velocity.y,
                data.velocity.z
            );
        }
    }

    postUpdate() {
        
        // Update grid and draw positions
        this.lastPosition.x = this.position.x;
        this.lastPosition.y = this.position.y;
        this.lastPosition.z = this.position.z;

    }
    
}