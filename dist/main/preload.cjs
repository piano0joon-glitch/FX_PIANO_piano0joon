"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld("pianoPuzzle", {
    getAppInfo: () => electron_1.ipcRenderer.invoke("app:info"),
    chooseAsset: (type) => electron_1.ipcRenderer.invoke("asset:choose", type),
    // 🧪 TEST: Read file by absolute path (DELETE AFTER TESTING)
    readAssetByPath: (filePath) => electron_1.ipcRenderer.invoke("asset:read-by-path", filePath)
});
