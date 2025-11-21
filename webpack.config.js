/**
 * Webpack Configuration for GUTS Game Engine
 * Dynamically builds client and server bundles based on project configuration
 */

const path = require('path');
const webpack = require('webpack');
const ConfigParser = require('./build/config-parser');
const EntryGenerator = require('./build/entry-generator');

// Get project name from command line or environment
const projectName = process.env.PROJECT_NAME || 'TurnBasedWarfare';
const mode = process.env.NODE_ENV || 'development';
const isProduction = mode === 'production';

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

// Base webpack configuration
const baseConfig = {
    mode: mode,
    devtool: isProduction ? 'source-map' : 'eval-source-map',
    resolve: {
        extensions: ['.js', '.json'],
        alias: {
            '@engine': path.resolve(__dirname, 'engine'),
            '@global': path.resolve(__dirname, 'global'),
            '@project': path.resolve(__dirname, 'projects', projectName),
            '@scripts': path.resolve(__dirname, 'projects', projectName, 'scripts', 'Scripts'),
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
        game: entries.client,
        engine: entries.engine
    },
    output: {
        path: clientOutput,
        filename: '[name].js',
        library: {
            name: 'GUTS',
            type: 'umd',
            export: 'default'
        },
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

// Export configurations
const configs = [clientConfig];
if (serverConfig) {
    configs.push(serverConfig);
}

module.exports = configs;
