class PixelPaletteSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.pixelPaletteSystem = this;

        this.palettePass = null;
        this.paletteColors = [];
        this.paletteTexture = null;
        this.enabled = true;
    }

    init(params = {}) {
        this.params = params;

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

        console.log(`[PixelPaletteSystem] Extracted ${this.paletteColors.length} colors from palette:`,
            this.paletteColors.map(c => `rgb(${Math.round(c.r*255)},${Math.round(c.g*255)},${Math.round(c.b*255)})`));
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

    createPaletteTexture() {
        // Create a fixed-size 1D texture (64x1) to store palette colors
        // This avoids GLSL issues with dynamic loop bounds
        const TEXTURE_SIZE = 64;
        const numColors = this.paletteColors.length;
        const data = new Uint8Array(TEXTURE_SIZE * 4);

        for (let i = 0; i < TEXTURE_SIZE; i++) {
            // Use actual color if available, otherwise repeat last color
            const colorIndex = Math.min(i, numColors - 1);
            const c = this.paletteColors[colorIndex];
            data[i * 4 + 0] = Math.round(c.r * 255);
            data[i * 4 + 1] = Math.round(c.g * 255);
            data[i * 4 + 2] = Math.round(c.b * 255);
            data[i * 4 + 3] = 255;
        }

        this.paletteTexture = new THREE.DataTexture(
            data,
            TEXTURE_SIZE,
            1,
            THREE.RGBAFormat,
            THREE.UnsignedByteType
        );
        this.paletteTexture.needsUpdate = true;
        this.paletteTexture.minFilter = THREE.NearestFilter;
        this.paletteTexture.magFilter = THREE.NearestFilter;
        this.paletteTexture.wrapS = THREE.ClampToEdgeWrapping;
        this.paletteTexture.wrapT = THREE.ClampToEdgeWrapping;

        console.log(`[PixelPaletteSystem] Created palette texture with ${numColors} colors (texture size: ${TEXTURE_SIZE})`);
    }

    postAllInit() {
        // Extract palette colors here to ensure game.palette is loaded
        this.extractPaletteColors();

        if (this.game.postProcessingSystem && this.paletteColors.length > 0) {
            this.createPaletteTexture();
            this.createPalettePass();
            this.game.gameManager.call('registerPostProcessingPass', 'palette', {
                enabled: this.enabled,
                pass: this.palettePass
            });
        } else {
            console.warn('[PixelPaletteSystem] Cannot create pass - no colors or no post-processing system');
        }
    }

    createPalettePass() {
        this.palettePass = {
            enabled: this.enabled,
            needsSwap: true,
            clear: false,

            uniforms: {
                tDiffuse: { value: null },
                paletteTexture: { value: this.paletteTexture }
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
                uniform sampler2D paletteTexture;

                varying vec2 vUv;

                float colorDistanceSq(vec3 c1, vec3 c2) {
                    vec3 diff = c1 - c2;
                    return dot(diff, diff);
                }

                void main() {
                    vec4 texColor = texture2D(tDiffuse, vUv);

                    // DEBUG: Just pass through the input to verify what we're receiving
                    gl_FragColor = texColor;
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

        console.log('[PixelPaletteSystem] Created palette post-processing pass');
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
        if (this.paletteTexture) {
            this.paletteTexture.dispose();
        }

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
