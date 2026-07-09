/**
 * SpriteBillboardRenderer - High-performance instanced sprite billboard renderer
 *
 * A reusable library for rendering large numbers of animated sprite billboards
 * using Three.js instanced rendering. Designed for performance with 100k+ sprites.
 *
 * Features:
 * - Instanced mesh rendering for efficient GPU batching
 * - Sprite sheet support with GPU-based UV calculation
 * - 8-direction sprite animation computed in shader
 * - Camera-facing billboards with direction snapping
 * - Per-instance heading for direction calculation on GPU
 */
class SpriteBillboardRenderer {
    constructor(options = {}) {
        this.scene = options.scene;
        this.capacity = options.capacity || 100000;
        this.resourcesPath = options.resourcesPath || '';

        // Three.js objects
        this.instancedMesh = null;
        this.geometry = null;
        this.material = null;
        this.spriteSheetTexture = null;

        // Sprite sheet dimensions and layout
        this.textureWidth = 0;
        this.textureHeight = 0;
        this.frameWidth = 256;
        this.frameHeight = 256;
        this.framesPerDirection = 4;
        this.fps = 4;

        // Animation data - computed once on init
        // Maps: animType -> direction -> [{x, y, w, h}, ...]
        this.frames = null;
        this.animationTypes = [];
        this.directions = ['down', 'downleft', 'left', 'upleft', 'up', 'upright', 'right', 'downright'];

        // Current animation state (uniform)
        this.currentAnimationType = 'walk';
        this.animationTime = 0;

        // Instance data
        this.headings = null;      // Float32Array for heading x,z per instance
        this.animOffsets = null;   // Float32Array for random animation phase offset per instance

        // Pre-allocated reusable objects
        this._tempMatrix = new THREE.Matrix4();
        this._tempPosition = new THREE.Vector3();
        this._tempQuaternion = new THREE.Quaternion();
        this._tempScale = new THREE.Vector3(1, 1, 1);
    }

    async init(spriteSheetPath, spriteAnimationSet) {
        const textureLoader = new THREE.TextureLoader();
        const fullPath = this.resourcesPath + spriteSheetPath;
        console.log('[SpriteBillboardRenderer] Loading sprite sheet from:', fullPath);

        try {
            this.spriteSheetTexture = await new Promise((resolve, reject) => {
                textureLoader.load(fullPath, resolve, undefined, reject);
            });
        } catch (error) {
            console.error('[SpriteBillboardRenderer] Failed to load sprite sheet:', fullPath, error);
            return false;
        }

        this.spriteSheetTexture.flipY = false;
        this.spriteSheetTexture.colorSpace = THREE.SRGBColorSpace;
        this.spriteSheetTexture.minFilter = THREE.NearestFilter;
        this.spriteSheetTexture.magFilter = THREE.NearestFilter;
        this.spriteSheetTexture.wrapS = THREE.ClampToEdgeWrapping;
        this.spriteSheetTexture.wrapT = THREE.ClampToEdgeWrapping;

        this.textureWidth = this.spriteSheetTexture.image.width;
        this.textureHeight = this.spriteSheetTexture.image.height;

        this.parseAnimationData(spriteAnimationSet);
        this.buildFrameLookupTexture();
        this.createGeometry();
        this.createMaterial();
        this.createInstancedMesh();

        return true;
    }

