class PostProcessingSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.postProcessingSystem = this;
        
        this.composer = null;
        this.passes = new Map();
        this.passOrder = ['render', 'pixel', 'fog', 'output'];
    }

    init(params = {}) {
        this.params = params;

        this.game.gameManager.register('registerPostProcessingPass', this.registerPass.bind(this));
        this.game.gameManager.register('removePostProcessingPass', this.removePass.bind(this));
        this.game.gameManager.register('renderPostProcessing', this.render.bind(this));
        this.game.gameManager.register('getPostProcessingComposer', this.getPostProcessingComposer.bind(this));
    }

    postAllInit() {
        // Composer setup deferred to onSceneLoad when renderer/scene/camera are available
    }

    onSceneLoad(sceneData) {
        // Initialize composer once WorldSystem has created renderer/scene/camera
        if (this.composer) return; // Already initialized

        if (!this.game.renderer || !this.game.scene || !this.game.camera) {
            console.warn('[PostProcessingSystem] Waiting for renderer, scene, or camera');
            return;
        }

        // Get size first so we can properly initialize depth textures
        const size = this.game.renderer.getSize(new THREE.Vector2());

        this.composer = new GUTS.EffectComposer(this.game.renderer);

        // Create depth textures for both render targets with explicit size
        const depthTexture1 = new THREE.DepthTexture(size.x, size.y);
        depthTexture1.format = THREE.DepthFormat;
        depthTexture1.type   = THREE.UnsignedIntType; // 24/32-bit depth

        const depthTexture2 = new THREE.DepthTexture(size.x, size.y);
        depthTexture2.format = THREE.DepthFormat;
        depthTexture2.type   = THREE.UnsignedIntType;

        this.composer.renderTarget1.depthTexture = depthTexture1;
        this.composer.renderTarget1.depthBuffer  = true;
        this.composer.renderTarget2.depthTexture = depthTexture2;
        this.composer.renderTarget2.depthBuffer  = true;

        // Make sure sizes are synced after attaching:
        this.composer.setSize(size.x, size.y);

        if (this.passes.size > 0) {
            this.rebuildComposer();
        }

        console.log('[PostProcessingSystem] Composer initialized');
    }

    getPostProcessingComposer() {
        return this.composer;
    }

    registerPass(name, passConfig) {
        
        if (this.passes.has(name)) {
            console.warn(`[PostProcessingSystem] Pass ${name} already exists, replacing`);
        }
        
        this.passes.set(name, passConfig);
        
        if (this.composer) {
            this.rebuildComposer();
        } 
    }

    removePass(name) {
        
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
        
        
        this.composer.passes = [];
        
        for (const passName of this.passOrder) {
            const passConfig = this.passes.get(passName);
            
            if (!passConfig) continue;
            
            if (passConfig.enabled === false) {
                continue;
            }
            
            if (typeof passConfig.create === 'function') {
                const pass = passConfig.create();
                this.composer.addPass(pass);
            } else if (passConfig.pass) {
                this.composer.addPass(passConfig.pass);
            }
        }
        
    }

    render() {
        if (this.composer) {
            // Render main scene with all post-processing (including fog)
            this.composer.render();
            
            if (this.game.uiScene) {
                this.game.renderer.autoClear = false;  // Don't clear the screen    
                this.game.renderer.clearDepth();             
                this.game.renderer.render(this.game.uiScene, this.game.camera);
                this.game.renderer.autoClear = true;   // Reset for next frame
            }
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

    /**
     * Called when scene is unloaded - cleanup all post-processing resources
     */
    onSceneUnload() {
        // Dispose all passes
        for (const [name, passConfig] of this.passes) {
            if (passConfig.dispose) {
                passConfig.dispose();
            }
        }
        this.passes.clear();

        // Dispose composer and its render targets
        if (this.composer) {
            // Dispose depth textures
            if (this.composer.renderTarget1?.depthTexture) {
                this.composer.renderTarget1.depthTexture.dispose();
            }
            if (this.composer.renderTarget2?.depthTexture) {
                this.composer.renderTarget2.depthTexture.dispose();
            }

            // Dispose render targets
            if (this.composer.renderTarget1) {
                this.composer.renderTarget1.dispose();
            }
            if (this.composer.renderTarget2) {
                this.composer.renderTarget2.dispose();
            }

            this.composer = null;
        }

        console.log('[PostProcessingSystem] Scene unloaded - resources cleaned up');
    }
}