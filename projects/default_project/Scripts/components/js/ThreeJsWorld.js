class ThreeJsWorld extends engine.Component {

    init({
        containerSelector = '#gameContainer',
        width = window.innerWidth,
        height = window.innerHeight,
        cameraConfig = {
            fov: 45,
            near: 0.1,
            far: 5000,
            position: { x: 768 / 2, y: 500, z: 768 * 1.5 },
            lookAt: { x: 768 / 2, y: 0, z: 768 / 2 }
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
        if (!this.game.config.configs.game.is3D) {
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
            this.controls.maxPolarAngle = Math.PI / 2.05; // Prevent going below ground
            this.controls.minPolarAngle = 0.1; // Prevent going completely overhead
            this.controls.enableDamping = true; // Add smooth damping
            this.controls.dampingFactor = 0.05;
            
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
        this.terrainSize = 768;
        this.directionalLight.position.set(this.terrainSize * 2, this.terrainSize * 2, this.terrainSize * 2);
        this.directionalLight.castShadow = shadowConfig.enabled;

        this.extendedSize = this.terrainSize * 10;
        if (shadowConfig.enabled) {
            this.directionalLight.shadow.mapSize.width = shadowConfig.mapSize;
            this.directionalLight.shadow.mapSize.height = shadowConfig.mapSize;
            this.directionalLight.shadow.camera.near = 0.5;
            this.directionalLight.shadow.camera.far = 20000;
            this.directionalLight.shadow.bias = shadowConfig.bias;
            this.directionalLight.shadow.normalBias = shadowConfig.normalBias;
            this.directionalLight.shadow.radius = shadowConfig.radius;

            const d = this.extendedSize * 0.6;
            this.directionalLight.shadow.camera.left = -d;
            this.directionalLight.shadow.camera.right = d;
            this.directionalLight.shadow.camera.top = d;
            this.directionalLight.shadow.camera.bottom = -d;

            this.directionalLight.target.position.set(-this.terrainSize * 2, 0, -this.terrainSize * 2);
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
        const groundGeometry = new THREE.PlaneGeometry(this.extendedSize, this.extendedSize);

        // Create canvas for terrain texture
        this.groundCanvas = document.createElement('canvas');
        this.groundCanvas.width = this.extendedSize;
        this.groundCanvas.height = this.extendedSize;
        this.groundCtx = this.groundCanvas.getContext('2d');

        // Fill with background color
        this.groundCtx.fillStyle = this.game.config.levels[this.game.state.level].tileMap.terrainBGColor;
        this.groundCtx.fillRect(0, 0, this.extendedSize, this.extendedSize);

        // Create texture
        this.groundTexture = new THREE.CanvasTexture(this.groundCanvas);
        this.groundTexture.wrapS = THREE.ClampToEdgeWrapping;
        this.groundTexture.wrapT = THREE.ClampToEdgeWrapping;
        this.groundTexture.minFilter = THREE.LinearFilter;
        this.groundTexture.magFilter = THREE.LinearFilter;

        // Use simplified material
        this.groundMaterial = this.getGroundMaterial();

        const ground = new THREE.Mesh(groundGeometry, this.groundMaterial);
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
        this.game.ground = ground;
        this.drawn = false;
        this.timer = 0;
    }

    getGroundMaterial() {
        // Simplified material using MeshStandardMaterial for terrain
        return new THREE.MeshStandardMaterial({
            map: this.groundTexture,
            side: THREE.DoubleSide,
            metalness: 0.0,
            roughness: 0.8
        });
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

    update() {
        if (!this.game.config.configs.game.is3D) {
            return;
        }
        if (this.controls) {
            this.controls.update();
        }
        if(!isNaN(this.game.deltaTime)) {
            this.timer += this.game.deltaTime;
        }
        if (this.stats) {
            this.stats.update();
        }
        if (!this.drawn && this.groundTexture && this.game.mapRenderer && this.game.mapRenderer.isMapCached) {
            const offset = (this.extendedSize - this.terrainSize) / 2;
            this.groundCtx.drawImage(this.game.terrainCanvasBuffer, offset, offset);
            this.groundTexture.needsUpdate = true;

            // Add 3D grass
            this.addGrassToTerrain();
            this.drawn = true;
        }
        if(this.grassMaterial) {
            if (this.uniforms) {
                this.uniforms.time = { value: this.timer };
            }
        }
        this.renderer.render(this.scene, this.camera);
    }

    // Add this method to your ThreeJsWorld class
    addGrassToTerrain() {
        // Grass blade geometry
        const bladeWidth = 24;
        const bladeHeight = 32;
        const grassGeometry = this.createCurvedBladeGeometry(bladeWidth, bladeHeight);
        grassGeometry.translate(0, bladeHeight / 2, 0);
        const grassCount = 100000;
        // Add random phase attribute for each instance
        const phases = new Float32Array(grassCount);
        for (let i = 0; i < grassCount; i++) {
            phases[i] = Math.random() * Math.PI * 2;
        }
        grassGeometry.setAttribute('instancePhase', new THREE.InstancedBufferAttribute(phases, 1));
    
        // Grass shader material
        const grassTexture = this.createGrassTexture();
        // In addGrassToTerrain() method:
        this.uniforms = {
                time: { value: 0 },
                windSpeed: { value: .8 },
                windStrength: { value: 0.2 },
                windDirection: { value: new THREE.Vector2(0.8, 0.6).normalize() },
                map: { value: grassTexture },
                // Three.js automatically provides:
                // projectionMatrix, modelViewMatrix, instanceMatrix (for instancing)
                // position, uv, etc.
            };
        const uniforms = this.uniforms;
        this.grassMaterial = new THREE.ShaderMaterial({
            vertexShader: `
        varying vec2 vUv;
        uniform float time;
        uniform float windSpeed;
        uniform float windStrength;
        uniform vec2 windDirection;
        attribute float instancePhase;

        void main() {        
            
            vUv = uv;
            
            vec2 dir = normalize(windDirection);
            float wave = sin(time * windSpeed + instancePhase) * windStrength;
            wave *= uv.y;
            
            vec3 displacement = vec3(
                dir.x * wave,
                0.0,
                dir.y * wave
            );

            gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * 
                        vec4(position + displacement, 1.0);

        }
    `,
    fragmentShader: `
        varying vec2 vUv;
        uniform sampler2D map;

        void main() {
            gl_FragColor = texture2D(map, vUv);
        }
    `,
            uniforms: uniforms
        });
    
        this.grassShader = this.grassMaterial; // Reference for time updates
    // new THREE.MeshStandardMaterial({map: grassTexture})
        // Create instanced mesh
        const grass = new THREE.InstancedMesh(grassGeometry,this.grassMaterial, grassCount);

        grass.castShadow = true;
        grass.receiveShadow = true;
    
        // Temporary objects
        const dummy = new THREE.Object3D();
    
        // Log terrain canvas status
        if (!this.groundCanvas) {
            console.warn('terrainCanvasBuffer is missing; placing grass everywhere.');
        } else {
            console.log('terrainCanvasBuffer size:', this.groundCanvas.width, 'x', this.groundCanvas.height);
            const ctx = this.groundCanvas.getContext('2d');
            try {
                const terrainData = ctx.getImageData(0, 0, this.groundCanvas.width, this.groundCanvas.height).data;
                let grassArea = this.groundCanvas.width / 4;
                const offset =  (this.extendedSize - grassArea) / 2;
                // Distribute grass (bypass terrain check)
                let placedGrassCount = 0;
                for (let i = 0; i < grassCount; i++) {
                    const x = Math.floor(Math.random() * grassArea);
                    const z = Math.floor(Math.random() * grassArea);
                    const pixelIndex = ((z + offset) * this.groundCanvas.width + (x + offset)) * 4;
                    const r = terrainData[pixelIndex];
                    const g = terrainData[pixelIndex + 1];
                    const b = terrainData[pixelIndex + 2];
                    if( g > r && g > b) {
                        placedGrassCount++;
                        const rotationY = Math.random() * Math.PI * 2;
                        const scale = 0.7 + Math.random() * 0.5;
                
                        dummy.position.set(x - grassArea / 2 + this.terrainSize / 2, -bladeHeight, z - grassArea / 2 + this.terrainSize / 2);
                        dummy.rotation.set(0, rotationY, 0);
                        dummy.scale.set(scale, scale, scale);
                        dummy.updateMatrix();
                
                        grass.setMatrixAt(i, dummy.matrix);
                    }
                
                }
            
            } catch (e) {
                console.warn('Failed to get terrainCanvasBuffer data:', e);
            }
        }
    
        grass.instanceMatrix.needsUpdate = true;
        this.scene.add(grass);
        this.grass = grass;

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
        window.removeEventListener('resize', this.onWindowResizeHandler);
        this.renderer.dispose();
        if (this.stats?.dom?.parentElement) {
            this.stats.dom.parentElement.removeChild(this.stats.dom);
        }
        if (this.renderer.domElement?.parentElement) {
            this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
        }
        // Dispose grass resources
        if (this.grass) {
            this.grass.geometry.dispose();
            this.grass.material.dispose();
        }
        // Dispose ground resources
        this.groundGeometry?.dispose();
        this.groundMaterial?.dispose();
        this.groundTexture?.dispose();
        this.game.scene = null;
        this.game.camera = null;
        this.game.renderer = null;
    }

    createCurvedBladeGeometry(width = 0.1, height = 1) {
        const shape = new THREE.Shape();
        shape.moveTo(0, 0);
        shape.quadraticCurveTo(width * 0.5, height * 0.5, 0, height);
    
        const geometry = new THREE.ShapeGeometry(shape);
        geometry.translate(0, 0, 0);
        return geometry;
    }
    createGrassTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 4;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');
    
        const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
        gradient.addColorStop(0, '#6bbf59');  // Tip
        gradient.addColorStop(1, '#2d5f2e');  // Base
    
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.magFilter = THREE.LinearFilter;
        texture.minFilter = THREE.LinearMipMapLinearFilter;
        return texture;
    }
}


