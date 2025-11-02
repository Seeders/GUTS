class FogOfWarSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.fogOfWarSystem = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();

        this.VISION_RADIUS = 500;
        this.WORLD_SIZE = this.game.worldSystem.extendedSize;
        this.FOG_TEXTURE_SIZE = 64; // Increased for smoother edges

        this.fogRenderTarget = null;
        this.explorationRenderTarget = null;
        this.explorationRenderTargetPingPong = null;
        this.fogScene = null;
        this.fogCamera = null;
        this.fogPass = null;

        // No more CPU buffers needed!
        
        // Reusable circle pool
        this.circlePool = [];
        this.circleGeometry = null;
        this.circleMaterial = null;
        
        // Accumulation shader for exploration
        this.accumulationMaterial = null;
        this.accumulationQuad = null;
        this.accumulationScene = null;
        this.accumulationCamera = null;
        
        this.pixelBuffer = new Uint8Array(4);
        
        this.cachedVisibilityBuffer = new Uint8Array(this.FOG_TEXTURE_SIZE * this.FOG_TEXTURE_SIZE * 4);
        this.cachedExplorationBuffer = new Uint8Array(this.FOG_TEXTURE_SIZE * this.FOG_TEXTURE_SIZE * 4);
        this.visibilityCacheValid = false;
        this.explorationCacheValid = false;
        this.isVisibleAtCount = 0;
        this.isExploredAtCount = 0;
    }


    init(params = {}) {
        this.params = params;
        
        this.fogRenderTarget = new THREE.WebGLRenderTarget(
            this.FOG_TEXTURE_SIZE,
            this.FOG_TEXTURE_SIZE,
            {
                minFilter: THREE.LinearFilter,
                magFilter: THREE.LinearFilter,
                format: THREE.RGBAFormat
            }
        );
        
        // Render target for persistent exploration
        this.explorationRenderTarget = new THREE.WebGLRenderTarget(
            this.FOG_TEXTURE_SIZE,
            this.FOG_TEXTURE_SIZE,
            {
                minFilter: THREE.LinearFilter,
                magFilter: THREE.LinearFilter,
                format: THREE.RGBAFormat
            }
        );
        
        this.explorationRenderTargetPingPong = new THREE.WebGLRenderTarget(
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
        
        this.circleTexture = this.createGradientCircleTexture();
        
        // Create shared geometry and material
        this.circleGeometry = new THREE.CircleGeometry(this.VISION_RADIUS, 32);
        this.circleMaterial = new THREE.MeshBasicMaterial({
            map: this.circleTexture,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false
        });
        
        // Create accumulation shader (max blending for exploration)
        this.accumulationMaterial = new THREE.ShaderMaterial({
            uniforms: {
                currentExploration: { value: null },
                newVisibility: { value: null }
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D currentExploration;
                uniform sampler2D newVisibility;
                varying vec2 vUv;
                
                void main() {
                    float explored = texture2D(currentExploration, vUv).r;
                    float visible = texture2D(newVisibility, vUv).r;
                    float newExploration = max(explored, visible);
                    gl_FragColor = vec4(newExploration, newExploration, newExploration, 1.0);
                }
            `
        });
        
        // Create accumulation scene (reused every frame)
        this.accumulationQuad = new THREE.Mesh(
            new THREE.PlaneGeometry(2, 2),
            this.accumulationMaterial
        );
        this.accumulationScene = new THREE.Scene();
        this.accumulationScene.add(this.accumulationQuad);
        this.accumulationCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        
        console.log('[FogOfWarSystem] GPU-accelerated RTS-style fog initialized');
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

    update() {
     
        
        this.isVisibleAtCount = 0;
        this.isExploredAtCount = 0;
    }

    createFogPass() {
        this.fogPass = {
            enabled: true,
            needsSwap: true,
            clear: false,
                                    
            uniforms: {
                tDiffuse: { value: null },
                tDepth: { value: null },
                fogTexture: { value: this.fogRenderTarget.texture },
                explorationTexture: { value: this.explorationRenderTarget.texture },
                worldSize: { value: this.WORLD_SIZE },
                cameraNear: { value: 1 },
                cameraFar: { value: 100 },
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
                uniform sampler2D tDepth;
                uniform sampler2D fogTexture;
                uniform sampler2D explorationTexture;
                uniform float worldSize;
                uniform float cameraNear;
                uniform float cameraFar;
                uniform mat4 cameraWorldMatrix;
                uniform mat4 cameraProjectionMatrixInv;

                varying vec2 vUv;
                
                float readDepth(vec2 coord) {
                    return texture2D(tDepth, coord).x;
                }
                
                float perspectiveDepthToViewZ(float depth, float near, float far) {
                    return (near * far) / ((far - near) * depth - far);
                }
                
                vec3 getWorldPosition(vec2 uv, float depth) {
                    // NDC coordinates
                    float x = uv.x * 2.0 - 1.0;
                    float y = uv.y * 2.0 - 1.0;
                    float z = depth * 2.0 - 1.0;
                    
                    vec4 clipPos = vec4(x, y, z, 1.0);
                    
                    // To view space
                    vec4 viewPos = cameraProjectionMatrixInv * clipPos;
                    viewPos /= viewPos.w;
                    
                    // To world space
                    vec4 worldPos = cameraWorldMatrix * viewPos;
                    
                    return worldPos.xyz;
                }

                void main() {
                    vec4 sceneColor = texture2D(tDiffuse, vUv);
                    float unexploredIntensity = 0.025;
                    float exploredIntensity = 0.2;
                    // Read depth and reconstruct world position
                    float depth = readDepth(vUv);
                    vec3 worldPos = getWorldPosition(vUv, depth);
                    
                    // Convert world XZ to fog UV
                    float halfSize = worldSize * 0.5;
                    vec2 fogUV = vec2(
                        (worldPos.x + halfSize) / worldSize,
                        (-worldPos.z + halfSize) / worldSize
                    );
                    
                    vec3 grayscale = vec3(dot(sceneColor.rgb, vec3(0.299, 0.587, 0.114)));
                    // Check bounds - out of bounds is unexplored
                    float inset = 1e-4;
                    if (fogUV.x < inset || fogUV.x > 1.0 - inset ||
                        fogUV.y < inset || fogUV.y > 1.0 - inset) {
                        // Completely black (unexplored)
                        gl_FragColor = vec4(grayscale * unexploredIntensity, 1.0);
                        return;
                    }
                    
                    // Sample gradient fog texture (smooth visibility with gradients)
                    vec4 fogSample = texture2D(fogTexture, fogUV);
                    float visibleGradient = fogSample.r; // Smooth gradient from circles
                    
                    // Sample exploration texture (now also has gradients)
                    vec4 explorationSample = texture2D(explorationTexture, fogUV);
                    float explorationGradient = explorationSample.g;
                    
                    // Calculate explored color (darkened/desaturated)
                    vec3 exploredColor = sceneColor.rgb * exploredIntensity;
                    
                    // Blend between explored and fully visible based on visibility gradient
                    vec3 visibleColor = mix(exploredColor, sceneColor.rgb, visibleGradient);
                    
                    // Finally, blend from black (unexplored) to visible/explored based on exploration gradient
                    vec3 finalColor = mix(grayscale * unexploredIntensity, visibleColor, explorationGradient);
                    
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
            // CRITICAL: Update camera matrices RIGHT NOW to match the depth buffer
            // that was just rendered, preventing lag/swimming effect
            if (fogSystemRef.game.camera) {
                fogPassObj.uniforms.cameraWorldMatrix.value.copy(fogSystemRef.game.camera.matrixWorld);
                fogPassObj.uniforms.cameraProjectionMatrixInv.value.copy(fogSystemRef.game.camera.projectionMatrixInverse);
                fogPassObj.uniforms.cameraNear.value = fogSystemRef.game.camera.near;
                fogPassObj.uniforms.cameraFar.value = fogSystemRef.game.camera.far;
            }
            
            fogSystemRef.renderFogTexture();
            
            fogPassObj.uniforms.tDiffuse.value = readBuffer.texture;
            fogPassObj.uniforms.tDepth.value = readBuffer.depthTexture;
            
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

        const myUnits = this.game.getEntitiesWith(
            this.componentTypes.POSITION,
            this.componentTypes.TEAM,
            this.componentTypes.HEALTH
        );

        // Hide all circles first
        this.circlePool.forEach(circle => circle.visible = false);

        // Position visible circles for each unit
        myUnits.forEach((entityId, index) => {
            const pos = this.game.getComponent(entityId, this.componentTypes.POSITION);
            if (!pos) return;

            // Reuse or create circle
            let circle;
            if (index < this.circlePool.length) {
                circle = this.circlePool[index];
                circle.visible = true;
            } else {
                circle = new THREE.Mesh(this.circleGeometry, this.circleMaterial);
                circle.rotation.x = -Math.PI / 2;
                this.circlePool.push(circle);
                this.fogScene.add(circle);
            }
            
            circle.position.set(pos.x, 0, pos.z);
        });

        // Render current visibility to fogRenderTarget (GPU, fast!)
        this.game.renderer.setRenderTarget(this.fogRenderTarget);
        this.game.renderer.render(this.fogScene, this.fogCamera);
        
        // Accumulate into exploration using GPU shader
        // This does: exploration = max(exploration, visibility)
        this.accumulationMaterial.uniforms.currentExploration.value = this.explorationRenderTarget.texture;
        this.accumulationMaterial.uniforms.newVisibility.value = this.fogRenderTarget.texture;
        
        this.game.renderer.setRenderTarget(this.explorationRenderTargetPingPong);
        
        // Render fullscreen quad with accumulation shader (scene already created in init)
        this.game.renderer.render(this.accumulationScene, this.accumulationCamera);
        
        // Swap render targets (no allocation/deallocation!)
        const temp = this.explorationRenderTarget;
        this.explorationRenderTarget = this.explorationRenderTargetPingPong;
        this.explorationRenderTargetPingPong = temp;
        
        // Update uniform reference
        this.fogPass.uniforms.explorationTexture.value = this.explorationRenderTarget.texture;
        
        this.game.renderer.setRenderTarget(null);
        
        this.visibilityCacheValid = false;
        this.explorationCacheValid = false;
    }

    createGradientCircleTexture() {
        const size = 128;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        
        const centerX = size / 2;
        const centerY = size / 2;
        const radius = size / 2;
        
        const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
        gradient.addColorStop(0.7, 'rgba(255, 255, 255, 1.0)');
        gradient.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');
        
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, size, size);
        
        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        return texture;
    }

    setVisionRadius(radius) {
        this.VISION_RADIUS = radius;
        console.log(`[FogOfWarSystem] Vision radius set to ${radius}`);
    }

    updateVisibilityCache() {
        if (this.visibilityCacheValid) return;
        

        this.game.renderer.readRenderTargetPixels(
            this.fogRenderTarget,
            0, 0,
            this.FOG_TEXTURE_SIZE,
            this.FOG_TEXTURE_SIZE,
            this.cachedVisibilityBuffer
        );
        
        this.visibilityCacheValid = true;
    }

    updateExplorationCache() {
        if (this.explorationCacheValid) return;
        
        this.game.renderer.readRenderTargetPixels(
            this.explorationRenderTarget,
            0, 0,
            this.FOG_TEXTURE_SIZE,
            this.FOG_TEXTURE_SIZE,
            this.cachedExplorationBuffer
        );
        
        this.explorationCacheValid = true;
    }

    isVisibleAt(x, z) {
        this.isVisibleAtCount += 1;
 
        const uv = this.worldToUV(x, z);
        if (!uv) return false;
        
        this.updateVisibilityCache();
        
        const px = Math.floor(uv.x * this.FOG_TEXTURE_SIZE);
        const py = Math.floor(uv.y * this.FOG_TEXTURE_SIZE);
        const index = (py * this.FOG_TEXTURE_SIZE + px) * 4;
        
        return this.cachedVisibilityBuffer[index] > 0;
    }

    isExploredAt(x, z) {
        this.isExploredAtCount += 1;

        const uv = this.worldToUV(x, z);
        if (!uv) return false;
        
        this.updateExplorationCache();
        
        const px = Math.floor(uv.x * this.FOG_TEXTURE_SIZE);
        const py = Math.floor(uv.y * this.FOG_TEXTURE_SIZE);
        const index = (py * this.FOG_TEXTURE_SIZE + px) * 4;
        
        return this.cachedExplorationBuffer[index] > 0;
    }

    worldToUV(x, z) {
        const half = this.WORLD_SIZE * 0.5;
        let u = (x + half) / this.WORLD_SIZE;
        let v = (-z + half) / this.WORLD_SIZE;

        // Return null if out of bounds
        if (u < 0 || u > 1 || v < 0 || v > 1) {
            return null;
        }

        return { x: u, y: v };
    }

    resetExploration() {
        // Clear exploration render target to black
        this.game.renderer.setRenderTarget(this.explorationRenderTarget);
        this.game.renderer.clear();
        this.game.renderer.setRenderTarget(this.explorationRenderTargetPingPong);
        this.game.renderer.clear();
        this.game.renderer.setRenderTarget(null);
        this.explorationCacheValid = false;
        console.log('[FogOfWarSystem] Exploration reset');
    }

    dispose() {
        if (this.fogRenderTarget) {
            this.fogRenderTarget.dispose();
        }
        if (this.explorationRenderTarget) {
            this.explorationRenderTarget.dispose();
        }
        if (this.explorationRenderTargetPingPong) {
            this.explorationRenderTargetPingPong.dispose();
        }
        if (this.game.postProcessingSystem) {
            this.game.postProcessingSystem.removePass('fog');
        }
        if (this.circleGeometry) {
            this.circleGeometry.dispose();
        }
        if (this.circleMaterial) {
            this.circleMaterial.dispose();
        }
        if (this.circleTexture) {
            this.circleTexture.dispose();
        }
        if (this.accumulationMaterial) {
            this.accumulationMaterial.dispose();
        }
        if (this.accumulationQuad) {
            this.accumulationQuad.geometry.dispose();
        }
        this.circlePool = [];
    }
}