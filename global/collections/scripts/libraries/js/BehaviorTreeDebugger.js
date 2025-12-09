/**
 * Behavior Tree Debugger
 * Tracks execution traces, state changes, and provides debugging utilities
 * for behavior tree evaluation.
 */
class BehaviorTreeDebugger {
    constructor(options = {}) {
        // Debug mode - when false, no traces are recorded
        this.enabled = options.enabled !== false;

        // Maximum traces to keep per entity (prevents memory bloat)
        this.maxTracesPerEntity = options.maxTracesPerEntity || 100;

        // Verbose console logging
        this.verboseLogging = options.verboseLogging || false;

        // Execution traces per entity: Map<entityId, Array<TraceEntry>>
        this.traces = new Map();

        // Current tick/frame counter
        this.currentTick = 0;

        // Listeners for trace events
        this.listeners = [];

        // Performance timing
        this.performanceData = new Map();
    }

    /**
     * Enable or disable debugging
     * @param {boolean} enabled
     */
    setEnabled(enabled) {
        this.enabled = enabled;
        if (!enabled) {
            this.clear();
        }
    }

    /**
     * Enable or disable verbose console logging
     * @param {boolean} verbose
     */
    setVerboseLogging(verbose) {
        this.verboseLogging = verbose;
    }

    /**
     * Increment the tick counter (call once per evaluation cycle)
     */
    tick() {
        this.currentTick++;
    }

    /**
     * Record the start of a tree evaluation
     * @param {string} entityId
     * @param {string} treeId
     * @returns {Object} trace context for recording subsequent events
     */
    beginEvaluation(entityId, treeId) {
        if (!this.enabled) return null;

        const startTime = performance.now();
        const trace = {
            tick: this.currentTick,
            timestamp: Date.now(),
            entityId,
            treeId,
            startTime,
            endTime: null,
            duration: null,
            nodes: [],
            result: null,
            stateSnapshot: null
        };

        if (this.verboseLogging) {
            console.log(`[BT Debug] Tick ${this.currentTick} | Entity ${entityId} | Evaluating ${treeId}`);
        }

        return trace;
    }

    /**
     * Record a node evaluation within a trace
     * @param {Object} trace - The trace context from beginEvaluation
     * @param {Object} nodeInfo - Information about the node
     */
    recordNode(trace, nodeInfo) {
        if (!this.enabled || !trace) return;

        const entry = {
            name: nodeInfo.name,
            type: nodeInfo.type || 'action', // 'action', 'tree', 'decorator', 'selector', 'sequence', 'parallel'
            index: nodeInfo.index,
            status: nodeInfo.status, // 'success', 'failure', 'running', 'skipped'
            reason: nodeInfo.reason || null, // Why this status (e.g., "condition failed", "already running")
            duration: nodeInfo.duration || null,
            meta: nodeInfo.meta || null,
            memory: nodeInfo.memory ? { ...nodeInfo.memory } : null
        };

        trace.nodes.push(entry);

        if (this.verboseLogging) {
            const statusIcon = this.getStatusIcon(entry.status);
            const indent = '  '.repeat(trace.nodes.length);
            console.log(`[BT Debug] ${indent}${statusIcon} ${entry.name} [${entry.status}]${entry.reason ? ` - ${entry.reason}` : ''}`);
        }
    }

    /**
     * Complete a tree evaluation trace
     * @param {Object} trace - The trace context
     * @param {Object} result - The evaluation result
     * @param {Object} stateSnapshot - Optional state snapshot (shared data, memory, etc.)
     */
    endEvaluation(trace, result, stateSnapshot = null) {
        if (!this.enabled || !trace) return;

        trace.endTime = performance.now();
        trace.duration = trace.endTime - trace.startTime;
        trace.result = result;
        trace.stateSnapshot = stateSnapshot;

        // Store the trace
        if (!this.traces.has(trace.entityId)) {
            this.traces.set(trace.entityId, []);
        }

        const entityTraces = this.traces.get(trace.entityId);
        entityTraces.push(trace);

        // Trim old traces if over limit
        while (entityTraces.length > this.maxTracesPerEntity) {
            entityTraces.shift();
        }

        // Update performance data
        this.updatePerformanceData(trace);

        // Notify listeners
        this.notifyListeners('trace', trace);

        if (this.verboseLogging) {
            const statusIcon = this.getStatusIcon(result?.status);
            console.log(`[BT Debug] ${statusIcon} Result: ${result?.action || 'none'} [${result?.status || 'null'}] (${trace.duration.toFixed(2)}ms)`);
            console.log('---');
        }
    }