    parseAnimationData(spriteAnimationSet) {
        if (!spriteAnimationSet || !spriteAnimationSet.frames) {
            console.warn('[SpriteBillboardRenderer] No frames in sprite animation set');
            return;
        }

        const settings = spriteAnimationSet.generatorSettings || {};
        this.frameWidth = settings.spriteSize || 256;
        this.frameHeight = settings.spriteSize || 256;
        this.fps = settings.fps || 4;
        this.animationTypes = settings.animationTypes || ['idle', 'walk'];

        this.frames = {};

        for (const animType of this.animationTypes) {
            this.frames[animType] = {};

            for (const direction of this.directions) {
                this.frames[animType][direction] = [];
                // Convert 'downleft' to 'DownLeft', 'upleft' to 'UpLeft', etc.
                const dirCapitalized = direction
                    .replace(/^down/, 'Down')
                    .replace(/^up/, 'Up')
                    .replace(/left$/, 'Left')
                    .replace(/right$/, 'Right');

                let frameIndex = 0;
                while (true) {
                    const frameName = `${animType}${dirCapitalized}_${frameIndex}`;
                    const frameData = spriteAnimationSet.frames[frameName];
                    if (!frameData) break;

                    this.frames[animType][direction].push({
                        x: frameData.x,
                        y: frameData.y,
                        w: frameData.w || this.frameWidth,
                        h: frameData.h || this.frameHeight
                    });
                    frameIndex++;
                }
            }
        }

        if (this.animationTypes.length > 0 && this.frames[this.animationTypes[0]]) {
            const firstDir = this.frames[this.animationTypes[0]].down;
            if (firstDir) {
                this.framesPerDirection = firstDir.length || 4;
            }
        }

        console.log(`[SpriteBillboardRenderer] Parsed ${this.animationTypes.length} animation types, ${this.framesPerDirection} frames per direction`);
    }

    /**
     * Build a DataTexture containing frame UV data for GPU lookup
     * Layout: width=framesPerDirection, height=8 directions
     * Each pixel = (uOffset, vOffset, uScale, vScale)
     */
    buildFrameLookupTexture() {
        const numDirections = 8;
        const numFrames = this.framesPerDirection;
        const width = numFrames;
        const height = numDirections;

        // RGBA float texture: R=uOffset, G=vOffset, B=uScale, A=vScale
        const data = new Float32Array(width * height * 4);

        const animType = this.currentAnimationType;
        const animFrames = this.frames[animType] || this.frames['walk'] || this.frames['idle'];

        if (!animFrames) {
            console.warn('[SpriteBillboardRenderer] No frames found for animation type:', animType);
            // Fill with default frame (first frame of sprite sheet)
            const defaultUScale = this.frameWidth / this.textureWidth;
            const defaultVScale = this.frameHeight / this.textureHeight;
            for (let i = 0; i < width * height; i++) {
                data[i * 4 + 0] = 0;  // uOffset
                data[i * 4 + 1] = 0;  // vOffset
                data[i * 4 + 2] = defaultUScale;
                data[i * 4 + 3] = defaultVScale;
            }
        } else {
            // Default frame data in case direction is missing
            const defaultUScale = this.frameWidth / this.textureWidth;
            const defaultVScale = this.frameHeight / this.textureHeight;

            for (let dir = 0; dir < numDirections; dir++) {
                const dirName = this.directions[dir];
                const dirFrames = animFrames[dirName] || [];

                for (let f = 0; f < numFrames; f++) {
                    const idx = (dir * width + f) * 4;

                    if (dirFrames.length > 0) {
                        const frame = dirFrames[f % dirFrames.length];
                        data[idx + 0] = frame.x / this.textureWidth;
                        data[idx + 1] = frame.y / this.textureHeight;
                        data[idx + 2] = frame.w / this.textureWidth;
                        data[idx + 3] = frame.h / this.textureHeight;
                    } else {
                        // Fallback to default
                        data[idx + 0] = 0;
                        data[idx + 1] = 0;
                        data[idx + 2] = defaultUScale;
                        data[idx + 3] = defaultVScale;
                    }
                }
            }
        }

        this.frameLookupTexture = new THREE.DataTexture(
            data, width, height,
            THREE.RGBAFormat, THREE.FloatType
        );
        this.frameLookupTexture.minFilter = THREE.NearestFilter;
        this.frameLookupTexture.magFilter = THREE.NearestFilter;
        this.frameLookupTexture.wrapS = THREE.ClampToEdgeWrapping;
        this.frameLookupTexture.wrapT = THREE.ClampToEdgeWrapping;
        this.frameLookupTexture.needsUpdate = true;

        console.log(`[SpriteBillboardRenderer] Built frame lookup texture: ${width}x${height}`);
    }

