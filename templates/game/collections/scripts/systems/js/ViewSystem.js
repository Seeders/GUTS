/**
 * Draws every entity with transform + cube using Three.js. Gameplay systems
 * never touch Three.js; this mirrors whatever entities exist.
 */
class ViewSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.meshes = new Map();            // entityId -> THREE.Mesh
        this.onResize = () => this.resize();
    }

    onSceneLoad() {
        this.container = document.getElementById('view');
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.container.appendChild(this.renderer.domElement);

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x14110e);
        this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
        this.camera.position.set(0, 2, 6);
        this.camera.lookAt(0, 0, 0);
        this.scene.add(new THREE.HemisphereLight(0xffffff, 0x302820, 1.5));
        const sun = new THREE.DirectionalLight(0xffffff, 2);
        sun.position.set(3, 5, 4);
        this.scene.add(sun);

        window.addEventListener('resize', this.onResize);
        this.resize();
    }

    render() {
        for (const id of this.game.getEntitiesWith('transform', 'cube')) {
            let mesh = this.meshes.get(id);
            if (!mesh) {
                const cube = this.game.getComponent(id, 'cube');
                mesh = new THREE.Mesh(
                    new THREE.BoxGeometry(cube.size, cube.size, cube.size),
                    new THREE.MeshStandardMaterial({ color: cube.color })
                );
                this.scene.add(mesh);
                this.meshes.set(id, mesh);
            }
            const t = this.game.getComponent(id, 'transform');
            mesh.position.set(t.position.x, t.position.y, t.position.z);
            mesh.rotation.set(t.rotation.x, t.rotation.y, t.rotation.z);
        }
        this.renderer.render(this.scene, this.camera);
    }

    entityDestroyed(id) {
        const mesh = this.meshes.get(id);
        if (!mesh) return;
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
        this.meshes.delete(id);
    }

    resize() {
        const w = this.container.clientWidth, h = this.container.clientHeight;
        this.renderer.setSize(w, h);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
    }

    onSceneUnload() {
        window.removeEventListener('resize', this.onResize);
        this.renderer.dispose();
        this.renderer.domElement.remove();
        this.meshes.clear();
    }
}