    /**
     * Get status icon for console output
     * @private
     */
    getStatusIcon(status) {
        switch (status) {
            case 'success': return '\u2713'; // checkmark
            case 'failure': return '\u2717'; // x
            case 'running': return '\u27F3'; // rotating arrow
            case 'skipped': return '\u2192'; // right arrow
            default: return '\u25CB'; // circle
        }
    }

    /**
     * Update performance statistics
     * @private
     */
    updatePerformanceData(trace) {
        const key = `${trace.entityId}:${trace.treeId}`;

        if (!this.performanceData.has(key)) {
            this.performanceData.set(key, {
                entityId: trace.entityId,
                treeId: trace.treeId,
                evaluations: 0,
                totalTime: 0,
                minTime: Infinity,
                maxTime: 0,
                avgTime: 0,
                nodeStats: new Map()
            });
        }

        const perf = this.performanceData.get(key);
        perf.evaluations++;
        perf.totalTime += trace.duration;
        perf.minTime = Math.min(perf.minTime, trace.duration);
        perf.maxTime = Math.max(perf.maxTime, trace.duration);
        perf.avgTime = perf.totalTime / perf.evaluations;

        // Track per-node stats
        for (const node of trace.nodes) {
            if (node.duration !== null) {
                if (!perf.nodeStats.has(node.name)) {
                    perf.nodeStats.set(node.name, {
                        executions: 0,
                        totalTime: 0,
                        successCount: 0,
                        failureCount: 0,
                        runningCount: 0
                    });
                }
                const nodePerf = perf.nodeStats.get(node.name);
                nodePerf.executions++;
                nodePerf.totalTime += node.duration;
                if (node.status === 'success') nodePerf.successCount++;
                if (node.status === 'failure') nodePerf.failureCount++;
                if (node.status === 'running') nodePerf.runningCount++;
            }
        }
    }

    /**
     * Get all traces for an entity
     * @param {string} entityId
     * @returns {Array} traces
     */
    getTraces(entityId) {
        return this.traces.get(entityId) || [];
    }

    /**
     * Get the most recent trace for an entity
     * @param {string} entityId
     * @returns {Object|null} trace
     */
    getLastTrace(entityId) {
        const traces = this.traces.get(entityId);
        return traces && traces.length > 0 ? traces[traces.length - 1] : null;
    }

    /**
     * Get traces within a tick range
     * @param {string} entityId
     * @param {number} startTick
     * @param {number} endTick
     * @returns {Array} traces
     */
    getTracesInRange(entityId, startTick, endTick) {
        const traces = this.traces.get(entityId) || [];
        return traces.filter(t => t.tick >= startTick && t.tick <= endTick);
    }

    /**
     * Get performance data for an entity/tree combination
     * @param {string} entityId
     * @param {string} treeId
     * @returns {Object|null} performance data
     */
    getPerformanceData(entityId, treeId) {
        return this.performanceData.get(`${entityId}:${treeId}`) || null;
    }

    /**
     * Get all performance data
     * @returns {Map} all performance data
     */
    getAllPerformanceData() {
        return this.performanceData;
    }

    /**
     * Format a trace for display (returns a formatted string tree)
     * @param {Object} trace
     * @returns {string} formatted trace
     */
    formatTrace(trace) {
        if (!trace) return 'No trace data';

        const lines = [];
        lines.push(`Tick: ${trace.tick} | Entity: ${trace.entityId} | Tree: ${trace.treeId}`);
        lines.push(`Duration: ${trace.duration?.toFixed(2) || '?'}ms`);
        lines.push('');
        lines.push('Evaluation Path:');

        for (let i = 0; i < trace.nodes.length; i++) {
            const node = trace.nodes[i];
            const indent = '  ';
            const statusIcon = this.getStatusIcon(node.status);
            let line = `${indent}#${node.index + 1} ${statusIcon} ${node.name} [${node.status}]`;

            if (node.reason) {
                line += ` - ${node.reason}`;
            }
            if (node.duration !== null) {
                line += ` (${node.duration.toFixed(2)}ms)`;
            }
            lines.push(line);

            if (node.meta) {
                lines.push(`${indent}   Meta: ${JSON.stringify(node.meta)}`);
            }
        }

        lines.push('');
        if (trace.result) {
            lines.push(`Result: ${trace.result.action || 'none'} [${trace.result.status || 'null'}]`);
            if (trace.result.meta) {
                lines.push(`Result Meta: ${JSON.stringify(trace.result.meta)}`);
            }
        }

        if (trace.stateSnapshot) {
            lines.push('');
            lines.push('State Snapshot:');
            lines.push(JSON.stringify(trace.stateSnapshot, null, 2));
        }

        return lines.join('\n');
    }

