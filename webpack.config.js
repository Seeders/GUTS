/**
 * Webpack Configuration for GUTS Game Engine
 * Dynamically builds client and server bundles based on project configuration
 */

const path = require('path');
const webpack = require('webpack');
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');
const ConfigParser = require('./build/config-parser');
const EntryGenerator = require('./build/entry-generator');

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

// Output directories
const clientOutput = path.resolve(__dirname, 'projects', projectName, 'dist', 'client');
const serverOutput = path.resolve(__dirname, 'projects', projectName, 'dist', 'server');
const editorOutput = path.resolve(__dirname, 'dist');

// Base webpack configuration
const baseConfig = {
    mode: mode,
    devtool: isProduction ? 'source-map' : 'eval-source-map',
    resolve: {
        extensions: ['.js', '.json'],
        alias: {
            '@engine': path.resolve(__dirname, 'engine'),
            '@global': path.resolve(__dirname, 'global', 'collections'),
            '@project': path.resolve(__dirname, 'projects', projectName),
            // Ensure 'three' resolves to the npm package
            'three': path.resolve(__dirname, 'node_modules', 'three')
        }
    },
    module: {
        rules: [
            {
                test: /\.js$/,
                exclude: /node_modules/,
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
        splitChunks: false // Keep everything in one bundle for now
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
            languages: ['javascript', 'typescript', 'css', 'html', 'json'],
            features: ['!gotoSymbol']
        }),
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
if (editorConfig) {
    configs.push(editorConfig);
}

module.exports = configs;
