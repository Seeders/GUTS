# Editor Dashboard Feature Plan

## Goal
Add a configurable dashboard system with:
1. Multiple dashboards (stored in a `dashboards` collection)
2. Dashboard selector to switch between dashboards
3. Custom widgets (stored in global `widgets` collection)
4. Widgets are self-contained scripts that query/display collection data

---

## Architecture Overview

```
global/collections/
└── editor/
    └── widgets/           # Widget definitions (global)
        ├── data/
        │   ├── collectionTable.json
        │   ├── recentFiles.json
        │   └── mostModified.json
        └── js/
            ├── collectionTable.js
            ├── recentFiles.js
            └── mostModified.js

projects/[Project]/collections/
└── editor/
    └── dashboards/        # Dashboard configurations (per-project)
        └── data/
            ├── main.json
            └── development.json
```

---

## Data Structures

### Widget Definition (global)
```javascript
// global/collections/editor/widgets/data/collectionTable.json
{
  "title": "Collection Table",
  "description": "Sortable table showing all collections with item counts",
  "icon": "table",
  "defaultConfig": {
    "sortBy": "name",
    "sortOrder": "asc",
    "columns": ["name", "category", "itemCount"]
  }
}

// global/collections/editor/widgets/js/collectionTable.js
class CollectionTableWidget {
  static title = "Collection Table";

  constructor(container, collections, config) {
    this.container = container;
    this.collections = collections;
    this.config = config;
  }

  render() {
    // Build sortable table from this.collections
  }

  destroy() {
    // Cleanup
  }
}
```

### Dashboard Definition (per-project)
```javascript
// projects/TurnBasedWarfare/collections/editor/dashboards/data/main.json
{
  "title": "Main Dashboard",
  "layout": "grid",  // or "freeform"
  "widgets": [
    {
      "id": "widget-1",
      "type": "collectionTable",
      "position": { "x": 0, "y": 0, "width": 2, "height": 1 },
      "config": {
        "sortBy": "itemCount",
        "sortOrder": "desc"
      }
    },
    {
      "id": "widget-2",
      "type": "recentFiles",
      "position": { "x": 2, "y": 0, "width": 1, "height": 1 },
      "config": {
        "limit": 10
      }
    }
  ],
  "quickLinks": [
    {
      "id": "link-1",
      "label": "Game Config",
      "collectionType": "configs",
      "objectId": "game"
    }
  ]
}
```

---

## Widget Examples

### 1. Collection Table Widget
- Sortable columns: Name, Category, Item Count
- Click column header to sort
- Click row to navigate to collection

### 2. Recent Files Widget
- Shows last N modified files
- Timestamp + collection type + object name
- Click to navigate

### 3. Most Modified Widget
- Shows files with most modifications (git history or edit count)
- Useful for finding frequently edited configs

### 4. Quick Links Widget
- Grid of shortcut buttons to specific objects
- Configurable icons/labels

---

## Implementation Plan

### Step 1: Create Widget Base Class

**File:** `engine/BaseWidget.js`

```javascript
class BaseWidget {
  constructor(container, collections, config, controller) {
    this.container = container;
    this.collections = collections;
    this.config = config;
    this.controller = controller;
  }

  render() { throw new Error('Must implement render()'); }
  destroy() { }

  navigateTo(collectionType, objectId) {
    this.controller.selectType(collectionType);
    this.controller.selectObject(objectId);
  }
}
```

### Step 2: Create Widget Collection (Global)

**Files to create:**
```
global/collections/editor/widgets/data/collectionTable.json
global/collections/editor/widgets/data/recentFiles.json
global/collections/editor/widgets/data/quickLinks.json
global/collections/editor/widgets/js/CollectionTableWidget.js
global/collections/editor/widgets/js/RecentFilesWidget.js
global/collections/editor/widgets/js/QuickLinksWidget.js
global/collections/settings/objectTypeDefinitions/widgets.json
```

### Step 3: Create Dashboard Collection (Per-Project)

