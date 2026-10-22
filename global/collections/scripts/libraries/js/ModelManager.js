class ModelManager {
    constructor(app, config, { ShapeFactory, palette, textures, models, animations, shaders, imageManager }) {
        this.app = app;
        this.config = config;
        this.shapeFactory = new ShapeFactory(this.app.getResourcesPath(), palette, textures, null, 1, models, animations);

        // Pass shaders and imageManager to ShapeFactory for custom shader support
        if (shaders) {
            this.shapeFactory.setShaders(shaders);
        }
        if (imageManager) {
            this.shapeFactory.setImageManager(imageManager);
        }

        if (location.hostname.indexOf('github') >= 0) {
            this.shapeFactory.setURLRoot("/GUTS/");
        }

        // VAT-focused storage
        this.masterModels = new Map();           // objectType_spawnType -> THREE.Group (master models)
        this.animationModels = new Map();        // objectType_spawnType_animName -> THREE.Group
        this.vatBundles = new Map();             // objectType_spawnType -> { geometry, material, vatTexture, meta }
        this.vatBundlePromises = new Map();      // objectType_spawnType -> Promise

        this.assetsLoaded = false;
        this.app.modelManager = this;
    }

    clear() {
        this.masterModels.clear();
        this.animationModels.clear();
        this.vatBundles.clear();
        this.vatBundlePromises.clear();
    }

    dispose() {
        // Dispose VAT bundles
        for (const [key, bundle] of this.vatBundles) {
            if (bundle.geometry) bundle.geometry.dispose();
            if (bundle.material) bundle.material.dispose();
            if (bundle.vatTexture) bundle.vatTexture.dispose();
        }
        this.clear();
    }

    async loadModels(prefix, config, onProgress = null) {
        this._configs = this._configs || {};
        this._configs[prefix] = config;
        // Load all models first (master + animations); `lazyLoad` ones wait until first drawn
        for (const [type, cfg] of Object.entries(config)) {
            if (!cfg.render?.model || cfg.lazyLoad) continue;
            await this._loadOne(prefix, type, cfg, onProgress);
        }

        this.assetsLoaded = true;
    }

    /**
     * A lazyLoad unit's model and clips, loaded the first time it's needed. `config` is its collection,
     * for one loadModels hasn't seen (an editor loading one unit, not the whole collection).
     */
    async ensureLoaded(prefix, type, config = null) {
        const key = `${prefix}_${type}`;
        if (this.masterModels.has(key)) return;
        const cfg = (config || this._configs?.[prefix])?.[type];
        if (!cfg?.render?.model) return;
        this._loading = this._loading || new Map();
        if (!this._loading.has(key)) this._loading.set(key, this._loadOne(prefix, type, cfg));
        await this._loading.get(key);
    }

    async _loadOne(prefix, type, cfg, onProgress = null) {
        {
            const modelKey = `${prefix}_${type}`;

            // Load master model
            this.masterModels.set(modelKey, await this.createModel(cfg.render.model));
            if (onProgress) onProgress(modelKey);

            // Load animation variants
            if (cfg.render.animations) {
                for (const [animName, variants] of Object.entries(cfg.render.animations)) {
                    for (let variantIndex = 0; variantIndex < variants.length; variantIndex++) {
                        const animVariant = variants[variantIndex];
                        const animKey = variantIndex === 0
                            ? `${modelKey}_${animName}`
                            : `${modelKey}_${animName}_${variantIndex}`;

                        // Merge animation model data
                        let mergedModel = JSON.parse(JSON.stringify(cfg.render.model));
                        if (animVariant && Object.keys(animVariant).length > 0) {
                            const mainGroupName = Object.keys(mergedModel)[0];
                            const animGroupName = Object.keys(animVariant)[0];
                            const animShape = animVariant[animGroupName]?.shapes?.[0];
                            if (animShape) {
                                // Copy animation reference to merged model
                                if (animShape.animation) {
                                    mergedModel[mainGroupName].shapes[0].animation = animShape.animation;
                                    delete mergedModel[mainGroupName].shapes[0].model;
                                } else if (animShape.model) {
                                    mergedModel[mainGroupName].shapes[0].model = animShape.model;
                                }
                            }
                        }

                        const animModel = await this.createModel(mergedModel);
                        this.animationModels.set(animKey, animModel);
                        if (onProgress) onProgress(animKey);
                    }
                }
            }
        }
    }

    async createModel(modelData) {
        const rootGroup = new THREE.Group();
        for (const groupName in modelData) {
            const group = await this.shapeFactory.createMergedGroupFromJSON(
                modelData, {}, groupName, null, null
            );
            if (group) {
                rootGroup.add(group);
            }
        }
        return rootGroup;
    }

    // ==================== LOOKS (variants of one model) ====================
    //
    // A unit can be drawn in several looks that share its bone bake: a modular
    // character wearing different parts, say. A look is a string the game picks
    // (lookFor); each look gets its own batch and bundle, built over the model's
    // one bake by buildLookBundle. Both are hooks for a game's ModelManager
    // subclass; by default no unit has looks.

    /** The look to draw this entity in, or null for the plain model. */
    lookFor(entityId, unitDef, looks) {
        return null;
    }

    /** A look's bundle ({ geometry, material, vatTexture, vatData, meta }) over the model's bake. */
    buildLookBundle(key, baseKey, base, look) {
        throw new Error(`[ModelManager] ${baseKey}: looks need a ModelManager subclass that implements buildLookBundle`);
    }

    static lookHash(look) {
        let h = 0;
        for (let i = 0; i < look.length; i++) h = (Math.imul(h, 31) + look.charCodeAt(i)) | 0;
        return (h >>> 0).toString(36);
    }

    async _requestLookBundle(objectType, spawnType, unitDef, look) {
        const baseKey = `${objectType}_${spawnType}`;
        const key = `${baseKey}_look${ModelManager.lookHash(look)}`;
        if (this.vatBundles.has(key)) return { ready: true, bundle: this.vatBundles.get(key) };
        if (!this.vatBundlePromises.has(key)) {
            this.vatBundlePromises.set(key, (async () => {
                // the bone bake, once per model
                let base = this.vatBundles.get(baseKey);
                if (!base) {
                    let p = this.vatBundlePromises.get(baseKey);
                    if (!p) { p = this._buildVATBundle(baseKey, objectType, spawnType, unitDef); this.vatBundlePromises.set(baseKey, p); }
                    try { base = await p; if (base) this.vatBundles.set(baseKey, base); } finally { this.vatBundlePromises.delete(baseKey); }
                }
                if (!base?.vatData) throw new Error(`Bake failed: ${baseKey}`);
                const bundle = this.buildLookBundle(key, baseKey, base, look);
                this.vatBundles.set(key, bundle);
                return bundle;
            })());
        }
        try {
            return { ready: true, bundle: await this.vatBundlePromises.get(key) };
        } catch (error) {
            console.error(`[ModelManager] Look failed: ${key}`, error);
            return { ready: false, error: 'Look failed' };
        } finally {
            this.vatBundlePromises.delete(key);
        }
    }

    // Main VAT bundle creation - called by RenderSystem. `look` (see lookFor) selects
    // a variant of the model sharing its bone bake.
    async requestVATBundle(objectType, spawnType, unitDef, look = null) {
        if (look != null) return this._requestLookBundle(objectType, spawnType, unitDef, look);
        const key = `${objectType}_${spawnType}`;

        // Return existing bundle
        if (this.vatBundles.has(key)) {
            return { ready: true, bundle: this.vatBundles.get(key) };
        }

        // Return in-progress promise
        if (this.vatBundlePromises.has(key)) {
            return { ready: false, promise: this.vatBundlePromises.get(key) };
        }

        // Start building VAT bundle
        const promise = this._buildVATBundle(key, objectType, spawnType, unitDef);
        this.vatBundlePromises.set(key, promise);

        try {
            const bundle = await promise;
            if (bundle) {
                this.vatBundles.set(key, bundle);
                return { ready: true, bundle };
            }
        } catch (error) {
            console.error(`[ModelManager] VAT bundle failed: ${key}`, error);
        } finally {
            this.vatBundlePromises.delete(key);
        }

        return { ready: false, error: 'VAT bundle creation failed' };
    }

    async _buildVATBundle(key, objectType, spawnType, unitDef) {

        // Get master model (a lazyLoad unit loads now)
        if (!this.masterModels.has(key)) await this.ensureLoaded(objectType, spawnType);
        const masterModel = this.masterModels.get(key);
        if (!masterModel) {
            throw new Error(`Master model not found: ${key}`);
        }

        // Find any mesh - prefer skinned mesh but fallback to any mesh
        let targetMesh = null;
        let skeleton = null;
        
        masterModel.traverse(obj => {
            if (obj.isSkinnedMesh && obj.skeleton && !targetMesh) {
                targetMesh = obj;
                skeleton = obj.skeleton;
            } else if (obj.isMesh && !targetMesh) {
                targetMesh = obj;
            }
        });

        if (!targetMesh) {
            throw new Error(`No mesh found in: ${key}`);
        }

        // Collect animation clips (may be empty for static meshes)
        const clips = await this._collectAnimationClips(key, objectType, spawnType, unitDef);
        
        // If no skeleton or no clips, create a static "animation" 
        if (!skeleton || clips.length === 0) {
            return this._buildStaticVATBundle(key, masterModel, targetMesh);
        }

        // Standard VAT bundle with animations
        const vatData = await this._bakeVATTexture(masterModel, skeleton, clips);
        if (!vatData) {
            throw new Error(`VAT baking failed for: ${key}`);
        }

        vatData.clipIndexByName = this._buildClipIndexMap(vatData.clips);
        const material = this._createVATMaterial(targetMesh, vatData, key);
        const geometry = targetMesh.geometry.clone();

        // Copy bone data
        const skinIndexAttr = targetMesh.geometry.getAttribute('skinIndex');
        const skinWeightAttr = targetMesh.geometry.getAttribute('skinWeight');
        if (!skinIndexAttr || !skinWeightAttr) {
            throw new Error('Skinned geometry missing skinIndex/skinWeight attributes.');
        }
        
        geometry.setAttribute('aBoneIndex', skinIndexAttr.clone());
        geometry.setAttribute('aBoneWeight', skinWeightAttr.clone());

        this._ensureFloatAttribute(geometry, 'aClipIndex', 1, 0.0);
        this._ensureFloatAttribute(geometry, 'aAnimTime', 1, 0.0);
        this._ensureFloatAttribute(geometry, 'aAnimSpeed', 1, 1.0);

        return {
            geometry,
            material,
            vatTexture: vatData.texture,
            vatData,
            meta: {
                fps: vatData.fps,
                cols: vatData.cols,
                rows: vatData.rows,
                clips: vatData.clips,
                clipIndexByName: vatData.clipIndexByName,
                skeleton: skeleton,
                attachmentTexture: vatData.attachmentTexture,
                attachmentBones: vatData.attachmentBones,
                attachmentValidBones: vatData.attachmentValidBones,
                attachmentBoneWorld: vatData.attachmentBoneWorld
            }
        };
    }

    /**
     * Hook: options for a static (unskinned) model's VAT material, given its cloned
     * geometry, which it may add attributes to. Returned options reach
     * _createVATMaterial and extendVATShader.
     */
    prepareStaticVAT(mesh, geometry) {
        return {};
    }

    /**
     * Hook: change a VAT material's shader (after the VAT code is in). Options
     * that change the source must set opts.programKey so differing shaders get
     * their own programs.
     */
    extendVATShader(shader, opts) {
    }

    /** Hook: add clips the model doesn't have (e.g. made from others) before the bake. */
    augmentClips(key, unitDef, clips) {
    }

    // Add method for static meshes without skeletons:
    _buildStaticVATBundle(key, masterModel, mesh) {
        const clips = [{ name: 'idle', startRow: 0, frames: 1 }];
        const clipIndexByName = { 'idle': 0 };
        
        // Now use clips in the material creation
        const identityData = new Float32Array([
            1, 0, 0, 0,  // identity matrix column 0
            0, 1, 0, 0,  // identity matrix column 1  
            0, 0, 1, 0,  // identity matrix column 2
            0, 0, 0, 1   // identity matrix column 3
        ]);

        const identityTexture = new THREE.DataTexture(
            identityData, 4, 1, THREE.RGBAFormat, THREE.FloatType
        );
        identityTexture.needsUpdate = true;
        identityTexture.flipY = false;

        const geometry = mesh.geometry.clone();
        const opts = this.prepareStaticVAT(mesh, geometry) || {};

        // Then use this instead of null:
        const material = this._createVATMaterial(mesh, {
            texture: identityTexture,  // Instead of null
            clips: clips,
            clipIndexByName: clipIndexByName,
            fps: 30,
            cols: 4,
            rows: 1
        }, key, opts);

        material.userData.batchKey = key;
        material.needsUpdate = true;

        const positionCount = geometry.getAttribute('position').count;
        
        // Create identity bone data (all vertices use bone 0 with weight 1)
        const boneIndices = new Float32Array(positionCount * 4);
        const boneWeights = new Float32Array(positionCount * 4);
        
        for (let i = 0; i < positionCount; i++) {
            boneIndices[i * 4] = 0;     // bone index 0
            boneWeights[i * 4] = 1;     // full weight
            // other indices/weights remain 0
        }
        
        geometry.setAttribute('aBoneIndex', new THREE.BufferAttribute(boneIndices, 4));
        geometry.setAttribute('aBoneWeight', new THREE.BufferAttribute(boneWeights, 4));

        this._ensureFloatAttribute(geometry, 'aClipIndex', 1, 0.0);
        this._ensureFloatAttribute(geometry, 'aAnimTime', 1, 0.0);
        this._ensureFloatAttribute(geometry, 'aAnimSpeed', 1, 1.0);
        const baseScale = (masterModel && masterModel.children[0]?.scale) ? masterModel.children[0].scale : new THREE.Vector3(1, 1, 1);
        const basePos = (masterModel && masterModel.children[0]?.position) ? masterModel.children[0].position : new THREE.Vector3(0, 0, 0);

        return {
            geometry,
            material,
            vatTexture: null, // No animation texture needed
            meta: {
                fps: 30,
                cols: 4,   // Identity matrix
                rows: 1,   // Single frame
                clips: clips,
                clipIndexByName: clipIndexByName,
                baseScale: baseScale,
                basePos: basePos
            }
        };
    }
    
    _ensureFloatAttribute(geometry, name, itemSize, fillValue = 0.0) {
        if (!geometry.getAttribute(name)) {
            const pos = geometry.getAttribute('position');
            const count = pos ? pos.count : 0;
            const arr = new Float32Array(count * itemSize);
            if (fillValue !== 0.0) arr.fill(fillValue);
            geometry.setAttribute(name, new THREE.BufferAttribute(arr, itemSize));
        }
    }

    async _collectAnimationClips(key, objectType, spawnType, unitDef) {
        const clips = [];

        // Standard animation names in order, then any others the unit names
        const base = ['idle', 'walk', 'run', 'sneak', 'strafeLeft', 'strafeRight', 'walkBack', 'attack', 'cast', 'hit', 'jump', 'death', 'celebrate'];
        const animNames = [...base, ...Object.keys(unitDef?.render?.animations || {}).filter(k => !base.includes(k))];

        for (const animName of animNames) {
            // Skip if not defined in unit config
            if (!unitDef?.render?.animations?.[animName]) continue;

            try {
                // Try to get animation model
                const animKey = `${key}_${animName}`;
                const animModel = this.animationModels.get(animKey);

                if (animModel) {
                    // Extract clip from animation model
                    let clip = null;

                    animModel.traverse(obj => {
                        // Check userData.animations (for base models with embedded animations,
                        // or for animation-only GLBs where ShapeFactory stores clips on the group)
                        if (obj.userData?.animations?.[0] && !clip) {
                            clip = obj.userData.animations[0];
                        }
                    });

                    // Also check model.animations directly (GLTF loader stores clips here)
                    if (!clip && animModel.animations?.length > 0) {
                        clip = animModel.animations[0];
                    }

                    if (clip) {
                        clips.push({ name: animName, clip });
                    }
                }
            } catch (error) {
                console.warn(`[ModelManager] Failed to load animation '${animName}' for ${key}:`, error);
            }
        }

        this.augmentClips(key, unitDef, clips);

        // Ensure we have at least idle
        if (clips.length === 0 || !clips.some(c => c.name === 'idle')) {
            // Create a default idle clip
            const defaultClip = new THREE.AnimationClip('idle', 1.0, []);
            clips.unshift({ name: 'idle', clip: defaultClip });
        }

        return clips;
    }

    async _bakeVATTexture(masterModel, skeleton, clipData, fps = 30) {

        const bones = skeleton.bones;
        const boneCount = bones.length;
        const bindMatrices = skeleton.boneInverses;

        // Calculate texture dimensions
        const cols = boneCount * 4; // 4 columns per bone (matrix rows)
        let totalFrames = 0;

        const clipMeta = clipData.map(({ name, clip }) => {
            const duration = clip.duration || 1.0;
            const frames = Math.max(1, Math.ceil(duration * fps));
            totalFrames += frames;
            return { name, clip, duration, frames };
        });

        const rows = totalFrames;

        // Create texture data
        const textureData = new Float32Array(rows * cols * 4); // RGBA
        const mixer = new THREE.AnimationMixer(masterModel);
        const tempMatrix = new THREE.Matrix4();

        let currentRow = 0;

        // Bake each clip
        for (const clipInfo of clipMeta) {
            const action = mixer.clipAction(clipInfo.clip);
            action.play();


            // Bake frames for this clip
            for (let frame = 0; frame < clipInfo.frames; frame++) {
                // Calculate time for this frame
                const t = clipInfo.frames > 1 ? (frame / (clipInfo.frames - 1)) * clipInfo.duration : 0;
                mixer.setTime(t);
                masterModel.updateMatrixWorld(true);

                // Bake bone matrices for this frame
                for (let boneIndex = 0; boneIndex < boneCount; boneIndex++) {
                    // Calculate final bone matrix (world * inverse bind)
                    tempMatrix.copy(bones[boneIndex].matrixWorld);
                    tempMatrix.multiply(bindMatrices[boneIndex]);

                    // Store matrix as 4 columns (transposed for shader)
                    const elements = tempMatrix.elements; // column-major
                    const textureRowIndex = currentRow + frame;
                    const boneColumnStart = boneIndex * 4;

                    for (let col = 0; col < 4; col++) {
                        const pixelIndex = (textureRowIndex * cols + boneColumnStart + col) * 4;
                        // Store column of matrix as RGBA
                        textureData[pixelIndex + 0] = elements[col * 4 + 0]; // x
                        textureData[pixelIndex + 1] = elements[col * 4 + 1]; // y
                        textureData[pixelIndex + 2] = elements[col * 4 + 2]; // z
                        textureData[pixelIndex + 3] = elements[col * 4 + 3]; // w
                    }
                }
            }

            action.stop();
            currentRow += clipInfo.frames;
        }

        // Create texture
        const texture = new THREE.DataTexture(
            textureData,
            cols,
            rows,
            THREE.RGBAFormat,
            THREE.FloatType
        );
        texture.needsUpdate = true;
        texture.flipY = false;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;

        // Build clip info with row ranges
        let rowOffset = 0;
        const clips = clipMeta.map(info => {
            const clipData = {
                name: info.name,
                startRow: rowOffset,
                endRow: rowOffset + info.frames,
                frames: info.frames,
                duration: info.duration
            };
            rowOffset += info.frames;
            return clipData;
        });

        const attachmentData = await this._bakeBoneAttachmentTexture(
            masterModel, bones, bindMatrices, mixer, clipMeta, fps
        );

        return {
            texture,
            cols,
            rows,
            fps,
            clips,
            boneCount,
            attachmentTexture: attachmentData.texture,
            attachmentBones: attachmentData.bones,
            attachmentValidBones: attachmentData.validBones.map(b => b.name),
            attachmentBoneWorld: attachmentData.boneWorld
        };
    }

    // Clip table size in the shared VAT shader (a uniform array).
    static VAT_MAX_CLIPS = 96;

    _createVATMaterial(baseMesh, vatData, batchKey = 'unknown', opts = {}) {
        // Get base material properties
        const sourceMaterial = Array.isArray(baseMesh.material)
            ? baseMesh.material[0]
            : baseMesh.material;

        // Create VAT material (do NOT enable skinning; we aren't using Three's path)
        const material = new THREE.MeshStandardMaterial({
            map: sourceMaterial?.map || null,
            color: sourceMaterial?.color?.clone() || new THREE.Color(0xffffff),
            metalness: sourceMaterial?.metalness ?? 0.5,
            roughness: sourceMaterial?.roughness ?? 0.5,
            vertexColors: !!sourceMaterial?.vertexColors && !!baseMesh.geometry?.attributes.color,
            transparent: false
        });

        // Add VAT shader modifications
        material.side = THREE.DoubleSide;           // helps if any frames flip winding
        material.metalness = sourceMaterial?.metalness ?? 0.05; // less metal, easier to see
        material.roughness = sourceMaterial?.roughness ?? 0.9;  // more diffuse light
        // Make VAT lookups crisp (optional but recommended)
        if(vatData.texture){
            vatData.texture.magFilter = THREE.NearestFilter;
            vatData.texture.minFilter = THREE.NearestFilter;
        }
        // One shader program for every VAT material (per programKey): the clip table goes in
        // a uniform array, not into the source, so a new unit type doesn't compile a new
        // program (each compile froze the screen for over a second on D3D).
        material.userData.batchKey = batchKey;
        material.customProgramCacheKey = () => 'vat' + (opts.programKey ? `_${opts.programKey}` : '');
        const MAX = ModelManager.VAT_MAX_CLIPS;
        if (vatData.clips.length > MAX) console.warn(`[ModelManager] ${batchKey}: ${vatData.clips.length} clips, only ${MAX} fit`);
        const clipTable = new Float32Array(MAX * 2);
        for (let i = 0; i < MAX; i++) {
            const c = vatData.clips[i] || vatData.clips[0];
            clipTable[i * 2] = c.startRow; clipTable[i * 2 + 1] = Math.max(1, c.frames);
        }

        material.onBeforeCompile = (shader) => {
            shader.uniforms.uVATTexture = { value: vatData.texture };
            shader.uniforms.uVATCols    = { value: vatData.cols };
            shader.uniforms.uVATRows    = { value: vatData.rows };
            shader.uniforms.uVATFPS     = { value: vatData.fps };
            shader.uniforms.uVATClips   = { value: clipTable };

            const clipHelpers = `
                float getClipStartRow(float clipIndex) {
                    return uVATClips[int(clamp(clipIndex + 0.5, 0.0, ${MAX - 1}.0))].x;
                }
                float getClipFrames(float clipIndex) {
                    return uVATClips[int(clamp(clipIndex + 0.5, 0.0, ${MAX - 1}.0))].y;
                }
                mat4 sampleVATMatrix(float row, float boneIndex) {
                    float boneColStart = boneIndex * 4.0;
                    float v = (row + 0.5) / uVATRows;
                    vec4 c0 = texture2D(uVATTexture, vec2((boneColStart + 0.5) / uVATCols, v));
                    vec4 c1 = texture2D(uVATTexture, vec2((boneColStart + 1.5) / uVATCols, v));
                    vec4 c2 = texture2D(uVATTexture, vec2((boneColStart + 2.5) / uVATCols, v));
                    vec4 c3 = texture2D(uVATTexture, vec2((boneColStart + 3.5) / uVATCols, v));
                    return mat4(c0, c1, c2, c3);  // columns
                }
            `;

            // strip three's skinning prelude (we supply our own attributes)
            shader.vertexShader = shader.vertexShader.replace('#include <skinning_pars_vertex>', '');

            shader.vertexShader = shader.vertexShader.replace(
                'void main() {',
                `
                // Custom VAT attributes
                attribute vec4 aBoneIndex;
                attribute vec4 aBoneWeight;
                attribute float aClipIndex;
                attribute float aAnimTime;
                attribute float aAnimSpeed;

                uniform sampler2D uVATTexture;
                uniform float uVATCols;
                uniform float uVATRows;
                uniform float uVATFPS;
                uniform vec2 uVATClips[${MAX}];

                ${clipHelpers}

                // Shared temporaries
                float _vat_currentRow;
                mat4 _vat_bm0, _vat_bm1, _vat_bm2, _vat_bm3;

                void main() {
                `
            );

            shader.vertexShader = shader.vertexShader.replace(
            '#include <beginnormal_vertex>',
            `
            // Determine current frame
            float _clipStart  = getClipStartRow(aClipIndex);
            float _clipFrames = getClipFrames(aClipIndex);
            float _frame      = floor(mod(aAnimTime * uVATFPS, _clipFrames));
            _vat_currentRow   = _clipStart + _frame;

            // Normalize bone weights (must be available here)
            float wsum_bn = aBoneWeight.x + aBoneWeight.y + aBoneWeight.z + aBoneWeight.w;
            vec4 w = (wsum_bn > 0.0) ? (aBoneWeight / wsum_bn) : vec4(1.0, 0.0, 0.0, 0.0);

            // Sample bone matrices for this frame (needed for normals too)
            _vat_bm0 = sampleVATMatrix(_vat_currentRow, aBoneIndex.x);
            _vat_bm1 = sampleVATMatrix(_vat_currentRow, aBoneIndex.y);
            _vat_bm2 = sampleVATMatrix(_vat_currentRow, aBoneIndex.z);
            _vat_bm3 = sampleVATMatrix(_vat_currentRow, aBoneIndex.w);

            // Skin the normal and renormalize
            vec3 n = normal;
            vec3 skinnedN =
                    mat3(_vat_bm0) * n * w.x +
                    mat3(_vat_bm1) * n * w.y +
                    mat3(_vat_bm2) * n * w.z +
                    mat3(_vat_bm3) * n * w.w;

            vec3 objectNormal = normalize(skinnedN);
            `
            );

            // --- begin_vertex: (re)compute weights & use same matrices to skin position
            shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            `
            // Recompute (safe if driver reorders chunks)
            float wsum_bv = aBoneWeight.x + aBoneWeight.y + aBoneWeight.z + aBoneWeight.w;
            vec4 w2 = (wsum_bv > 0.0) ? (aBoneWeight / wsum_bv) : vec4(1.0, 0.0, 0.0, 0.0);

            // Ensure matrices are available (cheap duplicates; keeps things robust)
            _vat_bm0 = sampleVATMatrix(_vat_currentRow, aBoneIndex.x);
            _vat_bm1 = sampleVATMatrix(_vat_currentRow, aBoneIndex.y);
            _vat_bm2 = sampleVATMatrix(_vat_currentRow, aBoneIndex.z);
            _vat_bm3 = sampleVATMatrix(_vat_currentRow, aBoneIndex.w);

            // Skin the position
            vec4 _pos = vec4(position, 1.0);
            vec4 _skinnedPos =
                    (_vat_bm0 * _pos) * w2.x +
                    (_vat_bm1 * _pos) * w2.y +
                    (_vat_bm2 * _pos) * w2.z +
                    (_vat_bm3 * _pos) * w2.w;

            vec3 transformed = _skinnedPos.xyz;
            `
            );
            this.extendVATShader(shader, opts);
        };
        material.needsUpdate = true;
        return material;
    }

    _buildClipIndexMap(clips) {
        const map = {};
        clips.forEach((clip, index) => {
            map[clip.name] = index;
        });
        return map;
    }

    // Legacy compatibility for non-unit objects (buildings, environment objects, etc.)
    getModel(objectType, spawnType) {
        const key = `${objectType}_${spawnType}`;

        // For units, redirect to VAT system
        if (objectType === 'units') {
            console.warn(`[ModelManager] Unit '${spawnType}' should use VAT batching, not getModel()`);
            // Return master model clone for emergency compatibility
            const master = this.masterModels.get(key);
            return master ? master.clone() : null;
        }

        // For environment objects, buildings, etc. - return master model clone
        const masterModel = this.masterModels.get(key);
        if (masterModel) {
            const clone = masterModel.clone();
            // Apply basic material setup
            clone.traverse(child => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });
            return clone;
        }

        console.warn(`[ModelManager] No model found for ${objectType}_${spawnType}`);
        return null;
    }

    // Legacy compatibility for animations
    async getAnimation(objectType, spawnType, animName, variantIndex = 0) {
        const key = variantIndex === 0
            ? `${objectType}_${spawnType}_${animName}`
            : `${objectType}_${spawnType}_${animName}_${variantIndex}`;

        const animModel = this.animationModels.get(key);
        if (animModel) {
            const clone = animModel.clone();
            clone.traverse(child => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });
            return clone;
        }

        console.warn(`[ModelManager] No animation model found for ${key}`);
        return null;
    }

    // Public API
    hasVATBundle(objectType, spawnType) {
        return this.vatBundles.has(`${objectType}_${spawnType}`);
    }

    getVATBundle(objectType, spawnType) {
        return this.vatBundles.get(`${objectType}_${spawnType}`);
    }
    async _bakeBoneAttachmentTexture(masterModel, bones, bindMatrices, mixer, clipMeta, fps) {
        const attachmentBoneNames = [
            'RightHand', 'LeftHand', 'Head', 'Spine2', 'Spine'
        ];
        const bonePrefix = 'mixamorig';
        
        const attachmentBones = [];
        for (const boneName of attachmentBoneNames) {
            let foundIndex = -1;
            for (let i = 0; i < bones.length; i++) {
                const bone = bones[i];
                const cleanName = bone.name.replace(bonePrefix, '');
                if (bone.name === boneName || cleanName === boneName || bone.name.includes(boneName)) {
                    foundIndex = i;
                    break;
                }
            }
            attachmentBones.push({ name: boneName, index: foundIndex });
        }

        const validBones = attachmentBones.filter(b => b.index >= 0);
        const cols = validBones.length * 4;
        const totalFrames = clipMeta.reduce((sum, info) => sum + info.frames, 0);
        const rows = totalFrames;

        const textureData = new Float32Array(rows * cols * 4);
        // The bones' own transforms per frame too (what an item held in that bone follows),
        // in the same space the skinned vertices end up in: rows x validBones x 16.
        const boneWorld = new Float32Array(rows * validBones.length * 16);
        const tempMatrix = new THREE.Matrix4();
        const worldMatrix = new THREE.Matrix4();

        let currentRow = 0;

        for (const clipInfo of clipMeta) {
            const action = mixer.clipAction(clipInfo.clip);
            action.play();

            for (let frame = 0; frame < clipInfo.frames; frame++) {
                const t = clipInfo.frames > 1 ? (frame / (clipInfo.frames - 1)) * clipInfo.duration : 0;
                mixer.setTime(t);
                masterModel.updateMatrixWorld(true);

                for (let i = 0; i < validBones.length; i++) {
                    const boneIndex = validBones[i].index;
                    const bone = bones[boneIndex];
                    
                    worldMatrix.copy(bone.matrixWorld);
                    boneWorld.set(worldMatrix.elements, ((currentRow + frame) * validBones.length + i) * 16);
                    tempMatrix.copy(worldMatrix).multiply(bindMatrices[boneIndex]);

                    const elements = tempMatrix.elements;
                    const textureRowIndex = currentRow + frame;
                    const boneColumnStart = i * 4;

                    for (let col = 0; col < 4; col++) {
                        const pixelIndex = (textureRowIndex * cols + boneColumnStart + col) * 4;
                        textureData[pixelIndex + 0] = elements[col * 4 + 0];
                        textureData[pixelIndex + 1] = elements[col * 4 + 1];
                        textureData[pixelIndex + 2] = elements[col * 4 + 2];
                        textureData[pixelIndex + 3] = elements[col * 4 + 3];
                    }
                }
            }

            action.stop();
            currentRow += clipInfo.frames;
        }

        const texture = new THREE.DataTexture(
            textureData,
            cols,
            rows,
            THREE.RGBAFormat,
            THREE.FloatType
        );
        texture.needsUpdate = true;
        texture.flipY = false;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;

      
        return {
            texture,
            bones: attachmentBones,
            validBones,
            boneWorld
        };
    }
}