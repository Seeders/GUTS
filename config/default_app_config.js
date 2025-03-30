const DEFAULT_PROJECT_CONFIG = {
  objectTypes: {
      configs: {                    
          "game": {
              "gridSize": 48,
              "imageSize": 128,
              "canvasWidth": 1536,
              "canvasHeight": 768,
              "html": "<div id=\"appContainer\"></div>",
              "css": "",
              "title": "My Project",
              "isIsometric": false,
              "libraries": []
          },
          "editor": {
              "title": "Editor Config",
              "editorCategories": "",
              "theme": "default"
          },
          "state": {
              "level": "level1",
          }
      },
      "entities": {
          "game": {
              "components": ["game"]
          }
      },
      "components": {
          "game": {
              "script" : "init(){}"
          }
      },
      "renderers": {
          "renderer": {
            "script" : "draw(){}"
        }
      },
      "functions": {},
      "environment": {},
      "levels": {
        "level1":{
          "title": "Level 1"
        }
      },
      "themes": {
          "default" : {
              "css" : "body { background-color: #333; color: #ededed; }"
          }
      },
      "sounds": {},
      "libraries": {},
  },
  objectTypeDefinitions:  [
      {
        "id": "configs",
        "name": "Configs",
        "singular": "Config",
        "category": "Settings",
        "isCore": true
      },
      {
        "id": "entities",
        "name": "Entities",
        "singular": "Entity",
        "category": "Scripts",
        "isCore": true
      },
      {
        "id": "components",
        "name": "Components",
        "singular": "Component",
        "category": "Scripts",
        "isCore": true
      },
      {
        "id": "renderers",
        "name": "Renderers",
        "singular": "Renderer",
        "category": "Scripts",
        "isCore": true
      },
      {
        "id": "functions",
        "name": "Functions",
        "singular": "Function",
        "category": "Scripts",
        "isCore": true
      },
      {
        "id": "environment",
        "name": "Environment",
        "singular": "Environment",
        "category": "Visuals",
        "isCore": true
      },
      {
        "id": "levels",
        "name": "Levels",
        "singular": "Level",
        "category": "Terrain",
        "isCore": true
      },
      {
        "id": "themes",
        "name": "Themes",
        "singular": "Theme",
        "category": "Settings",
        "isCore": true
      },
      {
        "id": "sounds",
        "name": "Sounds",
        "singular": "Sound",
        "category": "Audio",
        "isCore": true
      },
      {
        "id": "libraries",
        "name": "Libraries",
        "singular": "Library",
        "category": "Scripts",
        "isCore": true
      }
    ]
}; 

 export { DEFAULT_PROJECT_CONFIG };