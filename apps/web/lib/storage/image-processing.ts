/**
 * Image processing extension points.
 *
 * Per this phase's explicit instruction ("prepare architecture for avatar
 * resizing, thumbnail generation, image optimization, future virus scanning
 * integration — do not implement image processing itself"), every function
 * below is a documented no-op. Each is called from the exact point in
 * lib/storage/service.ts where real processing would need to hook in, so a
 * future phase can implement the body without restructuring the upload
 * flow around it.
 */

export interface ImageProcessingResult {
  processed: boolean;
  outputPath?: string;
  metadata?: Record<string, unknown>;
}

export interface ImageProcessor {
  /** Resize an avatar to the platform's standard dimensions. */
  resizeAvatar(sourcePath: string): Promise<ImageProcessingResult>;
  /** Generate a thumbnail for a larger media file (chat/challenge media). */
  generateThumbnail(sourcePath: string): Promise<ImageProcessingResult>;
  /** Re-encode/compress an image to reduce storage footprint. */
  optimizeImage(sourcePath: string): Promise<ImageProcessingResult>;
  /**
   * Scan a freshly-uploaded file for malicious content before it's marked
   * `active` in file_uploads. Real implementations would call an external
   * scanning service (e.g. ClamAV, a cloud provider's malware-scanning API)
   * and should leave the file in `status='quarantined'` (see migration 0031)
   * until a clean result comes back.
   */
  scanForThreats(sourcePath: string): Promise<{ clean: boolean; details?: string }>;
}

/**
 * No-op implementation used until a real processor is wired in. Every
 * method returns `processed: false` / `clean: true` so the upload pipeline
 * behaves exactly as if no processing step exists yet — which is the
 * honest current state, not a simulated success.
 */
export const noopImageProcessor: ImageProcessor = {
  async resizeAvatar() {
    return { processed: false };
  },
  async generateThumbnail() {
    return { processed: false };
  },
  async optimizeImage() {
    return { processed: false };
  },
  async scanForThreats() {
    return { clean: true, details: "No scanning integration configured yet." };
  },
};
