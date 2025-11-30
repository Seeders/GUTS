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
                    vec3 inputColor = texColor.rgb;

                    // DEBUG: Show the palette texture as a strip at the top of the screen
                    if (vUv.y > 0.95) {
                        float paletteIdx = vUv.x * 18.0;
                        float u = (floor(paletteIdx) + 0.5) / 64.0;
                        vec3 paletteColor = texture2D(paletteTexture, vec2(u, 0.5)).rgb;
                        gl_FragColor = vec4(paletteColor, 1.0);
                        return;
                    }

                    // DEBUG: Show input on left strip
                    if (vUv.x < 0.05) {
                        gl_FragColor = vec4(inputColor, 1.0);
                        return;
                    }

                    // Sample all 18 palette colors directly (unrolled for WebGL compatibility)
                    vec3 c0 = texture2D(paletteTexture, vec2(0.5/64.0, 0.5)).rgb;
                    vec3 c1 = texture2D(paletteTexture, vec2(1.5/64.0, 0.5)).rgb;
                    vec3 c2 = texture2D(paletteTexture, vec2(2.5/64.0, 0.5)).rgb;
                    vec3 c3 = texture2D(paletteTexture, vec2(3.5/64.0, 0.5)).rgb;
                    vec3 c4 = texture2D(paletteTexture, vec2(4.5/64.0, 0.5)).rgb;
                    vec3 c5 = texture2D(paletteTexture, vec2(5.5/64.0, 0.5)).rgb;
                    vec3 c6 = texture2D(paletteTexture, vec2(6.5/64.0, 0.5)).rgb;
                    vec3 c7 = texture2D(paletteTexture, vec2(7.5/64.0, 0.5)).rgb;
                    vec3 c8 = texture2D(paletteTexture, vec2(8.5/64.0, 0.5)).rgb;
                    vec3 c9 = texture2D(paletteTexture, vec2(9.5/64.0, 0.5)).rgb;
                    vec3 c10 = texture2D(paletteTexture, vec2(10.5/64.0, 0.5)).rgb;
                    vec3 c11 = texture2D(paletteTexture, vec2(11.5/64.0, 0.5)).rgb;
                    vec3 c12 = texture2D(paletteTexture, vec2(12.5/64.0, 0.5)).rgb;
                    vec3 c13 = texture2D(paletteTexture, vec2(13.5/64.0, 0.5)).rgb;
                    vec3 c14 = texture2D(paletteTexture, vec2(14.5/64.0, 0.5)).rgb;
                    vec3 c15 = texture2D(paletteTexture, vec2(15.5/64.0, 0.5)).rgb;
                    vec3 c16 = texture2D(paletteTexture, vec2(16.5/64.0, 0.5)).rgb;
                    vec3 c17 = texture2D(paletteTexture, vec2(17.5/64.0, 0.5)).rgb;

                    // Find closest color with index tracking
                    vec3 closest = c0;
                    float minDist = colorDistanceSq(inputColor, c0);
                    float idx = 0.0;
                    float d;

                    d = colorDistanceSq(inputColor, c1); if (d < minDist) { minDist = d; closest = c1; idx = 1.0; }
                    d = colorDistanceSq(inputColor, c2); if (d < minDist) { minDist = d; closest = c2; idx = 2.0; }
                    d = colorDistanceSq(inputColor, c3); if (d < minDist) { minDist = d; closest = c3; idx = 3.0; }
                    d = colorDistanceSq(inputColor, c4); if (d < minDist) { minDist = d; closest = c4; idx = 4.0; }
                    d = colorDistanceSq(inputColor, c5); if (d < minDist) { minDist = d; closest = c5; idx = 5.0; }
                    d = colorDistanceSq(inputColor, c6); if (d < minDist) { minDist = d; closest = c6; idx = 6.0; }
                    d = colorDistanceSq(inputColor, c7); if (d < minDist) { minDist = d; closest = c7; idx = 7.0; }
                    d = colorDistanceSq(inputColor, c8); if (d < minDist) { minDist = d; closest = c8; idx = 8.0; }
                    d = colorDistanceSq(inputColor, c9); if (d < minDist) { minDist = d; closest = c9; idx = 9.0; }
                    d = colorDistanceSq(inputColor, c10); if (d < minDist) { minDist = d; closest = c10; idx = 10.0; }
                    d = colorDistanceSq(inputColor, c11); if (d < minDist) { minDist = d; closest = c11; idx = 11.0; }
                    d = colorDistanceSq(inputColor, c12); if (d < minDist) { minDist = d; closest = c12; idx = 12.0; }
                    d = colorDistanceSq(inputColor, c13); if (d < minDist) { minDist = d; closest = c13; idx = 13.0; }
                    d = colorDistanceSq(inputColor, c14); if (d < minDist) { minDist = d; closest = c14; idx = 14.0; }
                    d = colorDistanceSq(inputColor, c15); if (d < minDist) { minDist = d; closest = c15; idx = 15.0; }
                    d = colorDistanceSq(inputColor, c16); if (d < minDist) { minDist = d; closest = c16; idx = 16.0; }
                    d = colorDistanceSq(inputColor, c17); if (d < minDist) { minDist = d; closest = c17; idx = 17.0; }

                    // DEBUG: Show which index was selected on right strip (different colors = different indices)
                    if (vUv.x > 0.95) {
                        gl_FragColor = vec4(idx / 17.0, mod(idx, 6.0) / 5.0, mod(idx, 3.0) / 2.0, 1.0);
                        return;
                    }

                    gl_FragColor = vec4(closest, texColor.a);
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
