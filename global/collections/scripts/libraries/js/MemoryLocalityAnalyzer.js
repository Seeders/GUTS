/**
 * MemoryLocalityAnalyzer - Runtime analysis of ECS memory layout and cache efficiency
 *
 * Usage:
 *   const analyzer = new MemoryLocalityAnalyzer(game);
 *   analyzer.analyze();           // Full analysis
 *   analyzer.analyzeFragmentation();  // Entity fragmentation only
 *   analyzer.analyzeQueryLocality(['transform', 'velocity']);  // Specific query
 *   analyzer.printReport();       // Console output
 *
 * Console API:
 *   MemoryLocalityAnalyzer.analyze()   // If attached to window/GUTS
 */
class MemoryLocalityAnalyzer {
    constructor(game) {
        this.game = game;
        this.lastReport = null;

        // Cache line size assumption (64 bytes is standard for x86/ARM)
        this.CACHE_LINE_SIZE = 64;
        this.FLOAT32_SIZE = 4;
        this.UINT8_SIZE = 1;
        this.UINT32_SIZE = 4;

        // Entities per cache line for different array types
        this.ENTITIES_PER_CACHELINE_FLOAT32 = this.CACHE_LINE_SIZE / this.FLOAT32_SIZE; // 16
        this.ENTITIES_PER_CACHELINE_UINT8 = this.CACHE_LINE_SIZE / this.UINT8_SIZE;     // 64
        this.ENTITIES_PER_CACHELINE_UINT32 = this.CACHE_LINE_SIZE / this.UINT32_SIZE;   // 16
    }

    /**
     * Run full memory locality analysis
     */
    analyze() {
        const report = {
            timestamp: Date.now(),
            entityStats: this.analyzeEntityStats(),
            fragmentation: this.analyzeFragmentation(),
            numericArrays: this.analyzeNumericArrays(),
            objectComponents: this.analyzeObjectComponents(),
            cacheEfficiency: this.analyzeCacheEfficiency(),
            recommendations: []
        };

        // Generate recommendations based on analysis
        report.recommendations = this.generateRecommendations(report);

        this.lastReport = report;
        return report;
    }

    /**
     * Basic entity statistics
     */
    analyzeEntityStats() {
        const game = this.game;
        let aliveCount = 0;
        let highestAliveId = 0;

        for (let i = 1; i < game.nextEntityId; i++) {
            if (game.entityAlive[i]) {
                aliveCount++;
                highestAliveId = i;
            }
        }

        return {
            maxEntities: game.MAX_ENTITIES,
            nextEntityId: game.nextEntityId,
            aliveCount: aliveCount,
            highestAliveId: highestAliveId,
            deadCount: game.nextEntityId - 1 - aliveCount, // IDs used but entities destroyed
            utilizationPercent: ((aliveCount / game.MAX_ENTITIES) * 100).toFixed(2),
            idSpaceUsed: ((game.nextEntityId / game.MAX_ENTITIES) * 100).toFixed(2)
        };
    }

    /**
     * Analyze entity ID fragmentation
     * Fragmentation hurts cache locality because iterations skip over dead slots
     */
    analyzeFragmentation() {
        const game = this.game;
        const gaps = [];
        let currentGapStart = null;
        let totalGapSize = 0;
        let maxGapSize = 0;
        let gapCount = 0;

        for (let i = 1; i < game.nextEntityId; i++) {
            const alive = game.entityAlive[i];

            if (!alive && currentGapStart === null) {
                currentGapStart = i;
            } else if (alive && currentGapStart !== null) {
                const gapSize = i - currentGapStart;
                gaps.push({ start: currentGapStart, end: i - 1, size: gapSize });
                totalGapSize += gapSize;
                maxGapSize = Math.max(maxGapSize, gapSize);
                gapCount++;
                currentGapStart = null;
            }
        }

        // Handle trailing gap
        if (currentGapStart !== null) {
            const gapSize = game.nextEntityId - currentGapStart;
            gaps.push({ start: currentGapStart, end: game.nextEntityId - 1, size: gapSize });
            totalGapSize += gapSize;
            maxGapSize = Math.max(maxGapSize, gapSize);
            gapCount++;
        }

        const activeRange = game.nextEntityId - 1; // IDs 1 to nextEntityId-1
        const fragmentationRatio = activeRange > 0 ? totalGapSize / activeRange : 0;

        return {
            totalGaps: gapCount,
            totalGapSize: totalGapSize,
            maxGapSize: maxGapSize,
            averageGapSize: gapCount > 0 ? (totalGapSize / gapCount).toFixed(2) : 0,
            fragmentationPercent: (fragmentationRatio * 100).toFixed(2),
            largestGaps: gaps.sort((a, b) => b.size - a.size).slice(0, 5),
            // Contiguous alive runs
            contiguousRuns: this.analyzeContiguousRuns()
        };
    }

