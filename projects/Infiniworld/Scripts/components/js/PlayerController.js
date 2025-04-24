class PlayerController extends engine.Component {
    init({
        infiniWorld, // Reference to InfiniWorld instance
        moveSpeed: acceleration = 20 // Movement speed in units/second
    }) {
        this.infiniWorld = infiniWorld;
        this.scene = infiniWorld.scene;
        this.camera = infiniWorld.camera; // Use InfiniWorld's camera
        this.acceleration = acceleration;

 
        // Initialize PointerLockControls
        this.controls = new (this.game.libraryClasses.Three_PointerLockControls)(this.camera, this.infiniWorld.renderer.domElement);
        this.controls.pointerSpeed = 0.001; // Adjust sensitivity
        this.scene.add(this.controls.getObject()); // Add camera to scene

        // Movement properties
        this.moveForward = false;
        this.moveBackward = false;
        this.moveLeft = false;
        this.moveRight = false;
        this.velocity = new THREE.Vector3();
        this.direction = new THREE.Vector3();

        // Bind event handlers
        this.onKeyDown = this.onKeyDown.bind(this);
        this.onKeyUp = this.onKeyUp.bind(this);
        document.addEventListener('keydown', this.onKeyDown);
        document.addEventListener('keyup', this.onKeyUp);

        // Initialize camera position
        this.updateCameraPosition();
    }

    // Keyboard input handlers
    onKeyDown(event) {
        switch (event.code) {
            case 'KeyW': this.moveForward = true; break;
            case 'KeyS': this.moveBackward = true; break;
            case 'KeyA': this.moveLeft = true; break;
            case 'KeyD': this.moveRight = true; break;
        }
    }

    onKeyUp(event) {
        switch (event.code) {
            case 'KeyW': this.moveForward = false; break;
            case 'KeyS': this.moveBackward = false; break;
            case 'KeyA': this.moveLeft = false; break;
            case 'KeyD': this.moveRight = false; break;
        }
    }

    // Update camera to align with model
    updateCameraPosition() {
        // Set camera at eye level (playerHeight above terrain)

    }

    // Update method
    update() {


        // Compute direction
        this.direction.z = Number(this.moveForward) - Number(this.moveBackward);
        this.direction.x = Number(this.moveRight) - Number(this.moveLeft);
        this.direction.normalize(); // Prevent faster diagonal movement

        // Apply velocity
        if (this.moveForward || this.moveBackward) {
            this.velocity.z += this.direction.z * this.acceleration * this.game.deltaTime;
        }
        if (this.moveLeft || this.moveRight) {
            this.velocity.x += this.direction.x * this.acceleration * this.game.deltaTime;
        }

        // Get camera's forward direction (XZ plane)
        const forward = new THREE.Vector3();
        this.controls.getDirection(forward);
        forward.y = 0; // Restrict to XZ plane
        forward.normalize();

        // Compute right vector
        const right = new THREE.Vector3();
        right.crossVectors(forward, new THREE.Vector3(0, 1, 0));

        // Update model position
        this.parent.position.x += (forward.x * this.velocity.z + right.x * this.velocity.x);
        this.parent.position.z += (forward.z * this.velocity.z + right.z * this.velocity.x);
        this.parent.position.y = 40;//this.infiniWorld.getTerrainHeight(this.parent.position.x, this.parent.position.z);

        this.camera.position.z = this.parent.position.z;
        this.camera.position.x = this.parent.position.x;
        this.camera.position.y = this.parent.position.y+20;
    }

    // Cleanup
    onDestroy() {
        this.controls.dispose();
        document.removeEventListener('keydown', this.onKeyDown);
        document.removeEventListener('keyup', this.onKeyUp);
        this.scene.remove(this.model);
        if (this.model.geometry) this.model.geometry.dispose();
        if (this.model.material) this.model.material.dispose();
    }
}