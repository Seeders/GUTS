class Entity {
    constructor(game, type) {
        this.game = game;
        this.moduleManager = game.moduleManager;        
        this.components = [];
        this.renderers = [];
        this.destroyed = false;        
        this.id = ++game.entityId;
        this.type = type;
        this.collisionRadius = 5;   
        this.entityHeight = 10;        
    }

    init(params) {
        for(let c in this.components) {
            this.components[c].init(params);               
        }     
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

    getComponent(name) {
        return this.components[name.toLowerCase()] || this.components[`${name.toLowerCase()}`];
    }
    addRenderer(RendererClassName, params) {
        const RendererClass = this.moduleManager.getCompiledScript(RendererClassName, 'renderers');
        const renderer = new RendererClass(this.game, this);
        this.renderers[RendererClass.name.toLowerCase()] = renderer;
        this.components[RendererClass.name.toLowerCase()] = renderer;
        if(params){
            renderer.init(params);
        }
        return renderer;
    }
    addComponent(ComponentClassName, params) {        
        const ComponentClass = this.moduleManager.getCompiledScript(ComponentClassName, 'components');
        const component = new ComponentClass(this.game, this);
        this.components[ComponentClass.name.toLowerCase()] = component;
        if(params){
            component.init(params);
        }
        return component;
    }
    getNetworkComponentData(){
        let data = {};
        for(let c in this.components) {
            let cData = this.components[c].getNetworkData(); 
            if(cData){
                data[c] = cData;
            }
        }    
        return data;
    }
    setNetworkComponentData(data, isRemote=false){            
        if(data?.components){
            for(let c in data.components) {
                this.components[c]?.setNetworkData(data.components[c], isRemote); 
            }    
        }
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
    }
    postUpdate() {
        for(let c in this.components) {
            this.components[c].postUpdate();   
            if(this.destroyed) break;
        }     
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
    OnGrounded(){
        for(let c in this.components) {
            this.components[c].OnGrounded();                           
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