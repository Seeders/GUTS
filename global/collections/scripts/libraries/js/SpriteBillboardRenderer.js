/**
 * SpriteBillboardRenderer - High-performance instanced sprite billboard renderer
 *
 * A reusable library for rendering large numbers of animated sprite billboards
 * using Three.js instanced rendering. Designed for performance with 100k+ sprites.
 *
 * Features:
 * - Instanced mesh rendering for efficient GPU batching
 * - Sprite sheet support with UV coordinate manipulation
 * - 8-direction sprite animation support
 * - Camera-facing billboards with direction snapping
 * - Per-instance animation frame control
 */
class SpriteBillboardRenderer {
    constructor(options = {}) {
        this.scene = options.scene;
        this.capacity = options.capacity || 100000;
        this.resourcesPath = options.resourcesPath || '';  // Base path for loading resources

        // Three.js objects
        this.instancedMesh = null;
        this.geometry = null;
        this.material = null;
        this.spriteSheetTexture = null;

        // Sprite sheet dimensions
        this.textureWidth = 0;
        this.textureHeight = 0;
        this.frameWidth = 256;  // Default frame size
        this.frameHeight = 256;

        // Animation data
        this.frames = null;  // Frame lookup: frames[animType][direction][frameIndex] = {x, y, w, h}
        this.animationTypes = [];
        this.directions = ['down', 'downleft', 'left', 'upleft', 'up', 'upright', 'right', 'downright'];
        this.framesPerDirection = 4;  // Default frames per direction
        this.fps = 4;  // Default animation FPS

        // Instance data
        this.instanceCount = 0;
        this.uvOffsets = null;  // Float32Array for UV offsets
        this.uvScales = null;   // Float32Array for UV scales

        // Pre-allocated reusable objects
        this._tempMatrix = new THREE.Matrix4();
        this._tempPosition = new THREE.Vector3();
        this._tempQuaternion = new THREE.Quaternion();
        this._tempScale = new THREE.Vector3(1, 1, 1);
    }

    /**
     * Initialize the renderer with a sprite sheet
     * @param {string} spriteSheetPath - Path to sprite sheet image
     * @param {Object} spriteAnimationSet - Sprite animation set JSON data
     * @returns {Promise<boolean>} Success
     */
    async init(spriteSheetPath, spriteAnimationSet) {
        // Load sprite sheet texture
        const textureLoader = new THREE.TextureLoader();

        // Construct full URL using resources path
        const fullPath = this.resourcesPath + spriteSheetPath;
        console.log('[SpriteBillboardRenderer] Loading sprite sheet from:', fullPath);

        try {
            this.spriteSheetTexture = await new Promise((resolve, reject) => {
                textureLoader.load(
                    fullPath,
                    resolve,
                    undefined,
                    reject
                );
            });
        } catch (error) {
            console.error('[SpriteBillboardRenderer] Failed to load sprite sheet:', fullPath, error);
            return false;
        }

        // Configure texture
        this.spriteSheetTexture.flipY = false;  // Sprite sheets use top-left origin
        this.spriteSheetTexture.colorSpace = THREE.SRGBColorSpace;
        this.spriteSheetTexture.minFilter = THREE.NearestFilter;
        this.spriteSheetTexture.magFilter = THREE.NearestFilter;
        this.spriteSheetTexture.wrapS = THREE.ClampToEdgeWrapping;
        this.spriteSheetTexture.wrapT = THREE.ClampToEdgeWrapping;

        // Get texture dimensions
        this.textureWidth = this.spriteSheetTexture.image.width;
        this.textureHeight = this.spriteSheetTexture.image.height;

        // Parse animation data from sprite animation set
        this.parseAnimationData(spriteAnimationSet);

        // Create geometry and material
        this.createGeometry();
        this.createMaterial();
        this.createInstancedMesh();

        return true;
    }

