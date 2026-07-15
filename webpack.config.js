/**
 * Webpack Configuration for GUTS Game Engine
 * Dynamically builds client and server bundles based on project configuration
 */

const path = require('path');
const webpack = require('webpack');
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');
const ConfigParser = require('./build/config-parser');
const EntryGenerator = require('./build/entry-generator');
const { GUTS_ROOT, resolveProjectRoot, resolvePackageDir } = require('./build/paths');

// Get project name from environment (required - set by build.js)
const projectName = process.env.PROJECT_NAME;
const mode = process.env.NODE_ENV || 'development';
const isProduction = mode === 'production';

if (!projectName) {
    console.error('Error: PROJECT_NAME environment variable is required');
    console.error('Use: npm run build -- <project-name>');
    process.exit(1);
}

console.log(`\n🔧 Building project: ${projectName} (${mode} mode)\n`);

// Parse project configuration
const parser = new ConfigParser(projectName);
const buildConfig = parser.generateBuildConfig();

// Generate entry points
const generator = new EntryGenerator(buildConfig);
const entries = generator.generateAll();

// Project root: monorepo (projects/<name>) or external (GUTS_PROJECT_ROOT).
const projectRoot = resolveProjectRoot(projectName);

// Output directories
const clientOutput = path.join(projectRoot, 'dist', 'client');
const serverOutput = path.join(projectRoot, 'dist', 'server');
const headlessOutput = path.join(projectRoot, 'dist', 'headless');
// The Editor is shared framework tooling and always lives inside GUTS.
const editorOutput = path.resolve(GUTS_ROOT, 'projects', 'Editor', 'dist');

// Base webpack configuration
const baseConfig = {
    mode: mode,
    devtool: isProduction ? false : 'eval-source-map', // Source maps in dev, disabled in prod for memory
    resolve: {
        extensions: ['.js', '.json'],
        alias: {
            '@engine': path.resolve(GUTS_ROOT, 'engine'),
            '@global': path.resolve(GUTS_ROOT, 'global', 'collections'),
            '@project': projectRoot,
            // Ensure 'three' resolves to the npm package, wherever it is hoisted.
            'three': resolvePackageDir('three') || path.resolve(GUTS_ROOT, 'node_modules', 'three')
        }
    },
    // Loaders (babel-loader, etc.) live in GUTS's node_modules. When building an
    // external project the cwd is that project, so make webpack look here too.
    resolveLoader: {
        modules: [path.resolve(GUTS_ROOT, 'node_modules'), 'node_modules']
    },
    module: {
        rules: [
            {
                test: /\.js$/,
                // Skip node_modules, EXCEPT the GUTS framework's own sources. When
                // GUTS is installed as a dependency it lives at node_modules/guts/,
                // so engine/ and global/ would otherwise be excluded — and then the
                // class-export-loader never registers GUTS.Engine et al.
                exclude: (modulePath) => {
                    const p = modulePath.replace(/\\/g, '/');
                    const engineDir = path.join(GUTS_ROOT, 'engine').replace(/\\/g, '/');
                    const globalDir = path.join(GUTS_ROOT, 'global').replace(/\\/g, '/');
                    if (p.startsWith(engineDir) || p.startsWith(globalDir)) return false;
                    return /[\\/]node_modules[\\/]/.test(p);
                },
                use: [
                    {
                        loader: 'babel-loader',
                        options: {
                            presets: [
                                ['@babel/preset-env', {
                                    targets: {
                                        browsers: ['last 2 versions', 'not dead']
                                    },
                                    modules: false
                                }]
                            ],
                            plugins: [
                                '@babel/plugin-proposal-class-properties'
                            ]
                        }
                    },
                    {
                        // Custom loader to auto-export classes
                        loader: path.resolve(__dirname, 'build/class-export-loader.js')
                    }
                ]
            },
            {
                // Import HTML files as raw text
                test: /\.html$/,
                type: 'asset/source'
            },
            {
                // Import CSS files as raw text (not processed)
                test: /\.css$/,
                type: 'asset/source'
            }
        ]
    },
    performance: {
        hints: false
    }
};

// Client configuration
const clientConfig = {
    ...baseConfig,
    name: 'client',
    target: 'web',
    entry: {
        game: entries.combined
    },
    output: {
        path: clientOutput,
        filename: '[name].js',
        // No library wrapper - entries handle their own global assignments
        globalObject: 'window'
    },
    plugins: [
        new webpack.DefinePlugin({
            'process.env.NODE_ENV': JSON.stringify(mode),
            'process.env.IS_CLIENT': JSON.stringify(true),
            'process.env.IS_SERVER': JSON.stringify(false)
        }),
        new webpack.BannerPlugin({
            banner: `
// Setup globals for browser environment BEFORE any imports execute
if (typeof window !== 'undefined') {
    if (!window.GUTS) window.GUTS = {};
}
`,
            raw: true,
            entryOnly: true
        }),
        new webpack.BannerPlugin({
            banner: `GUTS Game Engine - Client Bundle
Project: ${projectName}
Built: ${new Date().toISOString()}
Mode: ${mode}`,
            entryOnly: true
        })
    ],
    optimization: {
        usedExports: true,
        minimize: isProduction,
        splitChunks: false
    }
};