    /**
     * Find contiguous runs of alive entities (good for cache)
     */
    analyzeContiguousRuns() {
        const game = this.game;
        const runs = [];
        let runStart = null;

        for (let i = 1; i <= game.nextEntityId; i++) {
            const alive = i < game.nextEntityId && game.entityAlive[i];

            if (alive && runStart === null) {
                runStart = i;
            } else if (!alive && runStart !== null) {
                runs.push({ start: runStart, end: i - 1, size: i - runStart });
                runStart = null;
            }
        }

        runs.sort((a, b) => b.size - a.size);

        return {
            totalRuns: runs.length,
            largestRun: runs[0]?.size || 0,
            averageRunSize: runs.length > 0
                ? (runs.reduce((sum, r) => sum + r.size, 0) / runs.length).toFixed(2)
                : 0,
            top5Runs: runs.slice(0, 5)
        };
    }

    /**
     * Analyze numeric TypedArray storage
     */
    analyzeNumericArrays() {
        const game = this.game;
        const arrays = {};
        let totalBytes = 0;
        let usedBytes = 0;

        for (const [key, arr] of game._numericArrays) {
            const arrayBytes = arr.byteLength;
            totalBytes += arrayBytes;

            // Count non-zero/non-default values as "used"
            let usedSlots = 0;
            for (let i = 1; i < game.nextEntityId; i++) {
                if (game.entityAlive[i] && arr[i] !== 0 && arr[i] !== -Infinity) {
                    usedSlots++;
                }
            }

            const usedBytesForArray = usedSlots * this.FLOAT32_SIZE;
            usedBytes += usedBytesForArray;

            const componentType = key.split('.')[0];
            if (!arrays[componentType]) {
                arrays[componentType] = {
                    fields: [],
                    totalBytes: 0,
                    usedSlots: 0
                };
            }
            arrays[componentType].fields.push(key);
            arrays[componentType].totalBytes += arrayBytes;
            arrays[componentType].usedSlots += usedSlots;
        }

        return {
            totalArrays: game._numericArrays.size,
            totalBytes: totalBytes,
            totalMB: (totalBytes / (1024 * 1024)).toFixed(2),
            usedBytes: usedBytes,
            usedMB: (usedBytes / (1024 * 1024)).toFixed(2),
            wastePercent: totalBytes > 0 ? (((totalBytes - usedBytes) / totalBytes) * 100).toFixed(2) : 0,
            byComponent: arrays
        };
    }

    /**
     * Analyze object component storage
     */
    analyzeObjectComponents() {
        const game = this.game;
        const components = {};
        let totalObjects = 0;

        for (const [componentType, storage] of game._objectComponents) {
            let count = 0;
            let estimatedSize = 0;

            for (let i = 1; i < game.nextEntityId; i++) {
                if (storage[i] !== undefined && storage[i] !== null) {
                    count++;
                    // Rough size estimate
                    estimatedSize += JSON.stringify(storage[i]).length * 2; // UTF-16
                }
            }

            totalObjects += count;
            components[componentType] = {
                instanceCount: count,
                estimatedBytes: estimatedSize,
                estimatedKB: (estimatedSize / 1024).toFixed(2)
            };
        }

        return {
            componentTypes: game._objectComponents.size,
            totalInstances: totalObjects,
            byComponent: components
        };
    }

