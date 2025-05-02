class THREE_PointerLockControls {
    constructor(camera, domElement) {
        this.camera = camera;
        this.domElement = domElement || document.body;
        this.isLocked = false;
        this.minPolarAngle = 0; // Radians
        this.maxPolarAngle = Math.PI; // Radians
        this.pointerSpeed = 0.002;

        // Internal objects for rotation
        this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
        this.vector = new THREE.Vector3();

        // Bind methods
        this.onMouseMove = this.onMouseMove.bind(this);
        this.onPointerLockChange = this.onPointerLockChange.bind(this);
        this.onPointerLockError = this.onPointerLockError.bind(this);

        // Event listeners
        this.domElement.addEventListener('click', () => this.lock());
        document.addEventListener('pointerlockchange', this.onPointerLockChange);
        document.addEventListener('pointerlockerror', this.onPointerLockError);
    }

    onMouseMove(event) {
        if (!this.isLocked) return;

        const movementX = event.movementX || event.mozMovementX || event.webkitMovementX || 0;
        const movementY = event.movementY || event.mozMovementY || event.webkitMovementY || 0;

        // Update camera rotation
        this.euler.setFromQuaternion(this.camera.quaternion);
        this.euler.y -= movementX * this.pointerSpeed;
        this.euler.x -= movementY * this.pointerSpeed;
        this.euler.x = Math.max(
            Math.PI / 2 - this.maxPolarAngle,
            Math.min(Math.PI / 2 - this.minPolarAngle, this.euler.x)
        );
        this.camera.quaternion.setFromEuler(this.euler);
    }

    onPointerLockChange() {
        this.isLocked = document.pointerLockElement === this.domElement;
        if (this.isLocked) {
            document.addEventListener('mousemove', this.onMouseMove);
        } else {
            document.removeEventListener('mousemove', this.onMouseMove);
        }
    }

    onPointerLockError() {
        console.error('PointerLockControls: Unable to use Pointer Lock API');
    }

    lock() {
        this.domElement.requestPointerLock();
    }

    unlock() {
        document.exitPointerLock();
    }

    getObject() {
        return this.camera;
    }

    getDirection(v) {
        this.camera.getWorldDirection(this.vector);
        return v.copy(this.vector);
    }

    dispose() {
        this.unlock();
        this.domElement.removeEventListener('click', this.lock);
        document.removeEventListener('pointerlockchange', this.onPointerLockChange);
        document.removeEventListener('pointerlockerror', this.onPointerLockError);
        document.removeEventListener('mousemove', this.onMouseMove);
    }
}