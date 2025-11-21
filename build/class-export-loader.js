/**
 * Webpack loader that automatically exports classes from files that don't have explicit exports
 * This handles legacy GUTS files that were designed for browser globals
 */

module.exports = function(source) {
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

    // Check if the file already has exports
    const hasExports = /module\.exports|exports\.|export\s+(default|{|class|const|function)/.test(source);

    let exportCode = '\n\n// Auto-generated exports\n';

    if (isServerBundle) {
        // For server bundles, only add exports if they don't exist
        if (hasExports) {
            return source;
        }

        // CommonJS exports for server
        exportCode += 'if (typeof module !== \'undefined\' && module.exports) {\n';
        const mainClass = classNames[classNames.length - 1];
        exportCode += `  module.exports = ${mainClass};\n`;
        classNames.forEach(className => {
            exportCode += `  module.exports.${className} = ${className};\n`;
        });
        exportCode += '}\n';
    } else {
        // For client bundles, ALWAYS assign to window.GUTS
        // This ensures classes are available for inheritance before other modules are evaluated
        exportCode += 'if (typeof window !== \'undefined\' && window.GUTS) {\n';
        classNames.forEach(className => {
            exportCode += `  window.GUTS.${className} = ${className};\n`;
        });
        exportCode += '}\n';

        // If the file doesn't have exports, add them
        if (!hasExports) {
            exportCode += '\n';
            exportCode += 'if (typeof exports !== \'undefined\') {\n';
            const mainClass = classNames[classNames.length - 1];
            exportCode += `  exports.default = ${mainClass};\n`;
            classNames.forEach(className => {
                exportCode += `  exports.${className} = ${className};\n`;
            });
            exportCode += '}\n';
        }
    }

    return source + exportCode;
};
