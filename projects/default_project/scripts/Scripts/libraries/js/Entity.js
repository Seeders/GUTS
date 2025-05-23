class Entity {
    constructor(game, x, y, type) {
        this.game = game;
        this.moduleManager = game.moduleManager;
        this.position = { x: x, y: y, z: 0};
        this.components = [];
        this.renderers = [];
        this.destroyed = false;        
        this.id = ++game.entityId;
        this.type = type;
        this.gridPosition = { x: 0, y: 0};
        this.drawPosition = { x: 0, y: 0};
        this.lastPosition = {...this.position};
        this.lastGridPosition = {...this.gridPosition};
        this.lastDrawPosition = {...this.drawPosition};
        if(this.game.gameEntity){
            this.setGridPosition();
            this.position.z = this.getCurrentTerrainHeight();
        }
    }

    getCurrentTerrainHeight(){
        return this.game.gameEntity.getComponent('game').getTerrainHeight(this.gridPosition);
    }

    getComponent(name) {
        return this.components[name.toLowerCase()] || this.components[`${name.toLowerCase()}`];
    }
    addRenderer(RendererClassName, params) {
        const RendererClass = this.moduleManager.getCompiledScript(RendererClassName, 'renderers');
        const renderer = new RendererClass(this.game, this, params);
        this.renderers[RendererClass.name.toLowerCase()] = renderer;
        this.components[RendererClass.name.toLowerCase()] = renderer;
        return renderer;
    }
    addComponent(ComponentClassName, params) {        
        const ComponentClass = this.moduleManager.getCompiledScript(ComponentClassName, 'components');
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
        if(this.game.translator){
            let gridPosition = this.game.translator.pixelToGrid( this.position.x, this.position.y ); 
            this.gridPosition = this.game.translator.snapToGrid(gridPosition.x, gridPosition.y);   
            return;
        }
        this.gridPosition = { x: 0, y: 0 };
    }
    updateLastPositions() {
        this.lastPosition = {...this.position};
        this.lastGridPosition = {...this.gridPosition};
        this.lastDrawPosition = {...this.drawPosition};         
    }
    
    getCurrentTile() {                     
        if(this.game.state.tileMap.length > this.gridPosition.y && this.gridPosition.y > 0 && this.game.state.tileMap[Math.floor(this.gridPosition.y)] && this.game.state.tileMap[Math.floor(this.gridPosition.y)].length > this.gridPosition.x && this.gridPosition.x > 0){
            return this.game.state.tileMap[Math.floor(this.gridPosition.y)][Math.floor(this.gridPosition.x)];
        }
        return { typeId: 0};
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

        for(let r in this.renderers) {
            this.renderers[r].draw();  
        }

    }
    destroy() {
        this.destroyed = true;
        for(let c in this.components) {
            this.components[c].destroy();   
        }   
        for(let r in this.renderers) {
            this.renderers[r].destroy();   
        }   
    }
}