class HelloLoader {
    
    constructor(app){
        this.app = app;
    }

    init() {}
    
    async load(){     
        this.app.sceneManager.load("main");
        this.app.init();
    }

}