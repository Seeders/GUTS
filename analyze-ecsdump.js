/**
 * Offline analysis of ecsdump.json for memory locality
 * Run with: node analyze-ecsdump.js
 */

const fs = require('fs');

// Load the dump
const dump = JSON.parse(fs.readFileSync('./ecsdump.json', 'utf8'));

const CACHE_LINE_SIZE = 64;
const FLOAT32_SIZE = 4;
const ENTITIES_PER_CACHELINE = CACHE_LINE_SIZE / FLOAT32_SIZE; // 16

console.log('\n╔══════════════════════════════════════════════════════════════╗');
console.log('║         ECSDUMP.JSON MEMORY LOCALITY ANALYSIS                ║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');

// === Entity Statistics ===
const entityAlive = dump.entityAlive;
const aliveIds = Object.keys(entityAlive).filter(k => entityAlive[k] === 1).map(Number);
const maxId = Math.max(...Object.keys(entityAlive).map(Number));
const highestAliveId = Math.max(...aliveIds);

console.log('┌─ ENTITY STATISTICS ─────────────────────────────────────────┐');
console.log(`│ Next Entity ID:     ${String(dump.nextEntityId).padStart(6)}`);
console.log(`│ Alive Entities:     ${String(aliveIds.length).padStart(6)}`);
console.log(`│ Highest Alive ID:   ${String(highestAliveId).padStart(6)}`);
console.log(`│ Utilization:        ${((aliveIds.length / 16384) * 100).toFixed(2).padStart(6)}%`);
console.log('└──────────────────────────────────────────────────────────────┘\n');

// === Fragmentation Analysis ===
const sortedAlive = aliveIds.sort((a, b) => a - b);
const gaps = [];
let totalGapSize = 0;

for (let i = 1; i < sortedAlive.length; i++) {
    const gap = sortedAlive[i] - sortedAlive[i - 1] - 1;
    if (gap > 0) {
        gaps.push({ after: sortedAlive[i - 1], size: gap });
        totalGapSize += gap;
    }
}

const idRange = highestAliveId - sortedAlive[0] + 1;
const fragmentationPercent = ((totalGapSize / idRange) * 100).toFixed(2);

// Contiguous runs
const runs = [];
let runStart = sortedAlive[0];
let runLength = 1;

for (let i = 1; i < sortedAlive.length; i++) {
    if (sortedAlive[i] === sortedAlive[i - 1] + 1) {
        runLength++;
    } else {
        runs.push({ start: runStart, length: runLength });
        runStart = sortedAlive[i];
        runLength = 1;
    }
}
runs.push({ start: runStart, length: runLength });

const largestRun = Math.max(...runs.map(r => r.length));
const avgRunLength = (runs.reduce((s, r) => s + r.length, 0) / runs.length).toFixed(2);

console.log('┌─ FRAGMENTATION ANALYSIS ────────────────────────────────────┐');
console.log(`│ Fragmentation:      ${fragmentationPercent.padStart(6)}%`);
console.log(`│ Total Gaps:         ${String(gaps.length).padStart(6)} (${totalGapSize} dead slots)`);
console.log(`│ Largest Gap:        ${String(Math.max(...gaps.map(g => g.size), 0)).padStart(6)} entities`);
console.log('│');
console.log(`│ Contiguous Runs:    ${String(runs.length).padStart(6)}`);
console.log(`│ Largest Run:        ${String(largestRun).padStart(6)} entities`);
console.log(`│ Avg Run Size:       ${avgRunLength.padStart(6)}`);
console.log('└──────────────────────────────────────────────────────────────┘\n');

// === Stride Analysis ===
const strides = [];
for (let i = 1; i < sortedAlive.length; i++) {
    strides.push(sortedAlive[i] - sortedAlive[i - 1]);
}

const avgStride = (strides.reduce((a, b) => a + b, 0) / strides.length).toFixed(2);
const perfectStrides = strides.filter(s => s === 1).length;
const contiguityPercent = ((perfectStrides / strides.length) * 100).toFixed(2);

// Cache line analysis
let cacheLinesUsed = 0;
let lastCacheLine = -1;
for (const id of sortedAlive) {
    const cacheLine = Math.floor(id / ENTITIES_PER_CACHELINE);
    if (cacheLine !== lastCacheLine) {
        cacheLinesUsed++;
        lastCacheLine = cacheLine;
    }
}
const optimalCacheLines = Math.ceil(sortedAlive.length / ENTITIES_PER_CACHELINE);
const cacheEfficiency = ((optimalCacheLines / cacheLinesUsed) * 100).toFixed(2);

console.log('┌─ CACHE EFFICIENCY (all entities) ──────────────────────────┐');
console.log(`│ Average Stride:     ${avgStride.padStart(6)}`);
console.log(`│ Contiguity:         ${contiguityPercent.padStart(6)}% (stride=1)`);
console.log(`│ Cache Lines Used:   ${String(cacheLinesUsed).padStart(6)}`);
console.log(`│ Optimal Cache Lines:${String(optimalCacheLines).padStart(6)}`);
console.log(`│ Cache Efficiency:   ${cacheEfficiency.padStart(6)}%`);
console.log('└──────────────────────────────────────────────────────────────┘\n');

// === Numeric Arrays Analysis ===
const numericArrays = dump.numericArrays || {};
const arrayKeys = Object.keys(numericArrays);
const componentGroups = {};

