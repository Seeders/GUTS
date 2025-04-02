    init( {config, applyFn, amount }) {
        this.id = config.id;
        this.title = config.title;
        this.desc = config.desc;
        this.lifeTime = config.lifeTime;
        this.applyFn = applyFn;
        this.amount = amount;    
    }

    update() {
        this.lifeTime--;
        if( this.lifeTime <= 0) this.parent.removeComponent(this);
        return true;        
    }

    apply(s, add, mul) {
        this.applyFn(s, add, mul, this.amount);
    }