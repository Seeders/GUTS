/**
 * Configuration Parser for GUTS Webpack Build
 * Parses project config JSON and generates entry points for webpack
 */

const fs = require('fs');
const path = require('path');

class ConfigParser {
    constructor(projectName) {
        this.projectName = projectName;
        this.projectRoot = path.join(__dirname, '..', 'projects', projectName);
        this.configPath = path.join(this.projectRoot, 'config', `${projectName.toUpperCase()}.json`);
        this.config = null;
    }

    loadConfig() {
        if (!fs.existsSync(this.configPath)) {
            throw new Error(`Config not found: ${this.configPath}`);
        }

        const configContent = fs.readFileSync(this.configPath, 'utf8');
        this.config = JSON.parse(configContent);
        console.log(`✅ Loaded config for ${this.projectName}`);
        return this.config;
    }

    /**
     * Get library file paths from library names
     */
    getLibraryPaths(libraryNames) {
        const paths = [];
        const libraries = this.config.objectTypes.libraries || {};

        for (const libName of libraryNames) {
            const lib = libraries[libName];
            if (!lib) {
                console.warn(`⚠️ Library not found: ${libName}`);
                continue;
            }

            // Skip external CDN libraries (href)
            if (lib.href) {
                console.log(`⚠️ Skipping external library: ${libName} (${lib.href})`);
                continue;
            }

            if (lib.filePath) {
                // Convert absolute path to relative from project root
                const absolutePath = path.join(__dirname, '..', lib.filePath);
                if (fs.existsSync(absolutePath)) {
                    paths.push({
                        name: libName,
                        path: absolutePath,
                        isModule: lib.isModule || false,
                        requireName: lib.requireName || lib.fileName || libName,
                        windowContext: lib.windowContext
                    });
                } else {
                    console.warn(`⚠️ Library file not found: ${absolutePath}`);
                }
            }
        }

        return paths;
    }

    /**
     * Get script file paths for a collection (managers, systems, etc.)
     */
    getScriptPaths(collectionName, scriptNames) {
        const paths = [];
        const collection = this.config.objectTypes[collectionName] || {};

        for (const scriptName of scriptNames) {
            const script = collection[scriptName];
            if (!script) {
                console.warn(`⚠️ ${collectionName} not found: ${scriptName}`);
                continue;
            }

            if (script.filePath) {
                const absolutePath = path.join(__dirname, '..', script.filePath);
                if (fs.existsSync(absolutePath)) {
                    paths.push({
                        name: scriptName,
                        path: absolutePath,
                        fileName: script.fileName || scriptName
                    });
                } else {
                    console.warn(`⚠️ Script file not found: ${absolutePath}`);
                }
            }
        }

        return paths;
    }

    /**
     * Get all scripts for a scene based on its managers and systems
     */
    getSceneScripts(sceneName) {
        const scenes = this.config.objectTypes.scenes || {};
        const scene = scenes[sceneName];

        if (!scene || !scene.sceneData || !scene.sceneData[0]) {
            console.warn(`⚠️ Scene not found or empty: ${sceneName}`);
            return { managers: [], systems: [], classes: [] };
        }

        const sceneData = scene.sceneData[0];
        const managerNames = (sceneData.managers || []).map(m => m.type);
        const systemNames = (sceneData.systems || []).map(s => s.type);
        const classCollections = sceneData.classes || [];

        return {
            managers: this.getScriptPaths('managers', managerNames),
            systems: this.getScriptPaths('systems', systemNames),
            classes: classCollections
        };
    }

    /**
     * Get all class files from a collection (e.g., all abilities)
     */
    getAllClassesFromCollection(collectionName) {
        const collection = this.config.objectTypes[collectionName] || {};
        const classNames = Object.keys(collection);
        return this.getScriptPaths(collectionName, classNames);
    }

    /**
     * Generate client entry point data
     */
    getClientEntry() {
        const gameConfig = this.config.objectTypes.configs?.game;
        if (!gameConfig) {
            throw new Error('Game config not found');
        }

        const clientLibraries = this.getLibraryPaths(gameConfig.libraries || []);
        const clientScripts = this.getSceneScripts('client');

        // Get all abilities if referenced in scene
        const abilities = [];
        for (const classRef of clientScripts.classes) {
            if (classRef.collection === 'abilities') {
                abilities.push(...this.getAllClassesFromCollection('abilities'));
            }
        }

        return {
            libraries: clientLibraries,
            managers: clientScripts.managers,
            systems: clientScripts.systems,
            abilities: abilities,
            config: gameConfig
        };
    }

    /**
     * Generate server entry point data
     */
    getServerEntry() {
        const serverConfig = this.config.objectTypes.configs?.server;
        if (!serverConfig) {
            console.warn('⚠️ No server config found');
            return null;
        }

        const serverLibraries = this.getLibraryPaths(serverConfig.libraries || []);
        const serverScripts = this.getSceneScripts('server');

        // Get all abilities if referenced in scene
        const abilities = [];
        for (const classRef of serverScripts.classes) {
            if (classRef.collection === 'abilities') {
                abilities.push(...this.getAllClassesFromCollection('abilities'));
            }
        }

        return {
            libraries: serverLibraries,
            managers: serverScripts.managers,
            systems: serverScripts.systems,
            abilities: abilities,
            config: serverConfig
        };
    }

    /**
     * Get engine files
     */
    getEnginePaths() {
        const engineDir = path.join(__dirname, '..', 'engine');
        return {
            moduleManager: path.join(engineDir, 'ModuleManager.js'),
            baseEngine: path.join(engineDir, 'BaseEngine.js'),
            engine: path.join(engineDir, 'Engine.js')
        };
    }

    /**
     * Generate complete build configuration
     */
    generateBuildConfig() {
        this.loadConfig();

        return {
            projectName: this.projectName,
            client: this.getClientEntry(),
            server: this.getServerEntry(),
            engine: this.getEnginePaths(),
            projectConfig: this.config.objectTypes.configs
        };
    }
}

module.exports = ConfigParser;