    /**
     * Format performance data for display
     * @param {string} entityId
     * @param {string} treeId
     * @returns {string} formatted performance data
     */
    formatPerformance(entityId, treeId) {
        const perf = this.getPerformanceData(entityId, treeId);
        if (!perf) return 'No performance data';

        const lines = [];
        lines.push(`Performance: ${entityId} / ${treeId}`);
        lines.push(`Evaluations: ${perf.evaluations}`);
        lines.push(`Total Time: ${perf.totalTime.toFixed(2)}ms`);
        lines.push(`Avg Time: ${perf.avgTime.toFixed(2)}ms`);
        lines.push(`Min/Max: ${perf.minTime.toFixed(2)}ms / ${perf.maxTime.toFixed(2)}ms`);
        lines.push('');
        lines.push('Node Breakdown:');

        for (const [nodeName, stats] of perf.nodeStats) {
            const avgTime = stats.executions > 0 ? (stats.totalTime / stats.executions).toFixed(2) : 0;
            lines.push(`  ${nodeName}: ${stats.executions} executions, avg ${avgTime}ms`);
            lines.push(`    Success: ${stats.successCount}, Failure: ${stats.failureCount}, Running: ${stats.runningCount}`);
        }

        return lines.join('\n');
    }

    /**
     * Add a listener for debug events
     * @param {Function} listener - Called with (eventType, data)
     * @returns {Function} unsubscribe function
     */
    addListener(listener) {
        this.listeners.push(listener);
        return () => {
            const index = this.listeners.indexOf(listener);
            if (index > -1) {
                this.listeners.splice(index, 1);
            }
        };
    }

    /**
     * Notify all listeners of an event
     * @private
     */
    notifyListeners(eventType, data) {
        for (const listener of this.listeners) {
            try {
                listener(eventType, data);
            } catch (e) {
                console.error('Debug listener error:', e);
            }
        }
    }

    /**
     * Clear traces for an entity
     * @param {string} entityId
     */
    clearEntity(entityId) {
        this.traces.delete(entityId);

        // Clear performance data for this entity
        for (const key of this.performanceData.keys()) {
            if (key.startsWith(`${entityId}:`)) {
                this.performanceData.delete(key);
            }
        }
    }

    /**
     * Clear all debug data
     */
    clear() {
        this.traces.clear();
        this.performanceData.clear();
        this.currentTick = 0;
    }

    /**
     * Export all debug data as JSON
     * @returns {Object} exportable data
     */
    export() {
        const traces = {};
        for (const [entityId, entityTraces] of this.traces) {
            traces[entityId] = entityTraces;
        }

        const performance = {};
        for (const [key, perf] of this.performanceData) {
            performance[key] = {
                ...perf,
                nodeStats: Object.fromEntries(perf.nodeStats)
            };
        }

        return {
            enabled: this.enabled,
            currentTick: this.currentTick,
            traces,
            performance
        };
    }

    /**
     * Generate a summary report for all entities
     * @returns {string} summary report
     */
    generateReport() {
        const lines = [];
        lines.push('=== Behavior Tree Debug Report ===');
        lines.push(`Current Tick: ${this.currentTick}`);
        lines.push(`Entities Tracked: ${this.traces.size}`);
        lines.push('');

        for (const [entityId, traces] of this.traces) {
            lines.push(`Entity: ${entityId}`);
            lines.push(`  Total Traces: ${traces.length}`);

            if (traces.length > 0) {
                const lastTrace = traces[traces.length - 1];
                lines.push(`  Last Action: ${lastTrace.result?.action || 'none'}`);
                lines.push(`  Last Status: ${lastTrace.result?.status || 'null'}`);
            }

            // Add performance summary
            for (const [key, perf] of this.performanceData) {
                if (key.startsWith(`${entityId}:`)) {
                    lines.push(`  Avg Eval Time: ${perf.avgTime.toFixed(2)}ms`);
                }
            }
            lines.push('');
        }

        return lines.join('\n');
    }
}

// Export for use in both browser and Node.js environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BehaviorTreeDebugger;
}

// Also make available on GUTS global if it exists
if (typeof GUTS !== 'undefined') {
    GUTS.BehaviorTreeDebugger = BehaviorTreeDebugger;
}
