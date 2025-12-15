/**
 * CallLogger - Logs game.call() invocations for debugging and analysis
 *
 * Stores calls in a circular buffer to avoid memory issues.
 * Provides query methods to analyze call patterns.
 */
class CallLogger {
    constructor(maxEntries = 10000) {
        this.maxEntries = maxEntries;
        this.entries = [];
        this.enabled = false;
        this.filterFunctions = null; // Set to array of function names to only log those
        this.excludeFunctions = new Set(['getEnums', 'getReverseEnums', 'getUnitTypeDef', 'getComponentSchema']); // High-frequency calls to exclude by default
    }

    /**
     * Enable logging
     */
    enable() {
        this.enabled = true;
        this.entries = [];
    }

    /**
     * Disable logging
     */
    disable() {
        this.enabled = false;
    }

    /**
     * Clear all logged entries
     */
    clear() {
        this.entries = [];
    }

    /**
     * Set filter to only log specific functions
     * @param {string[]} functionNames - Array of function names to log, or null for all
     */
    setFilter(functionNames) {
        this.filterFunctions = functionNames ? new Set(functionNames) : null;
    }

    /**
     * Set functions to exclude from logging
     * @param {string[]} functionNames - Array of function names to exclude
     */
    setExclude(functionNames) {
        this.excludeFunctions = new Set(functionNames);
    }

    /**
     * Log a call
     * @param {string} key - Function name
     * @param {any[]} args - Arguments passed
     * @param {any} result - Return value
     * @param {number} gameTime - Current game time
     */
    log(key, args, result, gameTime) {
        if (!this.enabled) return;
        if (this.excludeFunctions.has(key)) return;
        if (this.filterFunctions && !this.filterFunctions.has(key)) return;

        const entry = {
            time: gameTime,
            key,
            args: this._cloneArgs(args),
            result: this._cloneResult(result),
            timestamp: Date.now()
        };

        this.entries.push(entry);

        // Circular buffer - remove oldest entries when full
        if (this.entries.length > this.maxEntries) {
            this.entries.shift();
        }
    }

    /**
     * Clone arguments for storage (shallow clone to avoid circular refs)
     */
    _cloneArgs(args) {
        return args.map(arg => {
            if (arg === null || arg === undefined) return arg;
            if (typeof arg === 'object') {
                try {
                    // For simple objects, create a shallow copy
                    if (Array.isArray(arg)) {
                        return [...arg];
                    }
                    return { ...arg };
                } catch (e) {
                    return '[Object]';
                }
            }
            return arg;
        });
    }

    /**
     * Clone result for storage
     */
    _cloneResult(result) {
        if (result === null || result === undefined) return result;
        if (typeof result === 'object') {
            try {
                if (Array.isArray(result)) {
                    return `[Array(${result.length})]`;
                }
                return '[Object]';
            } catch (e) {
                return '[Object]';
            }
        }
        return result;
    }

    // ==================== QUERY METHODS ====================

    /**
     * Get all entries
     */
    all() {
        return this.entries;
    }

    /**
     * Get entries for a specific function
     * @param {string} functionName
     */
    forFunction(functionName) {
        return this.entries.filter(e => e.key === functionName);
    }

    /**
     * Get entries within a time range
     * @param {number} startTime - Game time start
     * @param {number} endTime - Game time end
     */
    inTimeRange(startTime, endTime) {
        return this.entries.filter(e => e.time >= startTime && e.time <= endTime);
    }

    /**
     * Get entries where an argument matches a value
     * @param {number} argIndex - Index of argument to check
     * @param {any} value - Value to match
     */
    whereArg(argIndex, value) {
        return this.entries.filter(e => e.args[argIndex] === value);
    }

    /**
     * Get entries where first argument (often entityId) matches
     * @param {number} entityId
     */
    forEntity(entityId) {
        return this.entries.filter(e => e.args[0] === entityId);
    }

