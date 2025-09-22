// video-utils.js
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');

// Function to add watermark to video
function addWatermark(inputPath, outputPath, watermarkText) {
  return new Promise((resolve, reject) => {
    // Check if FFmpeg is available
    ffmpeg.getAvailableFilters((err, filters) => {
      if (err) {
        reject(new Error('FFmpeg not available'));
        return;
      }
      
      ffmpeg(inputPath)
        .videoFilters({
          filter: 'drawtext',
          options: {
            text: watermarkText,
            fontfile: path.join(__dirname, 'fonts', 'Arial.ttf'), // You need to provide a font file
            fontcolor: 'white',
            fontsize: 24,
            alpha: 0.5,
            x: '(w-text_w)/2',
            y: '(h-text_h)/2',
            box: 1,
            boxcolor: 'black@0.5',
            boxborderw: 5
          }
        })
        .on('end', () => resolve(outputPath))
        .on('error', (err) => reject(err))
        .save(outputPath);
    });
  });
}

// Function to check if FFmpeg is available
function checkFFmpeg() {
  return new Promise((resolve) => {
    ffmpeg.getAvailableFilters((err, filters) => {
      resolve(!err);
    });
  });
}

module.exports = {
  addWatermark,
  checkFFmpeg
};