// content-protection.js - Enhanced Version

// Prevent right-click
document.addEventListener('contextmenu', function(e) {
  e.preventDefault();
  showMessage('Content protection is enabled. Right-click is disabled.');
});

// Prevent text selection
document.addEventListener('selectstart', function(e) {
  e.preventDefault();
});

// Prevent drag and drop for images and videos
document.addEventListener('dragstart', function(e) {
  if (e.target.tagName === 'IMG' || e.target.tagName === 'VIDEO' || e.target.tagName === 'A') {
    e.preventDefault();
  }
});

// Detect print screen key
document.addEventListener('keyup', function(e) {
  if (e.key === 'PrintScreen') {
    navigator.clipboard.writeText('').then(() => {
      showMessage('Screenshots are disabled on this website.');
      // Blur the screen briefly
      document.body.style.filter = 'blur(5px)';
      setTimeout(() => { document.body.style.filter = 'none'; }, 1000);
    });
  }
});

// Disable developer tools shortcuts
document.addEventListener('keydown', function(e) {
  // Disable F12
  if (e.keyCode === 123) {
    e.preventDefault();
    showMessage('Developer tools are disabled on this website.');
  }
  
  // Disable Ctrl+Shift+I (Chrome, Firefox)
  if (e.ctrlKey && e.shiftKey && e.keyCode === 73) {
    e.preventDefault();
    showMessage('Developer tools are disabled on this website.');
  }
  
  // Disable Ctrl+Shift+C (Chrome)
  if (e.ctrlKey && e.shiftKey && e.keyCode === 67) {
    e.preventDefault();
    showMessage('Developer tools are disabled on this website.');
  }
  
  // Disable Ctrl+U (View source)
  if (e.ctrlKey && e.keyCode === 85) {
    e.preventDefault();
    showMessage('View source is disabled on this website.');
  }
});

// Screen recording detection (modern browsers)
let screenRecordingDetected = false;

function checkForScreenRecording() {
  // Method 1: Check for getDisplayMedia support (screen sharing)
  if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
    const originalGetDisplayMedia = navigator.mediaDevices.getDisplayMedia;
    navigator.mediaDevices.getDisplayMedia = function(constraints) {
      showMessage('Screen recording detected! This content is protected.');
      screenRecordingDetected = true;
      document.body.style.filter = 'blur(10px)';
      return Promise.reject(new Error('Screen recording is not allowed'));
    };
  }

  // Method 2: Canvas fingerprinting detection
  const detectCanvasRead = () => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    let detected = false;
    
    const originalGetImageData = ctx.getImageData;
    ctx.getImageData = function() {
      if (!detected) {
        showMessage('Canvas access detected. Screen recording may be in progress.');
        detected = true;
      }
      return originalGetImageData.apply(this, arguments);
    };
  };

  // Method 3: Detect iframe capturing
  if (window.self !== window.top) {
    showMessage('This content is protected and cannot be embedded.');
    document.body.innerHTML = '<div style="padding: 20px; text-align: center;"><h2>Content Protection</h2><p>This content cannot be viewed in embedded frames.</p></div>';
  }

  // Method 4: Periodic visibility check
  let hiddenTime = 0;
  setInterval(() => {
    if (document.hidden) {
      hiddenTime += 1000;
      if (hiddenTime > 5000) { // 5 seconds hidden
        showMessage('Unusual activity detected. Please don\'t switch tabs during video playback.');
      }
    } else {
      hiddenTime = 0;
    }
  }, 1000);
}


// Helper function to show messages
function showMessage(message) {
  // Create message element if it doesn't exist
  let messageEl = document.getElementById('protection-message');
  if (!messageEl) {
    messageEl = document.createElement('div');
    messageEl.id = 'protection-message';
    messageEl.style.position = 'fixed';
    messageEl.style.top = '20px';
    messageEl.style.right = '20px';
    messageEl.style.backgroundColor = '#e10600';
    messageEl.style.color = 'white';
    messageEl.style.padding = '10px 15px';
    messageEl.style.borderRadius = '5px';
    messageEl.style.zIndex = '10000';
    messageEl.style.maxWidth = '300px';
    document.body.appendChild(messageEl);
  }
  
  // Show message
  messageEl.textContent = message;
  messageEl.style.display = 'block';
  
  // Hide after 3 seconds
  setTimeout(() => {
    messageEl.style.display = 'none';
  }, 3000);
}

// Initialize protection when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
  showMessage('Advanced content protection enabled');
  checkForScreenRecording();
  createDynamicWatermark();
  
  // Additional protection for video elements
  const videos = document.querySelectorAll('video');
  videos.forEach(video => {
    // Disable picture-in-picture
    video.disablePictureInPicture = true;
    
    // Add event listener for fullscreen changes
    video.addEventListener('enterpictureinpicture', function(e) {
      document.exitPictureInPicture().catch(() => {});
      showMessage('Picture-in-picture is disabled for protected content.');
    });
    
    // Prevent video from being downloaded
    video.addEventListener('contextmenu', function(e) {
      e.preventDefault();
      showMessage('Video right-click is disabled to protect content.');
    });
  });
});

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { showMessage };
}