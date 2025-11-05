(() => {
    const engine = new Engine("appContainer");  
    async function main() {  
        let projectName = localStorage.getItem('currentProject');
        if(!projectName){
            const path =  window.location.pathname.split('/');
            if(path.length >= 3){
                projectName = window.location.pathname.split('/')[2];
            }
        }
        if(projectName){
            await engine.init(projectName);
            window.game = engine.gameInstance;
        }
    }
    window.onload = main;
})();