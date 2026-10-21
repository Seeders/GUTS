class SpinSystem extends GUTS.BaseSystem {
    onSceneLoad() {
        const cube = this.game.createEntity();
        this.game.addComponents(cube, {
            transform: {},
            spin: { speed: 1.5 },
            cube: { size: 2 }
        });
    }

    update() {
        const dt = this.game.state.deltaTime;
        for (const id of this.game.getEntitiesWith('transform', 'spin')) {
            const rotation = this.game.getComponent(id, 'transform').rotation;
            const speed = this.game.getComponent(id, 'spin').speed;
            rotation.x += speed * 0.4 * dt;
            rotation.y += speed * dt;
        }
    }
}
