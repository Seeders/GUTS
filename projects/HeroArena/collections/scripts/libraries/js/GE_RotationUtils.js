// RotationUtils.js
class GE_RotationUtils {
    /**
     * Convert degrees to radians
     * @param {number} degrees - Angle in degrees
     * @return {number} Angle in radians
     */
    static degToRad(degrees) {
        return degrees * Math.PI / 180;
    }
    
    /**
     * Convert radians to degrees
     * @param {number} radians - Angle in radians
     * @return {number} Angle in degrees (rounded)
     */
    static radToDeg(radians) {
        return Math.round(radians * 180 / Math.PI);
    }
    
    /**
     * Apply rotation to a position vector around a center point
     * @param {Object} position - Position with x, y, z properties
     * @param {Object} center - Center point with x, y, z properties
     * @param {Object} rotation - Rotation with x, y, z properties in radians
     * @return {Object} New position after rotation
     */
    static rotatePosition(position, center, rotation) {
        const pos = new window.THREE.Vector3(
            position.x || 0,
            position.y || 0,
            position.z || 0
        );
        
        const centerVec = new window.THREE.Vector3(
            center.x || 0,
            center.y || 0,
            center.z || 0
        );
        
        // Create rotation matrix
        const rotMatrix = new window.THREE.Matrix4();
        rotMatrix.makeRotationFromEuler(new window.THREE.Euler(
            rotation.x || 0,
            rotation.y || 0,
            rotation.z || 0
        ));
        
        // Apply rotation
        pos.sub(centerVec);
        pos.applyMatrix4(rotMatrix);
        pos.add(centerVec);
        
        return { x: pos.x, y: pos.y, z: pos.z };
    }
    
    /**
     * Combine two rotations (in Euler angles)
     * @param {Object} rotation1 - First rotation with x, y, z in degrees
     * @param {Object} rotation2 - Second rotation with x, y, z in degrees
     * @return {Object} Combined rotation in degrees
     */
    static combineRotations(rotation1, rotation2) {
        // Convert to radians
        const rot1 = {
            x: this.degToRad(rotation1.x || 0),
            y: this.degToRad(rotation1.y || 0),
            z: this.degToRad(rotation1.z || 0)
        };
        
        const rot2 = {
            x: this.degToRad(rotation2.x || 0),
            y: this.degToRad(rotation2.y || 0),
            z: this.degToRad(rotation2.z || 0)
        };
        
        // Convert to quaternions and multiply
        const quat1 = new window.THREE.Quaternion().setFromEuler(
            new window.THREE.Euler(rot1.x, rot1.y, rot1.z)
        );
        
        const quat2 = new window.THREE.Quaternion().setFromEuler(
            new window.THREE.Euler(rot2.x, rot2.y, rot2.z)
        );
        
        quat1.multiply(quat2);
        
        // Convert back to euler angles
        const euler = new window.THREE.Euler().setFromQuaternion(quat1);
        
        // Return in degrees
        return {
            x: this.radToDeg(euler.x),
            y: this.radToDeg(euler.y),
            z: this.radToDeg(euler.z)
        };
    }
}