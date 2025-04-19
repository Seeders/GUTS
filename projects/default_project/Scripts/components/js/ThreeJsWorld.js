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
        fog = { enabled: true, color: 0x87CEEB, density: 0.0005 },
        heightMapConfig = {
            enabled: true,
            heightStep: 5,
            smoothing: true
        },
        extensionSize = 768 // Width of grass border around terrain
    }) {
        if (!this.game.config.configs.game.is3D) {
            return;
        }
        this.showStats = false;
        this.clock = new THREE.Clock();
        this.onWindowResizeHandler = this.onWindowResize.bind(this);
        this.heightMapConfig = heightMapConfig;
        this.game.heightMapConfig = heightMapConfig;
        this.extensionSize = extensionSize;
        this.terrainSize = 768;
        this.extendedSize = this.terrainSize + 2 * extensionSize;
        this.heightMapResolution = 256;
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
            this.controls.maxPolarAngle = Math.PI / 2.05;
            this.controls.minPolarAngle = 0.1;
            this.controls.enableDamping = true;
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
        this.directionalLight.position.set(this.extendedSize * 2, this.extendedSize * 2, this.extendedSize * 2);
        this.directionalLight.castShadow = shadowConfig.enabled;

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

            this.directionalLight.target.position.set(-this.extendedSize * 2, 0, -this.extendedSize * 2);
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

        this.tileMap = this.game.config.levels[this.game.state.level].tileMap;
        this.setupGround();

        if (this.showStats) {
            this.stats = new Stats();
            this.container.appendChild(this.stats.dom);
        }

        window.addEventListener('resize', this.onWindowResizeHandler);

        this.game.scene = this.scene;
        this.game.camera = this.camera;
        this.game.renderer = this.renderer;
        this.game.ground = this.ground;
        this.drawn = false;
        this.timer = 0;
    }

    setupGround() {
        this.groundCanvas = document.createElement('canvas');
        this.groundCanvas.width = this.extendedSize;
        this.groundCanvas.height = this.extendedSize;
        this.groundCtx = this.groundCanvas.getContext('2d');

        let bgColor = this.tileMap.terrainTypes[this.tileMap.extensionTerrainType].color;
        let colorToUse = bgColor.paletteColor ? this.game.palette[bgColor.paletteColor] : bgColor;
        this.groundCtx.fillStyle = colorToUse;
        this.groundCtx.fillRect(0, 0, this.extendedSize, this.extendedSize);

        this.groundTexture = new THREE.CanvasTexture(this.groundCanvas);
        this.groundTexture.wrapS = THREE.ClampToEdgeWrapping;
        this.groundTexture.wrapT = THREE.ClampToEdgeWrapping;
        this.groundTexture.minFilter = THREE.LinearFilter;
        this.groundTexture.magFilter = THREE.LinearFilter;

        if (this.heightMapConfig.enabled) {
            this.createHeightMapTerrain();
        } else {
            const groundGeometry = new THREE.PlaneGeometry(this.extendedSize, this.extendedSize);
            this.groundMaterial = this.getGroundMaterial();
            this.ground = new THREE.Mesh(groundGeometry, this.groundMaterial);
            this.ground.rotation.x = -Math.PI / 2;
            this.ground.position.set(this.terrainSize / 2, 0, this.terrainSize / 2);
            this.ground.receiveShadow = true;
            this.scene.add(this.ground);
        }
    }

    createHeightMapTerrain() {
        this.heightMapData = new Float32Array(this.extendedSize * this.extendedSize);
        this.terrainTypes = this.tileMap.terrainTypes || [];
        this.heightStep = this.heightMapConfig.heightStep;

        const segments = this.heightMapResolution;
        const groundGeometry = new THREE.PlaneGeometry(
            this.extendedSize,
            this.extendedSize,
            segments,
            segments
        );

        this.groundVertices = groundGeometry.attributes.position;

        this.groundMaterial = this.getGroundMaterial();

        this.ground = new THREE.Mesh(groundGeometry, this.groundMaterial);
        this.ground.rotation.x = -Math.PI / 2;
        this.ground.position.set(this.terrainSize / 2, 0, this.terrainSize / 2);
        this.ground.receiveShadow = true;

        this.scene.add(this.ground);
    }

    updateHeightMap() {
        if (!this.heightMapConfig.enabled || !this.game.terrainCanvasBuffer) return;

        try {
            const terrainCanvas = this.game.terrainCanvasBuffer;
            const ctx = terrainCanvas.getContext('2d');
            const terrainData = ctx.getImageData(0, 0, terrainCanvas.width, terrainCanvas.height).data;

            const terrainTypeColors = this.createTerrainTypeColorMap();

            this.heightMapData = new Float32Array(this.extendedSize * this.extendedSize);

            const extensionTerrainType = this.tileMap.extensionTerrainType;
            const extensionHeight = extensionTerrainType * this.heightStep;

            for (let z = 0; z < this.extendedSize; z++) {
                for (let x = 0; x < this.extendedSize; x++) {
                    this.heightMapData[z * this.extendedSize + x] = extensionHeight;
                }
            }

            for (let z = 0; z < this.terrainSize; z++) {
                for (let x = 0; x < this.terrainSize; x++) {
                    const pixelIndex = (z * terrainCanvas.width + x) * 4;
                    const r = terrainData[pixelIndex];
                    const g = terrainData[pixelIndex + 1];
                    const b = terrainData[pixelIndex + 2];
                    const colorKey = `${r},${g},${b}`;

                    const typeIndex = terrainTypeColors[colorKey];
                    const height = typeIndex !== undefined ? typeIndex * this.heightStep : extensionHeight;

                    const extX = x + this.extensionSize;
                    const extZ = z + this.extensionSize;
                    this.heightMapData[extZ * this.extendedSize + extX] = height;
                }
            }

            this.applyHeightMapToGeometry();

        } catch (e) {
            console.warn('Failed to update height map:', e);
        }
    }

    createTerrainTypeColorMap() {
        const colorMap = {};
        const terrainTypes = this.terrainTypes;

        for (let i = 0; i < terrainTypes.length; i++) {
            const terrainType = terrainTypes[i];
            let color = terrainType.color || {};

            if (color.paletteColor && this.game.palette) {
                const hexColor = this.game.palette[color.paletteColor];
                if (hexColor) {
                    const r = parseInt(hexColor.slice(1, 3), 16);
                    const g = parseInt(hexColor.slice(3, 5), 16);
                    const b = parseInt(hexColor.slice(5, 7), 16);
                    colorMap[`${r},${g},${b}`] = i;
                }
            } else {
                const hexColor = color;
                if (hexColor) {
                    const r = parseInt(hexColor.slice(1, 3), 16);
                    const g = parseInt(hexColor.slice(3, 5), 16);
                    const b = parseInt(hexColor.slice(5, 7), 16);
                    colorMap[`${r},${g},${b}`] = i;
                }
            }
        }

        return colorMap;
    }

    applyHeightMapToGeometry() {
        if (!this.ground || !this.groundVertices) return;

        const positions = this.groundVertices.array;
        const geometry = this.ground.geometry;
        const segments = this.heightMapResolution;
        const verticesPerRow = segments + 1;

        for (let z = 0; z < verticesPerRow; z++) {
            for (let x = 0; x < verticesPerRow; x++) {
                const vertexIndex = (z * verticesPerRow + x);
                const idx = vertexIndex * 3;

                const nx = x / segments;
                const nz = z / segments;

                const terrainX = Math.floor(nx * (this.extendedSize - 1));
                const terrainZ = Math.floor(nz * (this.extendedSize - 1));

                const heightIndex = terrainZ * this.extendedSize + terrainX;
                const height = this.heightMapData[heightIndex] || 0;

                const finalHeight = this.heightMapConfig.smoothing ?
                    this.smoothHeight(terrainX, terrainZ) : height;

                positions[idx + 2] = finalHeight;
            }
        }

        this.groundVertices.needsUpdate = true;
        geometry.computeVertexNormals();
    }

    smoothHeight(x, z) {
        if (!this.heightMapConfig.smoothing) return this.heightMapData[z * this.extendedSize + x];

        let totalHeight = 0;
        let count = 0;

        for (let dz = -1; dz <= 1; dz++) {
            for (let dx = -1; dx <= 1; dx++) {
                const nx = x + dx;
                const nz = z + dz;

                if (nx >= 0 && nx < this.extendedSize && nz >= 0 && nz < this.extendedSize) {
                    totalHeight += this.heightMapData[nz * this.extendedSize + nx];
                    count++;
                }
            }
        }

        return count > 0 ? totalHeight / count : 0;
    }

    getGroundMaterial() {
        return new THREE.MeshStandardMaterial({
            map: this.groundTexture,
            side: THREE.DoubleSide,
            metalness: 0.0,
            roughness: 0.8
        });
    }

    onWindowResize() {
        const width = this.container.clientWidth || window.innerWidth;
        const height = this.container.clientHeight || window.innerHeight;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    update() {
        if (!this.game.config.configs.game.is3D) {
            return;
        }
        if (this.controls) {
            this.controls.update();
        }
        if (!isNaN(this.game.deltaTime)) {
            this.timer += this.game.deltaTime;
        }
        if (this.stats) {
            this.stats.update();
        }
        if (!this.drawn && this.groundTexture && this.game.mapRenderer && this.game.mapRenderer.isMapCached) {
            this.groundCtx.drawImage(this.game.terrainCanvasBuffer, this.extensionSize, this.extensionSize);
            this.groundTexture.needsUpdate = true;

            if (this.heightMapConfig.enabled) {
                this.updateHeightMap();
            }

            this.addGrassToTerrain();
            this.drawn = true;
        }
        if (this.grassMaterial) {
            if (this.uniforms) {
                this.uniforms.time = { value: this.timer };
            }
        }
        this.renderer.render(this.scene, this.camera);
    }

    addGrassToTerrain() {
        const bladeWidth = 12;
        const bladeHeight = 18;
        const grassGeometry = this.createCurvedBladeGeometry(bladeWidth, bladeHeight);
        grassGeometry.translate(0, bladeHeight / 2, 0);
        const grassCount = 1000000;

        const phases = new Float32Array(grassCount);
        for (let i = 0; i < grassCount; i++) {
            phases[i] = Math.random() * Math.PI * 2;
        }
        grassGeometry.setAttribute('instancePhase', new THREE.InstancedBufferAttribute(phases, 1));

        const grassTexture = this.createGrassTexture();
        this.uniforms = {
            time: { value: 0 },
            windSpeed: { value: 0.8 },
            windStrength: { value: 2 },
            windDirection: { value: new THREE.Vector2(0.8, 0.6).normalize() },
            map: { value: grassTexture }
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

                    vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position + displacement, 1.0);
                    gl_Position = projectionMatrix * mvPosition;
                    vUv = uv;
                }
            `,
            fragmentShader: `
                varying vec2 vUv;
                uniform sampler2D map;

                void main() {
                    vec4 texColor = texture2D(map, vUv);
                    gl_FragColor = texColor;
                }
            `,
            uniforms: uniforms
        });

        this.grassShader = this.grassMaterial;
        const grass = new THREE.InstancedMesh(grassGeometry, this.grassMaterial, grassCount);
        grass.castShadow = true;
        grass.receiveShadow = true;

        const dummy = new THREE.Object3D();

        if (this.groundCanvas) {
            const ctx = this.groundCanvas.getContext('2d');
            try {
                const terrainData = ctx.getImageData(0, 0, this.groundCanvas.width, this.groundCanvas.height).data;
                let grassArea = this.extendedSize;
                let placedGrassCount = 0;

                for (let i = 0; i < grassCount; i++) {
                    const x = Math.floor(Math.random() * grassArea);
                    const z = Math.floor(Math.random() * grassArea);
                    const pixelIndex = (z * this.groundCanvas.width + x) * 4;
                    const r = terrainData[pixelIndex];
                    const g = terrainData[pixelIndex + 1];
                    const b = terrainData[pixelIndex + 2];

                    if (g > r && g > b ) {
                        placedGrassCount++;
                        const rotationY = Math.random() * Math.PI * 2;
                        const scale = 0.7 + Math.random() * 0.5;

                        let height = 0;
                        if (this.heightMapConfig.enabled) {
                            const terrainX = Math.min(Math.floor(x), this.extendedSize - 1);
                            const terrainZ = Math.min(Math.floor(z), this.extendedSize - 1);
                            height = this.heightMapData[terrainZ * this.extendedSize + terrainX] || 0;
                        }

                        dummy.position.set(x - grassArea / 2 + this.terrainSize / 2, height - bladeHeight, z - grassArea / 2 + this.terrainSize / 2);
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

    setupFollowCamera(target, offsetX = 50, offsetY = 50, offsetZ = 50, lookAhead = 0) {
        if (!target) return;

        const updateFollowCamera = () => {
            const targetPosition = target.position || target;

            this.camera.position.set(
                targetPosition.x + offsetX,
                targetPosition.y + offsetY,
                targetPosition.z + offsetZ
            );

            this.camera.lookAt(
                targetPosition.x + lookAhead * (targetPosition.x - target.lastPosition?.x || 0),
                targetPosition.y + lookAhead * (targetPosition.y - target.lastPosition?.y || 0),
                targetPosition.z + lookAhead * (targetPosition.z - target.lastPosition?.z || 0)
            );
        };

        if (this.controls) {
            this.controls.enabled = false;
        }

        this.camera.updateFollowCamera = updateFollowCamera;
        updateFollowCamera();

        return updateFollowCamera;
    }

    setIsometricView() {
        const isoAngle = Math.atan(1 / Math.sqrt(2));
        const distance = 200;
        const horizDistance = distance * Math.cos(isoAngle);
        const vertDistance = distance * Math.sin(isoAngle);

        this.camera.position.set(horizDistance, vertDistance, horizDistance);
        this.camera.lookAt(0, 0, 0);

        if (this.controls) {
            this.controls.target.set(0, 0, 0);
            this.controls.update();
        }
    }

    setTopDownView(height = 200) {
        this.camera.position.set(0, height, 0);
        this.camera.lookAt(0, 0, 0);

        if (this.controls) {
            this.controls.target.set(0, 0, 0);
            this.controls.update();
        }
    }

    addPlayerLight(target, color = 0xffffbb, intensity = 0.7, distance = 50) {
        const playerLight = new THREE.PointLight(color, intensity, distance);
        playerLight.castShadow = true;
        playerLight.shadow.mapSize.width = 512;
        playerLight.shadow.mapSize.height = 512;

        const updateLightPosition = () => {
            const targetPosition = target.position || target;
            playerLight.position.set(
                targetPosition.x,
                targetPosition.y + 10,
                targetPosition.z
            );
        };

        this.scene.add(playerLight);
        updateLightPosition();

        return {
            light: playerLight,
            update: updateLightPosition
        };
    }

    onDestroy() {
        window.removeEventListener('resize', this.onWindowResizeHandler);
        this.renderer.dispose();
        if (this.stats?.dom?.parentElement) {
            this.stats.dom.parentElement.removeChild(this.stats.dom);
        }
        if (this.renderer.domElement?.parentElement) {
            this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
        }
        if (this.grass) {
            this.grass.geometry.dispose();
            this.grass.material.dispose();
        }
        this.ground.geometry?.dispose();
        this.groundMaterial?.dispose();
        this.groundTexture?.dispose();
        this.groundCanvas = null;
        this.game.scene = null;
        this.game.camera = null;
        this.game.renderer = null;
    }

    createCurvedBladeGeometry(width = 0.1, height = 1) {
        const shape = new THREE.Shape();
        shape.moveTo(0, 0);
        shape.quadraticCurveTo(width * 0.5, height * 0.5, 0, height);

        const shapeGeom = new THREE.ShapeGeometry(shape, 12);

        const positions = shapeGeom.attributes.position.array;
        const uvs = shapeGeom.attributes.uv.array;
        const vertexCount = positions.length / 3;

        const newUVs = new Float32Array(uvs.length);

        for (let i = 0; i < vertexCount; i++) {
            const posIndex = i * 3;
            const uvIndex = i * 2;

            const y = positions[posIndex + 1];
            const normalizedY = y / height;

            newUVs[uvIndex] = uvs[uvIndex];
            newUVs[uvIndex + 1] = normalizedY;
        }

        shapeGeom.setAttribute('uv', new THREE.BufferAttribute(newUVs, 2));

        return shapeGeom;
    }

    createGrassTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 4;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');

        const gradient = ctx.createLinearGradient(0, canvas.height, 0, 0);
        gradient.addColorStop(0.0, this.game.palette["greenDColor"]);
        gradient.addColorStop(0.8, this.game.palette["greenMColor"]);
        gradient.addColorStop(1.0, this.game.palette["redLColor"]);

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.magFilter = THREE.LinearFilter;
        texture.minFilter = THREE.LinearFilter;
        return texture;
    }
}