let totalFloats = 0;
let usedFloats = 0;

for (const key of arrayKeys) {
    const arr = numericArrays[key];
    const component = key.split('.')[0];

    if (!componentGroups[component]) {
        componentGroups[component] = { fields: 0, nonZero: 0 };
    }
    componentGroups[component].fields++;

    // Count non-default values
    for (const id of aliveIds) {
        totalFloats++;
        const val = arr[id];
        if (val !== undefined && val !== 0 && val !== -Infinity && val !== null) {
            usedFloats++;
            componentGroups[component].nonZero++;
        }
    }
}

console.log('┌─ NUMERIC ARRAYS ────────────────────────────────────────────┐');
console.log(`│ Total Arrays:       ${String(arrayKeys.length).padStart(6)}`);
console.log(`│ Memory (allocated): ${((arrayKeys.length * 16384 * 4) / 1024 / 1024).toFixed(2).padStart(6)} MB`);
console.log(`│ Values checked:     ${String(totalFloats).padStart(6)}`);
console.log(`│ Non-default values: ${String(usedFloats).padStart(6)} (${((usedFloats / totalFloats) * 100).toFixed(1)}%)`);
console.log('│');
console.log('│ By Component:');

const sortedComponents = Object.entries(componentGroups)
    .sort((a, b) => b[1].fields - a[1].fields)
    .slice(0, 10);

for (const [comp, stats] of sortedComponents) {
    console.log(`│   ${comp.padEnd(20)} ${String(stats.fields).padStart(3)} fields, ${String(stats.nonZero).padStart(5)} values`);
}
console.log('└──────────────────────────────────────────────────────────────┘\n');

// === Object Components Analysis ===
const objectComponents = dump.objectComponents || {};
const objCompKeys = Object.keys(objectComponents);

console.log('┌─ OBJECT COMPONENTS ─────────────────────────────────────────┐');
console.log(`│ Component Types:    ${String(objCompKeys.length).padStart(6)}`);

let totalObjects = 0;
for (const comp of objCompKeys) {
    const instances = Object.keys(objectComponents[comp]).length;
    totalObjects += instances;
    console.log(`│   ${comp.padEnd(20)} ${String(instances).padStart(5)} instances`);
}
console.log(`│ Total Instances:    ${String(totalObjects).padStart(6)}`);
console.log('└──────────────────────────────────────────────────────────────┘\n');

// === Component Mask Analysis ===
const entityComponentMask = dump.entityComponentMask || {};
const maskDistribution = {};

for (const id of aliveIds) {
    const mask0 = entityComponentMask[id * 2] || 0;
    const mask1 = entityComponentMask[id * 2 + 1] || 0;
    const componentCount = (mask0.toString(2).match(/1/g) || []).length +
                          (mask1.toString(2).match(/1/g) || []).length;

    maskDistribution[componentCount] = (maskDistribution[componentCount] || 0) + 1;
}

console.log('┌─ COMPONENTS PER ENTITY ─────────────────────────────────────┐');
const sortedCounts = Object.entries(maskDistribution).sort((a, b) => Number(a[0]) - Number(b[0]));
for (const [count, entities] of sortedCounts) {
    const bar = '█'.repeat(Math.min(30, Math.ceil(entities / aliveIds.length * 30)));
    console.log(`│ ${count.padStart(2)} components: ${String(entities).padStart(5)} entities ${bar}`);
}
console.log('└──────────────────────────────────────────────────────────────┘\n');

// === Recommendations ===
console.log('┌─ RECOMMENDATIONS ───────────────────────────────────────────┐');

const fragFloat = parseFloat(fragmentationPercent);
const cacheFloat = parseFloat(cacheEfficiency);

if (fragFloat < 5 && cacheFloat > 90) {
    console.log('│ 🟢 Excellent memory locality! No action needed.             │');
} else {
    if (fragFloat > 20) {
        console.log('│ 🔴 HIGH: Fragmentation at ' + fragmentationPercent + '% - implement entity compaction │');
    } else if (fragFloat > 10) {
        console.log('│ 🟡 MEDIUM: Fragmentation at ' + fragmentationPercent + '% - monitor for degradation  │');
    }

    if (cacheFloat < 50) {
        console.log('│ 🔴 HIGH: Cache efficiency at ' + cacheEfficiency + '% - entities are scattered    │');
    } else if (cacheFloat < 75) {
        console.log('│ 🟡 MEDIUM: Cache efficiency at ' + cacheEfficiency + '% - could be improved        │');
    }

    if (runs.length > aliveIds.length * 0.1) {
        console.log('│ 🟡 Entities scattered across ' + runs.length + ' separate runs              │');
    }
}

console.log('└──────────────────────────────────────────────────────────────┘\n');

// === Summary ===
console.log('┌─ SUMMARY ───────────────────────────────────────────────────┐');
console.log(`│ Entity Density:     ${((aliveIds.length / idRange) * 100).toFixed(2).padStart(6)}% of ID range used`);
console.log(`│ Cache Efficiency:   ${cacheEfficiency.padStart(6)}%`);
console.log(`│ Fragmentation:      ${fragmentationPercent.padStart(6)}%`);
console.log(`│ Avg Contiguous Run: ${avgRunLength.padStart(6)} entities`);
console.log('└──────────────────────────────────────────────────────────────┘\n');
