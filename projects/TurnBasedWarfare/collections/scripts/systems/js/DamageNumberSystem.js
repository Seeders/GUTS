class DamageNumberSystem extends GUTS.BaseSystem {
    static services = ['showDamageNumber'];

    static serviceDependencies = [
        'getCamera'
    ];

    constructor(game) {
        super(game);
        this.game.damageNumberSystem = this;

        // Damage number system
        this.damageNumbers = [];
        this.damageNumberPool = [];
        this.maxDamageNumbers = 20;

        // Text atlas/sprite approach for damage numbers
        this.damageTextMaterial = null;
        this.damageTextGeometry = null;
        this.damageNumberMesh = null;
        this.activeCharInstances = 0;
        this.VERTICAL_SPEED = 48;
        this.CHAR_SIZE = 12;
        // Performance tracking
        this.stats = {
            activeDamageNumbers: 0
        };

        // Pre-allocate reusable vectors to avoid per-frame allocations
        this._cameraRight = null;  // Created lazily when THREE is available
        this._cameraUp = null;
        this._tempVec3 = null;
        this._charPos = null;
        this._toRemove = [];  // Reusable array for removal indices
        this._currentPos = null;  // Reusable vector for position calculation
    }

    init() {
        // Scene-dependent initialization deferred to onSceneLoad()
    }

    onSceneLoad(sceneData) {
        // Initialize the damage number system once scene/Three.js is available
        if (!this.damageNumberMesh) {
            this.initializeDamageNumberSystem();
        }
    }

    initializeDamageNumberSystem() {
        // Create texture atlas with all characters we need
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        
        // Store canvas for reference
        this.damageTextCanvas = canvas;
        this.damageTextContext = ctx;
        
        // Character set for damage numbers
        this.damageChars = '0123456789,-+!CRITICAL';
        this.charWidth = 64; // Each character is 64px wide
        this.charHeight = 128;
        this.atlasColumns = Math.floor(canvas.width / this.charWidth);
        
        // Draw all characters into the atlas
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = 'bold 100px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        for (let i = 0; i < this.damageChars.length; i++) {
            const char = this.damageChars[i];
            const x = (i % this.atlasColumns) * this.charWidth + this.charWidth / 2;
            const y = Math.floor(i / this.atlasColumns) * this.charHeight + this.charHeight / 2;
            
            // Draw outline
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 8;
            ctx.strokeText(char, x, y);
            
            // Draw character (white, we'll tint with vertex colors)
            ctx.fillStyle = '#FFFFFF';
            ctx.fillText(char, x, y);
        }
        
        // Create texture
        this.damageTexture = new THREE.CanvasTexture(canvas);
        this.damageTexture.minFilter = THREE.LinearFilter;
        this.damageTexture.magFilter = THREE.LinearFilter;
        this.damageTexture.needsUpdate = true;
        
        // Create instanced geometry for quads
        // Each damage number can have up to 10 characters
        const maxCharsPerNumber = 10;
        const maxNumbers = 20; // Max simultaneous damage numbers
        const maxInstances = maxNumbers * maxCharsPerNumber;
        
        this.maxDamageNumbers = maxNumbers;
        this.maxDamageChars = maxCharsPerNumber;
        this.maxDamageInstances = maxInstances;
        
        const geometry = new THREE.PlaneGeometry(1, 1);
        this.damageTextGeometry = new THREE.InstancedBufferGeometry().copy(geometry);
        
        // Instance attributes
        const instancePositions = new Float32Array(maxInstances * 3);
        const instanceColors = new Float32Array(maxInstances * 3);
        const instanceOpacities = new Float32Array(maxInstances);
        const instanceScales = new Float32Array(maxInstances * 2);
        const instanceUVOffsets = new Float32Array(maxInstances * 4); // x, y, width, height
        
        this.damageTextGeometry.setAttribute('instancePosition', 
            new THREE.InstancedBufferAttribute(instancePositions, 3));
        this.damageTextGeometry.setAttribute('instanceColor', 
            new THREE.InstancedBufferAttribute(instanceColors, 3));
        this.damageTextGeometry.setAttribute('instanceOpacity', 
            new THREE.InstancedBufferAttribute(instanceOpacities, 1));
        this.damageTextGeometry.setAttribute('instanceScale', 
            new THREE.InstancedBufferAttribute(instanceScales, 2));
        this.damageTextGeometry.setAttribute('instanceUVOffset', 
            new THREE.InstancedBufferAttribute(instanceUVOffsets, 4));
        
        // Create material with custom shader
        this.damageTextMaterial = new THREE.ShaderMaterial({
            uniforms: {
                map: { value: this.damageTexture },
                cameraRight: { value: new THREE.Vector3(1, 0, 0) },
                cameraUp: { value: new THREE.Vector3(0, 1, 0) }
            },
            vertexShader: `
                attribute vec3 instancePosition;
                attribute vec3 instanceColor;
                attribute float instanceOpacity;
                attribute vec2 instanceScale;
                attribute vec4 instanceUVOffset;
                
                uniform vec3 cameraRight;
                uniform vec3 cameraUp;
                
                varying vec2 vUv;
                varying vec3 vColor;
                varying float vOpacity;
                
                void main() {
                    vUv = uv * instanceUVOffset.zw + instanceUVOffset.xy;
                    vColor = instanceColor;
                    vOpacity = instanceOpacity;
                    
                    // For orthographic camera, build billboard in view space
                    vec3 viewRight = normalize((modelViewMatrix * vec4(cameraRight, 0.0)).xyz);
                    vec3 viewUp = normalize((modelViewMatrix * vec4(cameraUp, 0.0)).xyz);
                    
                    vec4 viewPos = modelViewMatrix * vec4(instancePosition, 1.0);
                    viewPos.xyz += viewRight * position.x * instanceScale.x;
                    viewPos.xyz += viewUp * position.y * instanceScale.y;
                    
                    gl_Position = projectionMatrix * viewPos;
                }
            `,
            fragmentShader: `
                uniform sampler2D map;
                
                varying vec2 vUv;
                varying vec3 vColor;
                varying float vOpacity;
                
                void main() {
                    vec4 texColor = texture2D(map, vUv);
                    
                    // Use texture alpha and tint with color
                    gl_FragColor = vec4(vColor * texColor.rgb, texColor.a * vOpacity);
                    
                    if (gl_FragColor.a < 0.01) discard;
                }
            `,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide
        });
        
        this.damageNumberMesh = new THREE.Mesh(this.damageTextGeometry, this.damageTextMaterial);
        this.damageNumberMesh.frustumCulled = false;
        this.game.scene.add(this.damageNumberMesh);
        
        // Initially hide all instances
        this.damageTextGeometry.instanceCount = 0;
        
        // Track active character instances
        this.activeCharInstances = 0;

        // Initialize reusable vectors now that THREE is available
        this._cameraRight = new THREE.Vector3();
        this._cameraUp = new THREE.Vector3();
        this._tempVec3 = new THREE.Vector3();
        this._charPos = new THREE.Vector3();
        this._currentPos = new THREE.Vector3();
    }

    getCharUVOffset(char) {
        const index = this.damageChars.indexOf(char);
        if (index === -1) return { x: 0, y: 0, width: 0, height: 0 }; // Hide unknown chars
        
        const col = index % this.atlasColumns;
        const row = Math.floor(index / this.atlasColumns);
        
        const uWidth = this.charWidth / this.damageTextCanvas.width;
        const uHeight = this.charHeight / this.damageTextCanvas.height;
        
        return {
            x: col * uWidth,
            y: row * uHeight,
            width: uWidth,
            height: uHeight
        };
    }
    
    showDamageNumber(x, y, z, damage, type = null) {
        // Default to physical element
        if (type === null) {
            type = this.enums.element.physical;
        }
        // Get or create damage number object
        let damageObj = this.damageNumberPool.pop();

        if (!damageObj) {
            damageObj = {
                charStartIndex: 0, // Index in instance buffer where this number's chars start
                charCount: 0,
                startTime: 0,
                duration: 1.5,
                startPos: new THREE.Vector3(),
                velocity: new THREE.Vector3(),
                color: new THREE.Color(),
                text: ''
            };
        }

        // Setup damage number
        damageObj.text = Math.abs(Math.round(damage)).toString();
        damageObj.charCount = damageObj.text.length;
        damageObj.startTime = this.game.state.now;
        damageObj.startPos.set(x + (Math.random() - 0.5) * 12, y + 10, z + (Math.random() - 0.5) * 12);
        damageObj.velocity.set(
            0, // Slight random horizontal drift
            this.VERTICAL_SPEED, // Initial upward velocity
            0
        );

        // Set color based on element type (numeric enum)
        damageObj.color.setHex(this.getDamageColor(type));
        if (type === 'critical') {
            damageObj.velocity.y = 12;
        }
        
        // Allocate character instances
        if (this.activeCharInstances + damageObj.charCount > this.maxDamageInstances) {
            // Pool is full, can't show this damage number
            console.warn('Damage number pool full');
            this.damageNumberPool.push(damageObj);
            return;
        }
        
        damageObj.charStartIndex = this.activeCharInstances;
        this.activeCharInstances += damageObj.charCount;
        
        // Add to active list
        this.damageNumbers.push(damageObj);
        
        // Update instance count
        this.damageTextGeometry.instanceCount = this.activeCharInstances;
        
        // Initialize character instances
        this.updateDamageNumberInstance(damageObj, 0);
        
    }
    
    updateDamageNumberInstance(damageObj, progress) {
        if (!this.call.getCamera()) return;

        // Calculate position with simple upward motion - reuse vector instead of clone()
        const pos = this._currentPos;
        pos.copy(damageObj.startPos);
        const elapsed = progress * damageObj.duration;
        pos.x += damageObj.velocity.x * elapsed;
        pos.y += damageObj.velocity.y * elapsed;
        pos.z += damageObj.velocity.z * elapsed;
        
        // Calculate opacity with fade out
        let opacity = 1.0;
        if (progress > 0.6) {
            opacity = 1.0 - ((progress - 0.6) / 0.4);
        }
        
        // No scaling - constant size
        const scale = 1.0;
        
        // Character size (world units)
        const charWidth = this.CHAR_SIZE * scale;
        const charHeight = this.CHAR_SIZE * scale * 2;
        
        // Update each character instance
        const positions = this.damageTextGeometry.attributes.instancePosition;
        const colors = this.damageTextGeometry.attributes.instanceColor;
        const opacities = this.damageTextGeometry.attributes.instanceOpacity;
        const scales = this.damageTextGeometry.attributes.instanceScale;
        const uvOffsets = this.damageTextGeometry.attributes.instanceUVOffset;
        
        // Center the entire text string at pos
        const totalWidth = damageObj.charCount * charWidth;
        const startOffset = -totalWidth / 2 + charWidth / 2;

        for (let i = 0; i < damageObj.charCount; i++) {
            const instanceIdx = damageObj.charStartIndex + i;
            const char = damageObj.text[i];

            // Position each character along camera right vector, centered
            // Reuse pre-allocated vector instead of cloning
            const offset = startOffset + i * charWidth;
            this._charPos.copy(pos);
            this._charPos.x += this._cameraRight.x * offset;
            this._charPos.y += this._cameraRight.y * offset;
            this._charPos.z += this._cameraRight.z * offset;
            positions.setXYZ(instanceIdx, this._charPos.x, this._charPos.y, this._charPos.z);
            
            // Color
            colors.setXYZ(instanceIdx, damageObj.color.r, damageObj.color.g, damageObj.color.b);
            
            // Opacity
            opacities.setX(instanceIdx, opacity);
            
            // Scale
            scales.setXY(instanceIdx, charWidth, charHeight);
            
            // UV offset for this character
            const uvOffset = this.getCharUVOffset(char);
            uvOffsets.setXYZW(instanceIdx, uvOffset.x, uvOffset.y, uvOffset.width, uvOffset.height);
        }
        
        positions.needsUpdate = true;
        colors.needsUpdate = true;
        opacities.needsUpdate = true;
        scales.needsUpdate = true;
        uvOffsets.needsUpdate = true;
    }

    updateDamageNumbers() {
        const camera = this.call.getCamera();
        if (!this.game.state || this.damageNumbers.length === 0 || !camera) return;
        // Update camera vectors for billboarding (reuse pre-allocated vectors)

        camera.matrixWorld.extractBasis(this._cameraRight, this._cameraUp, this._tempVec3);

        this.damageTextMaterial.uniforms.cameraRight.value.copy(this._cameraRight);
        this.damageTextMaterial.uniforms.cameraUp.value.copy(this._cameraUp);

        const currentTime = this.game.state.now;
        // Reuse array instead of creating new one each frame
        this._toRemove.length = 0;
        
        for (let i = 0; i < this.damageNumbers.length; i++) {
            const damageObj = this.damageNumbers[i];
            const elapsed = currentTime - damageObj.startTime;
            const progress = elapsed / damageObj.duration;

            if (progress >= 1) {
                this._toRemove.push(i);
                continue;
            }

            this.updateDamageNumberInstance(damageObj, progress);
        }

        // Remove completed damage numbers (backwards to maintain indices)
        for (let i = this._toRemove.length - 1; i >= 0; i--) {
            const idx = this._toRemove[i];
            const damageObj = this.damageNumbers[idx];
            
            // Free up character instances
            const charsToRemove = damageObj.charCount;
            const startIdx = damageObj.charStartIndex;
            
            // Shift all subsequent characters back in the buffer
            if (startIdx + charsToRemove < this.activeCharInstances) {
                const positions = this.damageTextGeometry.attributes.instancePosition;
                const colors = this.damageTextGeometry.attributes.instanceColor;
                const opacities = this.damageTextGeometry.attributes.instanceOpacity;
                const scales = this.damageTextGeometry.attributes.instanceScale;
                const uvOffsets = this.damageTextGeometry.attributes.instanceUVOffset;
                
                for (let j = startIdx + charsToRemove; j < this.activeCharInstances; j++) {
                    const sourceIdx = j;
                    const destIdx = j - charsToRemove;
                    
                    // Copy position
                    positions.setXYZ(destIdx, 
                        positions.getX(sourceIdx),
                        positions.getY(sourceIdx),
                        positions.getZ(sourceIdx)
                    );
                    
                    // Copy color
                    colors.setXYZ(destIdx,
                        colors.getX(sourceIdx),
                        colors.getY(sourceIdx),
                        colors.getZ(sourceIdx)
                    );
                    
                    // Copy opacity
                    opacities.setX(destIdx, opacities.getX(sourceIdx));
                    
                    // Copy scale
                    scales.setXY(destIdx,
                        scales.getX(sourceIdx),
                        scales.getY(sourceIdx)
                    );
                    
                    // Copy UV offset
                    uvOffsets.setXYZW(destIdx,
                        uvOffsets.getX(sourceIdx),
                        uvOffsets.getY(sourceIdx),
                        uvOffsets.getZ(sourceIdx),
                        uvOffsets.getW(sourceIdx)
                    );
                }
                
                positions.needsUpdate = true;
                colors.needsUpdate = true;
                opacities.needsUpdate = true;
                scales.needsUpdate = true;
                uvOffsets.needsUpdate = true;
            }
            
            this.activeCharInstances -= charsToRemove;
            
            // Update indices for remaining damage numbers
            for (let j = idx + 1; j < this.damageNumbers.length; j++) {
                this.damageNumbers[j].charStartIndex -= charsToRemove;
            }
            
            // Return to pool
            this.damageNumberPool.push(damageObj);
            
            // Remove from active array
            this.damageNumbers.splice(idx, 1);
        }
        
        // Update instance count
        this.damageTextGeometry.instanceCount = this.activeCharInstances;
        this.stats.activeDamageNumbers = this.damageNumbers.length;
    }
    
    // Keep all existing particle and screen effect methods unchanged
    getEffectConfig(effectType) {
        const configs = {
            victory: {
                count: 5,
                shape: 'star',
                color: 0x00ff00,
                colorRange: { start: 0x00ff00, end: 0xffff00 },
                lifetime: 1.5,
                velocity: { speed: 8, spread: 0.5, pattern: 'burst' },
                scale: 2,
                scaleVariation: 0.3,
                physics: { gravity: -0.5, drag: 0.99 },
                rotation: { enabled: true, speed: 5 },
                visual: { fadeOut: true, scaleOverTime: true, blending: 'additive' }
            },
            defeat: {
                count: 8,
                shape: 'spark',
                color: 0xff0000,
                colorRange: { start: 0xff0000, end: 0x440000 },
                lifetime: 2,
                velocity: { speed: 6, spread: 0.8, pattern: 'burst' },
                scale: 1.5,
                scaleVariation: 0.4,
                physics: { gravity: 0.3, drag: 0.95 },
                rotation: { enabled: true, speed: 3 },
                visual: { fadeOut: true, scaleOverTime: false, blending: 'normal' }
            },
            levelup: {
                count: 12,
                shape: 'glow',
                color: 0xffaa00,
                colorRange: { start: 0xffaa00, end: 0xffffff },
                lifetime: 2.5,
                velocity: { speed: 4, spread: 0.3, pattern: 'fountain' },
                scale: 3,
                scaleVariation: 0.2,
                physics: { gravity: -0.2, drag: 0.98 },
                rotation: { enabled: false },
                visual: { fadeOut: true, scaleOverTime: true, blending: 'additive' }
            }
        };
        
        return configs[effectType] || configs.victory;
    }
        
    getDamageColor(type) {
        // Handle string types for special cases (heal, critical)
        if (type === 'heal') return 0x00ff88;
        if (type === 'critical') return 0xff0044;

        // Handle numeric element enum values
        if (type === this.enums.element.poison) return 0x8a2be2;
        if (type === this.enums.element.fire) return 0xff4400;
        if (type === this.enums.element.cold) return 0x00bfff;
        if (type === this.enums.element.lightning) return 0xffff00;
        if (type === this.enums.element.holy) return 0xffd700;
        if (type === this.enums.element.shadow) return 0x4b0082;
        // Physical and default
        return 0xff4444;
    }
        
    // Main update method called by game loop
    update() {
        this.updateDamageNumbers();
    }

    destroy() {
        // Clean up damage number system
        if (this.damageNumberMesh) {
            this.game.scene.remove(this.damageNumberMesh);
            this.damageTextGeometry.dispose();
            this.damageTextMaterial.dispose();
            this.damageTexture.dispose();
        }

    }

    onSceneUnload() {
        this.destroy();

        // Reset state
        this.damageNumbers = [];
        this.damageNumberPool = [];
        this.damageNumberMesh = null;
        this.damageTextMaterial = null;
        this.damageTextGeometry = null;
        this.damageTexture = null;
        this.damageTextCanvas = null;
        this.damageTextContext = null;
        this.activeCharInstances = 0;
        this.stats.activeDamageNumbers = 0;
    }
}
