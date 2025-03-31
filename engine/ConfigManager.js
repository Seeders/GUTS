class ConfigManager {
    constructor(config = {}, options = {}) {
      this.config = config;
      this.options = {
        refKey: options.refKey || 'ref',
        collectionsKey: options.collectionsKey || 'objectTypes',
        definitionsKey: options.definitionsKey || 'objectTypeDefinitions',
      };
    }
  
    // Get a value by path
    get(path) {
      return path.split('.').reduce((obj, key) => obj?.[key], this.config);
    }
  
    // Get collections (objectTypes)
    getCollections() {
      return this.get(this.options.collectionsKey) || {};
    }
  
    // Get type definitions (objectTypeDefinitions)
    getDefinitions() {
      return this.get(this.options.definitionsKey) || [];
    }
  
    // Get a single definition (singular)
    getDef(sourcePath, targetKey = null) {
      const source = this.get(sourcePath);
      if (typeof source !== 'string') return null; // Singular expects a string ref
  
      const parts = sourcePath.split('.');
      const lastPart = parts[parts.length - 1];
      const typeDef = this.getDefinitions().find(
        def => def.singular.replace(/ /g, '').toLowerCase() === lastPart.toLowerCase() || def.id === lastPart
      );
      const targetCollectionKey = typeDef ? typeDef.id : lastPart; // Use plural form
      const targetPath = targetKey || `${this.options.collectionsKey}.${targetCollectionKey}`;
      const target = this.get(targetPath) || {};
  
      return target[source] || null;
    }
  
    // Get multiple definitions (plural)
    getDefs(sourcePath, targetKey = null) {
        const fullSourcePath = `${this.options.collectionsKey}.${sourcePath}`;
        const source = this.get(fullSourcePath);
        if (!Array.isArray(source)) return {};
      
        const parts = sourcePath.split('.');
        const lastPart = parts[parts.length - 1];
        const typeDef = this.getDefinitions().find(
          def => def.id === lastPart || def.singular.replace(/ /g, '').toLowerCase() === lastPart.toLowerCase()
        );
        const targetCollectionKey = typeDef ? typeDef.id : lastPart;
        const targetPath = targetKey || `${this.options.collectionsKey}.${targetCollectionKey}`;
        const target = this.get(targetPath) || {};
      
        return source.reduce((map, ref) => {
          if (target[ref]) map[ref] = target[ref];
          return map;
        }, {});
      }
    // Resolve references in a value
    resolveReferences(value, refKey = this.options.refKey, seen = new Set()) {
      if (typeof value !== 'object' || value === null) return value;
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
      return Array.isArray(value)
        ? value.map(item => this.resolveReferences(item, refKey, seen))
        : Object.fromEntries(
            Object.entries(value).map(([k, v]) =>
              [k, k === refKey && v ? this.get(v) || v : this.resolveReferences(v, refKey, seen)]
            )
          );
    }
  
    // Get a value with resolved references
    getWithReferences(path, refKey = this.options.refKey) {
      const value = this.get(path);
      return value !== undefined ? this.resolveReferences(value, refKey) : null;
    }
  
    // Get a specific collection
    getCollection(typeId, resolveRefs = true) {
      const collection = this.getCollections()[typeId] || {};
      return resolveRefs ? this.resolveReferences(collection) : collection;
    }
  
    // Get a single object
    getObject(typeId, objId, resolveRefs = true) {
      const obj = this.getCollections()[typeId]?.[objId];
      return obj && resolveRefs ? this.resolveReferences(obj) : obj;
    }
  
    // Get type definition
    getTypeDef(typeId) {
      return this.getDefinitions().find(def => def.id === typeId) || null;
    }
  
    getSingularType(typeId) {
      const def = this.getTypeDef(typeId);
      return def ? def.singular : typeId.slice(0, -1);
    }
  
    getPluralType(typeId) {
      const def = this.getTypeDef(typeId);
      return def ? def.name : typeId;
    }
  
    // Set a value at a path
    set(path, value) {
      const keys = path.split('.');
      const lastKey = keys.pop();
      const target = keys.reduce((obj, key) => obj[key] = obj[key] || {}, this.config);
      target[lastKey] = value;
      return this;
    }
  
    setObject(typeId, objId, value) {
      return this.set(`${this.options.collectionsKey}.${typeId}.${objId}`, value);
    }
  }

  export { ConfigManager }