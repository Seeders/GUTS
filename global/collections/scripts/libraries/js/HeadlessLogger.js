/**
 * HeadlessLogger - Configurable logging utility for headless simulation
 *
 * Provides log levels to control verbosity during simulations:
 * - ERROR: Only critical errors
 * - WARN: Warnings and errors
 * - INFO: General information (default)
 * - DEBUG: Detailed debugging information
 * - TRACE: Very detailed trace information
 *
 * Usage:
 *   HeadlessLogger.setLevel('DEBUG');
 *   HeadlessLogger.info('HeadlessEngine', 'Initialized');
 *   HeadlessLogger.debug('HeadlessSimulation', 'Processing instruction', { type: 'PLACE_UNIT' });
 */

const LOG_LEVELS = {
    ERROR: 0,
    WARN: 1,
    INFO: 2,
    DEBUG: 3,
    TRACE: 4
};

class HeadlessLogger {
    static _level = LOG_LEVELS.INFO;
    static _enabled = true;
    static _timestamps = true;
    static _captureMode = false;
    static _capturedLogs = [];

    /**
     * Set the log level
     * @param {string|number} level - Log level name or number
     */
    static setLevel(level) {
        if (typeof level === 'string') {
            const upperLevel = level.toUpperCase();
            if (LOG_LEVELS[upperLevel] !== undefined) {
                this._level = LOG_LEVELS[upperLevel];
            } else {
                console.warn(`[HeadlessLogger] Unknown log level: ${level}. Using INFO.`);
                this._level = LOG_LEVELS.INFO;
            }
        } else if (typeof level === 'number') {
            this._level = Math.max(0, Math.min(4, level));
        }
    }

    /**
     * Get the current log level name
     * @returns {string}
     */
    static getLevel() {
        return Object.keys(LOG_LEVELS).find(key => LOG_LEVELS[key] === this._level) || 'INFO';
    }

    /**
     * Enable or disable logging
     * @param {boolean} enabled
     */
    static setEnabled(enabled) {
        this._enabled = enabled;
    }

    /**
     * Enable or disable timestamps
     * @param {boolean} enabled
     */
    static setTimestamps(enabled) {
        this._timestamps = enabled;
    }

    /**
     * Enable capture mode - logs are buffered instead of printed to console
     * Use this for batch simulations to capture logs to files
     * @param {boolean} enabled
     */
    static setCaptureMode(enabled) {
        this._captureMode = enabled;
        if (enabled) {
            this._capturedLogs = [];
        }
    }

    /**
     * Get captured logs and clear the buffer
     * @returns {string} All captured log lines joined with newlines
     */
    static getCapturedLogs() {
        const logs = this._capturedLogs.join('\n');
        this._capturedLogs = [];
        return logs;
    }

    /**
     * Clear captured logs without returning them
     */
    static clearCapturedLogs() {
        this._capturedLogs = [];
    }

    /**
     * Format a log message
     * @private
     */
    static _format(level, tag, message, data) {
        const timestamp = this._timestamps ? `[${new Date().toISOString()}] ` : '';
        const dataStr = data !== undefined ? ` ${JSON.stringify(data)}` : '';
        return `${timestamp}[${level}] [${tag}] ${message}${dataStr}`;
    }

    /**
     * Output a formatted message (to console or buffer)
     * @private
     */
    static _output(formattedMessage, consoleMethod = 'log') {
        if (this._captureMode) {
            this._capturedLogs.push(formattedMessage);
        } else {
            console[consoleMethod](formattedMessage);
        }
    }

    /**
     * Log at ERROR level
     * @param {string} tag - Component/system name
     * @param {string} message - Log message
     * @param {*} data - Optional data to log
     */
    static error(tag, message, data) {
        if (!this._enabled || this._level < LOG_LEVELS.ERROR) return;
        this._output(this._format('ERROR', tag, message, data), 'error');
    }

    /**
     * Log at WARN level
     * @param {string} tag - Component/system name
     * @param {string} message - Log message
     * @param {*} data - Optional data to log
     */
    static warn(tag, message, data) {
        if (!this._enabled || this._level < LOG_LEVELS.WARN) return;
        this._output(this._format('WARN', tag, message, data), 'warn');
    }

    /**
     * Log at INFO level
     * @param {string} tag - Component/system name
     * @param {string} message - Log message
     * @param {*} data - Optional data to log
     */
    static info(tag, message, data) {
        if (!this._enabled || this._level < LOG_LEVELS.INFO) return;
        this._output(this._format('INFO', tag, message, data), 'log');
    }

    /**
     * Log at DEBUG level
     * @param {string} tag - Component/system name
     * @param {string} message - Log message
     * @param {*} data - Optional data to log
     */
    static debug(tag, message, data) {
        if (!this._enabled || this._level < LOG_LEVELS.DEBUG) return;
        this._output(this._format('DEBUG', tag, message, data), 'log');
    }

    /**
     * Log at TRACE level
     * @param {string} tag - Component/system name
     * @param {string} message - Log message
     * @param {*} data - Optional data to log
     */
    static trace(tag, message, data) {
        if (!this._enabled || this._level < LOG_LEVELS.TRACE) return;
        this._output(this._format('TRACE', tag, message, data), 'log');
    }

    /**
     * Create a scoped logger for a specific tag
     * @param {string} tag - Component/system name
     * @returns {Object} Logger with bound tag
     */
    static createLogger(tag) {
        return {
            error: (message, data) => this.error(tag, message, data),
            warn: (message, data) => this.warn(tag, message, data),
            info: (message, data) => this.info(tag, message, data),
            debug: (message, data) => this.debug(tag, message, data),
            trace: (message, data) => this.trace(tag, message, data)
        };
    }
}

// Export log levels for external use
HeadlessLogger.LOG_LEVELS = LOG_LEVELS;

// Assign to global.GUTS for server
if (typeof global !== 'undefined') {
    if (!global.GUTS) global.GUTS = {};
    global.GUTS.HeadlessLogger = HeadlessLogger;
}

// ES6 exports for webpack bundling
export default HeadlessLogger;
export { HeadlessLogger, LOG_LEVELS };
