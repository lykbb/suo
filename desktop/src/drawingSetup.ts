// Serve drawing fonts from this application's bundle in both browser and desktop previews.
(window as Window & { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = new URL('/drawing-assets/', window.location.href).href;
