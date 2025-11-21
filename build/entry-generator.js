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

            const varName = `${varPrefix}_${mod.fileName || mod.name}`;
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

            // Three.js and its addons use named exports, need namespace import
            if (moduleName === 'THREE' || mod.name === 'threejs') {
                importStatement = `import * as ${varName} from '${importPath}';`;
            }
            // Three.js addons (GLTFLoader, OrbitControls, EffectComposer, etc.) export named classes
            else if (mod.name && (
                mod.name.startsWith('three_') ||
                mod.name.includes('GLTF') ||
                mod.name.includes('Orbit') ||
                mod.name.includes('Effect') ||
                mod.name.includes('Pass') ||
                mod.name.includes('Skeleton') ||
                mod.name.includes('MeshBVH') ||
                importPath.includes('/three/examples/jsm/') ||
                importPath.includes('three_')
            )) {
                // These modules export specific classes, use namespace import
                importStatement = `import * as ${varName} from '${importPath}';`;
                // Try to extract the specific class if requireName exists, with fallback to namespace
                if (mod.requireName && mod.requireName !== mod.fileName && mod.requireName !== mod.name) {
                    // Use fallback: try .moduleName first, fall back to whole namespace
                    exportValue = `(${varName}.${moduleName} || ${varName})`;
                } else {
                    // Export the whole namespace (for modules like three_MeshBVH that export multiple things)
                    exportValue = `${varName}`;
                }
            }
            // Standard default import for other modules
            else {
                importStatement = `import ${varName} from '${importPath}';`;
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

        // Import abilities
        if (client.abilities.length > 0) {
            sections.push('// ========== ABILITIES ==========');
            const { imports, exports } = this.generateImports(client.abilities, 'ability');
            sections.push(...imports);
            sections.push('');
            sections.push('const Abilities = {');
            sections.push(exports.join(',\n'));
            sections.push('};');
            sections.push('');
            globalExports.Abilities = 'Abilities';
        }

        // Create class registry
        sections.push('// ========== CLASS REGISTRY ==========');
        sections.push('const ClassRegistry = {');
        sections.push('  getManager: (name) => Managers[name],');
        sections.push('  getSystem: (name) => Systems[name],');
        sections.push('  getLibrary: (name) => Libraries[name],');
        sections.push('  getAbility: (name) => Abilities[name],');
        sections.push('  getAllManagers: () => Managers,');
        sections.push('  getAllSystems: () => Systems,');
        sections.push('  getAllLibraries: () => Libraries,');
        sections.push('  getAllAbilities: () => Abilities');
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
        sections.push('    if (key.startsWith(\'three_\') || [\'OrbitControls\', \'GLTFLoader\', \'EffectComposer\', \'OutputPass\', \'RenderPixelatedPass\', \'SkeletonUtils\'].includes(key)) {');
        sections.push('      const addon = Libraries[key];');
        sections.push('      if (typeof addon === \'object\' && addon !== null) {');
        sections.push('        // If it\'s a namespace with multiple exports, merge them');
        sections.push('        Object.assign(window.THREE, addon);');
        sections.push('      } else {');
        sections.push('        // If it\'s a single class, add it by name');
        sections.push('        window.THREE[key] = addon;');
        sections.push('      }');
        sections.push('    }');
        sections.push('  });');
        sections.push('}');
        sections.push('');
        sections.push('// Also expose managers, systems, abilities in GUTS namespace');
        sections.push('Object.assign(window.GUTS, {');
        sections.push('  managers: Managers,');
        sections.push('  systems: Systems,');
        sections.push('  abilities: Abilities');
        sections.push('});');
        sections.push('');
        sections.push('// Setup COMPILED_GAME namespace');
        sections.push('window.COMPILED_GAME = {');
        sections.push('  ready: Promise.resolve(),');
        sections.push('  initialized: false,');
        sections.push('  libraryClasses: Libraries,');
        sections.push('  managers: Managers,');
        sections.push('  systems: Systems,');
        sections.push('  abilities: Abilities,');
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
        sections.push('// Setup app.appClasses for abilities and other dynamic classes');
        sections.push('if (!global.GUTS.app) global.GUTS.app = {};');
        sections.push('if (!global.GUTS.app.appClasses) global.GUTS.app.appClasses = {};');
        sections.push('');

        // Require libraries (synchronous, happens in order)
        if (server.libraries.length > 0) {
            sections.push('// ========== LIBRARIES ==========');
            const { requires, exports } = this.generateCommonJSImports(server.libraries, 'lib');
            sections.push(...requires);
            sections.push('');
            sections.push('const Libraries = {');
            sections.push(exports.join(',\n'));
            sections.push('};');
            sections.push('');
            sections.push('// Make libraries available IMMEDIATELY in global.GUTS');
            sections.push('Object.assign(global.GUTS, Libraries);');
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

        // Require abilities
        if (server.abilities.length > 0) {
            sections.push('// ========== ABILITIES ==========');

            // Separate BaseAbility from other abilities
            const baseAbility = server.abilities.find(a =>
                (a.name === 'BaseAbility' || a.fileName === 'BaseAbility')
            );
            const otherAbilities = server.abilities.filter(a =>
                !(a.name === 'BaseAbility' || a.fileName === 'BaseAbility')
            );

            // Require BaseAbility first and register it immediately
            if (baseAbility) {
                const varName = `ability_BaseAbility`;
                const requirePath = baseAbility.path.replace(/\\/g, '/');
                sections.push(`// Require BaseAbility first so other abilities can extend from it`);
                sections.push(`const ${varName}_module = require('${requirePath}');`);
                sections.push(`const ${varName} = ${varName}_module.default || ${varName}_module.BaseAbility || ${varName}_module;`);
                sections.push(`global.GUTS.app.appClasses['BaseAbility'] = ${varName};`);
                sections.push('');
            }

            // Now require all other abilities
            const { requires, exports } = this.generateCommonJSImports(otherAbilities, 'ability');
            sections.push(...requires);
            sections.push('');

            // Build the Abilities object
            sections.push('const Abilities = {');
            if (baseAbility) {
                sections.push('  BaseAbility: ability_BaseAbility,');
            }
            sections.push(exports.join(',\n'));
            sections.push('};');
            sections.push('');

            // Make remaining abilities available in global.GUTS.app.appClasses
            sections.push('// Make all abilities available in global.GUTS.app.appClasses');
            sections.push('Object.assign(global.GUTS.app.appClasses, Abilities);');
            sections.push('');
        }

        // Create class registry
        sections.push('// ========== CLASS REGISTRY ==========');
        sections.push('const ClassRegistry = {');
        sections.push('  getManager: (name) => Managers[name],');
        sections.push('  getSystem: (name) => Systems[name],');
        sections.push('  getLibrary: (name) => Libraries[name],');
        sections.push('  getAbility: (name) => Abilities[name]');
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
        sections.push('  abilities: Abilities,');
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
        sections.push('global.GUTS.abilities = Abilities;');
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
     * Generate all entry points
     */
    generateAll() {
        this.ensureTempDir();

        return {
            client: this.generateClientEntry(),
            server: this.generateServerEntry(),
            engine: this.generateEngineEntry()
        };
    }
}

module.exports = EntryGenerator;