**Files to create:**
```
projects/TurnBasedWarfare/collections/editor/dashboards/data/main.json
projects/TurnBasedWarfare/collections/settings/objectTypeDefinitions/dashboards.json
```

### Step 4: Create Dashboard Editor Module

Uses the existing editor module pattern - dashboards are edited like any other collection.

**File:** `global/collections/editor/editorModules/dashboardModule.json`
```json
{
  "title": "Dashboard Editor",
  "container": "dashboard-editor-container",
  "interface": "dashboardEditor",
  "inputDataType": "json",
  "libraries": ["DashboardEditor"],
  "propertyName": "widgets",
  "loadHook": "editDashboard",
  "saveHook": "saveDashboard",
  "unloadHook": "unloadDashboard"
}
```

**File:** `global/collections/scripts/libraries/js/DashboardEditor.js`
```javascript
class DashboardEditor {
  constructor(gameEditor, config) {
    this.gameEditor = gameEditor;
    this.config = config;
    this.container = document.getElementById('dashboard-editor-container');
    this.savePropertyName = "widgets";
    this.widgets = [];  // Available widget types from global collection
    this.dashboardData = null;

    this.setupEventListeners();
  }

  setupEventListeners() {
    // Load dashboard data when object selected
    document.body.addEventListener('editDashboard', (event) => {
      this.dashboardData = event.detail.data;
      this.savePropertyName = event.detail.propertyName;
      this.loadWidgetTypes();
      this.render();
    });

    // Clear when unloaded
    document.body.addEventListener('unloadDashboard', () => {
      this.handleUnload();
    });
  }

  loadWidgetTypes() {
    // Load available widgets from global widgets collection
    const collections = this.gameEditor.getCollections();
    this.widgetTypes = collections.widgets || {};
  }

  render() {
    // Render grid layout with placed widgets
    // Show widget picker panel
    // Enable drag/drop repositioning
  }

  saveDashboard() {
    const event = new CustomEvent('saveDashboard', {
      detail: { data: this.dashboardData, propertyName: this.savePropertyName },
      bubbles: true
    });
    document.body.dispatchEvent(event);
  }

  handleUnload() {
    this.dashboardData = null;
    this.container.innerHTML = '';
  }
}
```

**File:** `global/collections/ui/interfaces/html/dashboardEditor.html`
```html
<div id="dashboard-editor-container" class="editor-module">
  <div class="dashboard-editor__sidebar">
    <h3>Available Widgets</h3>
    <div id="widget-picker"></div>
    <button id="save-dashboard-btn" class="editor-module__btn">Save Dashboard</button>
  </div>
  <div class="dashboard-editor__canvas">
    <div id="dashboard-grid"></div>
  </div>
</div>
```

**File:** `global/collections/ui/interfaces/css/dashboardEditor.css`

### Step 5: Create Dashboard Viewer (Home View)

Separate from the editor - this is the "live" dashboard view shown on startup.

**File:** `engine/DashboardViewer.js`
- Renders a dashboard in view mode (not edit mode)
- Instantiates widget classes
- Handles widget interactions (clicks, sorts)
- Dashboard selector dropdown

### Step 6: Add Dashboard View State to EditorModel

**File:** `engine/EditorModel.js`

```javascript
this.state = {
  currentView: 'dashboard',  // 'dashboard' | 'objectEditor'
  currentDashboard: 'main',  // Selected dashboard ID
  // ... existing state
}
```

### Step 7: Modify EditorView

**File:** `engine/EditorView.js`

- Add `showDashboardView()` / `showObjectEditorView()` toggle
- Integrate DashboardViewer
- Add "Home" button to sidebar header

### Step 8: Modify EditorController

**File:** `engine/EditorController.js`

- Load widgets from global collection on init
- Load dashboards from project collection
- Default to dashboard view on startup
- When user selects dashboards collection → show dashboard editor module
- When user clicks Home → show dashboard viewer

---

## Files to Create

