class PostProcessingSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.postProcessingSystem = this;
        
        this.composer = null;
        this.passes = new Map();
        this.passOrder = ['render', 'pixel', 'fog', 'output'];
    }

    init(params = {}) {
        this.params = params;
        console.log('[PostProcessingSystem] Initialized');
    }

    postAllInit() {
        console.log('[PostProcessingSystem] postAllInit called');
        
        if (!this.game.renderer || !this.game.scene || !this.game.camera) {
            console.error('[PostProcessingSystem] Missing renderer, scene, or camera in postAllInit');
            return;
        }
        
        console.log('[PostProcessingSystem] Creating composer with depth buffer support');
        
        this.composer = new THREE_.EffectComposer(this.game.renderer);
        
        // Create depth textures for both render targets
        const depthTexture1 = new THREE.DepthTexture();
        depthTexture1.format = THREE.DepthFormat;
        depthTexture1.type   = THREE.UnsignedIntType; // 24/32-bit depth

        const depthTexture2 = new THREE.DepthTexture();
        depthTexture2.format = THREE.DepthFormat;
        depthTexture2.type   = THREE.UnsignedIntType;

        this.composer.renderTarget1.depthTexture = depthTexture1;
        this.composer.renderTarget1.depthBuffer  = true;
        this.composer.renderTarget2.depthTexture = depthTexture2;
        this.composer.renderTarget2.depthBuffer  = true;

        // Make sure sizes are synced after attaching:
        const size = this.game.renderer.getSize(new THREE.Vector2());
        this.composer.setSize(size.x, size.y);
        
        if (this.passes.size > 0) {
            this.rebuildComposer();
        }
        
        console.log('[PostProcessingSystem] Composer ready with depth buffer');
    }

    registerPass(name, passConfig) {
        console.log(`[PostProcessingSystem] Registering pass: ${name}`);
        
        if (this.passes.has(name)) {
            console.warn(`[PostProcessingSystem] Pass ${name} already exists, replacing`);
        }
        
        this.passes.set(name, passConfig);
        
        if (this.composer) {
            this.rebuildComposer();
        } else {
            console.log(`[PostProcessingSystem] Pass ${name} queued (composer not ready yet)`);
        }
    }

    removePass(name) {
        console.log(`[PostProcessingSystem] Removing pass: ${name}`);
        
        if (this.passes.has(name)) {
            const passConfig = this.passes.get(name);
            if (passConfig.dispose) {
                passConfig.dispose();
            }
            this.passes.delete(name);
            
            if (this.composer) {
                this.rebuildComposer();
            }
        }
    }

    rebuildComposer() {
        if (!this.composer) {
            console.warn('[PostProcessingSystem] Composer not initialized yet');
            return;
        }
        
        console.log('[PostProcessingSystem] Rebuilding composer');
        
        this.composer.passes = [];
        
        for (const passName of this.passOrder) {
            const passConfig = this.passes.get(passName);
            
            if (!passConfig) continue;
            
            if (passConfig.enabled === false) {
                console.log(`[PostProcessingSystem] Skipping disabled pass: ${passName}`);
                continue;
            }
            
            if (typeof passConfig.create === 'function') {
                const pass = passConfig.create();
                this.composer.addPass(pass);
                console.log(`[PostProcessingSystem] Added pass: ${passName}`);
            } else if (passConfig.pass) {
                this.composer.addPass(passConfig.pass);
                console.log(`[PostProcessingSystem] Added pass: ${passName}`);
            }
        }
        
        console.log('[PostProcessingSystem] Composer rebuilt with', this.composer.passes.length, 'passes');
    }

    render() {
        if (this.composer) {
            this.composer.render();
        }
    }

    setSize(width, height) {
        if (this.composer) {
            this.composer.setSize(width, height);
        }
    }

    dispose() {
        if (this.composer) {
            this.composer.passes.forEach(pass => {
                if (pass.dispose) pass.dispose();
            });
        }
        this.passes.clear();
    }
}