class ThreeJsWorld extends engine.Component {

    init({ 
        containerSelector = '#gameContainer', 
        width = window.innerWidth, 
        height = window.innerHeight,
        cameraConfig = {
            fov: 45,
            near: 0.1,
            far: 1000,
            position: { x: 100, y: 100, z: 100 },
            lookAt: { x: 0, y: 0, z: 0 }
        },
        useControls = true,
        lightConfig = {
            ambient: { color: 0xffaaff, intensity: 0.25 },
            directional: { color: 0xffffaa, intensity: 0.7 },
            fill: { color: 0xffaaff, intensity: 0.5 }
        },
        shadowConfig = {
            enabled: true,
            mapSize: 1024,
            bias: -0.0005,
            normalBias: 0.02
        },
        background = 0x87CEEB, // Sky blue
        fog = { enabled: true, color: 0xCCCCCC, near: 100, far: 600 }
    }) {           
        // Performance monitoring
        this.showStats = false;
        
        // Clock for animation timing
        this.clock = new THREE.Clock();
        
        // Resize handler
        this.onWindowResizeHandler = this.onWindowResize.bind(this);
        
        // Get or create container element
        this.container = document.querySelector(containerSelector);
        // Initialize renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true, canvas: this.game.canvas });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.shadowMap.enabled = shadowConfig.enabled;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        // Create scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(background);
        
        // Add fog if enabled
        if (fog.enabled) {
            this.scene.fog = new THREE.Fog(fog.color, fog.near, fog.far);
        }
        
        // Create camera
        this.camera = new THREE.PerspectiveCamera(
            cameraConfig.fov,
            width / height,
            cameraConfig.near,
            cameraConfig.far
        );
        this.camera.position.set(
            cameraConfig.position.x,
            cameraConfig.position.y,
            cameraConfig.position.z
        );
        this.camera.lookAt(
            cameraConfig.lookAt.x,
            cameraConfig.lookAt.y,
            cameraConfig.lookAt.z
        );
        
        // Camera controls
        if (useControls) {
            this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
            this.controls.target.set(
                cameraConfig.lookAt.x,
                cameraConfig.lookAt.y,
                cameraConfig.lookAt.z
            );
            this.controls.update();
        }
        
        // Create lights
        // Ambient light
        this.ambientLight = new THREE.AmbientLight(
            lightConfig.ambient.color,
            lightConfig.ambient.intensity
        );
        this.scene.add(this.ambientLight);
        
        // Main directional light with shadows
        this.directionalLight = new THREE.DirectionalLight(
            lightConfig.directional.color,
            lightConfig.directional.intensity
        );
        this.directionalLight.position.set(75, 96, 75);
        this.directionalLight.castShadow = shadowConfig.enabled;
        
        // Configure shadow properties
        if (shadowConfig.enabled) {
            this.directionalLight.shadow.mapSize.width = shadowConfig.mapSize;
            this.directionalLight.shadow.mapSize.height = shadowConfig.mapSize;
            this.directionalLight.shadow.camera.near = 0.5;
            this.directionalLight.shadow.camera.far = 500;
            this.directionalLight.shadow.bias = shadowConfig.bias;
            this.directionalLight.shadow.normalBias = shadowConfig.normalBias;
            this.directionalLight.shadow.radius = 1;
            
            // Configure shadow camera frustum
            const d = 200;
            this.directionalLight.shadow.camera.left = -d;
            this.directionalLight.shadow.camera.right = d;
            this.directionalLight.shadow.camera.top = d;
            this.directionalLight.shadow.camera.bottom = -d;
            this.directionalLight.shadow.camera.updateProjectionMatrix();
        }
        
        this.scene.add(this.directionalLight);
        
        // Fill light
        this.fillLight = new THREE.DirectionalLight(
            lightConfig.fill.color,
            lightConfig.fill.intensity
        );
        this.fillLight.position.set(-20, 30, -20);
        this.scene.add(this.fillLight);
        
        // Create ground plane
        const groundGeometry = new THREE.PlaneGeometry(1000, 1000);
        const groundMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x999999, 
            roughness: 0.8,
            metalness: 0.2
        });
        const ground = new THREE.Mesh(groundGeometry, groundMaterial);
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = 0;
        ground.receiveShadow = true;
        this.scene.add(ground);
        
        // Add a grid helper
        const gridHelper = new THREE.GridHelper(1000, 100, 0x444444, 0x888888);
        this.scene.add(gridHelper);
        
        // Add coordinate axes helper
        const axesHelper = new THREE.AxesHelper(5);
        this.scene.add(axesHelper);
        
        // Add stats if enabled
        if (this.showStats) {
            this.stats = new Stats();
            this.container.appendChild(this.stats.dom);
        }
        
        // Add event listeners
        window.addEventListener('resize', this.onWindowResizeHandler);
        
        // Make the scene accessible to the game
        this.game.scene = this.scene;
        this.game.camera = this.camera;
        this.game.renderer = this.renderer;
    }
    
    // Handle window resize
    onWindowResize() {
        const width = this.container.clientWidth || window.innerWidth;
        const height = this.container.clientHeight || window.innerHeight;
        
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }
    
    // Update and render the scene
    update(deltaTime) {
        // Update controls if they exist
        if (this.controls) {
            this.controls.update();
        }
        
        // Update stats if they exist
        if (this.stats) {
            this.stats.update();
        }
        
        // Render the scene
        this.renderer.render(this.scene, this.camera);
    }
    
    // Create a follow camera that tracks a target object
    setupFollowCamera(target, offsetX = 50, offsetY = 50, offsetZ = 50, lookAhead = 0) {
        if (!target) return;
        
        // Create a function that updates camera position to follow target
        const updateFollowCamera = () => {
            const targetPosition = target.position || target;
            
            // Set camera position relative to target
            this.camera.position.set(
                targetPosition.x + offsetX,
                targetPosition.y + offsetY,
                targetPosition.z + offsetZ
            );
            
            // Look at target, possibly with some look-ahead
            this.camera.lookAt(
                targetPosition.x + lookAhead * (targetPosition.x - target.lastPosition?.x || 0),
                targetPosition.y + lookAhead * (targetPosition.y - target.lastPosition?.y || 0),
                targetPosition.z + lookAhead * (targetPosition.z - target.lastPosition?.z || 0)
            );
        };
        
        // Disable orbit controls if enabled
        if (this.controls) {
            this.controls.enabled = false;
        }
        
        // Store the update function on the camera
        this.camera.updateFollowCamera = updateFollowCamera;
        
        // Execute first update
        updateFollowCamera();
        
        // Return the update function so it can be called in the game loop
        return updateFollowCamera;
    }
    
    // Switch to isometric view
    setIsometricView() {
        const isoAngle = Math.atan(1 / Math.sqrt(2));
        const distance = 200;
        const horizDistance = distance * Math.cos(isoAngle);
        const vertDistance = distance * Math.sin(isoAngle);
        
        // Set camera to isometric position
        this.camera.position.set(horizDistance, vertDistance, horizDistance);
        this.camera.lookAt(0, 0, 0);
        
        // Update controls if they exist
        if (this.controls) {
            this.controls.target.set(0, 0, 0);
            this.controls.update();
        }
    }
    
    // Switch to top-down view
    setTopDownView(height = 200) {
        this.camera.position.set(0, height, 0);
        this.camera.lookAt(0, 0, 0);
        
        // Update controls if they exist
        if (this.controls) {
            this.controls.target.set(0, 0, 0);
            this.controls.update();
        }
    }
    
    // Create a new light that follows the player
    addPlayerLight(target, color = 0xffffbb, intensity = 0.7, distance = 50) {
        const playerLight = new THREE.PointLight(color, intensity, distance);
        playerLight.castShadow = true;
        playerLight.shadow.mapSize.width = 512;
        playerLight.shadow.mapSize.height = 512;
        
        // Create a function to update light position
        const updateLightPosition = () => {
            const targetPosition = target.position || target;
            playerLight.position.set(
                targetPosition.x,
                targetPosition.y + 10, // Position light above player
                targetPosition.z
            );
        };
        
        // Add light to scene
        this.scene.add(playerLight);
        updateLightPosition();
        
        // Return update function and light reference
        return { 
            light: playerLight, 
            update: updateLightPosition 
        };
    }
    
    // Clean up
    onDestroy() {
        debugger;
        // Remove event listeners
        window.removeEventListener('resize', this.onWindowResizeHandler);
        
        // Dispose Three.js objects
        this.renderer.dispose();
        
        // Remove stats if it exists
        if (this.stats && this.stats.dom && this.stats.dom.parentElement) {
            this.stats.dom.parentElement.removeChild(this.stats.dom);
        }
        
        // Remove renderer from DOM
        if (this.renderer.domElement && this.renderer.domElement.parentElement) {
            this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
        }
        
        // Remove references to Three.js objects from game
        this.game.scene = null;
        this.game.camera = null;
        this.game.renderer = null;
    }
}