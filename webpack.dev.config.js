/**
 * Webpack Dev Server Configuration for GUTS Game Engine
 * Provides hot module replacement and live reload during development
 */

const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const ConfigParser = require('./build/config-parser');
const EntryGenerator = require('./build/entry-generator');

// Get project name from environment (required)
const projectName = process.env.PROJECT_NAME;

if (!projectName) {
    console.error('Error: PROJECT_NAME environment variable is required');
    console.error('Use: PROJECT_NAME=<project-name> npm run dev');
    process.exit(1);
}

console.log(`\n🔧 Dev Server for project: ${projectName}\n`);

// Parse project configuration
const parser = new ConfigParser(projectName);
const buildConfig = parser.generateBuildConfig();

// Generate entry points
const generator = new EntryGenerator(buildConfig);
const entries = generator.generateAll();

// Output directory
const clientOutput = path.resolve(__dirname, 'projects', projectName, 'dist', 'client');

module.exports = {
    mode: 'development',
    target: 'web',
    entry: {
        game: entries.client,
        engine: entries.engine
    },
    output: {
        path: clientOutput,
        filename: '[name].js',
        publicPath: '/'
    },
    devtool: 'eval-source-map',
    resolve: {
        extensions: ['.js', '.json'],
        alias: {
            '@engine': path.resolve(__dirname, 'engine'),
            '@global': path.resolve(__dirname, 'global'),
            '@project': path.resolve(__dirname, 'projects', projectName),
            '@scripts': path.resolve(__dirname, 'projects', projectName, 'scripts', 'Scripts')
        }
    },
    module: {
        rules: [
            {
                test: /\.js$/,
                exclude: /node_modules/,
                use: {
                    loader: 'babel-loader',
                    options: {
                        presets: [
                            ['@babel/preset-env', {
                                targets: {
                                    browsers: ['last 2 versions']
                                },
                                modules: false
                            }]
                        ],
                        plugins: [
                            '@babel/plugin-proposal-class-properties'
                        ]
                    }
                }
            }
        ]
    },
    plugins: [
        new webpack.DefinePlugin({
            'process.env.NODE_ENV': JSON.stringify('development'),
            'process.env.IS_CLIENT': JSON.stringify(true)
        }),
        new HtmlWebpackPlugin({
            template: path.join(clientOutput, 'index.html'),
            inject: true,
            chunks: ['engine', 'game']
        }),
        new webpack.HotModuleReplacementPlugin()
    ],
    devServer: {
        static: {
            directory: clientOutput,
            publicPath: '/'
        },
        hot: true,
        liveReload: true,
        port: 8080,
        open: true,
        compress: true,
        historyApiFallback: true,
        client: {
            logging: 'info',
            overlay: {
                errors: true,
                warnings: false
            },
            progress: true
        },
        headers: {
            'Access-Control-Allow-Origin': '*'
        },
        watchFiles: {
            paths: [
                `projects/${projectName}/scripts/**/*.js`,
                `global/libraries/**/*.js`,
                `engine/**/*.js`,
                `projects/${projectName}/config/**/*.json`
            ],
            options: {
                usePolling: false
            }
        }
    },
    optimization: {
        runtimeChunk: 'single',
        splitChunks: false
    },
    performance: {
        hints: false
    }
};
