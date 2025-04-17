class ThreeJsWorld extends engine.Component {

    init({ 
        containerSelector = '#gameContainer', 
        width = window.innerWidth, 
        height = window.innerHeight,
        cameraConfig = {
            fov: 45,
            near: 0.1,
            far: 5000,
            position: { x: 768/2, y: 500, z: 768*1.5 },
            lookAt: { x: 768/2, y: 0, z: 768/2 }
        },
        useControls = true,
        lightConfig = {
            ambient: { color: 0xaaddff, intensity: 0.4 },
            directional: { color: 0xfff8e1, intensity: 0.8 },
            hemisphere: { skyColor: 0x87CEEB, groundColor: 0x4a7c59, intensity: 0.5 }
        },
        shadowConfig = {
            enabled: true,
            mapSize: 2048,
            bias: -0.0002,
            normalBias: 0.01,
            radius: 2
        },
        background = 0x87CEEB,
        fog = { enabled: true, color: 0x87CEEB, density: 0.0005 }
    }) {       
        if(!this.game.config.configs.game.is3D) {
            return;
        }    
        this.showStats = false;
        this.clock = new THREE.Clock();
        this.onWindowResizeHandler = this.onWindowResize.bind(this);
        
        this.container = document.querySelector(containerSelector) || document.body;
        this.renderer = new THREE.WebGLRenderer({ antialias: true, canvas: this.game.canvas });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.shadowMap.enabled = shadowConfig.enabled;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(background);
        
        if (fog.enabled) {
            this.scene.fog = new THREE.FogExp2(fog.color, fog.density);
        }
        
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
        
        if (useControls) {
            this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
            this.controls.target.set(
                cameraConfig.lookAt.x,
                cameraConfig.lookAt.y,
                cameraConfig.lookAt.z
            );
            this.controls.update();
        }
        
        this.ambientLight = new THREE.AmbientLight(
            lightConfig.ambient.color,
            lightConfig.ambient.intensity
        );
        this.scene.add(this.ambientLight);
        
        this.directionalLight = new THREE.DirectionalLight(
            lightConfig.directional.color,
            lightConfig.directional.intensity
        );
        this.terrainSize = 768; // Original terrain size
        this.directionalLight.position.set(this.terrainSize*2, this.terrainSize*2, this.terrainSize*2);
        this.directionalLight.castShadow = shadowConfig.enabled;
        
        this.extendedSize = this.terrainSize * 10; // Make ground plane 4x larger
        if (shadowConfig.enabled) {
            this.directionalLight.shadow.mapSize.width = shadowConfig.mapSize;
            this.directionalLight.shadow.mapSize.height = shadowConfig.mapSize;
            this.directionalLight.shadow.camera.near = 0.5;
            this.directionalLight.shadow.camera.far = 20000; // Increased for taller objects
            this.directionalLight.shadow.bias = shadowConfig.bias;
            this.directionalLight.shadow.normalBias = shadowConfig.normalBias;
            this.directionalLight.shadow.radius = shadowConfig.radius;
            
            // Size shadow frustum to cover entire terrain
            const d = this.extendedSize * 0.6; // 60% larger than half the terrain size for padding
            this.directionalLight.shadow.camera.left = -d;
            this.directionalLight.shadow.camera.right = d;
            this.directionalLight.shadow.camera.top = d;
            this.directionalLight.shadow.camera.bottom = -d;
            
            // Center shadow camera on terrain
            this.directionalLight.target.position.set(-this.terrainSize*2, 0, -this.terrainSize*2);
            this.directionalLight.target.updateMatrixWorld();
            this.directionalLight.shadow.camera.updateProjectionMatrix();

        }
        
        this.scene.add(this.directionalLight);
        this.scene.add(this.directionalLight.target);
        
        this.hemisphereLight = new THREE.HemisphereLight(
            lightConfig.hemisphere.skyColor,
            lightConfig.hemisphere.groundColor,
            lightConfig.hemisphere.intensity
        );
        this.scene.add(this.hemisphereLight);
        
        // Create ground plane
        
        // Create a single large ground plane
        const groundGeometry = new THREE.PlaneGeometry(this.extendedSize, this.extendedSize);
        
        // Create a new canvas for the combined texture
        const combinedCanvas = document.createElement('canvas');
        combinedCanvas.width = this.extendedSize;
        combinedCanvas.height = this.extendedSize;
        this.groundCtx = combinedCanvas.getContext('2d');
        
        // Fill with background color
        this.groundCtx.fillStyle = this.game.config.levels[this.game.state.level].tileMap.terrainBGColor;
        this.groundCtx.fillRect(0, 0, this.extendedSize, this.extendedSize);
        
      
        // Create texture from combined canvas
        this.groundTexture = new THREE.CanvasTexture(combinedCanvas);
        this.groundTexture.wrapS = THREE.ClampToEdgeWrapping;
        this.groundTexture.wrapT = THREE.ClampToEdgeWrapping;
        this.groundTexture.minFilter = THREE.LinearFilter;
        this.groundTexture.magFilter = THREE.LinearFilter;
        
        const groundMaterial = new THREE.MeshStandardMaterial({ 
            map: this.groundTexture,
            roughness: 0.8,
            metalness: 0.2
        });
        
        const ground = new THREE.Mesh(groundGeometry, groundMaterial);
        ground.rotation.x = -Math.PI / 2;
        ground.position.set(this.terrainSize / 2, 0, this.terrainSize / 2);
        ground.receiveShadow = true;
        this.scene.add(ground);
      
        if (this.showStats) {
            this.stats = new Stats();
            this.container.appendChild(this.stats.dom);
        }
        
        window.addEventListener('resize', this.onWindowResizeHandler);
        
        this.game.scene = this.scene;
        this.game.camera = this.camera;
        this.game.renderer = this.renderer;
        this.drawn = false;
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
        if(!this.game.config.configs.game.is3D) {
            return;
        }
        // Update controls if they exist
        if (this.controls) {
            this.controls.update();
        }
        
        // Update stats if they exist
        if (this.stats) {
            this.stats.update();
        }
        if (!this.drawn && this.groundTexture && this.game.mapRenderer && this.game.mapRenderer.isMapCached) {
            this.groundTexture.needsUpdate = true;          
              // Calculate position to draw terrain texture (center it)
            const offset = (this.extendedSize - this.terrainSize) / 2;
            
            // Draw terrain texture in the center
            this.groundCtx.drawImage(this.game.terrainCanvasBuffer, offset, offset);
            
            this.drawn = true;
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