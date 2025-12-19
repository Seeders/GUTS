#!/usr/bin/env node

/**
 * Build Script for GUTS Editor Only
 * Builds only the editor.js bundle without client/server bundles
 */

const webpack = require('webpack');
const path = require('path');
const fs = require('fs');
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');
const ConfigParser = require('./config-parser');
const EntryGenerator = require('./entry-generator');

// Parse command line arguments
const args = process.argv.slice(2);

// Filter out flags to find project name
const nonFlagArgs = args.filter(arg => !arg.startsWith('-'));
const projectName = nonFlagArgs[0] || 'TurnBasedWarfare';

const watch = args.includes('--watch') || args.includes('-w');
const production = args.includes('--production') || args.includes('-p');

// Verify project exists
const projectPath = path.join(__dirname, '..', 'projects', projectName);
if (!fs.existsSync(projectPath)) {
    console.error(`Error: Project "${projectName}" not found at ${projectPath}`);
    process.exit(1);
}

// Set environment
process.env.PROJECT_NAME = projectName;
process.env.NODE_ENV = production ? 'production' : 'development';

const mode = process.env.NODE_ENV;
const isProduction = mode === 'production';

console.log(`
╔═══════════════════════════════════════════════════════════╗
║           GUTS Editor - Webpack Build                     ║
╟───────────────────────────────────────────────────────────╢
║  Project: ${projectName.padEnd(47)}║
║  Mode:    ${(production ? 'Production' : 'Development').padEnd(47)}║
║  Watch:   ${(watch ? 'Enabled' : 'Disabled').padEnd(47)}║
╚═══════════════════════════════════════════════════════════╝
`);

// Parse project configuration
const parser = new ConfigParser(projectName);
const buildConfig = parser.generateBuildConfig();

// Generate entry points
const generator = new EntryGenerator(buildConfig);
const entries = generator.generateAll();

if (!entries.editor) {
    console.error('Error: No editor entry point generated. Check editor.json config.');
    process.exit(1);
}

// Output directory
const editorOutput = path.resolve(__dirname, '..', 'dist');

// Base webpack configuration
const baseConfig = {
    mode: mode,
    devtool: isProduction ? 'source-map' : 'eval-source-map',
    resolve: {
        extensions: ['.js', '.json'],
        alias: {
            '@engine': path.resolve(__dirname, '..', 'engine'),
            '@global': path.resolve(__dirname, '..', 'global', 'collections'),
            '@project': path.resolve(__dirname, '..', 'projects', projectName),
            'three': path.resolve(__dirname, '..', 'node_modules', 'three')
        }
    },
    performance: {
        hints: false
    }
};

// Editor configuration
const editorConfig = {
    ...baseConfig,
    name: 'editor',
    target: 'web',
    entry: {
        editor: entries.editor
    },
    output: {
        path: editorOutput,
        filename: '[name].js',
        globalObject: 'window',
        publicPath: '/dist/'
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
                        loader: path.resolve(__dirname, 'class-export-loader.js')
                    }
                ]
            },
            {
                test: /\.html$/,
                type: 'asset/source'
            },
            {
                test: /\.css$/,
                use: ['style-loader', 'css-loader']
            },
            {
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
};

// Create compiler
const compiler = webpack(editorConfig);

// Statistics configuration
const statsConfig = {
    colors: true,
    modules: false,
    children: false,
    chunks: false,
    chunkModules: false,
    entrypoints: true,
    assets: true,
    errors: true,
    warnings: true
};

if (watch) {
    console.log('👀 Watching for changes...\n');
    compiler.watch({
        aggregateTimeout: 300,
        poll: undefined,
        ignored: /node_modules/
    }, (err, stats) => {
        if (err) {
            console.error('❌ Webpack error:', err);
            return;
        }
        console.log(stats.toString(statsConfig));
        console.log('\n✅ Editor rebuild complete. Waiting for changes...\n');
    });
} else {
    compiler.run((err, stats) => {
        if (err) {
            console.error('❌ Webpack error:', err);
            process.exit(1);
        }

        console.log(stats.toString(statsConfig));

        if (stats.hasErrors()) {
            console.error('\n❌ Build failed with errors');
            process.exit(1);
        }

        console.log('\n✅ Editor build complete!');
        console.log(`   Output: ${editorOutput}/editor.js`);

        compiler.close((closeErr) => {
            if (closeErr) {
                console.error('Error closing compiler:', closeErr);
            }
        });
    });
}
