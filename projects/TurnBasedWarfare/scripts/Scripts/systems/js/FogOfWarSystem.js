class FogOfWarSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.fogOfWarSystem = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();

        this.VISION_RADIUS = 300;
        this.WORLD_SIZE = 2000;
        this.FOG_TEXTURE_SIZE = 512;

        this.fogRenderTarget = null;
        this.fogScene = null;
        this.fogCamera = null;
        this.fogPass = null;

        this.visibilityBuffer = new Uint8Array(this.FOG_TEXTURE_SIZE * this.FOG_TEXTURE_SIZE);
    }


    init(params = {}) {
        this.params = params;
        this.WORLD_SIZE = params.worldSize || 2000;
        
        this.fogRenderTarget = new THREE.WebGLRenderTarget(
            this.FOG_TEXTURE_SIZE,
            this.FOG_TEXTURE_SIZE,
            {
                minFilter: THREE.LinearFilter,
                magFilter: THREE.LinearFilter,
                format: THREE.RGBAFormat
            }
        );
        
        const halfSize = this.WORLD_SIZE / 2;
        this.fogCamera = new THREE.OrthographicCamera(
            -halfSize, halfSize,
            halfSize, -halfSize,
            0.1, 1000
        );
        this.fogCamera.position.set(0, 500, 0);
        this.fogCamera.lookAt(0, 0, 0);
        
        this.fogScene = new THREE.Scene();
        this.fogScene.background = new THREE.Color(0x000000);
        
        console.log('[FogOfWarSystem] Texture-based fog initialized');
    }

    postAllInit() {
        if (this.game.postProcessingSystem) {
            this.createFogPass();
            this.game.postProcessingSystem.registerPass('fog', {
                enabled: true,
                pass: this.fogPass
            });
        }
    }

    createFogPass() {
        this.fogPass = {
            enabled: true,
            needsSwap: true,
            clear: false,
                        
            uniforms: {
                tDiffuse: { value: null },
                fogTexture: { value: this.fogRenderTarget.texture },
                worldSize: { value: this.WORLD_SIZE },
                cameraWorldMatrix: { value: new THREE.Matrix4() },
                cameraProjectionMatrixInv: { value: new THREE.Matrix4() }
            },
            
            material: null,
            fsQuad: null,
            fsQuadScene: null,
            fsQuadCamera: null
        };

        this.fogPass.material = new THREE.ShaderMaterial({
            uniforms: this.fogPass.uniforms,
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D tDiffuse;
                uniform sampler2D fogTexture;
                uniform float worldSize;
                uniform mat4 cameraWorldMatrix;
                uniform mat4 cameraProjectionMatrixInv;
                
                varying vec2 vUv;
                
                void main() {
                    vec4 color = texture2D(tDiffuse, vUv);
                    
                    // Simpler approach: convert NDC to world space ray
                    vec4 nearPoint = vec4(vUv * 2.0 - 1.0, -1.0, 1.0);
                    vec4 farPoint = vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
                    
                    // Unproject to world space
                    vec4 nearWorld = cameraWorldMatrix * (cameraProjectionMatrixInv * nearPoint);
                    vec4 farWorld = cameraWorldMatrix * (cameraProjectionMatrixInv * farPoint);
                    
                    nearWorld /= nearWorld.w;
                    farWorld /= farWorld.w;
                    
                    // Ray from camera through pixel
                    vec3 rayDir = normalize(farWorld.xyz - nearWorld.xyz);
                    vec3 rayOrigin = nearWorld.xyz;
                    
                    // Intersect with Y=0 plane
                    float t = (0.0 - rayOrigin.y) / rayDir.y;
                    vec3 worldPos = rayOrigin + rayDir * t;
                    
                    // Convert to fog UV
                    vec2 fogUV = vec2(
                        (worldPos.x + worldSize * 0.5) / worldSize,
                        (-worldPos.z + worldSize * 0.5) / worldSize
                    );
                    
                    vec4 fogSample = texture2D(fogTexture, fogUV);
                    float visibility = fogSample.r;
                    float fogAmount = 1.0 - visibility;
                    
                    vec3 finalColor = mix(color.rgb, color.rgb * 0.2, fogAmount);
                    gl_FragColor = vec4(finalColor, 1.0);
                }
            `
        });
        
        const geometry = new THREE.PlaneGeometry(2, 2);
        const mesh = new THREE.Mesh(geometry, this.fogPass.material);
        const scene = new THREE.Scene();
        scene.add(mesh);
        const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        
        // Set these BEFORE creating the render function
        this.fogPass.fsQuadScene = scene;
        this.fogPass.fsQuadCamera = camera;
        
        const fogPassObj = this.fogPass;
        const fogSystemRef = this;
        
        // Create fsQuad object
        this.fogPass.fsQuad = {
            render: (renderer) => {
                renderer.render(fogPassObj.fsQuadScene, fogPassObj.fsQuadCamera);
            }
        };
        
        // NOW create the pass render function (after fsQuad exists)
        this.fogPass.render = function(renderer, writeBuffer, readBuffer) {
            fogSystemRef.renderFogTexture();
            
            fogPassObj.uniforms.tDiffuse.value = readBuffer.texture;
            
            if (fogPassObj.needsSwap) {
                renderer.setRenderTarget(writeBuffer);
            } else {
                renderer.setRenderTarget(null);
            }
            
            fogPassObj.fsQuad.render(renderer);
        };
        
        this.fogPass.setSize = function(width, height) {
            // No-op
        };
    }
    renderFogTexture() {
        const myTeam = this.game.state.mySide;
        if (!myTeam) return;

        this.visibilityBuffer.fill(0);

        const myUnits = this.game.getEntitiesWith(
            this.componentTypes.POSITION,
            this.componentTypes.TEAM
        ).filter(id => {
            const team = this.game.getComponent(id, this.componentTypes.TEAM);
            return team?.team === myTeam;
        });

        // clean fogScene
        this.fogScene.children.forEach(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        });
        this.fogScene.children = [];

        const radiusPx = (this.VISION_RADIUS / this.WORLD_SIZE) * this.FOG_TEXTURE_SIZE;
        const texSize = this.FOG_TEXTURE_SIZE;

        for (const entityId of myUnits) {
            const pos = this.game.getComponent(entityId, this.componentTypes.POSITION);
            if (!pos) continue;

            // === GPU draw
            const geometry = new THREE.CircleGeometry(this.VISION_RADIUS, 32);
            const material = new THREE.MeshBasicMaterial({
                color: 0xffffff,
                side: THREE.DoubleSide
            });
            const circle = new THREE.Mesh(geometry, material);
            circle.position.set(pos.x, 0, pos.z);
            circle.rotation.x = -Math.PI / 2;
            this.fogScene.add(circle);

            // === CPU rasterize
            const half = this.WORLD_SIZE * 0.5;
            const u = (pos.x + half) / this.WORLD_SIZE;
            const v = (-pos.z + half) / this.WORLD_SIZE;
            const centerX = Math.floor(u * texSize);
            const centerY = Math.floor(v * texSize);
            const r2 = radiusPx * radiusPx;

            const minY = Math.max(0, Math.floor(centerY - radiusPx));
            const maxY = Math.min(texSize - 1, Math.ceil(centerY + radiusPx));
            for (let y = minY; y <= maxY; y++) {
                const dy = y - centerY;
                const dxMax = Math.floor(Math.sqrt(r2 - dy * dy));
                const x0 = Math.max(0, centerX - dxMax);
                const x1 = Math.min(texSize - 1, centerX + dxMax);
                const row = y * texSize;
                for (let x = x0; x <= x1; x++) {
                    this.visibilityBuffer[row + x] = 255;
                }
            }
        }

        this.game.renderer.setRenderTarget(this.fogRenderTarget);
        this.game.renderer.render(this.fogScene, this.fogCamera);
        this.game.renderer.setRenderTarget(null);
    }


    update() {
        if (this.fogPass && this.game.camera) {
            this.fogPass.uniforms.cameraWorldMatrix.value.copy(this.game.camera.matrixWorld);
            this.fogPass.uniforms.cameraProjectionMatrixInv.value.copy(this.game.camera.projectionMatrixInverse);
        }
    }

    setVisionRadius(radius) {
        this.VISION_RADIUS = radius;
        console.log(`[FogOfWarSystem] Vision radius set to ${radius}`);
    }
    isVisibleAt(x, z) {
        const idx = this.worldToFogIndex(x, z);
        return this.visibilityBuffer[idx] > 0;
    }
    worldToFogIndex(x, z) {
        const half = this.WORLD_SIZE * 0.5;
        let u = (x + half) / this.WORLD_SIZE;
        let v = (-z + half) / this.WORLD_SIZE;

        // Clamp to 0..1
        u = Math.min(Math.max(u, 0), 1);
        v = Math.min(Math.max(v, 0), 1);

        const texX = Math.floor(u * this.FOG_TEXTURE_SIZE);
        const texY = Math.floor(v * this.FOG_TEXTURE_SIZE);
        return texY * this.FOG_TEXTURE_SIZE + texX;
    }
    dispose() {
        if (this.fogRenderTarget) {
            this.fogRenderTarget.dispose();
        }
        if (this.game.postProcessingSystem) {
            this.game.postProcessingSystem.removePass('fog');
        }
        this.fogScene.children.forEach(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        });
    }
}