    /**
     * Count calls per function
     */
    countByFunction() {
        const counts = {};
        for (const entry of this.entries) {
            counts[entry.key] = (counts[entry.key] || 0) + 1;
        }
        // Sort by count descending
        return Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .reduce((obj, [k, v]) => { obj[k] = v; return obj; }, {});
    }

    /**
     * Get unique function names called
     */
    functions() {
        return [...new Set(this.entries.map(e => e.key))];
    }

    /**
     * Get the last N entries
     * @param {number} n
     */
    last(n = 10) {
        return this.entries.slice(-n);
    }

    /**
     * Get the first N entries
     * @param {number} n
     */
    first(n = 10) {
        return this.entries.slice(0, n);
    }

    /**
     * Search entries where function name contains string
     * @param {string} substring
     */
    search(substring) {
        const lower = substring.toLowerCase();
        return this.entries.filter(e => e.key.toLowerCase().includes(lower));
    }

    /**
     * Get call frequency per game second
     */
    callsPerSecond() {
        if (this.entries.length === 0) return {};

        const bySecond = {};
        for (const entry of this.entries) {
            const second = Math.floor(entry.time);
            bySecond[second] = (bySecond[second] || 0) + 1;
        }
        return bySecond;
    }

    /**
     * Get a summary of logging state
     */
    summary() {
        return {
            enabled: this.enabled,
            entryCount: this.entries.length,
            maxEntries: this.maxEntries,
            functions: this.functions().length,
            timeRange: this.entries.length > 0
                ? { start: this.entries[0].time, end: this.entries[this.entries.length - 1].time }
                : null,
            topCalls: Object.entries(this.countByFunction()).slice(0, 10)
        };
    }

    /**
     * Print a formatted log to console
     * @param {object[]} entries - Entries to print (defaults to last 20)
     */
    print(entries = null) {
        const toPrint = entries || this.last(20);
        console.table(toPrint.map(e => ({
            time: e.time?.toFixed(3),
            function: e.key,
            args: JSON.stringify(e.args).substring(0, 60),
            result: e.result
        })));
    }

    /**
     * Print help information about how to use the CallLogger
     */
    help() {
        console.log(`
╔══════════════════════════════════════════════════════════════════╗
║                      CALL LOGGER HELP                            ║
╚══════════════════════════════════════════════════════════════════╝

SETUP
─────
  game.callLogger.enable()      Start logging calls
  game.callLogger.disable()     Stop logging calls
  game.callLogger.clear()       Clear all logged entries

FILTERING
─────────
  game.callLogger.setFilter(['fn1', 'fn2'])   Only log these functions
  game.callLogger.setFilter(null)             Log all functions
  game.callLogger.setExclude(['fn1'])         Exclude these from logging

QUERY METHODS
─────────────
  .all()                        Get all logged entries
  .last(n)                      Get last n entries (default 10)
  .first(n)                     Get first n entries (default 10)
  .forFunction('damage')        Get calls to specific function
  .forEntity(123)               Get calls where first arg is 123
  .search('squad')              Search function names containing text
  .inTimeRange(5.0, 10.0)       Get calls between game times
  .whereArg(1, 'value')         Get calls where arg[1] equals value

ANALYSIS
────────
  .countByFunction()            Count calls per function (sorted)
  .functions()                  List unique function names called
  .callsPerSecond()             Call frequency by game second
  .summary()                    Overview stats

OUTPUT
──────
  .print()                      Print last 20 calls as table
  .print(entries)               Print specific entries as table

EXAMPLES
────────
  // Start logging, play game, then analyze
  game.callLogger.enable()
  // ... play ...
  game.callLogger.print()
  game.callLogger.countByFunction()

  // Find all damage-related calls
  game.callLogger.print(game.callLogger.search('damage'))

  // What happened to entity 42?
  game.callLogger.print(game.callLogger.forEntity(42))

  // Only log specific functions
  game.callLogger.setFilter(['applySquadTargetPosition', 'damage'])
  game.callLogger.enable()
`);
    }
}

GUTS.CallLogger = CallLogger;
