class SeededRandom {
    constructor(seed) {
        this.seed = seed;
        this.current = seed;
    }
    
    next() {
        this.current = (this.current * 1664525 + 1013904223) % Math.pow(2, 32);
        return this.current / Math.pow(2, 32);
    }
    
    range(min, max) {
        return min + this.next() * (max - min);
    }
    
    int(min, max) {
        return Math.floor(this.range(min, max + 1));
    }

    reseed(seed) {
        this.seed = seed;
        this.current = seed;
    }
}

if(typeof SeededRandom != 'undefined'){
    if (typeof window !== 'undefined') {
        window.SeededRandom = SeededRandom;
    }

    // Make available as ES module export (new for server)  
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = SeededRandom;
    }

    // Make available as ES6 export (also new for server)
    if (typeof exports !== 'undefined') {
        exports.default = SeededRandom;
        exports.SeededRandom = SeededRandom;
    }
}