| File | Purpose |
|------|---------|
| `engine/BaseWidget.js` | Base class for all widgets |
| `engine/DashboardViewer.js` | Renders dashboard in view mode (home screen) |
| `global/collections/editor/editorModules/dashboardModule.json` | Dashboard editor module config |
| `global/collections/scripts/libraries/js/DashboardEditor.js` | Dashboard editor module class |
| `global/collections/ui/interfaces/html/dashboardEditor.html` | Dashboard editor HTML |
| `global/collections/ui/interfaces/css/dashboardEditor.css` | Dashboard editor styles |
| `global/collections/editor/widgets/data/*.json` | Widget definitions |
| `global/collections/editor/widgets/js/*.js` | Widget implementations |
| `global/collections/settings/objectTypeDefinitions/widgets.json` | Widget type definition |
| `projects/*/collections/editor/dashboards/data/main.json` | Default dashboard |
| `projects/*/collections/settings/objectTypeDefinitions/dashboards.json` | Dashboard type definition |

## Files to Modify

| File | Changes |
|------|---------|
| `engine/EditorModel.js` | Add `currentView`, `currentDashboard` state |
| `engine/EditorView.js` | Add `showDashboardView()`, integrate DashboardViewer |
| `engine/EditorController.js` | Load widgets/dashboards, init dashboard view, home button |
| `projects/Editor/index.html` | Add dashboard container, home button in sidebar |
| `projects/*/collections/settings/configs/editor.json` | Add dashboardModule to editorModules array |

---

## Dashboard UI Mockup

```
┌─────────────────────────────────────────────────────────────────┐
│ [Home] [Dashboard: Main ▼]                    [+ Add Widget]    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────┐  ┌─────────────────────────┐  │
│  │ Collection Table        [x] │  │ Recent Files        [x] │  │
│  ├─────────────────────────────┤  ├─────────────────────────┤  │
│  │ Name      │ Cat.  │ Count   │  │ game.json      2min ago │  │
│  │───────────┼───────┼─────────│  │ peasant.json   5min ago │  │
│  │ units     │ prefab│ 35      │  │ lobby.json    10min ago │  │
│  │ buildings │ prefab│ 13      │  │ ...                     │  │
│  │ abilities │ script│ 48      │  └─────────────────────────┘  │
│  │ systems   │ script│ 59      │                               │
│  │ ...       │       │         │  ┌─────────────────────────┐  │
│  └─────────────────────────────┘  │ Quick Links         [x] │  │
│                                   ├─────────────────────────┤  │
│                                   │ [Game] [Lobby] [Units]  │  │
│                                   │ [AI Config] [Editor]    │  │
│                                   └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Widget API

Each widget script exports a class with this interface:

```javascript
class MyWidget extends BaseWidget {
  static title = "My Widget";           // Display name
  static description = "Description";   // For widget picker
  static icon = "icon-name";            // Optional icon
  static defaultConfig = {};            // Default configuration

  constructor(container, collections, config, controller) {
    super(container, collections, config, controller);
  }

  // Called when widget should render
  render() {
    this.container.innerHTML = `<div>...</div>`;
  }

  // Called when widget is removed or dashboard changes
  destroy() {
    // Cleanup event listeners, etc.
  }

  // Optional: Called when config changes
  onConfigChange(newConfig) {
    this.config = newConfig;
    this.render();
  }
}
```

Widgets receive:
- `container` - DOM element to render into
- `collections` - All loaded collection data
- `config` - Widget-specific configuration from dashboard
- `controller` - EditorController for navigation and actions

---

## Verification

1. Editor loads with dashboard view by default
2. Dashboard selector shows available dashboards
3. Widgets render correctly with collection data
4. Collection Table widget sorts by clicking headers
5. Recent Files widget shows actual modification times
6. Quick Links navigate to correct objects
7. "Add Widget" shows available widgets
8. Widgets can be removed from dashboard
9. Dashboard changes persist to dashboards collection
10. Sidebar navigation still works, switches to object editor view
11. Home button returns to dashboard
