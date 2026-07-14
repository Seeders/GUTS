class InstancePool {
    constructor(geometry, material, initialSize) {
        this.mesh = new THREE.InstancedMesh(geometry, material, initialSize);
        this.mesh.count = 0;
        this.freeIndices = [];
        this.maxIndex = 0;
    }

    addInstance(matrix) {
        let index;
        if (this.freeIndices.length > 0) {
            index = this.freeIndices.pop();
        } else {
            index = this.maxIndex++;
            if (index >= this.mesh.instanceMatrix.count) {
                this.expandPool(Math.max(this.mesh.count * 2, 100));
            }
        }

        this.mesh.setMatrixAt(index, matrix);
        this.mesh.count = Math.max(this.mesh.count, index + 1);
        this.mesh.instanceMatrix.needsUpdate = true;
        return index;
    }

    removeInstance(index) {
        this.freeIndices.push(index);
        // Set identity matrix to hide instance
        this.mesh.setMatrixAt(index, new THREE.Matrix4());
        this.mesh.instanceMatrix.needsUpdate = true;
    }

    expandPool(additionalSize) {
        const newCount = this.mesh.instanceMatrix.count + additionalSize;
        const newMesh = new THREE.InstancedMesh(
            this.mesh.geometry,
            this.mesh.material,
            newCount
        );
        
        newMesh.instanceMatrix.copy(this.mesh.instanceMatrix);
        newMesh.count = this.mesh.count;
        this.mesh.dispose();
        this.mesh = newMesh;
    }
}