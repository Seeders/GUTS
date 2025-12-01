/**
 * Entry Point Generator for GUTS Webpack Build
 * Creates dynamic entry point files for client and server bundles
 */

const fs = require('fs');
const path = require('path');

class EntryGenerator {
    constructor(buildConfig) {
        this.buildConfig = buildConfig;
        this.tempDir = path.join(__dirname, '.temp');
    }

    ensureTempDir() {
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true });
        }
    }

    /**
     * Generate imports for a list of modules
     */
    generateImports(modules, varPrefix = 'module') {
        const imports = [];
        const exports = [];
        const seen = new Set(); // Track duplicates

        modules.forEach((mod, index) => {
            const moduleName = mod.requireName || mod.fileName || mod.name;

            // Skip duplicates
            if (seen.has(moduleName)) {
                console.log(`⚠️ Skipping duplicate: ${moduleName}`);
                return;
            }
            seen.add(moduleName);

            // Sanitize variable name - replace dots, dashes, and other invalid chars with underscores
            const fileNameSafe = (mod.fileName || mod.name).replace(/[.\-]/g, '_');
            const varName = `${varPrefix}_${fileNameSafe}`;
            let importPath = mod.path.replace(/\\/g, '/');

            // Special handling for Three.js - use 'three' package name
            if (importPath.includes('node_modules/three/build/')) {
                importPath = 'three';
            }
            // Three.js examples should use their full path from node_modules
            else if (importPath.includes('node_modules/three/examples/')) {
                importPath = importPath.replace(/.*node_modules\//, '');
            }
            let importStatement;
            let exportValue = varName;

            // Socket.io-client uses default export
            if (moduleName === 'io' || importPath.includes('socket.io-client')) {
                importStatement = `import ${varName} from '${importPath}';`;
                exportValue = varName;
            }
            // Three.js and its addons use named exports, need namespace import
            else if (moduleName === 'THREE' || mod.name === 'threejs') {
                importStatement = `import * as ${varName} from '${importPath}';`;
            }
            // Three.js addons (GLTFLoader, OrbitControls, EffectComposer, etc.) export named classes
            else if (mod.name && (
                mod.name.startsWith('three_') ||
                mod.name.includes('GLTF') ||
                mod.name.includes('Orbit') ||
                (mod.name.includes('Effect') && !mod.name.includes('System')) ||
                (mod.name.includes('Pass') && !mod.name.includes('System')) ||
                mod.name.includes('Skeleton') ||
                mod.name.includes('MeshBVH') ||
                importPath.includes('/three/examples/jsm/') ||
                importPath.includes('three_')
            )) {
                // These modules export specific classes, use namespace import
                importStatement = `import * as ${varName} from '${importPath}';`;
                // Always try to extract the named export first, with fallback to namespace
                exportValue = `(${varName}.${moduleName} || ${varName})`;
            }
            // Standard namespace import for other modules
            // Use namespace import because class-export-loader exports both default and named exports
            else {
                importStatement = `import * as ${varName} from '${importPath}';`;
                // Extract the actual class from the module object
                // The class-export-loader exports both .default and .ClassName
                // Try named export first, then default, then the module itself
                exportValue = `(${varName}.${moduleName} || ${varName}.default || ${varName})`;
            }

            imports.push(importStatement);

            // Quote the property name if it contains special characters
            const needsQuoting = /[^a-zA-Z0-9_$]/.test(moduleName);
            const propertyName = needsQuoting ? `'${moduleName}'` : moduleName;

            // For the export value, if moduleName has special chars, use bracket notation
            let finalExportValue = exportValue;
            if (needsQuoting && exportValue.includes(`${varName}.${moduleName}`)) {
                // Replace dot notation with bracket notation for names with special chars
                finalExportValue = exportValue.replace(
                    `${varName}.${moduleName}`,
                    `${varName}['${moduleName}']`
                );
            }

            exports.push(`  ${propertyName}: ${finalExportValue}`);
        });

        return { imports, exports };
    }

    /**
     * Generate client entry point
     */
    generateClientEntry() {
        const { client, engine } = this.buildConfig;

        const sections = [];
        const globalExports = {};

        // Header
        sections.push(`/**
 * GUTS Game Client Bundle
 * Generated: ${new Date().toISOString()}
 * Project: ${this.buildConfig.projectName}
 */
`);

        // Import engine files
        sections.push('// ========== ENGINE ==========');
        sections.push(`import BaseEngine from '${engine.baseEngine.replace(/\\/g, '/')}';`);
        sections.push(`import Engine from '${engine.engine.replace(/\\/g, '/')}';`);
        sections.push('');

        globalExports.BaseEngine = 'BaseEngine';
        globalExports.Engine = 'Engine';

        // Import libraries
        if (client.libraries.length > 0) {
            sections.push('// ========== LIBRARIES ==========');
            const { imports, exports } = this.generateImports(client.libraries, 'lib');
            sections.push(...imports);
            sections.push('');
            sections.push('const Libraries = {');
            sections.push(exports.join(',\n'));
            sections.push('};');
            sections.push('');
            globalExports.Libraries = 'Libraries';
        }

        // Import managers
        if (client.managers.length > 0) {
            sections.push('// ========== MANAGERS ==========');
            const { imports, exports } = this.generateImports(client.managers, 'mgr');
            sections.push(...imports);
            sections.push('');
            sections.push('const Managers = {');
            sections.push(exports.join(',\n'));
            sections.push('};');
            sections.push('');
            globalExports.Managers = 'Managers';
        }

        // Import systems
        if (client.systems.length > 0) {
            sections.push('// ========== SYSTEMS ==========');
            const { imports, exports } = this.generateImports(client.systems, 'sys');
            sections.push(...imports);
            sections.push('');
            sections.push('const Systems = {');
            sections.push(exports.join(',\n'));
            sections.push('};');
            sections.push('');
            globalExports.Systems = 'Systems';
        }

        // Import class collections dynamically (abilities, items, etc.)
        const classCollectionObjects = {};
        if (client.classCollections && Object.keys(client.classCollections).length > 0) {
            for (const [collectionName, classFiles] of Object.entries(client.classCollections)) {
                const capitalized = collectionName.charAt(0).toUpperCase() + collectionName.slice(1);
                sections.push(`// ========== ${collectionName.toUpperCase()} ==========`);

                // Find metadata for this collection to check for base class
                const metadata = client.classMetadata?.find(m => m.collection === collectionName);
                let baseClassFile = null;
                let otherFiles = classFiles;

                if (metadata && metadata.baseClass) {
                    // Check if base class is already in libraries (if so, we don't need to import it again)
                    const baseClassInLibraries = client.libraries.some(lib =>
                        lib.name === metadata.baseClass || lib.fileName === metadata.baseClass || lib.requireName === metadata.baseClass
                    );

                    if (!baseClassInLibraries) {
                        // Separate base class from other files
                        baseClassFile = classFiles.find(f =>
                            f.name === metadata.baseClass || f.fileName === metadata.baseClass
                        );
                        otherFiles = classFiles.filter(f =>
                            f.name !== metadata.baseClass && f.fileName !== metadata.baseClass
                        );

                        // Import base class first
                        if (baseClassFile) {
                            sections.push(`// Import ${metadata.baseClass} first so other ${collectionName} can extend from it`);
                            const { imports: baseImports, exports: baseExports } = this.generateImports([baseClassFile], collectionName.toLowerCase());
                            sections.push(...baseImports);
                            sections.push('');
                        }
                    } else {
                        sections.push(`// ${metadata.baseClass} is already loaded from libraries`);
                    }
                }

                // Import remaining classes
                const { imports, exports } = this.generateImports(otherFiles, collectionName.toLowerCase());
                sections.push(...imports);
                sections.push('');

                sections.push(`const ${capitalized} = {`);
                if (baseClassFile && metadata) {
                    const baseVarName = `${collectionName.toLowerCase()}_${metadata.baseClass}`;
                    // Apply fallback expression to base class too
                    sections.push(`  ${metadata.baseClass}: (${baseVarName}.${metadata.baseClass} || ${baseVarName}.default || ${baseVarName}),`);
                } else if (metadata && metadata.baseClass) {
                    // Base class is from libraries, reference it from Libraries
                    sections.push(`  ${metadata.baseClass}: Libraries.${metadata.baseClass},`);
                }
                sections.push(exports.join(',\n'));
                sections.push('};');
                sections.push('');
                globalExports[capitalized] = capitalized;
                classCollectionObjects[collectionName] = capitalized;
            }
        }

        // Import data collections (JSON, HTML, CSS files)
        const dataCollectionObjects = {};
        if (client.dataCollections && Object.keys(client.dataCollections).length > 0) {
            sections.push('// ========== DATA COLLECTIONS ==========');

            for (const [collectionName, collectionFiles] of Object.entries(client.dataCollections)) {
                const { dataFiles, htmlFiles, cssFiles } = collectionFiles;
                if (dataFiles.length === 0 && htmlFiles.length === 0 && cssFiles.length === 0) continue;

                const dataVarName = `${collectionName}Data`;
                sections.push(`// ${collectionName} data`);

                // Import each JSON file
                dataFiles.forEach((file) => {
                    const varName = `${collectionName}_json_${this.sanitizeVarName(file.fileName)}`;
                    let importPath = file.path.replace(/\\/g, '/');
                    sections.push(`import ${varName} from '${importPath}';`);
                });

                // Import each HTML file as raw text
                htmlFiles.forEach((file) => {
                    const varName = `${collectionName}_html_${this.sanitizeVarName(file.fileName)}`;
                    let importPath = file.path.replace(/\\/g, '/');
                    sections.push(`import ${varName} from '${importPath}';`);
                });

                // Import each CSS file as raw text
                cssFiles.forEach((file) => {
                    const varName = `${collectionName}_css_${this.sanitizeVarName(file.fileName)}`;
                    let importPath = file.path.replace(/\\/g, '/');
                    sections.push(`import ${varName} from '${importPath}';`);
                });

                // Build the data collection object, merging JSON with HTML/CSS by fileName
                sections.push(`const ${dataVarName} = {`);

                // Use dataFiles as the primary list, merging in html/css
                dataFiles.forEach((file, index) => {
                    const jsonVar = `${collectionName}_json_${this.sanitizeVarName(file.fileName)}`;
                    const htmlVar = `${collectionName}_html_${this.sanitizeVarName(file.fileName)}`;
                    const cssVar = `${collectionName}_css_${this.sanitizeVarName(file.fileName)}`;

                    // Check if matching HTML/CSS files exist
                    const hasHtml = htmlFiles.some(h => h.fileName === file.fileName);
                    const hasCss = cssFiles.some(c => c.fileName === file.fileName);

                    const comma = index < dataFiles.length - 1 ? ',' : '';

                    if (hasHtml || hasCss) {
                        sections.push(`  "${file.fileName}": {`);
                        sections.push(`    ...${jsonVar},`);
                        if (hasHtml) {
                            sections.push(`    html: ${htmlVar},`);
                        }
                        if (hasCss) {
                            sections.push(`    css: ${cssVar}`);
                        }
                        sections.push(`  }${comma}`);
                    } else {
                        sections.push(`  "${file.fileName}": ${jsonVar}${comma}`);
                    }
                });

                sections.push('};');
                sections.push('');

                dataCollectionObjects[collectionName] = dataVarName;
            }
        }

        // Build the combined collections object for COMPILED_GAME.collections
        sections.push('// ========== COMBINED COLLECTIONS ==========');
        sections.push('const DataCollections = {');
        Object.entries(dataCollectionObjects).forEach(([collectionName, varName], index, arr) => {
            const comma = index < arr.length - 1 ? ',' : '';
            sections.push(`  ${collectionName}: ${varName}${comma}`);
        });
        sections.push('};');
        sections.push('');

        // Setup global namespace
        sections.push('// ========== GLOBAL SETUP ==========');
        sections.push('');
        sections.push('// Setup window.GUTS for backwards compatibility');
        sections.push('if (!window.GUTS) {');
        sections.push('  window.GUTS = {};');
        sections.push('}');
        sections.push('');
        sections.push('// Register all libraries in window.GUTS');
        sections.push('Object.assign(window.GUTS, Libraries);');
        sections.push('');
        sections.push('// Setup window.THREE if it exists in libraries');
        sections.push('if (Libraries.THREE) {');
        sections.push('  window.THREE = Libraries.THREE;');
        sections.push('  ');
        sections.push('  // Add Three.js addons to window.THREE namespace');
        sections.push('  Object.keys(Libraries).forEach(key => {');
        sections.push('    if (key.startsWith(\'three_\')) {');
        sections.push('      // For three_ prefixed libraries, add as both namespaced AND flattened');
        sections.push('      // e.g., THREE.MeshBVH (namespace) AND THREE.computeBoundsTree (flattened)');
        sections.push('      const addon = Libraries[key];');
        sections.push('      const cleanName = key.replace(\'three_\', \'\');');
        sections.push('      window.THREE[cleanName] = addon; // Add as namespace');
        sections.push('      if (typeof addon === \'object\' && addon !== null) {');
        sections.push('        Object.assign(window.THREE, addon); // Also flatten for direct access');
        sections.push('      }');
        sections.push('    } else if ([\'OrbitControls\', \'GLTFLoader\', \'EffectComposer\', \'OutputPass\', \'RenderPixelatedPass\', \'SkeletonUtils\'].includes(key)) {');
        sections.push('      const addon = Libraries[key];');
        sections.push('      if (typeof addon === \'object\' && addon !== null) {');
        sections.push('        Object.assign(window.THREE, addon);');
        sections.push('      } else {');
        sections.push('        window.THREE[key] = addon;');
        sections.push('      }');
        sections.push('    }');
        sections.push('  });');
        sections.push('}');
        sections.push('');
        // Also expose managers, systems, and dynamic collections in GUTS namespace
        sections.push('Object.assign(window.GUTS, {');
        sections.push('  managers: Managers,');
        sections.push('  systems: Systems,');

        // Add dynamic collections
        const collectionEntries = Object.entries(classCollectionObjects);
        collectionEntries.forEach(([collectionName, varName], index) => {
            const isLast = index === collectionEntries.length - 1;
            const comma = isLast ? '' : ',';
            sections.push(`  ${collectionName}: ${varName}${comma}`);
        });

        sections.push('});');
        sections.push('');

        // Also assign individual classes directly to window.GUTS (not just in organized collections)
        sections.push('// Assign all individual classes directly to window.GUTS for direct access');
        sections.push('Object.assign(window.GUTS, Managers);');
        sections.push('Object.assign(window.GUTS, Systems);');

        // Assign individual classes from dynamic collections
        Object.entries(classCollectionObjects).forEach(([collectionName, varName]) => {
            sections.push(`Object.assign(window.GUTS, ${varName});`);
        });

        sections.push('');
        sections.push('// Setup COMPILED_GAME namespace');
        sections.push('window.COMPILED_GAME = {');
        sections.push('  ready: Promise.resolve(),');
        sections.push('  initialized: false,');
        sections.push('  libraryClasses: Libraries,');
        sections.push('  managers: Managers,');
        sections.push('  systems: Systems,');
        sections.push('  collections: DataCollections,');

        // Add dynamic class collections
        Object.entries(classCollectionObjects).forEach(([collectionName, varName]) => {
            sections.push(`  ${collectionName}: ${varName},`);
        });

        sections.push('  init: function(gutsEngine) {');
        sections.push('    if (this.initialized) return;');
        sections.push('    this.initialized = true;');
        sections.push('    window.GUTS.engine = gutsEngine;');
        sections.push('    console.log("✅ COMPILED_GAME initialized");');
        sections.push('  }');
        sections.push('};');
        sections.push('');

        // Export everything
        sections.push('// ========== EXPORTS ==========');
        sections.push('export {');
        Object.entries(globalExports).forEach(([key, value], index, arr) => {
            const comma = index < arr.length - 1 ? ',' : '';
            sections.push(`  ${value}${comma}`);
        });
        sections.push('};');
        sections.push('');
        sections.push('export default window.COMPILED_GAME;');

        const entryPath = path.join(this.tempDir, 'client-entry.js');
        fs.writeFileSync(entryPath, sections.join('\n'), 'utf8');
        console.log(`✅ Generated client entry: ${entryPath}`);

        return entryPath;
    }

    /**
     * Sanitize a name to be a valid JavaScript identifier
     */
    sanitizeVarName(name) {
        // Replace hyphens, dots, and other special characters with underscores
        return name.replace(/[^a-zA-Z0-9_$]/g, '_');
    }

    /**
     * Generate imports using CommonJS require (for server, to avoid hoisting issues)
     */
    generateCommonJSImports(modules, varPrefix = 'module') {
        const requires = [];
        const exports = [];
        const seen = new Set();

        modules.forEach((mod) => {
            const moduleName = mod.requireName || mod.fileName || mod.name;

            if (seen.has(moduleName)) {
                console.log(`⚠️ Skipping duplicate: ${moduleName}`);
                return;
            }
            seen.add(moduleName);

            const varName = `${varPrefix}_${this.sanitizeVarName(mod.fileName || mod.name)}`;
            const sanitizedModuleName = this.sanitizeVarName(moduleName);
            const requirePath = mod.path.replace(/\\/g, '/');

            // Require the module and extract the actual class from exports
            requires.push(`const ${varName}_module = require('${requirePath}');`);
            requires.push(`const ${varName} = ${varName}_module.default || ${varName}_module.${moduleName} || ${varName}_module;`);
            // Immediately assign to global.GUTS so it's available for inheritance
            requires.push(`global.GUTS.${sanitizedModuleName} = ${varName};`);
            exports.push(`  ${sanitizedModuleName}: ${varName}`);
        });

        return { requires, exports };
    }

    /**
     * Generate server entry point (using CommonJS to avoid ES6 import hoisting)
     */
    generateServerEntry() {
        const { server } = this.buildConfig;

        if (!server) {
            console.log('⚠️ No server configuration found, skipping server entry');
            return null;
        }

        const sections = [];

        // Header
        sections.push(`/**
 * GUTS Game Server Bundle (CommonJS)
 * Generated: ${new Date().toISOString()}
 * Project: ${this.buildConfig.projectName}
 */
`);

        // Setup globals FIRST
        sections.push('// ========== SETUP GLOBALS ==========');
        sections.push('if (!global.GUTS) global.GUTS = {};');
        sections.push('if (!global.window) global.window = global;');
        sections.push('');

        // Require libraries (synchronous, happens in order)
        // Each library is assigned to global.GUTS immediately after being required
        if (server.libraries.length > 0) {
            sections.push('// ========== LIBRARIES ==========');
            const { requires, exports } = this.generateCommonJSImports(server.libraries, 'lib');
            sections.push(...requires);
            sections.push('');
            sections.push('const Libraries = {');
            sections.push(exports.join(',\n'));
            sections.push('};');
            sections.push('');
        }

        // Require managers
        if (server.managers.length > 0) {
            sections.push('// ========== MANAGERS ==========');
            const { requires, exports } = this.generateCommonJSImports(server.managers, 'mgr');
            sections.push(...requires);
            sections.push('');
            sections.push('const Managers = {');
            sections.push(exports.join(',\n'));
            sections.push('};');
            sections.push('');
        }

        // Require systems
        if (server.systems.length > 0) {
            sections.push('// ========== SYSTEMS ==========');
            const { requires, exports } = this.generateCommonJSImports(server.systems, 'sys');
            sections.push(...requires);
            sections.push('');
            sections.push('const Systems = {');
            sections.push(exports.join(',\n'));
            sections.push('};');
            sections.push('');
        }

        // Require class collections dynamically (abilities, items, etc.)
        // Use classMetadata to load base classes FIRST
        const classCollectionVars = {};
        if (server.classCollections && Object.keys(server.classCollections).length > 0) {
            for (const [collectionName, classFiles] of Object.entries(server.classCollections)) {
                const capitalized = collectionName.charAt(0).toUpperCase() + collectionName.slice(1);
                sections.push(`// ========== ${collectionName.toUpperCase()} ==========`);

                // Find metadata for this collection to check for base class
                const metadata = server.classMetadata?.find(m => m.collection === collectionName);
                let baseClassFile = null;
                let otherFiles = classFiles;

                if (metadata && metadata.baseClass) {
                    // Check if base class is already in libraries (if so, we don't need to import it again)
                    const baseClassInLibraries = server.libraries.some(lib =>
                        lib.name === metadata.baseClass || lib.fileName === metadata.baseClass || lib.requireName === metadata.baseClass
                    );

                    if (!baseClassInLibraries) {
                        // Separate base class from other files
                        baseClassFile = classFiles.find(f =>
                            f.name === metadata.baseClass || f.fileName === metadata.baseClass
                        );
                        otherFiles = classFiles.filter(f =>
                            f.name !== metadata.baseClass && f.fileName !== metadata.baseClass
                        );

                        // Require base class first and register it immediately
                        if (baseClassFile) {
                            const varName = `${collectionName.toLowerCase()}_${metadata.baseClass}`;
                            const requirePath = baseClassFile.path.replace(/\\/g, '/');
                            sections.push(`// Require ${metadata.baseClass} first so other ${collectionName} can extend from it`);
                            sections.push(`const ${varName}_module = require('${requirePath}');`);
                            sections.push(`const ${varName} = ${varName}_module.default || ${varName}_module.${metadata.baseClass} || ${varName}_module;`);
                            sections.push(`global.GUTS.${metadata.baseClass} = ${varName};`);
                            sections.push('');
                        }
                    } else {
                        sections.push(`// ${metadata.baseClass} is already loaded from libraries`);
                        sections.push('');
                    }
                }

                // Now require all other files
                const { requires, exports } = this.generateCommonJSImports(otherFiles, collectionName.toLowerCase());
                sections.push(...requires);
                sections.push('');

                // Build the collection object
                sections.push(`const ${capitalized} = {`);
                if (baseClassFile && metadata) {
                    const varName = `${collectionName.toLowerCase()}_${metadata.baseClass}`;
                    sections.push(`  ${metadata.baseClass}: ${varName},`);
                } else if (metadata && metadata.baseClass) {
                    // Base class is from libraries, reference it from global.GUTS (already loaded)
                    sections.push(`  ${metadata.baseClass}: global.GUTS.${metadata.baseClass},`);
                }
                sections.push(exports.join(',\n'));
                sections.push('};');
                sections.push('');

                // Make all classes available in global.GUTS directly
                sections.push(`// Make all ${collectionName} available in global.GUTS`);
                sections.push(`Object.assign(global.GUTS, ${capitalized});`);
                sections.push('');

                classCollectionVars[collectionName] = capitalized;
            }
        }

        // Require data collections (JSON files only for server - no HTML/CSS needed)
        const dataCollectionVars = {};
        if (server.dataCollections && Object.keys(server.dataCollections).length > 0) {
            sections.push('// ========== DATA COLLECTIONS ==========');

            for (const [collectionName, collectionFiles] of Object.entries(server.dataCollections)) {
                const { dataFiles } = collectionFiles;
                if (!dataFiles || dataFiles.length === 0) continue;

                const dataVarName = `${collectionName}Data`;
                sections.push(`// ${collectionName} data`);

                // Require each JSON file
                dataFiles.forEach((file) => {
                    const varName = `${collectionName}_json_${this.sanitizeVarName(file.fileName)}`;
                    let requirePath = file.path.replace(/\\/g, '/');
                    sections.push(`const ${varName} = require('${requirePath}');`);
                });

                // Build the data collection object
                sections.push(`const ${dataVarName} = {`);
                dataFiles.forEach((file, index) => {
                    const varName = `${collectionName}_json_${this.sanitizeVarName(file.fileName)}`;
                    const comma = index < dataFiles.length - 1 ? ',' : '';
                    sections.push(`  "${file.fileName}": ${varName}${comma}`);
                });
                sections.push('};');
                sections.push('');

                dataCollectionVars[collectionName] = dataVarName;
            }
        }

        // Build the combined data collections object
        sections.push('// ========== COMBINED DATA COLLECTIONS ==========');
        sections.push('const DataCollections = {');
        Object.entries(dataCollectionVars).forEach(([collectionName, varName], index, arr) => {
            const comma = index < arr.length - 1 ? ',' : '';
            sections.push(`  ${collectionName}: ${varName}${comma}`);
        });
        sections.push('};');
        sections.push('');


        // Setup global namespace (Node.js global)
        sections.push('// ========== GLOBAL SETUP ==========');
        sections.push('global.COMPILED_GAME = {');
        sections.push('  ready: Promise.resolve(),');
        sections.push('  initialized: false,');
        sections.push('  libraryClasses: Libraries,');
        sections.push('  managers: Managers,');
        sections.push('  systems: Systems,');
        sections.push('  collections: DataCollections,');

        // Add dynamic class collections
        for (const [collectionName, varName] of Object.entries(classCollectionVars)) {
            sections.push(`  ${collectionName}: ${varName},`);
        }

        sections.push('  init: function(gutsEngine) {');
        sections.push('    if (this.initialized) return;');
        sections.push('    this.initialized = true;');
        sections.push('    global.GUTS.engine = gutsEngine;');
        sections.push('    console.log("✅ COMPILED_GAME initialized on server");');
        sections.push('  }');
        sections.push('};');
        sections.push('');
        sections.push('// Also expose in global.GUTS for compatibility');
        sections.push('global.GUTS.managers = Managers;');
        sections.push('global.GUTS.systems = Systems;');

        // Add dynamic collections to global.GUTS
        for (const [collectionName, varName] of Object.entries(classCollectionVars)) {
            sections.push(`global.GUTS.${collectionName} = ${varName};`);
        }

        sections.push('');

        // Export
        sections.push('module.exports = global.COMPILED_GAME;');

        const entryPath = path.join(this.tempDir, 'server-entry.js');
        fs.writeFileSync(entryPath, sections.join('\n'), 'utf8');
        console.log(`✅ Generated server entry: ${entryPath}`);

        return entryPath;
    }

    /**
     * Generate engine entry point
     */
    /**
     * Generate editor entry point
     */
    generateEditorEntry() {
        const { editor } = this.buildConfig;

        if (!editor) {
            console.warn('⚠️ No editor configuration found');
            return null;
        }

        const sections = [];

        // Header
        sections.push(`/**
 * GUTS Editor Bundle
 * Generated: ${new Date().toISOString()}
 * Project: ${this.buildConfig.projectName}
 */
`);

        // Import codemirror
        sections.push('// CodeMirror');
        sections.push(`import CodeMirror from 'codemirror';`);
        sections.push(`import 'codemirror/lib/codemirror.css';`);
        sections.push(`import 'codemirror/addon/hint/show-hint.css';`);
        sections.push(`import 'codemirror/mode/javascript/javascript.js';`);
        sections.push(`import 'codemirror/addon/hint/show-hint.js';`);
        sections.push(`import 'codemirror/addon/hint/javascript-hint.js';`);
        sections.push('');

        // Import editor engine files
        const engineDir = path.join(__dirname, '..', 'engine').replace(/\\/g, '/');
        sections.push('// Editor Engine Files');
        sections.push(`import FileSystemSyncService from '${engineDir}/FileSystemSyncService.js';`);
        sections.push(`import EditorModel from '${engineDir}/EditorModel.js';`);
        sections.push(`import EditorView from '${engineDir}/EditorView.js';`);
        sections.push(`import EditorController from '${engineDir}/EditorController.js';`);
        sections.push('');

        // Initialize window.GUTS
        sections.push('// Initialize global namespace');
        sections.push('if (!window.GUTS) window.GUTS = {};');
        sections.push('');

        // Import libraries from editor modules (in order)
        if (editor.libraries && editor.libraries.length > 0) {
            sections.push('// ========== LIBRARIES (from editor modules) ==========');
            const { imports, exports } = this.generateImports(editor.libraries, 'lib');
            sections.push(...imports);
            sections.push('');
            sections.push('const Libraries = {');
            sections.push(exports.join(',\n'));
            sections.push('};');
            sections.push('');

            // Make libraries available in window.GUTS
            sections.push('// Make libraries available in window.GUTS');
            sections.push('window.GUTS.libraries = Libraries;');
            sections.push('Object.assign(window.GUTS, Libraries);');
            sections.push('');
        }

        // Import systems from editor modules
        if (editor.systems && editor.systems.length > 0) {
            sections.push('// ========== SYSTEMS (from editor modules) ==========');
            const { imports, exports } = this.generateImports(editor.systems, 'sys');
            sections.push(...imports);
            sections.push('');
            sections.push('const Systems = {');
            sections.push(exports.join(',\n'));
            sections.push('};');
            sections.push('');

            // Make systems available in window.GUTS
            sections.push('// Make systems available in window.GUTS');
            sections.push('window.GUTS.systems = Systems;');
            sections.push('Object.assign(window.GUTS, Systems);');
            sections.push('');
        }

        // Import class collections from editor modules
        const classCollectionObjects = {};
        if (editor.classCollections && Object.keys(editor.classCollections).length > 0) {
            for (const [collectionName, classFiles] of Object.entries(editor.classCollections)) {
                const capitalized = collectionName.charAt(0).toUpperCase() + collectionName.slice(1);
                sections.push(`// ========== ${collectionName.toUpperCase()} ==========`);

                // Find metadata for this collection to check for base class
                const metadata = editor.classMetadata?.find(m => m.collection === collectionName);
                let baseClassFile = null;
                let otherFiles = classFiles;

                if (metadata && metadata.baseClass) {
                    // Check if base class is already in libraries (if so, we don't need to import it again)
                    const baseClassInLibraries = editor.libraries.some(lib =>
                        lib.name === metadata.baseClass || lib.fileName === metadata.baseClass || lib.requireName === metadata.baseClass
                    );

                    if (!baseClassInLibraries) {
                        // Separate base class from other files
                        baseClassFile = classFiles.find(f =>
                            f.name === metadata.baseClass || f.fileName === metadata.baseClass
                        );
                        otherFiles = classFiles.filter(f =>
                            f.name !== metadata.baseClass && f.fileName !== metadata.baseClass
                        );

                        // Import base class first
                        if (baseClassFile) {
                            sections.push(`// Import ${metadata.baseClass} first so other ${collectionName} can extend from it`);
                            const { imports: baseImports, exports: baseExports } = this.generateImports([baseClassFile], collectionName.toLowerCase());
                            sections.push(...baseImports);
                            sections.push('');
                        }
                    } else {
                        sections.push(`// ${metadata.baseClass} is already loaded from libraries`);
                        sections.push('');
                    }
                }

                // Import remaining classes
                const { imports, exports } = this.generateImports(otherFiles, collectionName.toLowerCase());
                sections.push(...imports);
                sections.push('');

                sections.push(`const ${capitalized} = {`);
                if (baseClassFile && metadata) {
                    const baseVarName = `${collectionName.toLowerCase()}_${metadata.baseClass}`;
                    // Apply fallback expression to base class too
                    sections.push(`  ${metadata.baseClass}: (${baseVarName}.${metadata.baseClass} || ${baseVarName}.default || ${baseVarName}),`);
                } else if (metadata && metadata.baseClass) {
                    // Base class is from libraries, reference it from Libraries
                    sections.push(`  ${metadata.baseClass}: Libraries.${metadata.baseClass},`);
                }
                sections.push(exports.join(',\n'));
                sections.push('};');
                sections.push('');

                // Make class collection available in window.GUTS
                sections.push(`// Make ${collectionName} available in window.GUTS`);
                sections.push(`window.GUTS.${collectionName} = ${capitalized};`);
                sections.push(`Object.assign(window.GUTS, ${capitalized});`);
                sections.push('');

                classCollectionObjects[collectionName] = capitalized;
            }
        }

        // Make editor engine classes and CodeMirror available globally
        sections.push('// Make editor engine classes and CodeMirror available globally');
        sections.push('window.CodeMirror = CodeMirror;');
        sections.push('window.FileSystemSyncService = FileSystemSyncService;');
        sections.push('window.EditorModel = EditorModel;');
        sections.push('window.EditorView = EditorView;');
        sections.push('window.EditorController = EditorController;');
        sections.push('');

        // Set up window.THREE with core library and addons (if libraries exist)
        sections.push('// Set up window.THREE with core library and addons');
        sections.push('if (window.GUTS.libraries) {');
        sections.push('  Object.keys(window.GUTS.libraries).forEach(key => {');
        sections.push('    // Core THREE.js library');
        sections.push('    if (key === \'threejs\' || key === \'THREE\') {');
        sections.push('      window.THREE = window.GUTS.libraries[key];');
        sections.push('    }');
        sections.push('  });');
        sections.push('  ');
        sections.push('  // Add Three.js addons to window.THREE namespace');
        sections.push('  if (!window.THREE) window.THREE = {};');
        sections.push('  Object.keys(window.GUTS.libraries).forEach(key => {');
        sections.push('    if (key.startsWith(\'three_\')) {');
        sections.push('      // For three_ prefixed libraries, add as both namespaced AND flattened');
        sections.push('      const addon = window.GUTS.libraries[key];');
        sections.push('      const cleanName = key.replace(\'three_\', \'\');');
        sections.push('      window.THREE[cleanName] = addon; // Add as namespace');
        sections.push('      if (typeof addon === \'object\' && addon !== null) {');
        sections.push('        Object.assign(window.THREE, addon); // Also flatten for direct access');
        sections.push('      }');
        sections.push('    } else if (key === \'GLTFLoader\' || key === \'BufferGeometryUtils\' || key === \'OrbitControls\') {');
        sections.push('      // Other THREE.js libraries');
        sections.push('      window.THREE[key] = window.GUTS.libraries[key];');
        sections.push('    }');
        sections.push('  });');
        sections.push('}');
        sections.push('');

        // Build dynamic exports
        const exportsList = ['CodeMirror', 'FileSystemSyncService', 'EditorModel', 'EditorView', 'EditorController'];

        // Add Libraries to exports if it exists
        if (editor.libraries && editor.libraries.length > 0) {
            exportsList.push('Libraries');
        }

        // Add class collections to exports
        Object.values(classCollectionObjects).forEach(varName => {
            exportsList.push(varName);
        });

        // Export
        sections.push(`export { ${exportsList.join(', ')} };`);

        // Export Libraries as default if it exists, otherwise export window.GUTS
        if (editor.libraries && editor.libraries.length > 0) {
            sections.push('export default Libraries;');
        } else {
            sections.push('export default window.GUTS;');
        }

        const entryPath = path.join(this.tempDir, 'editor-entry.js');
        fs.writeFileSync(entryPath, sections.join('\n'), 'utf8');
        console.log(`✅ Generated editor entry: ${entryPath}`);

        return entryPath;
    }

    generateEngineEntry() {
        const { engine } = this.buildConfig;

        const sections = [];

        // Header
        sections.push(`/**
 * GUTS Engine Bundle
 * Generated: ${new Date().toISOString()}
 */
`);

        // Import engine files
        sections.push(`import BaseEngine from '${engine.baseEngine.replace(/\\/g, '/')}';`);
        sections.push(`import Engine from '${engine.engine.replace(/\\/g, '/')}';`);
        sections.push('');

        // Export
        sections.push('window.Engine = Engine;');
        sections.push('window.BaseEngine = BaseEngine;');
        sections.push('');
        sections.push('export { BaseEngine, Engine };');
        sections.push('export default Engine;');

        const entryPath = path.join(this.tempDir, 'engine-entry.js');
        fs.writeFileSync(entryPath, sections.join('\n'), 'utf8');
        console.log(`✅ Generated engine entry: ${entryPath}`);

        return entryPath;
    }

    /**
     * Generate combined entry point (engine + game in one file)
     */
    generateCombinedEntry() {
        // First generate engine and client entries
        const enginePath = this.generateEngineEntry();
        const clientPath = this.generateClientEntry();

        const sections = [];

        // Header
        sections.push(`/**
 * GUTS Combined Bundle (Engine + Game)
 * Generated: ${new Date().toISOString()}
 * Project: ${this.buildConfig.projectName}
 */
`);

        // Import engine entry first (this sets up Engine, BaseEngine)
        sections.push(`import './engine-entry.js';`);
        sections.push('');

        // Then import game entry (this sets up all game classes and COMPILED_GAME)
        sections.push(`import COMPILED_GAME from './client-entry.js';`);
        sections.push('');

        // Re-export for consistency
        sections.push('export default COMPILED_GAME;');

        const entryPath = path.join(this.tempDir, 'combined-entry.js');
        fs.writeFileSync(entryPath, sections.join('\n'), 'utf8');
        console.log(`✅ Generated combined entry: ${entryPath}`);

        return entryPath;
    }

    /**
     * Generate all entry points
     */
    generateAll() {
        this.ensureTempDir();

        return {
            client: this.generateClientEntry(),
            server: this.generateServerEntry(),
            editor: this.generateEditorEntry(),
            engine: this.generateEngineEntry(),
            combined: this.generateCombinedEntry()
        };
    }
}

module.exports = EntryGenerator;
