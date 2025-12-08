#!/usr/bin/env node

/**
 * Copy Resources for All Projects
 * Discovers all projects in the projects/ folder and copies resources for each one
 */

const path = require('path');
const fs = require('fs');
const { copyResources } = require('./copy-resources');

const projectsDir = path.join(__dirname, '..', 'projects');

// Discover all project folders
function discoverProjects() {
    try {
        const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
        return entries
            .filter(entry => entry.isDirectory())
            .filter(entry => {
                // Check if it has a resources folder
                const resourcesPath = path.join(projectsDir, entry.name, 'resources');
                return fs.existsSync(resourcesPath);
            })
            .map(entry => entry.name);
    } catch (error) {
        console.error('Error discovering projects:', error.message);
        return [];
    }
}

const projects = discoverProjects();

if (projects.length === 0) {
    console.log('No projects with resources folders found');
    process.exit(1);
}

console.log(`\n📦 Copying resources for ${projects.length} project(s)...\n`);

let success = true;
for (const project of projects) {
    console.log(`\n── ${project} ──`);
    if (!copyResources(project, true)) {
        success = false;
    }
}

console.log(success ? '\n✅ All resources copied successfully' : '\n⚠️ Some resources failed to copy');
process.exit(success ? 0 : 1);
