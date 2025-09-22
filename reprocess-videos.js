const mongoose = require('mongoose');
const { addWatermark } = require('./video-utils');
const Course = require('./models/Course'); // Adjust path to your Course model
const path = require('path');
const fs = require('fs');

async function reprocessAllVideos() {
  try {
    // Connect to your database
    await mongoose.connect('mongodb://localhost:27017/your-database-name', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log('Connected to database');

    // Find all courses with videos
    const courses = await Course.find({ 'modules.videos.0': { $exists: true } });

    let processedCount = 0;
    let errorCount = 0;

    for (const course of courses) {
      for (const module of course.modules) {
        if (module.videos && module.videos.length > 0) {
          for (const video of module.videos) {
            try {
              const videoPath = path.join(__dirname, 'uploads', 'videos', path.basename(video.videoUrl));
              
              if (fs.existsSync(videoPath)) {
                console.log(`Processing: ${video.videoTitle}`);
                
                // Create backup first
                const backupPath = videoPath + '.bak';
                if (!fs.existsSync(backupPath)) {
                  fs.copyFileSync(videoPath, backupPath);
                }
                
                // Add watermark
                await addWatermark(videoPath, videoPath, '© Learn with Saurab');
                
                processedCount++;
                console.log(`✓ Successfully processed: ${video.videoTitle}`);
              } else {
                console.log(`✗ File not found: ${video.videoTitle}`);
                errorCount++;
              }
            } catch (error) {
              console.error(`Error processing ${video.videoTitle}:`, error.message);
              errorCount++;
            }
          }
        }
      }
    }

    console.log(`\nProcessing complete!`);
    console.log(`Successfully processed: ${processedCount} videos`);
    console.log(`Errors: ${errorCount} videos`);
    
    await mongoose.connection.close();
    process.exit(0);
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  reprocessAllVideos();
}

module.exports = { reprocessAllVideos };