    createGeometry() {
        this.geometry = new THREE.PlaneGeometry(1, 1);

        // Heading (x, z) per instance - direction computed in shader
        this.headings = new Float32Array(this.capacity * 2);
        this.geometry.setAttribute('heading', new THREE.InstancedBufferAttribute(this.headings, 2));

        // Random animation phase offset per instance (0-1 range, represents fraction of animation cycle)
        this.animOffsets = new Float32Array(this.capacity);
        for (let i = 0; i < this.capacity; i++) {
            this.animOffsets[i] = Math.random();
        }
        this.geometry.setAttribute('animOffset', new THREE.InstancedBufferAttribute(this.animOffsets, 1));
    }

    createMaterial() {
        this.material = new THREE.ShaderMaterial({
            uniforms: THREE.UniformsUtils.merge([
                THREE.UniformsLib.fog,
                {
                    map: { value: this.spriteSheetTexture },
                    frameLookup: { value: this.frameLookupTexture },
                    frameIndex: { value: 0 },
                    numFrames: { value: this.framesPerDirection },
                    ambientLightColor: { value: new THREE.Color(1.0, 1.0, 1.0) }
                }
            ]),
            vertexShader: `
                attribute vec2 heading;
                attribute float animOffset;

                uniform sampler2D frameLookup;
                uniform float frameIndex;
                uniform float numFrames;

                varying vec2 vUv;
                #include <fog_pars_vertex>

                const float PI = 3.14159265359;
                const float ANGLE_STEP = PI / 4.0;

                void main() {
                    // Get instance transform
                    mat4 instanceMat = instanceMatrix;
                    vec3 instancePos = vec3(instanceMat[3][0], instanceMat[3][1], instanceMat[3][2]);
                    vec3 instanceScale = vec3(
                        length(vec3(instanceMat[0][0], instanceMat[0][1], instanceMat[0][2])),
                        length(vec3(instanceMat[1][0], instanceMat[1][1], instanceMat[1][2])),
                        length(vec3(instanceMat[2][0], instanceMat[2][1], instanceMat[2][2]))
                    );

                    vec4 worldPos = modelMatrix * vec4(instancePos, 1.0);

                    // Calculate angle from entity to camera
                    float dx = cameraPosition.x - worldPos.x;
                    float dz = cameraPosition.z - worldPos.z;
                    float angleToCamera = atan(dz, dx);
                    float snappedCameraAngle = round(angleToCamera / ANGLE_STEP) * ANGLE_STEP;

                    // Calculate entity facing angle from heading
                    // Guard against zero heading (would give NaN)
                    float hx = heading.x;
                    float hz = heading.y;
                    float headingLen = sqrt(hx * hx + hz * hz);
                    if (headingLen < 0.001) {
                        hx = 0.0;
                        hz = -1.0;  // Default to facing -Z
                    }
                    float entityFacingAngle = atan(hz, hx);

                    // Relative angle determines sprite direction
                    float relativeAngle = entityFacingAngle - snappedCameraAngle;

                    // Normalize to -PI to PI
                    relativeAngle = mod(relativeAngle + PI, 2.0 * PI) - PI;

                    // Snap to 8 directions and get direction index (0-7)
                    float snappedRelative = round(relativeAngle / ANGLE_STEP) * ANGLE_STEP;
                    float dirIndexF = mod(round(snappedRelative / ANGLE_STEP) + 8.0, 8.0);

                    // Clamp to valid range just in case
                    dirIndexF = clamp(dirIndexF, 0.0, 7.0);

                    // Look up UV coordinates from frame lookup texture
                    // frameLookup is numFrames (width) x 8 (height)
                    // u = frame index (with per-instance offset for desync), v = direction index
                    float offsetFrame = mod(frameIndex + animOffset * numFrames, numFrames);
                    float u = (offsetFrame + 0.5) / numFrames;
                    float v = (dirIndexF + 0.5) / 8.0;
                    vec4 frameData = texture2D(frameLookup, vec2(u, v));

                    // frameData: R=uOffset, G=vOffset, B=uScale, A=vScale
                    vec2 uvOffset = frameData.rg;
                    vec2 uvScale = frameData.ba;

                    // Compute final UV (flip V for top-left origin)
                    vUv = vec2(uv.x * uvScale.x + uvOffset.x, (1.0 - uv.y) * uvScale.y + uvOffset.y);

                    // Billboard transformation
                    vec3 scaledPos = vec3(position.x * instanceScale.x, position.y * instanceScale.y, 0.0);

                    float cosA = cos(snappedCameraAngle);
                    float sinA = sin(snappedCameraAngle);

                    float dy = cameraPosition.y - worldPos.y;
                    float horizontalDist = sqrt(dx * dx + dz * dz);
                    float verticalAngle = atan(dy, horizontalDist);

                    vec3 snappedRight = vec3(sinA, 0.0, -cosA);
                    vec3 forward = vec3(cosA, 0.0, sinA);

                    float cosV = cos(verticalAngle);
                    float sinV = sin(verticalAngle);
                    vec3 up = vec3(-forward.x * sinV, cosV, -forward.z * sinV);

                    vec3 rotatedPos = snappedRight * scaledPos.x + up * scaledPos.y;
                    vec4 finalWorldPos = vec4(worldPos.xyz + rotatedPos, 1.0);

                    vec4 mvPosition = viewMatrix * finalWorldPos;
                    gl_Position = projectionMatrix * mvPosition;
                    #include <fog_vertex>
                }
            `,
            fragmentShader: `
                uniform sampler2D map;
                uniform vec3 ambientLightColor;
                varying vec2 vUv;
                #include <fog_pars_fragment>

                void main() {
                    vec4 texColor = texture2D(map, vUv);
                    if (texColor.a < 0.5) discard;
                    vec3 litColor = texColor.rgb * ambientLightColor;
                    gl_FragColor = vec4(litColor, texColor.a);
                    #include <colorspace_fragment>
                    #include <fog_fragment>
                }
            `,
            fog: true,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: true
        });
    }

