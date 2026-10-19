import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';

export class FfmpegService {
  /**
   * Probes video metadata (duration, resolution, vertical check)
   */
  async probeVideo(filePath) {
    return new Promise((resolve) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) {
          // If FFmpeg is not installed on system PATH, resolve gracefully with defaults
          return resolve({
            available: false,
            error: err.message,
            duration: 0,
            width: 1080,
            height: 1920,
            isVertical: true,
          });
        }

        const videoStream = metadata.streams?.find((s) => s.codec_type === 'video');
        const width = videoStream?.width || 1080;
        const height = videoStream?.height || 1920;
        const duration = Math.round(metadata.format?.duration || 0);

        resolve({
          available: true,
          duration,
          width,
          height,
          isVertical: height > width,
          aspectRatio: `${width}:${height}`,
        });
      });
    });
  }

  /**
   * Generates a preview screenshot frame from a local video file
   */
  async generateThumbnail(videoPath, outputDir, filename = 'thumb.jpg') {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      ffmpeg(videoPath)
        .screenshots({
          timestamps: ['1'],
          filename,
          folder: outputDir,
          size: '320x568',
        })
        .on('end', () => resolve(path.join(outputDir, filename)))
        .on('error', (err) => reject(err));
    });
  }
}

export const ffmpegService = new FfmpegService();
