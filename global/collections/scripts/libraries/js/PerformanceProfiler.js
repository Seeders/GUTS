{class PerformanceProfiler {
  constructor(game, sampleSize = 60) {
    this.game = game;
    this.game.profiler = this;
    this.sampleSize = sampleSize;
    this.timings = new Map();
    this.frameTimes = [];
    this.enabled = true;
    this.startTime = performance.now();
  }
  startMeasure(label) {
    if (!this.enabled) return;
    if (!this.timings.has(label)) {
      this.timings.set(label, {
        samples: [],
        totalTime: 0,
        calls: 0,
        avgTime: 0,
        maxTime: 0,
        minTime: Infinity
      });
    }
    return performance.now();
  }
  endMeasure(label, startTime) {
    if (!this.enabled) return;
    const duration = performance.now() - startTime;
    const stats = this.timings.get(label);
    if (stats) {
      stats.samples.push(duration);
      if (stats.samples.length > this.sampleSize) {
        stats.samples.shift();
      }
      stats.totalTime += duration;
      stats.calls++;
      stats.maxTime = Math.max(stats.maxTime, duration);
      stats.minTime = Math.min(stats.minTime, duration);
      stats.avgTime = stats.samples.reduce((a, b) => a + b, 0) / stats.samples.length;
    }
  }
  measure(label, fn) {
    const start = this.startMeasure(label);
    try {
      return fn();
    } finally {
      this.endMeasure(label, start);
    }
  }
  async measureAsync(label, fn) {
    const start = this.startMeasure(label);
    try {
      return await fn();
    } finally {
      this.endMeasure(label, start);
    }
  }
  getReport(sortBy = 'avgTime') {
    const report = [];
    for (const [label, stats] of this.timings) {
      report.push({
        label,
        avgTime: stats.avgTime,
        maxTime: stats.maxTime,
        minTime: stats.minTime,
        totalTime: stats.totalTime,
        calls: stats.calls,
        percentOfFrame: 0
      });
    }
    const totalTime = report.reduce((sum, stat) => sum + stat.avgTime, 0);
    report.forEach(stat => {
      stat.percentOfFrame = totalTime > 0 ? stat.avgTime / totalTime * 100 : 0;
    });
    report.sort((a, b) => b[sortBy] - a[sortBy]);
    return report;
  }
  printReport() {
    const report = this.getReport();
    console.log('\
=== Performance Report ===');
    console.log('Label'.padEnd(30), 'Avg(ms)', 'Max(ms)', 'Min(ms)', '% Frame', 'Calls');
    console.log('-'.repeat(80));
    report.forEach(stat => {
      console.log(stat.label.padEnd(30), stat.avgTime.toFixed(3).padStart(7), stat.maxTime.toFixed(3).padStart(7), stat.minTime.toFixed(3).padStart(7), stat.percentOfFrame.toFixed(1).padStart(6) + '%', stat.calls.toString().padStart(6));
    });
    const totalAvg = report.reduce((sum, stat) => sum + stat.avgTime, 0);
    console.log('-'.repeat(80));
    console.log('Total'.padEnd(30), totalAvg.toFixed(3).padStart(7));
    console.log('\
');
  }
  reset() {
    this.timings.clear();
    this.frameTimes = [];
  }
  toggle() {
    this.enabled = !this.enabled;
    return this.enabled;
  }
  setupCommands() {
    window.debug = {
      profileSystem: systemName => {
        const system = this.game.systems.find(s => s.constructor.name.toLowerCase().includes(systemName.toLowerCase()));
        if (system) {
          console.log(`Profiling ${system.constructor.name}...`);
          this.game.profiler.reset();
          setTimeout(() => {
            this.game.profiler.printReport();
          }, 3000);
        } else {
          console.log(`System "${systemName}" not found`);
        }
      },
      listSystems: () => {
        console.log('Active Systems:');
        this.game.systems.forEach((system, i) => {
          console.log(`${i + 1}. ${system.constructor.name}`);
        });
      },
      compareRuns: (duration = 5000) => {
        console.log('Starting comparison run...');
        this.game.profiler.reset();
        setTimeout(() => {
          const baseline = this.game.getPerformanceReport();
          console.log('Baseline recorded. Make changes and wait...');
          setTimeout(() => {
            const current = this.game.getPerformanceReport();
            console.log('\
=== Performance Comparison ===');
            console.log('System'.padEnd(30), 'Before', 'After', 'Diff');
            console.log('-'.repeat(70));
            baseline.forEach(before => {
              const after = current.find(s => s.label === before.label);
              if (after) {
                const diff = after.avgTime - before.avgTime;
                const diffStr = (diff > 0 ? '+' : '') + diff.toFixed(3);
                const color = diff > 0 ? '\x1b[31m' : '\x1b[32m';
                console.log(before.label.padEnd(30), before.avgTime.toFixed(3).padStart(7), after.avgTime.toFixed(3).padStart(7), `${color}${diffStr}\x1b[0m`.padStart(10));
              }
            });
          }, duration);
        }, duration);
      }
    };
    console.log('Debug commands loaded. Available: debug.profileSystem(), debug.listSystems(), debug.compareRuns()');
  }
}
if (typeof PerformanceProfiler != 'undefined') {
  if ( true && module.exports) {
    module.exports = PerformanceProfiler;
  }
}

// Auto-generated exports
if (typeof window !== 'undefined' && window.GUTS) {
  window.GUTS.PerformanceProfiler = PerformanceProfiler;
}

}