    /**
     * Analyze cache efficiency for common query patterns
     */
    analyzeCacheEfficiency() {
        const game = this.game;
        const results = {};

        // Analyze common component combinations
        const commonQueries = [
            ['transform'],
            ['transform', 'velocity'],
            ['transform', 'render'],
            ['health'],
            ['aiState']
        ];

        for (const query of commonQueries) {
            // Check if all components exist
            const allExist = query.every(c => game._componentTypeId.has(c));
            if (!allExist) continue;

            const queryResult = this.analyzeQueryLocality(query);
            if (queryResult) {
                results[query.join('+')] = queryResult;
            }
        }

        return results;
    }

    /**
     * Analyze memory locality for a specific component query
     */
    analyzeQueryLocality(componentTypes) {
        const game = this.game;

        // Get entities matching query
        const entities = game.getEntitiesWith(...componentTypes);
        if (entities.length === 0) return null;

        // Sort to analyze stride patterns
        const sorted = [...entities].sort((a, b) => a - b);

        // Calculate stride statistics
        const strides = [];
        for (let i = 1; i < sorted.length; i++) {
            strides.push(sorted[i] - sorted[i - 1]);
        }

        const avgStride = strides.length > 0
            ? strides.reduce((a, b) => a + b, 0) / strides.length
            : 1;

        // Perfect stride of 1 means contiguous access
        const perfectStrides = strides.filter(s => s === 1).length;
        const contiguityPercent = strides.length > 0
            ? (perfectStrides / strides.length) * 100
            : 100;

        // Cache line analysis for Float32Arrays
        // With stride=1, we get 16 entities per cache line fetch
        // With higher strides, we waste cache line fetches
        const entitiesPerCacheLine = this.ENTITIES_PER_CACHELINE_FLOAT32;
        const optimalCacheLines = Math.ceil(sorted.length / entitiesPerCacheLine);

        // Estimate actual cache lines touched
        let cacheLinesUsed = 0;
        let lastCacheLine = -1;
        for (const entityId of sorted) {
            const cacheLine = Math.floor(entityId / entitiesPerCacheLine);
            if (cacheLine !== lastCacheLine) {
                cacheLinesUsed++;
                lastCacheLine = cacheLine;
            }
        }

        const cacheEfficiency = optimalCacheLines > 0
            ? (optimalCacheLines / cacheLinesUsed) * 100
            : 100;

        return {
            entityCount: entities.length,
            minEntityId: sorted[0],
            maxEntityId: sorted[sorted.length - 1],
            idRange: sorted[sorted.length - 1] - sorted[0] + 1,
            averageStride: avgStride.toFixed(2),
            contiguityPercent: contiguityPercent.toFixed(2),
            optimalCacheLines: optimalCacheLines,
            actualCacheLines: cacheLinesUsed,
            cacheEfficiencyPercent: cacheEfficiency.toFixed(2),
            // Density: how much of the ID range is actually used
            densityPercent: ((entities.length / (sorted[sorted.length - 1] - sorted[0] + 1)) * 100).toFixed(2)
        };
    }

