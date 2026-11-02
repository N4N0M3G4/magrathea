// One stacking column for GEO-RECON panels, so they never overlap each other.
export function leftDock() {
  let dock = document.getElementById('gr-left-dock');
  if (!dock) {
    dock = document.createElement('div');
    dock.id = 'gr-left-dock';
    dock.style.cssText =
      'position:fixed;left:12px;bottom:120px;z-index:50;display:flex;flex-direction:column;gap:8px;' +
      'width:290px;max-width:calc(100vw - 24px);max-height:calc(100vh - 510px);overflow-y:auto';
    document.body.append(dock);
  }
  return dock;
}
