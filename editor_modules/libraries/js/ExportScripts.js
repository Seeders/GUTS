class ExportScripts {
  constructor(app) {
     this.app = app;
  }
  export(project) {
      // Initialize JSZip
      const zip = new (this.app.libraryClasses.JSZip)();

      // Iterate over each script type (e.g., "renderers", "components")
      Object.keys(project).forEach(scriptType => {
          const scripts = project[scriptType];

          // Create a folder for the script type
          const folder = zip.folder(`scripts/${scriptType}`);

          // Iterate over each script key (e.g., "renderer", "component")
          Object.keys(scripts).forEach(scriptKey => {
              const scriptData = scripts[scriptKey];
              const scriptContent = scriptData.script || ''; // Fallback to empty string if no script

              // Add the script file to the folder
              folder.file(`${scriptKey}.js`, scriptContent);
          });
      });

      // Generate the zip file and trigger download
      zip.generateAsync({ type: 'blob' }).then(blob => {
          // Create a temporary URL for the blob
          const url = window.URL.createObjectURL(blob);

          // Create a temporary link element to trigger download
          const link = document.createElement('a');
          link.href = url;
          link.download = 'scripts.zip'; // Name of the downloaded file
          document.body.appendChild(link);
          link.click();

          // Clean up
          document.body.removeChild(link);
          window.URL.revokeObjectURL(url);
      }).catch(error => {
          console.error('Error generating zip file:', error);
      });
  }
}