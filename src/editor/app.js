/** @file Initializes the manual editor after application data is available. */

async function initializeEditor() {
  await window.ensureOskarsData();
  let finishRenderTimer = window.startOskarsPerformance?.("editor:render");
  document.body.dataset.editorReady = "true";
  finishRenderTimer?.(
    `${Object.keys(window.state.filmsById || {}).length} films`,
  );
}

initializeEditor().catch((err) => {
  console.error("Failed to initialize The Oskars editor", err);
  alert("Failed to initialize The Oskars editor: " + err.message);
});
