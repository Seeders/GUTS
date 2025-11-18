class PerformanceMonitor {
    constructor() {
        this.enabled = false;
        this.systemStats = new Map();
        this.frameStats = {
            fps: 0,
            frameTime: 0,
            lastFrameTime: performance.now()
        };
        this.history = new Map();
        this.historySize = 60; // Keep 60 frames of history

        // Memory tracking
        this.memorySupported = performance.memory !== undefined;

        // UI elements
        this.overlay = null;
        this.createOverlay();

        // Expose console API
        this.exposeConsoleAPI();
    }

    exposeConsoleAPI() {
        if (typeof window !== 'undefined') {
            window.PerformanceMonitor = {
                enable: () => this.enable(),
                disable: () => this.disable(),
                toggle: () => this.toggle(),
                reset: () => this.reset(),
                isEnabled: () => this.enabled,
                help: () => {
                    console.log('%c Performance Monitor Commands:', 'color: #00ff00; font-weight: bold');
                    console.log('%c PerformanceMonitor.enable()  %c - Enable the performance monitor', 'color: #00ffff', 'color: #ffffff');
                    console.log('%c PerformanceMonitor.disable() %c - Disable the performance monitor', 'color: #00ffff', 'color: #ffffff');
                    console.log('%c PerformanceMonitor.toggle()  %c - Toggle the performance monitor', 'color: #00ffff', 'color: #ffffff');
                    console.log('%c PerformanceMonitor.reset()   %c - Clear all performance history', 'color: #00ffff', 'color: #ffffff');
                    console.log('%c PerformanceMonitor.isEnabled() %c - Check if enabled', 'color: #00ffff', 'color: #ffffff');
                }
            };
            console.log('%c Performance Monitor loaded! %c Type PerformanceMonitor.help() for commands', 'color: #00ff00; font-weight: bold', 'color: #ffff00');
        }
    }

    enable() {
        this.enabled = true;
        if (this.overlay) {
            this.overlay.style.display = 'block';
        }
        console.log('%c✓ Performance Monitor enabled', 'color: #00ff00');
    }

    disable() {
        this.enabled = false;
        if (this.overlay) {
            this.overlay.style.display = 'none';
        }
        console.log('%c✓ Performance Monitor disabled', 'color: #ffaa00');
    }

    toggle() {
        if (this.enabled) {
            this.disable();
        } else {
            this.enable();
        }
    }

    startFrame() {
        if (!this.enabled) return;

        const now = performance.now();
        this.frameStats.frameTime = now - this.frameStats.lastFrameTime;
        this.frameStats.fps = 1000 / this.frameStats.frameTime;
        this.frameStats.lastFrameTime = now;
    }

    startSystem(systemName) {
        if (!this.enabled) return;

        if (!this.systemStats.has(systemName)) {
            this.systemStats.set(systemName, {
                updateTime: 0,
                renderTime: 0,
                totalTime: 0,
                updateStart: 0,
                renderStart: 0,
                memoryBefore: 0,
                memoryAfter: 0,
                memoryDelta: 0
            });
            this.history.set(systemName, {
                updateTimes: [],
                renderTimes: [],
                totalTimes: []
            });
        }

        const stats = this.systemStats.get(systemName);
        stats.updateStart = performance.now();

        if (this.memorySupported) {
            stats.memoryBefore = performance.memory.usedJSHeapSize;
        }
    }

    endSystemUpdate(systemName) {
        if (!this.enabled) return;

        const stats = this.systemStats.get(systemName);
        if (!stats) return;

        stats.updateTime = performance.now() - stats.updateStart;
    }

    startSystemRender(systemName) {
        if (!this.enabled) return;

        const stats = this.systemStats.get(systemName);
        if (!stats) return;

        stats.renderStart = performance.now();
    }

    endSystemRender(systemName) {
        if (!this.enabled) return;

        const stats = this.systemStats.get(systemName);
        if (!stats) return;

        stats.renderTime = performance.now() - stats.renderStart;
        stats.totalTime = stats.updateTime + stats.renderTime;

        if (this.memorySupported) {
            stats.memoryAfter = performance.memory.usedJSHeapSize;
            stats.memoryDelta = stats.memoryAfter - stats.memoryBefore;
        }

        // Add to history
        const history = this.history.get(systemName);
        history.updateTimes.push(stats.updateTime);
        history.renderTimes.push(stats.renderTime);
        history.totalTimes.push(stats.totalTime);

        // Trim history
        if (history.updateTimes.length > this.historySize) {
            history.updateTimes.shift();
            history.renderTimes.shift();
            history.totalTimes.shift();
        }
    }

    getAverageTime(systemName, type = 'total') {
        const history = this.history.get(systemName);
        if (!history) return 0;

        const times = type === 'update' ? history.updateTimes :
                     type === 'render' ? history.renderTimes :
                     history.totalTimes;

        if (times.length === 0) return 0;

        const sum = times.reduce((a, b) => a + b, 0);
        return sum / times.length;
    }

    createOverlay() {
        if (typeof document === 'undefined') return;

        this.overlay = document.createElement('div');
        this.overlay.id = 'performance-monitor-overlay';
        this.overlay.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            background: rgba(0, 0, 0, 0.85);
            color: #00ff00;
            font-family: 'Courier New', monospace;
            font-size: 12px;
            padding: 10px;
            border-radius: 5px;
            z-index: 10000;
            max-height: 90vh;
            overflow-y: auto;
            min-width: 400px;
            display: none;
            box-shadow: 0 0 10px rgba(0, 255, 0, 0.3);
        `;

        document.body.appendChild(this.overlay);
    }

    updateOverlay() {
        if (!this.enabled || !this.overlay) return;

        let html = '<div style="margin-bottom: 10px; border-bottom: 1px solid #00ff00; padding-bottom: 5px;">';
        html += `<strong>PERFORMANCE MONITOR</strong><br>`;
        html += `FPS: ${this.frameStats.fps.toFixed(1)} | Frame: ${this.frameStats.frameTime.toFixed(2)}ms`;

        if (this.memorySupported) {
            const memoryMB = (performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(2);
            const memoryLimitMB = (performance.memory.jsHeapSizeLimit / 1024 / 1024).toFixed(2);
            html += ` | Memory: ${memoryMB}MB / ${memoryLimitMB}MB`;
        }

        html += '</div>';

        // Sort systems by total time (descending)
        const sortedSystems = Array.from(this.systemStats.entries())
            .sort((a, b) => b[1].totalTime - a[1].totalTime);

        // Calculate total time
        const totalTime = sortedSystems.reduce((sum, [_, stats]) => sum + stats.totalTime, 0);

        html += '<table style="width: 100%; border-collapse: collapse;">';
        html += '<tr style="border-bottom: 1px solid #00ff00;">';
        html += '<th style="text-align: left; padding: 3px;">System</th>';
        html += '<th style="text-align: right; padding: 3px;">Update</th>';
        html += '<th style="text-align: right; padding: 3px;">Render</th>';
        html += '<th style="text-align: right; padding: 3px;">Total</th>';
        html += '<th style="text-align: right; padding: 3px;">Avg</th>';
        html += '<th style="text-align: right; padding: 3px;">%</th>';
        if (this.memorySupported) {
            html += '<th style="text-align: right; padding: 3px;">Memory</th>';
        }
        html += '</tr>';

        for (const [systemName, stats] of sortedSystems) {
            const avgTime = this.getAverageTime(systemName, 'total');
            const percentage = totalTime > 0 ? (stats.totalTime / totalTime * 100).toFixed(1) : 0;

            // Color coding based on performance
            let rowColor = '#00ff00';
            if (stats.totalTime > 16) rowColor = '#ff0000'; // Red if > 16ms (< 60fps)
            else if (stats.totalTime > 8) rowColor = '#ffaa00'; // Orange if > 8ms
            else if (stats.totalTime > 4) rowColor = '#ffff00'; // Yellow if > 4ms

            html += `<tr style="color: ${rowColor};">`;
            html += `<td style="padding: 3px;">${this.formatSystemName(systemName)}</td>`;
            html += `<td style="text-align: right; padding: 3px;">${stats.updateTime.toFixed(2)}ms</td>`;
            html += `<td style="text-align: right; padding: 3px;">${stats.renderTime.toFixed(2)}ms</td>`;
            html += `<td style="text-align: right; padding: 3px;"><strong>${stats.totalTime.toFixed(2)}ms</strong></td>`;
            html += `<td style="text-align: right; padding: 3px;">${avgTime.toFixed(2)}ms</td>`;
            html += `<td style="text-align: right; padding: 3px;">${percentage}%</td>`;

            if (this.memorySupported && stats.memoryDelta !== 0) {
                const memoryKB = (stats.memoryDelta / 1024).toFixed(2);
                const memoryColor = stats.memoryDelta > 0 ? '#ff6666' : '#66ff66';
                html += `<td style="text-align: right; padding: 3px; color: ${memoryColor};">${memoryKB}KB</td>`;
            } else if (this.memorySupported) {
                html += `<td style="text-align: right; padding: 3px;">-</td>`;
            }

            html += '</tr>';
        }

        html += '<tr style="border-top: 1px solid #00ff00; font-weight: bold;">';
        html += '<td style="padding: 3px;">TOTAL</td>';
        html += '<td></td>';
        html += '<td></td>';
        html += `<td style="text-align: right; padding: 3px;">${totalTime.toFixed(2)}ms</td>`;
        html += '<td></td>';
        html += '<td style="text-align: right; padding: 3px;">100%</td>';
        if (this.memorySupported) {
            html += '<td></td>';
        }
        html += '</tr>';

        html += '</table>';

        this.overlay.innerHTML = html;
    }

    formatSystemName(systemName) {
        // Remove 'System' suffix and add spaces before capital letters
        return systemName
            .replace(/System$/, '')
            .replace(/([A-Z])/g, ' $1')
            .trim();
    }

    reset() {
        this.systemStats.clear();
        this.history.clear();
    }
}

if(typeof PerformanceMonitor != 'undefined'){
    if (typeof window !== 'undefined') {
        window.PerformanceMonitor = PerformanceMonitor;
    }

    // Make available as ES module export (new for server)
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PerformanceMonitor;
    }

    // Make available as ES6 export (also new for server)
    if (typeof exports !== 'undefined') {
        exports.default = PerformanceMonitor;
        exports.PerformanceMonitor = PerformanceMonitor;
    }
}
