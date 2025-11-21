/**
 * Webpack loader that automatically exports classes from files that don't have explicit exports
 * This handles legacy GUTS files that were designed for browser globals
 */

module.exports = function(source) {
    // Check if the file already has exports
    const hasExports = /module\.exports|exports\.|export\s+(default|{|class|const|function)/.test(source);

    if (hasExports) {
        // File already has exports, return as-is
        return source;
    }

    // Extract class names from the source (only top-level class declarations)
    // Match: class ClassName { or class ClassName extends
    const classRegex = /^class\s+(\w+)(?:\s+extends|\s*\{)/gm;
    const classMatches = [...source.matchAll(classRegex)];

    if (!classMatches || classMatches.length === 0) {
        // No classes found, return as-is
        return source;
    }

    // Extract class names from capture groups
    const classNames = classMatches.map(match => match[1]);

    // Check the context to determine if we should use ES6 or CommonJS
    // For server bundles (using CommonJS), add conditional exports
    // For client bundles (using ES6), add ES6 exports
    const resourcePath = this.resourcePath || '';
    const isServerBundle = resourcePath.includes('.temp/server-entry');

    let exportCode = '\n\n// Auto-generated exports\n';

    if (isServerBundle) {
        // CommonJS exports for server
        exportCode += 'if (typeof module !== \'undefined\' && module.exports) {\n';
        const mainClass = classNames[classNames.length - 1];
        exportCode += `  module.exports = ${mainClass};\n`;
        classNames.forEach(className => {
            exportCode += `  module.exports.${className} = ${className};\n`;
        });
        exportCode += '}\n';
    } else {
        // ES6 exports for client, but make them conditional to avoid conflicts
        exportCode += 'if (typeof exports !== \'undefined\') {\n';
        const mainClass = classNames[classNames.length - 1];
        exportCode += `  exports.default = ${mainClass};\n`;
        classNames.forEach(className => {
            exportCode += `  exports.${className} = ${className};\n`;
        });
        exportCode += '}\n';
    }

    return source + exportCode;
};
