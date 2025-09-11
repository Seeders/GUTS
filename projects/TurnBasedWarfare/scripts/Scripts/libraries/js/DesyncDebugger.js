class DesyncDebugger {
    constructor(game) {
        this.game = game;
        this.frameHashes = [];
        this.lastDisplayTime = 0;
        this.logInterval = 0; // Log every 1 sec
        this.detailedLogging = true;
        this.displaySync = false;
    }

    // Call this every frame from your main update loop
    checkSync() {

        // Get all combat entities
        const entities = this.game.getEntitiesWith(
            this.game.componentManager.getComponentTypes().POSITION,
            this.game.componentManager.getComponentTypes().COMBAT
        );

        // Create deterministic state snapshot
        const stateData = this.createStateSnapshot(entities);
        const hash = this.hashState(stateData);
        
        this.frameHashes.push({
            hash: hash,
            entityCount: entities.length,
            time: this.game.currentTime
        });

        // Log periodically
        if (this.displaySync ) {
           // console.log(`Hash=${hash}, Entities=${entities.length}, Time=${this.game.currentTime.toFixed(3)}`);
            
            if (this.displaySync || this.detailedLogging) {
              //  console.log("Detailed state:", stateData);
            }
            this.lastDisplayTime = this.game.currentTime;
        }
        return hash;
    }

    createStateSnapshot(entities) {
        const CT = this.game.componentManager.getComponentTypes();
        
        const snapshot = {
            gameTime: parseFloat(this.game.currentTime.toFixed(6)), // Round to avoid float precision issues
            entities: []
        };

        entities.forEach(entityId => {
            const pos = this.game.getComponent(entityId, CT.POSITION);
            const vel = this.game.getComponent(entityId, CT.VELOCITY);
            const combat = this.game.getComponent(entityId, CT.COMBAT);
            const health = this.game.getComponent(entityId, CT.HEALTH);
            const aiState = this.game.getComponent(entityId, CT.AI_STATE);

            const entityData = {
                id: String(entityId),
                pos: pos ? {
                    x: parseFloat(pos.x.toFixed(3)),
                    y: parseFloat(pos.y.toFixed(3)),
                    z: parseFloat(pos.z.toFixed(3))
                } : null,
                vel: vel ? {
                    vx: parseFloat(vel.vx.toFixed(3)),
                    vy: parseFloat(vel.vy.toFixed(3)),
                    vz: parseFloat(vel.vz.toFixed(3))
                } : null,
                health: health ? {
                    current: health.current,
                    max: health.max
                } : null,
                combat: combat ? {
                    lastAttack: parseFloat(combat.lastAttack.toFixed(6)),
                    damage: combat.damage,
                    attackSpeed: combat.attackSpeed
                } : null,
                aiState: aiState ? {
                    state: aiState.state,
                    currentTarget: aiState.aiBehavior ? String(aiState.aiBehavior.currentTarget || 'null') : 'null'
                } : null
            };

            snapshot.entities.push(entityData);
        });

        return snapshot;
    }

    hashState(stateData) {
        // Simple hash function for state comparison
        const str = JSON.stringify(stateData);
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return hash;
    }

    // Compare with another client's hashes
    compareHashes(otherClientHashes) {
        const mismatches = [];
        
        for (let i = 0; i < Math.min(this.frameHashes.length, otherClientHashes.length); i++) {
            const myFrame = this.frameHashes[i];
            const otherFrame = otherClientHashes[i];
            
            if (myFrame.hash !== otherFrame.hash) {
                mismatches.push({
                    frame: myFrame.frame,
                    myHash: myFrame.hash,
                    otherHash: otherFrame.hash,
                    myTime: myFrame.time,
                    otherTime: otherFrame.time,
                    myEntities: myFrame.entityCount,
                    otherEntities: otherFrame.entityCount
                });
            }
        }
        
        return mismatches;
    }

    enableDetailedLogging() {
        this.detailedLogging = true;
        console.log("Detailed desync logging enabled");
    }

    disableDetailedLogging() {
        this.detailedLogging = false;
        console.log("Detailed desync logging disabled");
    }

    // Get the last N frame hashes for comparison
    getRecentHashes(count = 10) {
        return this.frameHashes.slice(-count);
    }

    // Check for common desync patterns
    analyzeDesyncPatterns() {
        if (this.frameHashes.length < 10) return;

        const recent = this.frameHashes.slice(-10);
        const patterns = {
            stableHashes: new Set(recent.map(f => f.hash)).size === 1,
            increasingEntityCount: recent[recent.length - 1].entityCount > recent[0].entityCount,
            decreasingEntityCount: recent[recent.length - 1].entityCount < recent[0].entityCount,
            timeIncreasingMonotonically: recent.every((frame, i) => i === 0 || frame.time > recent[i-1].time)
        };

        console.log("Desync Analysis:", patterns);
        return patterns;
    }
}