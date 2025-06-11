class Health extends engine.Component {
       
  init(){
        let statsComp = this.parent.getComponent('stats');
        this.hp = statsComp.stats.hp;
        
        statsComp.addStat('maxHp', this.hp);
    }

    update() {        
        if (this.hp <= 0){            
            this.parent.destroy();
        }
    }

    draw() {
        let imageSize = this.game.getCollections().configs.game.imageSize;
        let statsComp = this.parent.getComponent('stats');
        const healthPercentage = this.hp / statsComp.stats.maxHp;
        const barWidth = 30;
        this.game.ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';

        // const isoPos = this.game.translator.pixelToIso(this.parent.transform.position.x, this.parent.transform.position.y)

        // this.game.ctx.fillRect(isoPos.x - barWidth/2, isoPos.y - imageSize * .3, barWidth, 5);
        // if( healthPercentage >= 0 ) {
        //     this.game.ctx.fillStyle = healthPercentage > 0.5 ? 'rgba(0, 255, 0, 0.5)' : healthPercentage > 0.25 ? 'rgba(255, 255, 0, 0.5)' : 'rgba(255, 0, 0, 0.5)';
        //     this.game.ctx.fillRect(isoPos.x - barWidth/2, isoPos.y - imageSize * .3, barWidth * healthPercentage, 5);
        // }
    }
}