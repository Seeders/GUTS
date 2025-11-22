class UIManager extends GUTS.Component {
	init() {
		this.counter = 0;
	}
   draw() {
   	document.getElementById("gameContainer").innerHTML = `Hello World, from \"Scripts / Renderers / UI Manager\"! <br />Frame Count: ${this.counter++}`; 
  }
}