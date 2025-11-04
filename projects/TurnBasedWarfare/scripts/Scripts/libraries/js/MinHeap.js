class MinHeap {
    constructor() {
        this.heap = [];
    }
    
    push(item) {
        this.heap.push(item);
        this.bubbleUp(this.heap.length - 1);
    }
    
    pop() {
        if (this.heap.length === 0) return null;
        if (this.heap.length === 1) return this.heap.pop();
        
        const min = this.heap[0];
        this.heap[0] = this.heap.pop();
        this.bubbleDown(0);
        return min;
    }
    
    bubbleUp(index) {
        while (index > 0) {
            const parentIndex = Math.floor((index - 1) / 2);
            if (this.heap[index].f >= this.heap[parentIndex].f) break;
            
            [this.heap[index], this.heap[parentIndex]] = [this.heap[parentIndex], this.heap[index]];
            index = parentIndex;
        }
    }
    
    bubbleDown(index) {
        while (true) {
            const leftChild = 2 * index + 1;
            const rightChild = 2 * index + 2;
            let smallest = index;
            
            if (leftChild < this.heap.length && this.heap[leftChild].f < this.heap[smallest].f) {
                smallest = leftChild;
            }
            
            if (rightChild < this.heap.length && this.heap[rightChild].f < this.heap[smallest].f) {
                smallest = rightChild;
            }
            
            if (smallest === index) break;
            
            [this.heap[index], this.heap[smallest]] = [this.heap[smallest], this.heap[index]];
            index = smallest;
        }
    }
    
    isEmpty() {
        return this.heap.length === 0;
    }
}

if(typeof MinHeap != 'undefined'){
        
    if (typeof window !== 'undefined') {
        window.MinHeap = MinHeap;
    }

    // Make available as ES module export (new for server)  
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = MinHeap;
    }

    // Make available as ES6 export (also new for server)
    if (typeof exports !== 'undefined') {
        exports.default = MinHeap;
        exports.MinHeap = MinHeap;
    }
}