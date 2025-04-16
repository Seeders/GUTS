class Leveler extends engine.Component {
    
    constructor(game, parent, params) {
        super(game, parent, params);
    }
    
    
 init( {level = 1}) {
        this.level = level;
    }
}