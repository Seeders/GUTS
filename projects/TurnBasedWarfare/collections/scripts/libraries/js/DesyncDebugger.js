class DesyncDebugger {
    constructor(game) {
        this.game = game;
        this.game.desyncDebugger = this;
        this.frameHashes = [];
        this.lastDisplayTime = 0;
        this.logInterval = 0; // Log every 1 sec
        this.detailedLogging = true;
        this.enabled = false;
    }
    displaySync(detailed) {    
        if(this.enabled){
            const entities = this.game.getEntitiesWith(
                "transform",
                "combat"
            );
            // Create deterministic state snapshot
            const stateData = this.createStateSnapshot(entities);
            const hash = this.hash(stateData);
            
            this.frameHashes.push({
                hash: hash,
                entityCount: entities.length,
                stateData: stateData,
                time: this.game.state.now
            });   
            if(this.game.isServer){
                console.log(this.game.state.now, hash);                    
            } else {
                console.log(this.game.state.now, hash, stateData);                    
            }
        }
    }

    createStateSnapshot(entities) {
        
        const snapshot = {
            gameTime: parseFloat(this.game.state.now.toFixed(6)), // Round to avoid float precision issues
            entities: []
        };

        entities.forEach(entityId => {
            const transform = this.game.getComponent(entityId, "transform");
            const pos = transform?.position;
            const vel = this.game.getComponent(entityId, "velocity");
            const combat = this.game.getComponent(entityId, "combat");
            const health = this.game.getComponent(entityId, "health");
            const aiState = this.game.getComponent(entityId, "aiState");

            const entityData = {
                id: String(entityId),
                pos: `${this.hash(pos ? {
                    x: parseFloat(pos.x.toFixed(3)),
                    y: parseFloat(pos.y.toFixed(3)),
                    z: parseFloat(pos.z.toFixed(3))
                } : null)} ${pos.x}, ${pos.y}, ${pos.z}`,
                vel: `${this.hash(vel ? {
                    vx: parseFloat(vel.vx.toFixed(3)),
                    vy: parseFloat(vel.vy.toFixed(3)),
                    vz: parseFloat(vel.vz.toFixed(3))
                } : null)} ${vel?.vx || 0}, ${vel?.vy || 0}, ${vel?.vz || 0}`,
                healthHash: this.hash(health ? {
                    current: health.current,
                    max: health.max
                } : null),
                combatHash: this.hash(combat ? {
                    lastAttack: parseFloat(combat.lastAttack.toFixed(6)),
                    damage: combat.damage,
                    attackSpeed: combat.attackSpeed
                } : null),
                aiStateHash: this.hash(aiState ? {
                    currentAction: aiState.currentAction ?? 'null',
                    currentActionCollection: aiState.currentActionCollection ?? 'null',
                    meta: this.game.call('getBehaviorMeta', entityId) || 'null'
                } : null),
                aiState: JSON.stringify(aiState)
            };

            snapshot.entities.push(entityData);
        });

        return snapshot;
    }

    hash(data) {
        // Simple hash function for state comparison
        const str = JSON.stringify(data);
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


// Assign to global.GUTS for server
if (typeof global !== 'undefined' && global.GUTS) {
    global.GUTS.DesyncDebugger = DesyncDebugger;
}

// ES6 exports for webpack bundling
export default DesyncDebugger;
export { DesyncDebugger };
