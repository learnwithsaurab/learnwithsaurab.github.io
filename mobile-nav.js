// mobile-nav.js - Enhanced mobile navigation
document.addEventListener('DOMContentLoaded', function() {
  // Mobile menu functionality
  const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
  const navMenu = document.querySelector('.nav-menu');
  
  if (mobileMenuBtn && navMenu) {
    mobileMenuBtn.addEventListener('click', function() {
      const isExpanded = navMenu.classList.contains('active');
      navMenu.classList.toggle('active');
      mobileMenuBtn.classList.toggle('active');
      document.body.style.overflow = isExpanded ? '' : 'hidden';
      
      // Update aria-expanded attribute for accessibility
      mobileMenuBtn.setAttribute('aria-expanded', !isExpanded);
    });
    
    // Close menu when clicking outside
    document.addEventListener('click', function(event) {
      if (!event.target.closest('.nav-menu') && 
          !event.target.closest('.mobile-menu-btn') && 
          navMenu.classList.contains('active')) {
        closeMobileMenu();
      }
    });
    
    // Close menu when clicking on a link
    const navLinks = document.querySelectorAll('.nav-menu a');
    navLinks.forEach(link => {
      link.addEventListener('click', function() {
        closeMobileMenu();
      });
    });
    
    // Close menu with Escape key
    document.addEventListener('keydown', function(event) {
      if (event.key === 'Escape' && navMenu.classList.contains('active')) {
        closeMobileMenu();
      }
    });
  }
  
  function closeMobileMenu() {
    if (navMenu.classList.contains('active')) {
      navMenu.classList.remove('active');
      mobileMenuBtn.classList.remove('active');
      document.body.style.overflow = '';
      mobileMenuBtn.setAttribute('aria-expanded', 'false');
    }
  }
  
  // Touch device detection
  function isTouchDevice() {
    return 'ontouchstart' in window || 
           navigator.maxTouchPoints > 0 || 
           navigator.msMaxTouchPoints > 0;
  }
  
  if (isTouchDevice()) {
    document.body.classList.add('touch-device');
    
    // Add touch-specific improvements
    const buttons = document.querySelectorAll('button, a.btn, .cta-button');
    buttons.forEach(button => {
      button.style.minHeight = '44px';
      button.style.minWidth = '44px';
      button.style.display = 'flex';
      button.style.alignItems = 'center';
      button.style.justifyContent = 'center';
    });
  } else {
    document.body.classList.add('no-touch-device');
  }
  
  // Improve video player for touch devices
  const videos = document.querySelectorAll('video');
  videos.forEach(video => {
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
  });
  
  // Handle responsive images
  const images = document.querySelectorAll('img');
  images.forEach(img => {
    if (!img.hasAttribute('loading')) {
      img.setAttribute('loading', 'lazy');
    }
  });
  
  console.log('Mobile navigation loaded successfully');
});