    /**
     * Parse sprite animation set data into a frame lookup table
     */
    parseAnimationData(spriteAnimationSet) {
        if (!spriteAnimationSet || !spriteAnimationSet.frames) {
            console.warn('[SpriteBillboardRenderer] No frames in sprite animation set');
            return;
        }

        // Get generator settings
        const settings = spriteAnimationSet.generatorSettings || {};
        this.frameWidth = settings.spriteSize || 256;
        this.frameHeight = settings.spriteSize || 256;
        this.fps = settings.fps || 4;
        this.animationTypes = settings.animationTypes || ['idle', 'walk'];

        // Build frame lookup: frames[animType][direction][frameIndex]
        this.frames = {};

        for (const animType of this.animationTypes) {
            this.frames[animType] = {};

            for (const direction of this.directions) {
                this.frames[animType][direction] = [];

                // Build frame name pattern: e.g., "idleDown_0", "walkUpLeft_3"
                // Direction names in JSON use capitalized first letter
                const dirCapitalized = direction.charAt(0).toUpperCase() + direction.slice(1);

                // Find all frames for this animation type and direction
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

        // Determine frames per direction from first animation type
        if (this.animationTypes.length > 0 && this.frames[this.animationTypes[0]]) {
            const firstDir = this.frames[this.animationTypes[0]].down;
            if (firstDir) {
                this.framesPerDirection = firstDir.length || 4;
            }
        }

        console.log(`[SpriteBillboardRenderer] Parsed ${this.animationTypes.length} animation types, ${this.framesPerDirection} frames per direction`);
    }

    /**
     * Create billboard geometry with instanced UV attributes
     */
    createGeometry() {
        // Create a simple quad (plane geometry)
        this.geometry = new THREE.PlaneGeometry(1, 1);

        // Add instance attributes for UV coordinates
        this.uvOffsets = new Float32Array(this.capacity * 2);
        this.uvScales = new Float32Array(this.capacity * 2);

        // Initialize with default UVs (first frame)
        const defaultScaleX = this.frameWidth / this.textureWidth;
        const defaultScaleY = this.frameHeight / this.textureHeight;

        for (let i = 0; i < this.capacity; i++) {
            this.uvOffsets[i * 2] = 0;
            this.uvOffsets[i * 2 + 1] = 0;
            this.uvScales[i * 2] = defaultScaleX;
            this.uvScales[i * 2 + 1] = defaultScaleY;
        }

        this.geometry.setAttribute('uvOffset', new THREE.InstancedBufferAttribute(this.uvOffsets, 2));
        this.geometry.setAttribute('uvScale', new THREE.InstancedBufferAttribute(this.uvScales, 2));
    }

    /**
     * Create shader material for billboarding with UV manipulation
     */
    createMaterial() {
        this.material = new THREE.ShaderMaterial({
            uniforms: THREE.UniformsUtils.merge([
                THREE.UniformsLib.fog,
                {
                    map: { value: this.spriteSheetTexture },
                    ambientLightColor: { value: new THREE.Color(1.0, 1.0, 1.0) }
                }
            ]),
            vertexShader: `
                attribute vec2 uvOffset;
                attribute vec2 uvScale;
                varying vec2 vUv;
                #include <fog_pars_vertex>

                void main() {
                    // Pass UV with instance-specific offset and scale
                    // Flip V coordinate since we disabled texture.flipY
                    vUv = vec2(uv.x * uvScale.x + uvOffset.x, (1.0 - uv.y) * uvScale.y + uvOffset.y);

                    // Get instance transform
                    mat4 instanceMat = instanceMatrix;

                    // Extract position from instance matrix
                    vec3 instancePos = vec3(instanceMat[3][0], instanceMat[3][1], instanceMat[3][2]);

                    // Extract scale from instance matrix
                    vec3 instanceScale = vec3(
                        length(vec3(instanceMat[0][0], instanceMat[0][1], instanceMat[0][2])),
                        length(vec3(instanceMat[1][0], instanceMat[1][1], instanceMat[1][2])),
                        length(vec3(instanceMat[2][0], instanceMat[2][1], instanceMat[2][2]))
                    );

                    // Get world-space instance position
                    vec4 worldPos = modelMatrix * vec4(instancePos, 1.0);

                    // Calculate angle from entity to camera in world XZ plane
                    float dx = cameraPosition.x - worldPos.x;
                    float dz = cameraPosition.z - worldPos.z;
                    float angleToCamera = atan(dz, dx);

                    // Snap angle to nearest 45-degree increment for 8-direction sprites
                    const float ANGLE_STEP = 3.14159265359 / 4.0;
                    float snappedAngle = round(angleToCamera / ANGLE_STEP) * ANGLE_STEP;

                    // Billboard quad: PlaneGeometry is in XY plane
                    vec3 scaledPos = vec3(position.x * instanceScale.x, position.y * instanceScale.y, 0.0);

                    // Rotate quad to face camera at snapped angle
                    float cosA = cos(snappedAngle);
                    float sinA = sin(snappedAngle);

                    // Calculate vertical angle for Y-axis billboarding
                    float dy = cameraPosition.y - worldPos.y;
                    float horizontalDist = sqrt(dx * dx + dz * dz);
                    float verticalAngle = atan(dy, horizontalDist);

                    // Snapped right vector (horizontal, in XZ plane)
                    vec3 snappedRight = vec3(sinA, 0.0, -cosA);

                    // Forward direction toward camera
                    vec3 forward = vec3(cosA, 0.0, sinA);

                    // Tilt up vector based on camera's vertical position
                    float cosV = cos(verticalAngle);
                    float sinV = sin(verticalAngle);

                    vec3 up = vec3(
                        -forward.x * sinV,
                        cosV,
                        -forward.z * sinV
                    );

                    // Build the billboard position
                    vec3 rotatedPos = snappedRight * scaledPos.x + up * scaledPos.y;

                    // Add to world position
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
                    // Apply ambient lighting
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

    /**
     * Create the instanced mesh
     */
    createInstancedMesh() {
        this.instancedMesh = new THREE.InstancedMesh(this.geometry, this.material, this.capacity);
        this.instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.instancedMesh.frustumCulled = false;
        this.instancedMesh.count = 0;

        if (this.scene) {
            this.scene.add(this.instancedMesh);
        }
    }

    /**
     * Set the number of active instances
     * @param {number} count - Number of instances to render
     */
    setInstanceCount(count) {
        this.instanceCount = Math.min(count, this.capacity);
        if (this.instancedMesh) {
            this.instancedMesh.count = this.instanceCount;
        }
    }

    /**
     * Update a single instance's transform
     * @param {number} index - Instance index
     * @param {number} x - X position
     * @param {number} y - Y position
     * @param {number} z - Z position
     * @param {number} scale - Uniform scale (default 1)
     */
    setInstanceTransform(index, x, y, z, scale = 1) {
        if (index >= this.capacity) return;

        this._tempPosition.set(x, y, z);
        this._tempScale.set(scale, scale, scale);
        this._tempMatrix.compose(this._tempPosition, this._tempQuaternion, this._tempScale);
        this.instancedMesh.setMatrixAt(index, this._tempMatrix);
    }

    /**
     * Update a single instance's animation frame
     * @param {number} index - Instance index
     * @param {string} animationType - Animation type (e.g., 'idle', 'walk')
     * @param {number} directionIndex - Direction index (0-7: down, downleft, left, upleft, up, upright, right, downright)
     * @param {number} frameIndex - Frame index within the animation
     */
    setInstanceFrame(index, animationType, directionIndex, frameIndex) {
        if (index >= this.capacity) return;

        const direction = this.directions[directionIndex] || 'down';
        const frames = this.frames?.[animationType]?.[direction];

        if (!frames || frames.length === 0) {
            // Fallback to idle if animation type not found
            const fallbackFrames = this.frames?.['idle']?.[direction] || this.frames?.['walk']?.[direction];
            if (!fallbackFrames || fallbackFrames.length === 0) return;

            const frame = fallbackFrames[frameIndex % fallbackFrames.length];
            this.setInstanceUV(index, frame);
            return;
        }

        const frame = frames[frameIndex % frames.length];
        this.setInstanceUV(index, frame);
    }

    /**
     * Set UV coordinates for an instance
     * @param {number} index - Instance index
     * @param {Object} frame - Frame data {x, y, w, h}
     */
    setInstanceUV(index, frame) {
        if (!frame) return;

        const offsetX = frame.x / this.textureWidth;
        const offsetY = frame.y / this.textureHeight;
        const scaleX = frame.w / this.textureWidth;
        const scaleY = frame.h / this.textureHeight;

        this.uvOffsets[index * 2] = offsetX;
        this.uvOffsets[index * 2 + 1] = offsetY;
        this.uvScales[index * 2] = scaleX;
        this.uvScales[index * 2 + 1] = scaleY;
    }

    /**
     * Convert a heading vector to a direction index (0-7) relative to camera
     * @param {number} hx - Heading X component
     * @param {number} hz - Heading Z component
     * @param {number} camX - Camera X position
     * @param {number} camZ - Camera Z position
     * @param {number} entityX - Entity X position
     * @param {number} entityZ - Entity Z position
     * @returns {number} Direction index (0=down, 1=downleft, 2=left, etc.)
     */
    headingToDirection(hx, hz, camX, camZ, entityX, entityZ) {
        const ANGLE_STEP = Math.PI / 4;

        // Calculate entity's facing angle (from heading vector)
        const entityFacingAngle = Math.atan2(hz, hx);

        // Calculate angle from entity to camera
        const dx = camX - entityX;
        const dz = camZ - entityZ;
        const angleToCamera = Math.atan2(dz, dx);

        // Snap camera angle to 8 directions (same as billboard shader)
        const snappedCameraAngle = Math.round(angleToCamera / ANGLE_STEP) * ANGLE_STEP;

        // Calculate relative angle: entity facing relative to camera view
        // This gives us the sprite direction to show
        let relativeAngle = entityFacingAngle - snappedCameraAngle;

        // Normalize to -PI to PI
        while (relativeAngle > Math.PI) relativeAngle -= 2 * Math.PI;
        while (relativeAngle < -Math.PI) relativeAngle += 2 * Math.PI;

        // Snap relative angle to 8 directions
        const snappedRelativeAngle = Math.round(relativeAngle / ANGLE_STEP) * ANGLE_STEP;

        // Map to direction index (0-7)
        // Direction 0 = facing camera (down sprite), increases counterclockwise
        let directionIndex = Math.round(snappedRelativeAngle / ANGLE_STEP);
        directionIndex = ((directionIndex % 8) + 8) % 8;

        return directionIndex;
    }

    /**
     * Finalize updates - call after all instance updates
     */
    finalizeUpdates() {
        if (this.instancedMesh) {
            this.instancedMesh.instanceMatrix.needsUpdate = true;
            this.geometry.attributes.uvOffset.needsUpdate = true;
            this.geometry.attributes.uvScale.needsUpdate = true;
        }
    }

    /**
     * Get the instanced mesh for adding to a scene
     */
    getMesh() {
        return this.instancedMesh;
    }

    /**
     * Set ambient light color for sprites
     * @param {THREE.Color} color - Ambient light color
     */
    setAmbientLight(color) {
        if (this.material && this.material.uniforms.ambientLightColor) {
            this.material.uniforms.ambientLightColor.value.copy(color);
        }
    }

    /**
     * Dispose of all resources
     */
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
    }
}

// Export for GUTS
if (typeof window !== 'undefined') {
    window.SpriteBillboardRenderer = SpriteBillboardRenderer;
}