    createInstancedMesh() {
        this.instancedMesh = new THREE.InstancedMesh(this.geometry, this.material, this.capacity);
        this.instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.instancedMesh.frustumCulled = false;
        this.instancedMesh.count = 0;

        if (this.scene) {
            this.scene.add(this.instancedMesh);
        }
    }

    setInstanceCount(count) {
        this.instanceCount = Math.min(count, this.capacity);
        if (this.instancedMesh) {
            this.instancedMesh.count = this.instanceCount;
        }
    }

    /**
     * Update instance transform and heading in one call
     */
    setInstance(index, x, y, z, scale, headingX, headingZ) {
        if (index >= this.capacity) return;

        // Set transform matrix
        this._tempPosition.set(x, y, z);
        this._tempScale.set(scale, scale, scale);
        this._tempMatrix.compose(this._tempPosition, this._tempQuaternion, this._tempScale);
        this.instancedMesh.setMatrixAt(index, this._tempMatrix);

        // Set heading for direction calculation in shader
        this.headings[index * 2] = headingX;
        this.headings[index * 2 + 1] = headingZ;
    }

    /**
     * Set animation frame (called once per frame, not per instance)
     */
    setAnimationFrame(frameIndex) {
        if (this.material && this.material.uniforms.frameIndex) {
            this.material.uniforms.frameIndex.value = frameIndex % this.framesPerDirection;
        }
    }

    /**
     * Finalize updates - call after all instance updates
     */
    finalizeUpdates() {
        if (this.instancedMesh) {
            this.instancedMesh.instanceMatrix.needsUpdate = true;
            this.geometry.attributes.heading.needsUpdate = true;
        }
    }

    getMesh() {
        return this.instancedMesh;
    }

    setAmbientLight(color) {
        if (this.material && this.material.uniforms.ambientLightColor) {
            this.material.uniforms.ambientLightColor.value.copy(color);
        }
    }

    dispose() {
        if (this.instancedMesh) {
            if (this.scene) {
                this.scene.remove(this.instancedMesh);
            }
            this.instancedMesh.dispose();
        }
        if (this.geometry) {
            this.geometry.dispose();
        }
        if (this.material) {
            this.material.dispose();
        }
        if (this.spriteSheetTexture) {
            this.spriteSheetTexture.dispose();
        }
        if (this.frameLookupTexture) {
            this.frameLookupTexture.dispose();
        }
    }
}

if (typeof window !== 'undefined') {
    window.SpriteBillboardRenderer = SpriteBillboardRenderer;
}
