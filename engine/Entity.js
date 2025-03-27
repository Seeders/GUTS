class Entity {
    constructor(game, x, y) {
        this.game = game;
        this.position = { x: x, y: y };
        this.components = [];
        this.renderers = [];
        this.destroyed = false;        
        this.id = ++game.entityId;
        
        this.lastPosition = {...this.position};
        this.lastGridPosition = {...this.gridPosition};
        this.lastDrawPosition = {...this.drawPosition};
        this.setPositions();
    }

    getComponent(name) {
        return this.components[name.toLowerCase()] || this.components[`${name.toLowerCase()}`];
    }
    addRenderer(ComponentClass, params) {
        let renderer = this.addComponent(ComponentClass, params);
        this.renderers.push(renderer);
        return renderer;
    }
    addComponent(ComponentClass, params) {
        const component = new ComponentClass(this.game, this, params);
        this.components[ComponentClass.name.toLowerCase()] = component;
        return component;
    }
    removeComponent(component) {
        let index = this.components.indexOf(component);
        if( index >= 0 ) {
            this.components.splice(index, 1);
        }
    }
    setPositions() {
        let gridPosition = this.game.translator.pixelToGrid( this.position.x, this.position.y );
        const isoPos = this.game.translator.pixelToIso(this.position.x, this.position.y);  
        this.gridPosition = this.game.translator.snapToGrid(gridPosition.x, gridPosition.y);      
        this.drawPosition = { x: isoPos.x, y: isoPos.y};
    }
    updateLastPositions() {
        this.lastPosition = {...this.position};
        this.lastGridPosition = {...this.gridPosition};
        this.lastDrawPosition = {...this.drawPosition};         
    }
    update() {    
        this.setPositions();
        for(let c in this.components) {
            this.components[c].update();   
            if(this.destroyed) break;
        }             
        this.setPositions();        
        return !this.destroyed;
    }
    postUpdate() {
        for(let c in this.components) {
            this.components[c].postUpdate();   
            if(this.destroyed) break;
        }     
        this.updateLastPositions(); 
        return !this.destroyed;
    }
    draw() {
        if( this.renderers.length ) {
            this.renderers.forEach( (r) => r.draw() );
        }   
    }
    destroy() {
        this.destroyed = true;
        for(let c in this.components) {
            this.components[c].destroy();   
        }   
    }
}
export { Entity };