    /**
     * Generate recommendations based on analysis
     */
    generateRecommendations(report) {
        const recs = [];

        // Fragmentation recommendations
        const frag = report.fragmentation;
        if (parseFloat(frag.fragmentationPercent) > 20) {
            recs.push({
                severity: 'high',
                category: 'fragmentation',
                message: `High fragmentation (${frag.fragmentationPercent}%). Consider implementing entity compaction.`,
                detail: `${frag.totalGapSize} dead entity slots scattered across ${frag.totalGaps} gaps.`
            });
        } else if (parseFloat(frag.fragmentationPercent) > 10) {
            recs.push({
                severity: 'medium',
                category: 'fragmentation',
                message: `Moderate fragmentation (${frag.fragmentationPercent}%). Monitor for degradation.`,
                detail: `Largest gap: ${frag.maxGapSize} entities`
            });
        }

        // Cache efficiency recommendations
        for (const [query, stats] of Object.entries(report.cacheEfficiency)) {
            if (parseFloat(stats.cacheEfficiencyPercent) < 50) {
                recs.push({
                    severity: 'high',
                    category: 'cache',
                    message: `Poor cache efficiency for [${query}] query: ${stats.cacheEfficiencyPercent}%`,
                    detail: `Using ${stats.actualCacheLines} cache lines instead of optimal ${stats.optimalCacheLines}`
                });
            } else if (parseFloat(stats.cacheEfficiencyPercent) < 75) {
                recs.push({
                    severity: 'medium',
                    category: 'cache',
                    message: `Suboptimal cache efficiency for [${query}]: ${stats.cacheEfficiencyPercent}%`,
                    detail: `Average stride: ${stats.averageStride}, contiguity: ${stats.contiguityPercent}%`
                });
            }
        }

        // Memory waste recommendations
        const arrays = report.numericArrays;
        if (parseFloat(arrays.wastePercent) > 80) {
            recs.push({
                severity: 'medium',
                category: 'memory',
                message: `High memory overhead in TypedArrays: ${arrays.wastePercent}% unused`,
                detail: `${arrays.totalMB}MB allocated, only ${arrays.usedMB}MB used`
            });
        }

        // Contiguous run analysis
        const runs = frag.contiguousRuns;
        if (runs.totalRuns > 10 && parseFloat(runs.averageRunSize) < 50) {
            recs.push({
                severity: 'medium',
                category: 'fragmentation',
                message: `Entities are scattered across ${runs.totalRuns} separate runs`,
                detail: `Average run size: ${runs.averageRunSize}. Consider grouping related entities.`
            });
        }

        return recs;
    }

