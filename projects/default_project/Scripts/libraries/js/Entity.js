class Entity {
    constructor(game, x, y, type) {
        this.game = game;
        this.position = { x: x, y: y };
        this.components = [];
        this.renderers = [];
        this.destroyed = false;        
        this.id = ++game.entityId;
        this.type = type;
        this.lastPosition = {...this.position};
        this.lastGridPosition = {...this.gridPosition};
        this.lastDrawPosition = {...this.drawPosition};
        this.setGridPosition();
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
    setGridPosition() {
        let gridPosition = this.game.translator.pixelToGrid( this.position.x, this.position.y ); 
        this.gridPosition = this.game.translator.snapToGrid(gridPosition.x, gridPosition.y);   
    }
    updateLastPositions() {
        this.lastPosition = {...this.position};
        this.lastGridPosition = {...this.gridPosition};
        this.lastDrawPosition = {...this.drawPosition};         
    }
    update() {    
        this.setGridPosition();
        for(let c in this.components) {
            this.components[c].update();   
            this.setGridPosition();
            if(this.destroyed) break;
        }                
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
        const isoPos = this.game.translator.pixelToIso(this.position.x, this.position.y);    
        this.drawPosition = { x: isoPos.x, y: isoPos.y };
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