class ArrayTracker extends GUTS.Component {
    
    constructor(game, parent, params) {
        super(game, parent, params);
    }
    
    
    init( {objectType}) {
        this.arr = objectType;
        if(!this.game.state[this.arr]){
            this.game.state[this.arr] = [];
        }
        this.game.state[this.arr].push(this.parent);
    }

    destroy(){
        let index = this.game.state[this.arr].indexOf(this.parent);
        this.game.state[this.arr].splice(index, 1);        
    }
}