// Server configuration (if exists)
const serverConfig = entries.server ? {
    ...baseConfig,
    name: 'server',
    target: 'node',
    entry: {
        game: entries.server
    },
    output: {
        path: serverOutput,
        filename: '[name].js',
        library: {
            type: 'commonjs2'
        }
    },
    externals: {
        // Exclude Node.js built-in modules
    },
    plugins: [
        new webpack.DefinePlugin({
            'process.env.NODE_ENV': JSON.stringify(mode),
            'process.env.IS_CLIENT': JSON.stringify(false),
            'process.env.IS_SERVER': JSON.stringify(true)
        }),
        new webpack.BannerPlugin({
            banner: `GUTS Game Engine - Server Bundle
Project: ${projectName}
Built: ${new Date().toISOString()}
Mode: ${mode}

IMPORTANT: This bundle expects global.GUTS to be set up before loading.
Set up in server_game.js before loading this bundle.`,
            entryOnly: true,
            raw: false
        }),
        new webpack.BannerPlugin({
            banner: `
// Setup globals for server environment
if (typeof global !== 'undefined') {
    if (!global.GUTS) global.GUTS = {};
    if (!global.window) global.window = global;
}
`,
            raw: true,
            entryOnly: true
        })
    ],
    optimization: {
        usedExports: true,
        minimize: isProduction
    }
} : null;

// Headless configuration (if exists)
const headlessConfig = entries.headless ? {
    ...baseConfig,
    name: 'headless',
    target: 'node',
    entry: {
        game: entries.headless
    },
    output: {
        path: headlessOutput,
        filename: '[name].js',
        library: {
            type: 'commonjs2'
        }
    },
    externals: {
        // Exclude Node.js built-in modules
    },
    plugins: [
        new webpack.DefinePlugin({
            'process.env.NODE_ENV': JSON.stringify(mode),
            'process.env.IS_CLIENT': JSON.stringify(false),
            'process.env.IS_SERVER': JSON.stringify(false),
            'process.env.IS_HEADLESS': JSON.stringify(true)
        }),
        new webpack.BannerPlugin({
            banner: `GUTS Game Engine - Headless Simulation Bundle
Project: ${projectName}
Built: ${new Date().toISOString()}
Mode: ${mode}

This bundle is for running headless game simulations without rendering.`,
            entryOnly: true,
            raw: false
        }),
        new webpack.BannerPlugin({
            banner: `
// Setup globals for headless environment
if (typeof global !== 'undefined') {
    if (!global.GUTS) global.GUTS = {};
    if (!global.window) global.window = global;
}
`,
            raw: true,
            entryOnly: true
        })
    ],
    optimization: {
        usedExports: true,
        minimize: isProduction
    }
} : null;

// Editor configuration (if exists)
const editorConfig = entries.editor ? {
    ...baseConfig,
    name: 'editor',
    target: 'web',
    entry: {
        editor: entries.editor
    },
    output: {
        path: editorOutput,
        filename: '[name].js',
        globalObject: 'window'
    },
    module: {
        rules: [
            // Include base rules EXCEPT the CSS rule (which uses asset/source)
            ...baseConfig.module.rules.filter(rule => !rule.test?.toString().includes('css')),
            {
                // Monaco and editor CSS should be injected into DOM
                test: /\.css$/,
                use: ['style-loader', 'css-loader']
            },
            {
                // Monaco editor requires TTF fonts
                test: /\.ttf$/,
                type: 'asset/resource'
            }
        ]
    },
    plugins: [
new MonacoWebpackPlugin({
            // JavaScript language support depends on TypeScript internally
            languages: ['javascript', 'typescript', 'css', 'html', 'json'],
            features: ['!gotoSymbol']
        }),
        // Exclude all basic-languages except javascript, typescript, css, html
        new webpack.NormalModuleReplacementPlugin(
            /monaco-editor[\\/]esm[\\/]vs[\\/]basic-languages[\\/](?!javascript|typescript|css|html|_).*[\\/].*\.js$/,
            require.resolve('./build/empty-module.js')
        ),
        new webpack.DefinePlugin({
            'process.env.NODE_ENV': JSON.stringify(mode),
            'process.env.IS_CLIENT': JSON.stringify(false),
            'process.env.IS_SERVER': JSON.stringify(false)
        }),
        new webpack.BannerPlugin({
            banner: `
// Setup globals for editor environment
if (typeof window !== 'undefined') {
    if (!window.GUTS) window.GUTS = {};
    if (!window.THREE) window.THREE = {};
}
`,
            raw: true,
            entryOnly: true
        }),
        new webpack.BannerPlugin({
            banner: `GUTS Editor Bundle
Project: ${projectName}
Built: ${new Date().toISOString()}
Mode: ${mode}`,
            entryOnly: true
        })
    ],
    optimization: {
        usedExports: true,
        minimize: isProduction,
        splitChunks: false
    }
} : null;

// Export configurations
const configs = [clientConfig];
if (serverConfig) {
    configs.push(serverConfig);
}
if (headlessConfig) {
    configs.push(headlessConfig);
}
if (editorConfig) {
    configs.push(editorConfig);
}

module.exports = configs;
