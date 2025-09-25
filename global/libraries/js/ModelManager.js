class ModelManager {
    constructor(app, config, { ShapeFactory, palette, textures }) {
        this.app = app;
        this.config = config;
        this.shapeFactory = new ShapeFactory(palette, textures, null, 1);

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

    async loadModels(prefix, config) {
        console.log(`[ModelManager] Loading models for VAT rendering: ${prefix}`);

        // Load all models first (master + animations)
        for (const [type, cfg] of Object.entries(config)) {
            if (!cfg.render?.model) continue;

            const modelKey = `${prefix}_${type}`;

            // Load master model
            this.masterModels.set(modelKey, await this.createModel(cfg.render.model));

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
                            if (animVariant[animGroupName]?.shapes?.[0]?.url) {
                                mergedModel[mainGroupName].shapes[0].url = animVariant[animGroupName].shapes[0].url;
                            }
                        }

                        this.animationModels.set(animKey, await this.createModel(mergedModel));
                    }
                }
            }
        }

        this.assetsLoaded = true;
        console.log(`[ModelManager] Loaded ${this.masterModels.size} master models and ${this.animationModels.size} animation models`);
    }

    async createModel(modelData) {
        const rootGroup = new THREE.Group();
        for (const groupName in modelData) {
            const group = await this.shapeFactory.createMergedGroupFromJSON(
                modelData, {}, groupName, null, null
            );
            console.log(modelData, groupName, group);
            if (group) {
                rootGroup.add(group);
            }
        }
        return rootGroup;
    }

    // Main VAT bundle creation - called by RenderSystem
    async requestVATBundle(objectType, spawnType, unitDef) {
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
                console.log(`[ModelManager] VAT bundle ready: ${key}`, bundle.meta.clips.map(c => c.name));
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
        console.log(`[ModelManager] Building VAT bundle: ${key}`);

        // Get master model
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
            meta: {
                fps: vatData.fps,
                cols: vatData.cols,
                rows: vatData.rows,
                clips: vatData.clips,
                clipIndexByName: vatData.clipIndexByName
            }
        };
    }

    // Add method for static meshes without skeletons:
    _buildStaticVATBundle(key, masterModel, mesh) {
        console.log(`[ModelManager] Building static VAT bundle: ${key}`);
            
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

        // Then use this instead of null:
        const material = this._createVATMaterial(mesh, {
            texture: identityTexture,  // Instead of null
            clips: clips,
            clipIndexByName: clipIndexByName,
            fps: 30,
            cols: 4,
            rows: 1
        }, key);

        material.userData.batchKey = key;
        material.customProgramCacheKey = () => key;
        material.needsUpdate = true;

        const geometry = mesh.geometry.clone();
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

        console.log('created baseScale', baseScale, masterModel);
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
                baseScale: baseScale
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

        // Define standard animation names in order
        const animNames = ['idle', 'walk', 'attack', 'cast', 'death', 'celebrate'];

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
                        if (obj.userData?.animations?.[0]) {
                            clip = obj.userData.animations[0];
                        }
                    });

                    if (clip) {
                        clips.push({ name: animName, clip });
                        console.log(`[ModelManager] Found clip '${animName}' (${clip.duration}s) for ${key}`);
                    } else {
                        console.warn(`[ModelManager] No clip data in animation model ${animKey}`);
                    }
                } else {
                    console.warn(`[ModelManager] Animation model not found: ${animKey}`);
                }
            } catch (error) {
                console.warn(`[ModelManager] Failed to load animation '${animName}' for ${key}:`, error);
            }
        }

        // Ensure we have at least idle
        if (clips.length === 0 || !clips.some(c => c.name === 'idle')) {
            // Create a default idle clip
            const defaultClip = new THREE.AnimationClip('idle', 1.0, []);
            clips.unshift({ name: 'idle', clip: defaultClip });
            console.log(`[ModelManager] Added default idle clip for ${key}`);
        }

        return clips;
    }

    async _bakeVATTexture(masterModel, skeleton, clipData, fps = 30) {
        console.log(`[ModelManager] Baking VAT texture for ${clipData.length} clips at ${fps}fps`);

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
        console.log(`[ModelManager] VAT texture size: ${cols}x${rows} (${boneCount} bones, ${totalFrames} total frames)`);

        // Create texture data
        const textureData = new Float32Array(rows * cols * 4); // RGBA
        const mixer = new THREE.AnimationMixer(masterModel);
        const tempMatrix = new THREE.Matrix4();

        let currentRow = 0;

        // Bake each clip
        for (const clipInfo of clipMeta) {
            const action = mixer.clipAction(clipInfo.clip);
            action.play();

            console.log(`[ModelManager] Baking clip '${clipInfo.name}': ${clipInfo.frames} frames`);

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

        return {
            texture,
            cols,
            rows,
            fps,
            clips,
            boneCount
        };
    }

    _createVATMaterial(baseMesh, vatData, batchKey = 'unknown') {
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
        // Force unique shader compilation per batch
        material.userData.batchKey = batchKey;
        material.customProgramCacheKey = () => batchKey;

        material.onBeforeCompile = (shader) => {
            shader.uniforms.uVATTexture = { value: vatData.texture };
            shader.uniforms.uVATCols    = { value: vatData.cols };
            shader.uniforms.uVATRows    = { value: vatData.rows };
            shader.uniforms.uVATFPS     = { value: vatData.fps };

            // FIXED: Generate unique defines per batch to prevent cross-batch contamination
            const batchPrefix = batchKey.toUpperCase().replace(/[^A-Z0-9]/g, '_');
            const clipDefines = vatData.clips.map((clip, index) => `
                #define ${batchPrefix}_CLIP_${index}_START ${clip.startRow}.0
                #define ${batchPrefix}_CLIP_${index}_FRAMES ${clip.frames}.0
            `).join('\n');

            // *** DEBUG CODE ***
            console.log(`[VAT Debug] Clip mapping for ${batchKey}:`);
            console.log('vatData.clipIndexByName:', vatData.clipIndexByName);
            console.log('clips array order:', vatData.clips.map((c, i) => `${i}: ${c.name}`));
            
            // Verify each clip's shader define
            Object.entries(vatData.clipIndexByName || {}).forEach(([name, index]) => {
                const clip = vatData.clips[index];
                if (clip) {
                    console.log(`${name}(${index}) -> startRow:${clip.startRow}, frames:${clip.frames}`);
                } else {
                    console.error(`No clip found at index ${index} for ${name}`);
                }
            });

            const clipHelpers = `
                float getClipStartRow(float clipIndex) {
                    ${vatData.clips.map((clip, i) => 
                        `if (abs(clipIndex - ${i}.0) < 0.5) return ${batchPrefix}_CLIP_${i}_START;`
                    ).join('\n                    ')}
                    return ${batchPrefix}_CLIP_0_START;
                }
                float getClipFrames(float clipIndex) {
                    ${vatData.clips.map((clip, i) => 
                        `if (abs(clipIndex - ${i}.0) < 0.5) return ${batchPrefix}_CLIP_${i}_FRAMES;`
                    ).join('\n                    ')}
                    return ${batchPrefix}_CLIP_0_FRAMES;
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

                ${clipDefines}
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
}