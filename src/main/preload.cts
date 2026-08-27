import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("pianoPuzzle", {
  getAppInfo: () => ipcRenderer.invoke("app:info"),
  chooseAsset: (type: "image" | "video" | "midi" | "audio") => ipcRenderer.invoke("asset:choose", type),
  // 🧪 TEST: Read file by absolute path (DELETE AFTER TESTING)
  readAssetByPath: (filePath: string) => ipcRenderer.invoke("asset:read-by-path", filePath)
});
