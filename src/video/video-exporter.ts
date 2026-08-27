export interface CanvasVideoExportOptions {
  canvas: HTMLCanvasElement;
  durationMs: number;
  fps: 30 | 60;
  videoBitsPerSecond: number;
  preferredFormat: "webm" | "mp4";
  audioStream?: MediaStream;
  onProgress?: (progress: number) => void;
  onStart?: () => void | Promise<void>;
  onStop?: () => void | Promise<void>;
}

export interface CanvasVideoExportResult {
  blob: Blob;
  mimeType: string;
  extension: "webm" | "mp4";
}

function supportedMimeType(preferredFormat: "webm" | "mp4"): { mimeType: string; extension: "webm" | "mp4" } {
  if (typeof MediaRecorder === "undefined") {
    throw new Error("این نسخه از Chromium قابلیت ضبط ویدئو را ندارد.");
  }

  const candidates = preferredFormat === "mp4"
    ? [
        { mimeType: "video/mp4;codecs=avc1.42E01E,mp4a.40.2", extension: "mp4" as const },
        { mimeType: "video/mp4", extension: "mp4" as const },
        { mimeType: "video/webm;codecs=vp9,opus", extension: "webm" as const },
        { mimeType: "video/webm;codecs=vp8,opus", extension: "webm" as const },
        { mimeType: "video/webm", extension: "webm" as const }
      ]
    : [
        { mimeType: "video/webm;codecs=vp9,opus", extension: "webm" as const },
        { mimeType: "video/webm;codecs=vp8,opus", extension: "webm" as const },
        { mimeType: "video/webm", extension: "webm" as const }
      ];

  const supported = candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate.mimeType));
  if (!supported) throw new Error("فرمت ویدئویی قابل ضبط روی این سیستم پیدا نشد.");
  return supported;
}

function stopTracks(stream: MediaStream) {
  for (const track of stream.getTracks()) track.stop();
}

export async function recordCanvasVideo(options: CanvasVideoExportOptions): Promise<CanvasVideoExportResult> {
  if (!options.canvas.captureStream) throw new Error("مرورگر این سیستم از ضبط مستقیم بوم پشتیبانی نمی‌کند.");
  if (!Number.isFinite(options.durationMs) || options.durationMs <= 0) throw new Error("مدت انیمیشن برای خروجی گرفتن معتبر نیست.");

  const selected = supportedMimeType(options.preferredFormat);
  const stream = options.canvas.captureStream(options.fps);
  const clonedAudioTracks = options.audioStream?.getAudioTracks().map((track) => track.clone()) ?? [];
  for (const track of clonedAudioTracks) stream.addTrack(track);
  const recorder = new MediaRecorder(stream, {
    mimeType: selected.mimeType,
    videoBitsPerSecond: Math.max(500_000, Math.round(options.videoBitsPerSecond))
  });
  const chunks: BlobPart[] = [];
  let timer = 0;
  let settled = false;

  const result = await new Promise<CanvasVideoExportResult>((resolve, reject) => {
    const finish = async (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearInterval(timer);
      stopTracks(stream);
      try {
        await options.onStop?.();
      } catch (caught) {
        error = caught instanceof Error ? caught : new Error(String(caught));
      }
      if (error) {
        reject(error);
        return;
      }
      resolve({ blob: new Blob(chunks, { type: selected.mimeType }), mimeType: selected.mimeType, extension: selected.extension });
    };

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onerror = () => void finish(new Error("ضبط ویدئو با خطا متوقف شد."));
    recorder.onstop = () => void finish();

    void (async () => {
      try {
        await options.onStart?.();
        recorder.start(250);
        const startedAt = performance.now();
        timer = window.setInterval(() => {
          const progress = Math.min(1, (performance.now() - startedAt) / options.durationMs);
          options.onProgress?.(progress);
          if (progress >= 1 && recorder.state !== "inactive") recorder.stop();
        }, 50);
        options.onProgress?.(0);
      } catch (caught) {
        if (recorder.state !== "inactive") recorder.stop();
        await finish(caught instanceof Error ? caught : new Error(String(caught)));
      }
    })();
  });

  options.onProgress?.(1);
  return result;
}

export function downloadVideoBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
