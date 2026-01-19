/**
 * Script to analyze UV coordinates of cliff GLB models
 * Run with: node analyze_cliff_uvs.js
 */

const fs = require('fs');
const path = require('path');

// Simple GLB/GLTF parser to extract UV data
function parseGLB(buffer) {
    const dataView = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

    // GLB Header
    const magic = dataView.getUint32(0, true);
    if (magic !== 0x46546C67) { // 'glTF'
        throw new Error('Not a valid GLB file');
    }

    const version = dataView.getUint32(4, true);
    const length = dataView.getUint32(8, true);

    // First chunk (JSON)
    const chunk0Length = dataView.getUint32(12, true);
    const chunk0Type = dataView.getUint32(16, true);

    if (chunk0Type !== 0x4E4F534A) { // 'JSON'
        throw new Error('First chunk is not JSON');
    }

    const jsonData = buffer.slice(20, 20 + chunk0Length).toString('utf8');
    const gltf = JSON.parse(jsonData);

    // Second chunk (BIN) - contains binary buffer data
    let binBuffer = null;
    if (20 + chunk0Length < length) {
        const chunk1Start = 20 + chunk0Length;
        const chunk1Length = dataView.getUint32(chunk1Start, true);
        const chunk1Type = dataView.getUint32(chunk1Start + 4, true);

        if (chunk1Type === 0x004E4942) { // 'BIN\0'
            binBuffer = buffer.slice(chunk1Start + 8, chunk1Start + 8 + chunk1Length);
        }
    }

    return { gltf, binBuffer };
}

function getAccessorData(gltf, binBuffer, accessorIndex) {
    const accessor = gltf.accessors[accessorIndex];
    const bufferView = gltf.bufferViews[accessor.bufferView];

    const byteOffset = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
    const componentType = accessor.componentType;
    const count = accessor.count;
    const type = accessor.type;

    // Determine components per element
    const typeComponents = {
        'SCALAR': 1,
        'VEC2': 2,
        'VEC3': 3,
        'VEC4': 4
    };
    const numComponents = typeComponents[type] || 1;

    // Read data based on component type
    const data = [];
    const view = new DataView(binBuffer.buffer, binBuffer.byteOffset + byteOffset);

    for (let i = 0; i < count; i++) {
        const element = [];
        for (let j = 0; j < numComponents; j++) {
            const offset = i * numComponents * 4 + j * 4; // Assuming float (4 bytes)
            if (componentType === 5126) { // FLOAT
                element.push(view.getFloat32(offset, true));
            }
        }
        data.push(element);
    }

    return data;
}

function analyzeUVs(filePath) {
    const buffer = fs.readFileSync(filePath);
    const { gltf, binBuffer } = parseGLB(buffer);

    const results = {
        file: path.basename(filePath),
        meshes: []
    };

    // Find all meshes and their UV data
    for (const mesh of gltf.meshes || []) {
        for (const primitive of mesh.primitives || []) {
            if (primitive.attributes && primitive.attributes.TEXCOORD_0 !== undefined) {
                const uvData = getAccessorData(gltf, binBuffer, primitive.attributes.TEXCOORD_0);

                let minU = Infinity, maxU = -Infinity;
                let minV = Infinity, maxV = -Infinity;

                for (const [u, v] of uvData) {
                    minU = Math.min(minU, u);
                    maxU = Math.max(maxU, u);
                    minV = Math.min(minV, v);
                    maxV = Math.max(maxV, v);
                }

                results.meshes.push({
                    name: mesh.name || 'unnamed',
                    uvCount: uvData.length,
                    uRange: [minU, maxU],
                    vRange: [minV, maxV],
                    // In pixels (assuming 100x100 texture)
                    uPixels: [Math.round(minU * 100), Math.round(maxU * 100)],
                    vPixels: [Math.round(minV * 100), Math.round(maxV * 100)]
                });
            }
        }
    }

    return results;
}

// Main
const modelsDir = path.join(__dirname, 'projects/UseYourIllusions/resources/models');
const cliffModels = [
    'atom_one_top_grass.glb',
    'atom_one_mid_grass.glb',
    'atom_one_base_grass.glb',
    'atom_two_top_grass.glb',
    'atom_two_mid_grass.glb',
    'atom_two_base_grass.glb',
    'atom_three_top_grass.glb',
    'atom_three_base_grass.glb'
];

console.log('Analyzing cliff model UV coordinates...\n');
console.log('Note: V coordinates in UV space are typically 0=bottom, 1=top');
console.log('With flipY=false, canvas Y coordinates map directly to V coordinates\n');

for (const modelFile of cliffModels) {
    const filePath = path.join(modelsDir, modelFile);
    if (fs.existsSync(filePath)) {
        try {
            const result = analyzeUVs(filePath);
            console.log(`=== ${result.file} ===`);
            for (const mesh of result.meshes) {
                console.log(`  U range: ${mesh.uRange[0].toFixed(3)} - ${mesh.uRange[1].toFixed(3)} (pixels ${mesh.uPixels[0]} - ${mesh.uPixels[1]})`);
                console.log(`  V range: ${mesh.vRange[0].toFixed(3)} - ${mesh.vRange[1].toFixed(3)} (pixels ${mesh.vPixels[0]} - ${mesh.vPixels[1]})`);
            }
            console.log('');
        } catch (e) {
            console.log(`Error analyzing ${modelFile}: ${e.message}\n`);
        }
    } else {
        console.log(`File not found: ${modelFile}\n`);
    }
}

// Also output the texture layout we're generating
console.log('\n=== Generated Texture Layout (100x100) ===');
console.log('Canvas Y coordinates (top=0, bottom=100):');
console.log('  Y 0-24:   Base terrain (brick) - repeated 24x24');
console.log('  Y 24-48:  Base terrain (brick) - repeated 24x24');
console.log('  Y 48-54:  Step 5: Secondary 24x24 blocks (y=54-baseSampleSize=30, so y=30-54)');
console.log('  Y 54-78:  Step 4: Secondary 24x24 blocks (y=78-baseSampleSize=54, so y=54-78)');
console.log('  Y 78-84:  Step 3: Secondary strip at y=78 (strip2Y = 100-16-6 = 78)');
console.log('  Y 94-100: Step 2: Secondary strip at bottom (y=94-100)');
console.log('');
console.log('With flipY=false:');
console.log('  Canvas Y=0 maps to UV V=0 (which samples from canvas top)');
console.log('  Canvas Y=100 maps to UV V=1 (which samples from canvas bottom)');
