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
            exports.push(`  ${moduleName}: ${exportValue}`);
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
        sections.push(`import ModuleManager from '${engine.moduleManager.replace(/\\/g, '/')}';`);
        sections.push(`import BaseEngine from '${engine.baseEngine.replace(/\\/g, '/')}';`);
        sections.push(`import Engine from '${engine.engine.replace(/\\/g, '/')}';`);
        sections.push('');

        globalExports.ModuleManager = 'ModuleManager';
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
                }
                sections.push(exports.join(',\n'));
                sections.push('};');
                sections.push('');
                globalExports[capitalized] = capitalized;
                classCollectionObjects[collectionName] = capitalized;
            }
        }

        // Create class registry (dynamic collections)
        sections.push('// ========== CLASS REGISTRY ==========');
        sections.push('const ClassRegistry = {');
        sections.push('  getManager: (name) => Managers[name],');
        sections.push('  getSystem: (name) => Systems[name],');
        sections.push('  getLibrary: (name) => Libraries[name],');

        // Add dynamic getters for each collection
        Object.entries(classCollectionObjects).forEach(([collectionName, varName]) => {
            const methodName = `get${varName}`;
            sections.push(`  ${methodName}: (name) => ${varName}[name],`);
        });

        sections.push('  getAllManagers: () => Managers,');
        sections.push('  getAllSystems: () => Systems,');
        sections.push('  getAllLibraries: () => Libraries,');

        // Add dynamic getAll methods for each collection
        const getAllEntries = Object.entries(classCollectionObjects);
        getAllEntries.forEach(([collectionName, varName], index) => {
            const methodName = `getAll${varName}`;
            const isLast = index === getAllEntries.length - 1;
            const comma = isLast ? '' : ',';
            sections.push(`  ${methodName}: () => ${varName}${comma}`);
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

        // Add dynamic collections
        Object.entries(classCollectionObjects).forEach(([collectionName, varName]) => {
            sections.push(`  ${collectionName}: ${varName},`);
        });

        sections.push('  classRegistry: ClassRegistry,');
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

            const varName = `${varPrefix}_${mod.fileName || mod.name}`;
            const requirePath = mod.path.replace(/\\/g, '/');

            // Require the module and extract the actual class from exports
            requires.push(`const ${varName}_module = require('${requirePath}');`);
            requires.push(`const ${varName} = ${varName}_module.default || ${varName}_module.${moduleName} || ${varName}_module;`);
            // Immediately assign to global.GUTS so it's available for inheritance
            requires.push(`global.GUTS.${moduleName} = ${varName};`);
            exports.push(`  ${moduleName}: ${varName}`);
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

        // Create class registry (dynamic collections)
        sections.push('// ========== CLASS REGISTRY ==========');
        sections.push('const ClassRegistry = {');
        sections.push('  getManager: (name) => Managers[name],');
        sections.push('  getSystem: (name) => Systems[name],');
        sections.push('  getLibrary: (name) => Libraries[name],');

        // Add dynamic getters for each collection
        for (const [collectionName, varName] of Object.entries(classCollectionVars)) {
            const methodName = `get${varName}`;
            sections.push(`  ${methodName}: (name) => ${varName}[name],`);
        }

        // Remove trailing comma from last entry
        let lastClassRegLine = sections[sections.length - 1];
        sections[sections.length - 1] = lastClassRegLine.replace(/,$/, '');

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

        // Add dynamic collections
        for (const [collectionName, varName] of Object.entries(classCollectionVars)) {
            sections.push(`  ${collectionName}: ${varName},`);
        }

        sections.push('  classRegistry: ClassRegistry,');
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

        // Import libraries
        let libraryExports = [];
        if (editor.libraries && editor.libraries.length > 0) {
            sections.push('// Libraries');
            const { imports: libraryImports, exports: libExports } = this.generateImports(editor.libraries, 'lib');
            sections.push(...libraryImports);
            sections.push('');
            libraryExports = libExports;
        }

        // Create Libraries object
        sections.push('// Create global Libraries object');
        sections.push('const Libraries = {');
        if (libraryExports.length > 0) {
            sections.push(...libraryExports.map(exp => exp + ','));
        }
        sections.push('};');
        sections.push('');

        // Export to window.GUTS
        sections.push('// Make libraries available globally');
        sections.push('if (!window.GUTS) window.GUTS = {};');
        sections.push('Object.assign(window.GUTS, Libraries);');
        sections.push('');

        // Make editor engine classes and CodeMirror available globally
        sections.push('// Make editor engine classes and CodeMirror available globally');
        sections.push('window.CodeMirror = CodeMirror;');
        sections.push('window.FileSystemSyncService = FileSystemSyncService;');
        sections.push('window.EditorModel = EditorModel;');
        sections.push('window.EditorView = EditorView;');
        sections.push('window.EditorController = EditorController;');
        sections.push('');

        // Set up window.THREE with core library and addons
        sections.push('// Set up window.THREE with core library and addons');
        sections.push('Object.keys(Libraries).forEach(key => {');
        sections.push('  // Core THREE.js library');
        sections.push('  if (key === \'threejs\' || key === \'THREE\') {');
        sections.push('    window.THREE = Libraries[key];');
        sections.push('  }');
        sections.push('});');
        sections.push('');
        sections.push('// Add Three.js addons to window.THREE namespace');
        sections.push('if (!window.THREE) window.THREE = {};');
        sections.push('Object.keys(Libraries).forEach(key => {');
        sections.push('  if (key.startsWith(\'three_\')) {');
        sections.push('    // For three_ prefixed libraries, add as both namespaced AND flattened');
        sections.push('    const addon = Libraries[key];');
        sections.push('    const cleanName = key.replace(\'three_\', \'\');');
        sections.push('    window.THREE[cleanName] = addon; // Add as namespace');
        sections.push('    if (typeof addon === \'object\' && addon !== null) {');
        sections.push('      Object.assign(window.THREE, addon); // Also flatten for direct access');
        sections.push('    }');
        sections.push('  } else if (key === \'GLTFLoader\' || key === \'BufferGeometryUtils\' || key === \'OrbitControls\') {');
        sections.push('    // Other THREE.js libraries');
        sections.push('    window.THREE[key] = Libraries[key];');
        sections.push('  }');
        sections.push('});');
        sections.push('');

        // Export
        sections.push('export { Libraries, CodeMirror, FileSystemSyncService, EditorModel, EditorView, EditorController };');
        sections.push('export default Libraries;');

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
        sections.push(`import ModuleManager from '${engine.moduleManager.replace(/\\/g, '/')}';`);
        sections.push(`import BaseEngine from '${engine.baseEngine.replace(/\\/g, '/')}';`);
        sections.push(`import Engine from '${engine.engine.replace(/\\/g, '/')}';`);
        sections.push('');

        // Export
        sections.push('window.Engine = Engine;');
        sections.push('window.BaseEngine = BaseEngine;');
        sections.push('window.ModuleManager = ModuleManager;');
        sections.push('');
        sections.push('export { ModuleManager, BaseEngine, Engine };');
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

        // Import engine entry first (this sets up Engine, BaseEngine, ModuleManager)
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
