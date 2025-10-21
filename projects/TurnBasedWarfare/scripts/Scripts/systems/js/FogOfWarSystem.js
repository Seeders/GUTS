class FogOfWarSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.fogOfWarSystem = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();
        
        this.VISION_RADIUS = 200;
        this.MAX_REVEAL_CIRCLES = 50;
        
        this.FOG_COLOR = new THREE.Color(0x000000);
        this.FOG_OPACITY = 0.85;
    }

    init(params = {}) {
        this.params = params;
        
        const initialPositions = new Array(this.MAX_REVEAL_CIRCLES).fill(null).map(() => new THREE.Vector3(0, 0, 0));
        const initialRadii = new Array(this.MAX_REVEAL_CIRCLES).fill(0);
        
        // Create custom pass
        this.fogPass = {
            enabled: true,
            needsSwap: true,
            clear: false,
            
            uniforms: {
                tDiffuse: { value: null },
                revealPositions: { value: initialPositions },
                revealRadii: { value: initialRadii },
                revealCount: { value: 0 },
                fogColor: { value: this.FOG_COLOR },
                opacity: { value: this.FOG_OPACITY },
                viewMatrix: { value: new THREE.Matrix4() },
                projectionMatrix: { value: new THREE.Matrix4() },
                resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) }
            },
            
            material: null,
            fsQuad: null,
            
            setSize: function(width, height) {
                this.uniforms.resolution.value.set(width, height);
            },
            
            render: function(renderer, writeBuffer, readBuffer) {
                this.uniforms.tDiffuse.value = readBuffer.texture;
                
                if (this.needsSwap) {
                    renderer.setRenderTarget(writeBuffer);
                } else {
                    renderer.setRenderTarget(null);
                }
                
                this.fsQuad.render(renderer);
            }
        };
        
        // Create material
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
                uniform vec3 revealPositions[50];
                uniform float revealRadii[50];
                uniform int revealCount;
                uniform vec3 fogColor;
                uniform float opacity;
                uniform mat4 projectionMatrix;
                uniform vec2 resolution;
                
                varying vec2 vUv;
                
                void main() {
                    vec4 color = texture2D(tDiffuse, vUv);
                    
                    float minFog = 1.0;
                    
                    for (int i = 0; i < 50; i++) {
                        if (i >= revealCount) break;
                        
                        vec3 revealPos = revealPositions[i];
                        float radius = revealRadii[i];
                        
                        vec4 screenPos = projectionMatrix * viewMatrix * vec4(revealPos, 1.0);
                        screenPos.xy /= screenPos.w;
                        screenPos.xy = screenPos.xy * 0.5 + 0.5;
                        
                        vec2 pixelDist = (vUv - screenPos.xy) * resolution;
                        float dist = length(pixelDist);
                        
                        float fogAmount = smoothstep(radius * 0.7, radius, dist);
                        minFog = min(minFog, fogAmount);
                    }
                    
                    vec3 finalColor = mix(color.rgb, fogColor, minFog * opacity);
                    gl_FragColor = vec4(finalColor, 1.0);
                }
            `
        });
        
        // Create fullscreen quad
        const geometry = new THREE.PlaneGeometry(2, 2);
        const mesh = new THREE.Mesh(geometry, this.fogPass.material);
        const scene = new THREE.Scene();
        scene.add(mesh);
        const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        
        this.fogPass.fsQuad = {
            render: function(renderer) {
                renderer.render(scene, camera);
            }
        };
        
        // Add to composer if it exists
        if (this.game.worldSystem?.composer) {
            this.composer = this.game.worldSystem.composer;
            
            
            this.composer.addPass(this.fogPass);

            console.log('[FogOfWarSystem] Added fog pass to composer');
        }
        
        window.addEventListener('resize', this.onWindowResize.bind(this));
        
        console.log('[FogOfWarSystem] Initialized');
    }

    onWindowResize() {
        if (this.fogPass) {
            this.fogPass.setSize(window.innerWidth, window.innerHeight);
        }
    }

    update() {
        if (!this.fogPass) return;

        const myTeam = this.game.state.mySide;
        if (!myTeam) return;

        const positions = [];
        const radii = [];

        const myUnits = this.game.getEntitiesWith(
            this.componentTypes.POSITION, 
            this.componentTypes.TEAM
        ).filter(id => {
            const team = this.game.getComponent(id, this.componentTypes.TEAM);
            return team?.team === myTeam;
        });

        for (const entityId of myUnits) {
            const pos = this.game.getComponent(entityId, this.componentTypes.POSITION);
            if (!pos) continue;

            positions.push(new THREE.Vector3(pos.x, pos.y, pos.z));
            radii.push(this.VISION_RADIUS);

            if (positions.length >= this.MAX_REVEAL_CIRCLES) break;
        }

        while (positions.length < this.MAX_REVEAL_CIRCLES) {
            positions.push(new THREE.Vector3(0, 0, 0));
            radii.push(0);
        }

        this.fogPass.uniforms.revealPositions.value = positions;
        this.fogPass.uniforms.revealRadii.value = radii;
        this.fogPass.uniforms.revealCount.value = myUnits.length;
        
        if (this.game.camera) {
            this.fogPass.uniforms.viewMatrix.value.copy(this.game.camera.matrixWorldInverse);
            this.fogPass.uniforms.projectionMatrix.value.copy(this.game.camera.projectionMatrix);
        }
    }

    setVisionRadius(radius) {
        this.VISION_RADIUS = radius;
        console.log(`[FogOfWarSystem] Vision radius set to ${radius}`);
    }

    setFogOpacity(opacity) {
        this.FOG_OPACITY = opacity;
        if (this.fogPass) {
            this.fogPass.uniforms.opacity.value = opacity;
        }
        console.log(`[FogOfWarSystem] Fog opacity set to ${opacity}`);
    }

    setFogColor(color) {
        this.FOG_COLOR = new THREE.Color(color);
        if (this.fogPass) {
            this.fogPass.uniforms.fogColor.value = this.FOG_COLOR;
        }
        console.log(`[FogOfWarSystem] Fog color set to ${color}`);
    }

    dispose() {
        if (this.fogPass && this.game.worldSystem?.composer) {
            const composer = this.game.worldSystem.composer;
            const index = composer.passes.indexOf(this.fogPass);
            if (index > -1) {
                composer.passes.splice(index, 1);
            }
        }
        if (this.fogPass?.material) {
            this.fogPass.material.dispose();
        }
        window.removeEventListener('resize', this.onWindowResize.bind(this));
    }
}