    /**
     * Print formatted report to console
     */
    printReport(report = this.lastReport) {
        if (!report) {
            report = this.analyze();
        }

        console.log('\n╔══════════════════════════════════════════════════════════════╗');
        console.log('║           MEMORY LOCALITY ANALYSIS REPORT                    ║');
        console.log('╚══════════════════════════════════════════════════════════════╝\n');

        // Entity Stats
        console.log('┌─ ENTITY STATISTICS ─────────────────────────────────────────┐');
        const es = report.entityStats;
        console.log(`│ Alive Entities:     ${es.aliveCount.toString().padStart(6)} / ${es.maxEntities} (${es.utilizationPercent}%)`);
        console.log(`│ Next Entity ID:     ${es.nextEntityId.toString().padStart(6)} (${es.idSpaceUsed}% of ID space)`);
        console.log(`│ Highest Alive ID:   ${es.highestAliveId.toString().padStart(6)}`);
        console.log(`│ Free Pool Size:     ${es.freePoolSize.toString().padStart(6)}`);
        console.log('└──────────────────────────────────────────────────────────────┘\n');

        // Fragmentation
        console.log('┌─ FRAGMENTATION ANALYSIS ────────────────────────────────────┐');
        const f = report.fragmentation;
        console.log(`│ Fragmentation:      ${f.fragmentationPercent.padStart(6)}%`);
        console.log(`│ Total Gaps:         ${f.totalGaps.toString().padStart(6)} (${f.totalGapSize} dead slots)`);
        console.log(`│ Largest Gap:        ${f.maxGapSize.toString().padStart(6)} entities`);
        console.log(`│ Avg Gap Size:       ${f.averageGapSize.toString().padStart(6)}`);
        console.log('│');
        console.log(`│ Contiguous Runs:    ${f.contiguousRuns.totalRuns.toString().padStart(6)}`);
        console.log(`│ Largest Run:        ${f.contiguousRuns.largestRun.toString().padStart(6)} entities`);
        console.log(`│ Avg Run Size:       ${f.contiguousRuns.averageRunSize.toString().padStart(6)}`);
        console.log('└──────────────────────────────────────────────────────────────┘\n');

        // Memory Usage
        console.log('┌─ MEMORY USAGE ──────────────────────────────────────────────┐');
        const na = report.numericArrays;
        console.log(`│ Numeric Arrays:     ${na.totalArrays.toString().padStart(6)}`);
        console.log(`│ Allocated:          ${na.totalMB.padStart(6)} MB`);
        console.log(`│ Used:               ${na.usedMB.padStart(6)} MB`);
        console.log(`│ Waste:              ${na.wastePercent.padStart(6)}%`);
        console.log('│');
        const oc = report.objectComponents;
        console.log(`│ Object Components:  ${oc.componentTypes.toString().padStart(6)} types`);
        console.log(`│ Object Instances:   ${oc.totalInstances.toString().padStart(6)}`);
        console.log('└──────────────────────────────────────────────────────────────┘\n');

        // Cache Efficiency
        console.log('┌─ CACHE EFFICIENCY (by query) ──────────────────────────────┐');
        for (const [query, stats] of Object.entries(report.cacheEfficiency)) {
            const eff = parseFloat(stats.cacheEfficiencyPercent);
            const indicator = eff >= 75 ? '✓' : eff >= 50 ? '◐' : '✗';
            console.log(`│ ${indicator} ${query.padEnd(25)} ${stats.cacheEfficiencyPercent.padStart(5)}% efficient`);
            console.log(`│   └─ ${stats.entityCount} entities, stride ${stats.averageStride}, density ${stats.densityPercent}%`);
        }
        console.log('└──────────────────────────────────────────────────────────────┘\n');

        // Recommendations
        if (report.recommendations.length > 0) {
            console.log('┌─ RECOMMENDATIONS ───────────────────────────────────────────┐');
            for (const rec of report.recommendations) {
                const icon = rec.severity === 'high' ? '🔴' : rec.severity === 'medium' ? '🟡' : '🟢';
                console.log(`│ ${icon} [${rec.category.toUpperCase()}] ${rec.message}`);
                if (rec.detail) {
                    console.log(`│    └─ ${rec.detail}`);
                }
            }
            console.log('└──────────────────────────────────────────────────────────────┘\n');
        } else {
            console.log('┌─ RECOMMENDATIONS ───────────────────────────────────────────┐');
            console.log('│ 🟢 Memory locality looks good! No issues detected.          │');
            console.log('└──────────────────────────────────────────────────────────────┘\n');
        }

        return report;
    }

    /**
     * Export report as JSON
     */
    exportReport() {
        return JSON.stringify(this.lastReport || this.analyze(), null, 2);
    }

    /**
     * Track locality changes over time
     */
    createSnapshot() {
        return {
            timestamp: Date.now(),
            entityCount: this.game.entityCount,
            nextEntityId: this.game.nextEntityId,
            fragmentation: parseFloat(this.analyzeFragmentation().fragmentationPercent),
            cacheEfficiency: Object.fromEntries(
                Object.entries(this.analyzeCacheEfficiency())
                    .map(([k, v]) => [k, parseFloat(v.cacheEfficiencyPercent)])
            )
        };
    }

    /**
     * Compare two snapshots
     */
    compareSnapshots(before, after) {
        return {
            duration: after.timestamp - before.timestamp,
            entityDelta: after.entityCount - before.entityCount,
            idSpaceDelta: after.nextEntityId - before.nextEntityId,
            fragmentationDelta: (after.fragmentation - before.fragmentation).toFixed(2),
            cacheEfficiencyDelta: Object.fromEntries(
                Object.keys(after.cacheEfficiency)
                    .filter(k => before.cacheEfficiency[k] !== undefined)
                    .map(k => [k, (after.cacheEfficiency[k] - before.cacheEfficiency[k]).toFixed(2)])
            )
        };
    }
}

// Export for different module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MemoryLocalityAnalyzer;
}
if (typeof GUTS !== 'undefined') {
    GUTS.MemoryLocalityAnalyzer = MemoryLocalityAnalyzer;
}
if (typeof window !== 'undefined') {
    window.MemoryLocalityAnalyzer = MemoryLocalityAnalyzer;
}
