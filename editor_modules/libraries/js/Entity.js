class Entity {
    constructor(game, x, y, type) {
        this.game = game;
        this.moduleManager = game.moduleManager;        
        this.components = [];
        this.renderers = [];
        this.destroyed = false;        
        this.id = ++game.entityId;
        this.type = type;
        this.collisionRadius = 5;   
        this.entityHeight = 10;    
        this.transform = this.addComponent("transform", { x: x, y: y, z: 0 });        
    }
    getAABB(position = this.transform.position) {
        return {
            min: {
                x: position.x - this.collisionRadius,
                y: position.y,
                z: position.z - this.collisionRadius
            },
            max: {
                x: position.x + this.collisionRadius,
                y: position.y + this.entityHeight,
                z: position.z + this.collisionRadius
            }
        };
    }
    getCurrentTerrainHeight(){
        return this.game.gameEntity.getComponent('game').getTerrainHeight(this.transform.position);
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
    update() {    
        for(let c in this.components) {
            this.components[c].update(); 
            if(this.destroyed) break;
        }                
        return !this.destroyed;
    }
    postUpdate() {
        for(let c in this.components) {
            this.components[c].postUpdate();   
            if(this.destroyed) break;
        }     
        return !this.destroyed;
    }
    draw() {

        for(let r in this.renderers) {
            this.renderers[r].draw();  
        }

    }
    OnCollision(collidedWith){
        for(let c in this.components) {
            this.components[c].OnCollision(collidedWith);                           
        }                
    }
    OnStaticCollision(){
        for(let c in this.components) {
            this.components[c].OnStaticCollision();                           
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