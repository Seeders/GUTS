class PixelPaletteSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.pixelPaletteSystem = this;

        this.palettePass = null;
        this.paletteColors = [];
        this.enabled = true;
    }

    init(params = {}) {
        this.params = params;

        // Extract palette colors from game.palette
        this.extractPaletteColors();

        // Register methods for runtime control
        this.game.gameManager.register('setPalettePassEnabled', this.setEnabled.bind(this));
        this.game.gameManager.register('getPalettePassEnabled', () => this.enabled);
    }

    extractPaletteColors() {
        const palette = this.game.palette;
        if (!palette) {
            console.warn('[PixelPaletteSystem] No palette found in game');
            return;
        }

        this.paletteColors = [];

        // Extract all color values from palette (hex strings like "#a3d39c")
        for (const [key, value] of Object.entries(palette)) {
            if (typeof value === 'string' && value.startsWith('#')) {
                const rgb = this.hexToRgb(value);
                if (rgb) {
                    this.paletteColors.push(rgb);
                }
            }
        }

        console.log(`[PixelPaletteSystem] Extracted ${this.paletteColors.length} colors from palette`);
    }

    hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        if (!result) return null;

        return {
            r: parseInt(result[1], 16) / 255,
            g: parseInt(result[2], 16) / 255,
            b: parseInt(result[3], 16) / 255
        };
    }

    postAllInit() {
        if (this.game.postProcessingSystem && this.paletteColors.length > 0) {
            this.createPalettePass();
            this.game.gameManager.call('registerPostProcessingPass', 'palette', {
                enabled: this.enabled,
                pass: this.palettePass
            });
        }
    }

    createPalettePass() {
        // Build palette color array for shader (max 64 colors should be plenty)
        const maxColors = Math.min(this.paletteColors.length, 64);
        const paletteArray = [];

        for (let i = 0; i < maxColors; i++) {
            const c = this.paletteColors[i];
            paletteArray.push(new THREE.Vector3(c.r, c.g, c.b));
        }

        // Pad remaining slots with black if needed
        while (paletteArray.length < 64) {
            paletteArray.push(new THREE.Vector3(0, 0, 0));
        }

        this.palettePass = {
            enabled: this.enabled,
            needsSwap: true,
            clear: false,

            uniforms: {
                tDiffuse: { value: null },
                paletteColors: { value: paletteArray },
                paletteSize: { value: maxColors }
            },

            material: null,
            fsQuadScene: null,
            fsQuadCamera: null
        };

        this.palettePass.material = new THREE.ShaderMaterial({
            uniforms: this.palettePass.uniforms,
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D tDiffuse;
                uniform vec3 paletteColors[64];
                uniform int paletteSize;

                varying vec2 vUv;

                float colorDistance(vec3 c1, vec3 c2) {
                    vec3 diff = c1 - c2;
                    return dot(diff, diff);
                }

                vec3 findClosestPaletteColor(vec3 color) {
                    vec3 closest = paletteColors[0];
                    float minDist = colorDistance(color, closest);

                    for (int i = 1; i < 64; i++) {
                        if (i >= paletteSize) break;

                        float dist = colorDistance(color, paletteColors[i]);
                        if (dist < minDist) {
                            minDist = dist;
                            closest = paletteColors[i];
                        }
                    }

                    return closest;
                }

                void main() {
                    vec4 texColor = texture2D(tDiffuse, vUv);
                    vec3 closestColor = findClosestPaletteColor(texColor.rgb);
                    gl_FragColor = vec4(closestColor, texColor.a);
                }
            `
        });

        // Create fullscreen quad for rendering
        const geometry = new THREE.PlaneGeometry(2, 2);
        const mesh = new THREE.Mesh(geometry, this.palettePass.material);
        const scene = new THREE.Scene();
        scene.add(mesh);
        const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

        this.palettePass.fsQuadScene = scene;
        this.palettePass.fsQuadCamera = camera;

        const passRef = this.palettePass;

        this.palettePass.render = function(renderer, writeBuffer, readBuffer) {
            passRef.uniforms.tDiffuse.value = readBuffer.texture;

            if (passRef.needsSwap) {
                renderer.setRenderTarget(writeBuffer);
            } else {
                renderer.setRenderTarget(null);
            }

            renderer.render(passRef.fsQuadScene, passRef.fsQuadCamera);
        };

        this.palettePass.setSize = function(width, height) {
            // No-op - no size-dependent resources
        };
    }

    setEnabled(enabled) {
        this.enabled = enabled;
        if (this.palettePass) {
            this.palettePass.enabled = enabled;

            // Rebuild composer to apply change
            if (this.game.postProcessingSystem) {
                this.game.postProcessingSystem.rebuildComposer();
            }
        }
    }

    dispose() {
        if (this.palettePass) {
            if (this.palettePass.material) {
                this.palettePass.material.dispose();
            }
            if (this.palettePass.fsQuadScene) {
                this.palettePass.fsQuadScene.children.forEach(child => {
                    if (child.geometry) child.geometry.dispose();
                });
            }
        }

        if (this.game.postProcessingSystem) {
            this.game.gameManager.call('removePostProcessingPass', 'palette');
        }
    }
}
