import { desktopCapturer, screen } from 'electron';

export interface ScreenshotInfo {
  base64: string;
  label: string;
  displayIndex: number;
  capturedWidth: number;
  capturedHeight: number;
  screenWidth: number;
  screenHeight: number;
}

export interface CapturedScreen {
  imageDataUrl: string;
  displayId: string;
  label: string;
  bounds: Electron.Rectangle;
  displayIndex: number;
  capturedWidth: number;
  capturedHeight: number;
}

export class ScreenCaptureManager {
  async captureAllScreens(): Promise<CapturedScreen[]> {
    const displays = screen.getAllDisplays();
    const primaryDisplay = screen.getPrimaryDisplay();

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: 1280,
        height: 720,
      },
    });

    console.log(`[ScreenCaptureManager] Found ${sources.length} screen source(s), ${displays.length} display(s)`);

    const results: CapturedScreen[] = [];

    for (let i = 0; i < sources.length; i++) {
      const source = sources[i];
      const display = displays[i] || displays[0];

      const isPrimary = display.id === primaryDisplay.id;
      const label = isPrimary ? `Screen ${i + 1} (Primary)` : `Screen ${i + 1}`;

      const thumbnail = source.thumbnail;
      if (!thumbnail || thumbnail.isEmpty()) {
        console.warn(`[ScreenCaptureManager] Empty thumbnail for source: ${source.name}`);
        continue;
      }

      const { width: capturedWidth, height: capturedHeight } = thumbnail.getSize();
      const jpegBuffer = thumbnail.toJPEG(85);
      const base64 = jpegBuffer.toString('base64');

      results.push({
        imageDataUrl: `data:image/jpeg;base64,${base64}`,
        displayId: String(display.id),
        label,
        bounds: display.bounds,
        displayIndex: i,
        capturedWidth,
        capturedHeight,
      });

      console.log(`[ScreenCaptureManager] Captured ${label}: ${display.bounds.width}x${display.bounds.height} → ${capturedWidth}x${capturedHeight}`);
    }

    return results;
  }

  async captureAllScreensAsBase64(): Promise<ScreenshotInfo[]> {
    const screens = await this.captureAllScreens();
    return screens.map((s) => ({
      base64: s.imageDataUrl.replace(/^data:image\/jpeg;base64,/, ''),
      label: s.label,
      displayIndex: s.displayIndex,
      capturedWidth: s.capturedWidth,
      capturedHeight: s.capturedHeight,
      screenWidth: s.bounds.width,
      screenHeight: s.bounds.height,
    }));
  }
}
