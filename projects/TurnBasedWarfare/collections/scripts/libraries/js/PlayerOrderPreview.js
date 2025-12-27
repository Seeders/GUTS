/**
 * PlayerOrderPreview - Shows circular markers for player move/hide orders
 * Separate from PlacementPreview which handles building placement squares
 */
class PlayerOrderPreview {
    constructor(game) {
        this.game = game;
        this.scene = game.uiScene;

        this.config = {
            radius: 12,
            segments: 24,
            opacity: 0.5,
            borderOpacity: 0.8,
            elevationOffset: 1,
            maxMarkers: 20
        };

        this.previewGroup = new THREE.Group();
        this.previewGroup.name = 'PlayerOrderPreview';
        this.previewGroup.visible = false;

        if (this.scene) {
            this.scene.add(this.previewGroup);
        }

        this.materials = this.createMaterials();
        this.markerPool = [];
        this.borderPool = [];
        this.activeMeshes = [];
        this.animationId = null;

        this.initializePool();
    }

    createMaterials() {
        return {
            move: new THREE.MeshBasicMaterial({
                color: 0x00ff00,
                transparent: true,
                opacity: this.config.opacity,
                side: THREE.DoubleSide
            }),
            moveBorder: new THREE.LineBasicMaterial({
                color: 0x00ff00,
                transparent: true,
                opacity: this.config.borderOpacity
            }),
            stealth: new THREE.MeshBasicMaterial({
                color: 0x8866cc,
                transparent: true,
                opacity: this.config.opacity * 0.8,
                side: THREE.DoubleSide
            }),
            stealthBorder: new THREE.LineBasicMaterial({
                color: 0xaa88ee,
                transparent: true,
                opacity: this.config.borderOpacity * 0.9
            })
        };
    }

    initializePool() {
        const circleGeometry = new THREE.CircleGeometry(this.config.radius, this.config.segments);
        const ringGeometry = new THREE.RingGeometry(
            this.config.radius - 1,
            this.config.radius,
            this.config.segments
        );

        for (let i = 0; i < this.config.maxMarkers; i++) {
            // Circle fill
            const marker = new THREE.Mesh(circleGeometry, this.materials.move);
            marker.rotation.x = -Math.PI / 2;
            marker.visible = false;
            this.markerPool.push(marker);
            this.previewGroup.add(marker);

            // Circle border (ring)
            const border = new THREE.Mesh(ringGeometry, this.materials.moveBorder);
            border.rotation.x = -Math.PI / 2;
            border.visible = false;
            this.borderPool.push(border);
            this.previewGroup.add(border);
        }
    }

    /**
     * Show order markers at positions
     * @param {Array} orders - Array of { x, z, isHiding }
     */
    show(orders) {
        if (!orders || orders.length === 0) {
            this.hide();
            return;
        }

        this.hideAllMeshes();

        orders.slice(0, this.config.maxMarkers).forEach((order, index) => {
            const marker = this.markerPool[index];
            const border = this.borderPool[index];

            // Get terrain height
            let yPosition = this.config.elevationOffset;
            if (this.game.hasService('getTerrainHeightAtPosition')) {
                const terrainHeight = this.game.call('getTerrainHeightAtPosition', order.x, order.z);
                yPosition = (terrainHeight || 0) + this.config.elevationOffset;
            }

            // Set materials based on order type
            if (order.isHiding) {
                marker.material = this.materials.stealth;
                border.material = this.materials.stealthBorder;
            } else {
                marker.material = this.materials.move;
                border.material = this.materials.moveBorder;
            }

            marker.position.set(order.x, yPosition, order.z);
            marker.visible = true;
            this.activeMeshes.push(marker);

            border.position.set(order.x, yPosition + 0.1, order.z);
            border.visible = true;
            this.activeMeshes.push(border);
        });

        this.previewGroup.visible = true;
        this.startAnimation();
    }

    hideAllMeshes() {
        this.activeMeshes.length = 0;
        this.markerPool.forEach(m => m.visible = false);
        this.borderPool.forEach(b => b.visible = false);
    }

    hide() {
        this.previewGroup.visible = false;
        this.hideAllMeshes();
        this.stopAnimation();
    }

    clear() {
        this.hide();
    }

    startAnimation() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }

        const startTime = performance.now();
        const animate = () => {
            if (!this.previewGroup.visible) {
                this.animationId = null;
                return;
            }

            const elapsed = (performance.now() - startTime) / 1000;
            const scale = 1 + Math.sin(elapsed * 2) * 0.08;

            this.activeMeshes.forEach(mesh => {
                if (mesh.visible) {
                    mesh.scale.setScalar(scale);
                }
            });

            this.animationId = requestAnimationFrame(animate);
        };

        this.animationId = requestAnimationFrame(animate);
    }

    stopAnimation() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    dispose() {
        this.clear();
        this.stopAnimation();

        if (this.previewGroup.parent) {
            this.previewGroup.parent.remove(this.previewGroup);
        }

        Object.values(this.materials).forEach(mat => mat.dispose());
        this.markerPool.length = 0;
        this.borderPool.length = 0;
    }
}

if (typeof GUTS !== 'undefined') {
    GUTS.PlayerOrderPreview = PlayerOrderPreview;
}
