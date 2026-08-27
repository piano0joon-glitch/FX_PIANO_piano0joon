import electron from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";

const { dialog } = electron;

const filters: Record<"image" | "video" | "midi" | "audio", { name: string; extensions: string[] }[]> = {
  image: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }],
  video: [{ name: "Videos", extensions: ["mp4", "mov", "webm", "m4v"] }],
  midi: [{ name: "MIDI", extensions: ["mid", "midi"] }],
  audio: [{ name: "Audio", extensions: ["wav", "mp3", "ogg", "m4a"] }]
} as const;

function mimeTypeForExtension(extension: string): string {
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  if (extension === ".mid" || extension === ".midi") return "audio/midi";
  if (extension === ".mp4" || extension === ".m4v") return "video/mp4";
  if (extension === ".mov") return "video/quicktime";
  if (extension === ".webm") return "video/webm";
  if (extension === ".wav") return "audio/wav";
  if (extension === ".mp3") return "audio/mpeg";
  if (extension === ".ogg") return "audio/ogg";
  if (extension === ".m4a") return "audio/mp4";
  return "application/octet-stream";
}

// 🧪 TEST: Read file by absolute path without dialog (DELETE AFTER TESTING)
export async function readAssetByPath(filePath: string) {
  const stat = await fs.stat(filePath);
  const extension = path.extname(filePath).toLowerCase();
  const mimeType = mimeTypeForExtension(extension);
  const bytes = await fs.readFile(filePath);
  return { filePath, fileName: path.basename(filePath), fileSize: stat.size, mimeType, dataBase64: bytes.toString("base64") };
}

export async function chooseAsset(type: keyof typeof filters) {
  const result = await dialog.showOpenDialog({ properties: ["openFile"], filters: [...filters[type]] });
  if (result.canceled || !result.filePaths[0]) return null;
  const filePath = result.filePaths[0];
  const stat = await fs.stat(filePath);
  const extension = path.extname(filePath).toLowerCase();
  const mimeType = mimeTypeForExtension(extension);
  const bytes = await fs.readFile(filePath);
  return { filePath, fileName: path.basename(filePath), fileSize: stat.size, mimeType, dataBase64: bytes.toString("base64") };
}
