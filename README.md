
<p align="center">
   <img src="https://raw.githubusercontent.com/Seeders/GUTS/main/logo.png">

</p>

# GUTS - Gamedev Ultimate Toolkit System

GUTS is a comprehensive data-driven toolkit for game development, providing a flexible framework to create and edit games with ease. It comes with a pre-packaged tower defense game and sample assets to help you get started.

More samples will be on the way.  It's easy!

## Local Installation

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the server:
   ```bash
   node server.js
   ```

3. Open in your browser:
   - Editor: `http://localhost:5000/index.html`
   - Game: `http://localhost:5000/game.html`

## License

GUTS is available under the MIT license as open source software.

## Try it yourself:
https://seeders.github.io/GUTS/index.html

https://seeders.github.io/GUTS/game.html

## Screenshots

![image](https://github.com/user-attachments/assets/efcaa562-b040-4789-a5a4-14e14ddbe2a0)


Customize your theme, your tools, ALL the guts:
![Editor Screenshot](https://github.com/user-attachments/assets/77f5a78d-bbfe-4d62-b26e-9479ca03dd84)
![Game Screenshot](https://github.com/user-attachments/assets/3f63d70f-cdd1-43f6-97fc-65805144735d)

## Features

GUTS has any feature you have the GUTS to implement.  haha this never gets old. No but seriously, GUTS is extremely versatile and is built to be customized.

Does it support volumetric fog?  Absolutely.  Quantum AGI?  Look, the moment someone figures that out, GUTS will have it available.

GUTS includes a simple tower defense game and various assets to demonstrate its capabilities. The toolkit is built around the following core object types:

# GUTS Editor Project Documentation

## Project Overview

The GUTS Editor is a web-based editor application built using a data driven architecture. It enables users to create, edit, and manage game projects, including object types, objects, and their properties. The application supports dynamic module loading, project persistence, and a customizable UI with themes.

**Purpose:** Provide a flexible, extensible editor for game development.

### Editor Components:
- **Model:** `EditorModel.js` - Manages data storage and manipulation.
- **View:** `EditorView.js` - Handles UI rendering and user interactions.
- **Controller:** `EditorController.js` - Coordinates between model and view.
- **HTML:** `index.html` - Defines the initial DOM structure.

### Engine Components:
- **Class:** `Engine.js` - Loads the configured project and runs it.
---

## HTML: index.html

### Overview
The HTML file defines the initial structure of the GUTS Editor UI, including the sidebar, main content area, editor panel, and modals. It loads necessary scripts and stylesheets and serves as the entry point for the application.

### Structure

#### Head:
- **Meta Tags:** UTF-8 encoding and responsive viewport.
- **Title:** "GUTS Editor".
- **Scripts:**
  - CodeMirror core (`codemirror.core.min.js`)
  - CodeMirror JavaScript mode (`codemirror.js.min.js`)
  - CodeMirror hint features (`codemirror.showhint.min.js`, `codemirror.hint.min.js`)
- **Stylesheets:**
  - `editor.css` (custom styles)
  - `codemirror.css` (CodeMirror styles)
  - Inline `<style id="theme_style">` (for dynamic theme injection)

#### Body:
- **Class:** `loading` (initial state, removed after setup).
- **Main Container:** `<div id="container">`
  - **Sidebar:** `<div class="sidebar">`
    - **Logo:** `<img src="./logo.png">`
    - **Project Selector:** `<select id="project-selector">` with a "Create New Project" option.
    - **Launch Button:** `<button id="launch-game-btn">`
    - **Object List:** `<div id="object-list">` (dynamically populated)
    - **Sidebar Actions:** Buttons for adding objects and deleting projects.
  - **Main Content:** `<div class="main-content">`
    - **Content Container:** `<div id="main-content-container">` (for module content)
    - **Resize Handle:** `<button id="toggleEditorButton">` (initially hidden)
    - **Editor Panel:** `<div id="editor" class="full-height">` with initial instructions.
  - **Modals Container:** `<div id="modals">`
    - **New Project Modal:** `<div id="new-project-modal">`
    - **New Object Modal:** `<div id="new-object-modal">`
    - **Duplicate Object Modal:** `<div id="duplicate-object-modal">`
- **Script:** Loads `EditorController.js` as a module.

### Key Elements

| ID/Class | Purpose |
|----------|---------|
| `#container` | Main application wrapper |
| `.sidebar` | Sidebar for project and object navigation |
| `#object-list` | Dynamic list of object types and objects |
| `#editor` | Editor panel for object properties |
| `#main-content-container` | Container for module-specific content |
| `#toggleEditorButton` | Handle for resizing editor/content areas |
| `#modals` | Container for all modal dialogs |

---

## Model: EditorModel.js

### Overview
The EditorModel class manages the application's data, including project configurations, object collections, and state. It uses localStorage for persistence and supports operations like creating, updating, and deleting projects and objects.

### Key Properties
- **CONFIG:** Default settings (e.g., `GRID_SIZE`, `DEFAULT_RENDER`).
- **state:** Tracks current project, selected type/object, and expanded categories.
- **defaultProjects:** Predefined projects (e.g., "default_project").

### Key Methods
- **initializeDefaultProjects():** Sets up default projects in localStorage.
- **loadProject(name):** Loads a project into state.project.
- **saveProject():** Saves the current project to localStorage or server (localhost).
- **createObject(typeId, objId, properties):** Adds a new object to a collection.
- **updateObject(updates):** Updates the selected object's properties.
- **deleteObject():** Removes the selected object.
- **getCollections():** Returns all object collections.
- **getCollectionDefs():** Returns type definitions.

---

## Controller: EditorController.js

### Overview
The EditorController class coordinates between the model and view, handling initialization, project loading, and object management. It also manages dynamic modules and theme application.

### Key Properties
- **model:** Instance of EditorModel.
- **view:** Instance of EditorView.
- **elements:** Cached DOM references (e.g., `#object-list`, `#editor`).
- **moduleManager:** Manages dynamic module loading.

### Key Methods
- **init():** Initializes the application and loads the initial project.
- **loadProject(name):** Loads a project, including modules and UI updates.
- **saveObject(data):** Saves changes to the current object.
- **selectObject(obj):** Updates the selected object and UI.
- **applyTheme(themeConfig):** Applies a CSS theme to the UI.
- **dispatchHook(hookName, params):** Dispatches custom events for extensibility.

---

## View: EditorView.js

### Overview
The EditorView class renders the UI and handles user interactions, updating the DOM based on the model state via the controller. It supports dynamic property editors, modals, and drag-resize functionality.

### Key Properties
- **controller:** Reference to EditorController.
- **elements:** Cached DOM elements.
- **isDragging:** Tracks drag state for resizing.

### Key Methods
- **renderObjectList():** Renders the sidebar with categorized object types and objects.
- **renderEditor():** Displays the editor panel for the selected object.
- **renderCustomProperties(container, object):** Renders object properties with type-specific inputs.
- **setupEventListeners():** Sets up listeners for UI interactions (e.g., clicks, drags).
- **showSuccessMessage(message):** Displays temporary success messages.
- **renderObject():** Renders module-specific content for the selected object.

---

## Project Workflow

### Initialization:
1. HTML loads, triggering `EditorController.js`.
2. Controller creates `EditorModel` and `EditorView`, then calls `init()`.

### Project Loading:
1. Model loads the initial project from localStorage.
2. Controller initializes modules and updates the view.

### UI Interaction:
1. View renders the sidebar and editor based on model data.
2. User actions (e.g., selecting objects, saving) trigger controller methods.

### Persistence:
- Changes are saved to localStorage (or server on localhost).

### Extensibility:
- Modules enhance functionality via hooks and dynamic loading.

---

## Notes
- **Dynamic Modules:** The ModuleManager allows for extensible property editors.
- **Theming:** Themes are applied via inline CSS in `#theme_style`.
- **Local Development:** On localhost, data is synced to a server via FileSystemSyncService.
- **UI Flexibility:** Drag-resize and modal dialogs enhance usability.

## Contributing

Feel free to submit issues or pull requests to improve GUTS. Contributions are welcome under the MIT Open Source license.
