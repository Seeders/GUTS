/**
 * Editor Integration for Webpack Builds
 * Provides API endpoint for editor to trigger webpack builds
 */

const { spawn } = require('child_process');
const path = require('path');

class WebpackEditorIntegration {
    constructor() {
        this.activeBuild = null;
        this.buildQueue = [];
    }

    /**
     * Trigger a webpack build for a project
     */
    async buildProject(projectName, options = {}) {
        const {
            production = false,
            watch = false
        } = options;

        // If a build is already running, queue this one
        if (this.activeBuild) {
            console.log(`⏳ Build already in progress, queuing ${projectName}...`);
            return new Promise((resolve, reject) => {
                this.buildQueue.push({ projectName, options, resolve, reject });
            });
        }

        return new Promise((resolve, reject) => {
            console.log(`\n🔨 Starting webpack build for ${projectName}...`);

            const buildScript = path.join(__dirname, 'build.js');
            const args = [buildScript, projectName];

            if (production) args.push('--production');
            if (watch) args.push('--watch');

            const build = spawn('node', args, {
                cwd: path.join(__dirname, '..'),
                env: {
                    ...process.env,
                    PROJECT_NAME: projectName,
                    NODE_ENV: production ? 'production' : 'development'
                }
            });

            this.activeBuild = {
                projectName,
                process: build,
                startTime: Date.now()
            };

            let stdout = '';
            let stderr = '';

            build.stdout.on('data', (data) => {
                const output = data.toString();
                stdout += output;
                console.log(output);
            });

            build.stderr.on('data', (data) => {
                const output = data.toString();
                stderr += output;
                console.error(output);
            });

            build.on('close', (code) => {
                const duration = ((Date.now() - this.activeBuild.startTime) / 1000).toFixed(2);
                this.activeBuild = null;

                if (code === 0) {
                    console.log(`✅ Webpack build completed in ${duration}s`);
                    resolve({
                        success: true,
                        projectName,
                        duration,
                        output: stdout
                    });
                } else {
                    console.error(`❌ Webpack build failed with code ${code}`);
                    reject({
                        success: false,
                        projectName,
                        duration,
                        error: stderr || stdout,
                        exitCode: code
                    });
                }

                // Process next queued build
                if (this.buildQueue.length > 0) {
                    const next = this.buildQueue.shift();
                    this.buildProject(next.projectName, next.options)
                        .then(next.resolve)
                        .catch(next.reject);
                }
            });

            build.on('error', (err) => {
                this.activeBuild = null;
                console.error('❌ Failed to start webpack build:', err);
                reject({
                    success: false,
                    projectName,
                    error: err.message
                });
            });
        });
    }

    /**
     * Trigger an editor-only webpack build
     */
    async buildEditor(projectName, options = {}) {
        const { production = false } = options;

        // If a build is already running, queue this one
        if (this.activeBuild) {
            console.log(`⏳ Build already in progress, queuing editor build...`);
            return new Promise((resolve, reject) => {
                this.buildQueue.push({ projectName, options, isEditor: true, resolve, reject });
            });
        }

        return new Promise((resolve, reject) => {
            console.log(`\n🔨 Starting editor webpack build...`);

            const buildScript = path.join(__dirname, 'build-editor.js');
            const args = [buildScript, projectName];

            if (production) args.push('--production');

            const build = spawn('node', args, {
                cwd: path.join(__dirname, '..'),
                env: {
                    ...process.env,
                    PROJECT_NAME: projectName,
                    NODE_ENV: production ? 'production' : 'development'
                }
            });

            this.activeBuild = {
                projectName: 'editor',
                process: build,
                startTime: Date.now()
            };

            let stdout = '';
            let stderr = '';

            build.stdout.on('data', (data) => {
                const output = data.toString();
                stdout += output;
                console.log(output);
            });

            build.stderr.on('data', (data) => {
                const output = data.toString();
                stderr += output;
                console.error(output);
            });

            build.on('close', (code) => {
                const duration = ((Date.now() - this.activeBuild.startTime) / 1000).toFixed(2);
                this.activeBuild = null;

                if (code === 0) {
                    console.log(`✅ Editor build completed in ${duration}s`);
                    resolve({
                        success: true,
                        projectName: 'editor',
                        duration,
                        output: stdout
                    });
                } else {
                    console.error(`❌ Editor build failed with code ${code}`);
                    reject({
                        success: false,
                        projectName: 'editor',
                        duration,
                        error: stderr || stdout,
                        exitCode: code
                    });
                }

                // Process next queued build
                if (this.buildQueue.length > 0) {
                    const next = this.buildQueue.shift();
                    const buildFn = next.isEditor ? this.buildEditor.bind(this) : this.buildProject.bind(this);
                    buildFn(next.projectName, next.options)
                        .then(next.resolve)
                        .catch(next.reject);
                }
            });

            build.on('error', (err) => {
                this.activeBuild = null;
                console.error('❌ Failed to start editor build:', err);
                reject({
                    success: false,
                    projectName: 'editor',
                    error: err.message
                });
            });
        });
    }

    /**
     * Setup Express routes for webpack builds
     */
    setupRoutes(app) {
        // Trigger webpack build
        app.post('/webpack-build', async (req, res) => {
            const { projectName, production = false } = req.body;

            if (!projectName) {
                return res.status(400).json({
                    success: false,
                    error: 'projectName is required'
                });
            }

            try {
                const result = await this.buildProject(projectName, { production });
                res.status(200).json(result);
            } catch (error) {
                res.status(500).json(error);
            }
        });

        // Get build status
        app.get('/webpack-build/status', (req, res) => {
            if (this.activeBuild) {
                res.json({
                    building: true,
                    projectName: this.activeBuild.projectName,
                    duration: ((Date.now() - this.activeBuild.startTime) / 1000).toFixed(2),
                    queued: this.buildQueue.length
                });
            } else {
                res.json({
                    building: false,
                    queued: this.buildQueue.length
                });
            }
        });

        console.log('✅ Webpack build endpoints registered:');
        console.log('   POST /webpack-build');
        console.log('   GET  /webpack-build/status');
    }
}

module.exports = WebpackEditorIntegration;
