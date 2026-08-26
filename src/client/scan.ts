/**
 * Reading a recovery key off another device's screen.
 *
 * The other half of `qr.tsx`. Nothing here decides anything: it hands text to
 * `importAccount`, which is the only thing that decides whether text is an
 * account, and does it by signing with the key and verifying the signature.
 * So a misread, a stray poster in the background, or a QR from some other app
 * all end at the same honest refusal.
 *
 * ## Detection is the platform's, and may not be there
 *
 * `BarcodeDetector` is a browser API. Android's WebView has it, which is the
 * case that matters -- the phone is the device being set *up*, and the phone
 * is the one holding the camera -- but plenty of desktop browsers do not, and
 * iOS Safari does not. Bundling a decoder to cover them is forty kilobytes on
 * every visit to a lobby to serve a path that already has a working answer, so
 * this feature-detects and the paste box stays. `canScan()` is what the UI
 * asks before offering a button, and offering nothing is a legitimate outcome.
 *
 * A second reason the fallback has to stay: `getUserMedia` needs a secure
 * context, so on a plain-http LAN address -- the way this app is tested on a
 * real phone -- there is no camera at all.
 */

/** The slice of `BarcodeDetector` this uses. The DOM lib does not have it. */
interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
interface DetectorClass {
  new (options?: { formats?: string[] }): Detector;
  getSupportedFormats?(): Promise<string[]>;
}
function detectorClass(): DetectorClass | null {
  const found = (window as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
  return typeof found === "function" ? found : null;
}

/** Whether to offer the button at all. Cheap, synchronous, no permission prompt. */
export function canScan(): boolean {
  return detectorClass() !== null && typeof navigator.mediaDevices?.getUserMedia === "function";
}

/** A scan in progress. Stopping it is the caller's job, and it must happen. */
export interface Scan {
  stop(): void;
}

/**
 * Point the camera at a screen until something decodes.
 *
 * Rejects if the camera is refused or missing, which is a thing to tell
 * somebody about rather than a thing to retry, and is why it is not folded
 * into `canScan`: whether the API exists can be asked without a prompt, and
 * whether this person will allow it cannot.
 *
 * Polled on a timer rather than `requestAnimationFrame`, because a hidden
 * document never fires one -- the Browser pane is the standing example -- and
 * a scanner that silently stops when a tab is backgrounded is a scanner that
 * appears to have hung. `detect` on a 61-module code takes a few milliseconds;
 * every 250ms is far more often than a hand can be steadied.
 */
export async function scanQr(
  video: HTMLVideoElement,
  found: (text: string) => void,
): Promise<Scan> {
  const Detector = detectorClass();
  if (!Detector) throw new Error("no detector");

  // The rear camera, where there is a choice. `facingMode` is a preference
  // rather than a constraint on purpose: a laptop has one camera facing the
  // wrong way by this definition, and it is the only one it has.
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment" },
  });

  let timer = 0;
  let live = true;
  const stop = () => {
    live = false;
    clearTimeout(timer);
    for (const track of stream.getTracks()) track.stop();
    video.srcObject = null;
  };

  video.srcObject = stream;
  video.setAttribute("playsinline", "");
  video.muted = true;
  try {
    await video.play();
  } catch {
    // Autoplay refused. The stream is still attached and some browsers paint
    // it anyway, so this is not fatal -- but it is not worth pretending the
    // scan will work either.
    stop();
    throw new Error("no preview");
  }

  const detector = new Detector({ formats: ["qr_code"] });
  const tick = async () => {
    if (!live) return;
    try {
      const codes = await detector.detect(video);
      // Stopped before the callback: it is going to unmount this element, and
      // a detect already in flight against a dead track throws on some
      // builds.
      if (codes.length > 0 && live) {
        stop();
        found(codes[0].rawValue);
        return;
      }
    } catch {
      // A frame that could not be read is the ordinary case, not an error:
      // the camera is still focusing, or the code is half out of shot.
    }
    if (live) timer = window.setTimeout(tick, 250);
  };
  timer = window.setTimeout(tick, 250);

  return { stop };
}
