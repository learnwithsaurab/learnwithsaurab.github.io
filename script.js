// script.js - Professional Version

// Global variables
let isLoading = false;

// Utility Functions
const showLoading = () => {
    isLoading = true;
    document.body.style.cursor = 'wait';
    // You could add a loading spinner here
};

const hideLoading = () => {
    isLoading = false;
    document.body.style.cursor = 'default';
};

// Professional notification system
const showNotification = (message, type = 'info') => {
    // Remove any existing notifications
    const existingNotification = document.getElementById('custom-notification');
    if (existingNotification) {
        existingNotification.remove();
    }

    // Create notification element
    const notification = document.createElement('div');
    notification.id = 'custom-notification';
    notification.style.cssText = `
        position: fixed;
        top: 100px;
        right: 20px;
        padding: 16px 24px;
        border-radius: 8px;
        color: white;
        font-family: 'Inter', sans-serif;
        font-weight: 500;
        z-index: 10000;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
        transform: translateX(100%);
        transition: transform 0.3s ease;
        max-width: 350px;
        backdrop-filter: blur(10px);
    `;

    // Set background color based on type
    const colors = {
        success: 'linear-gradient(135deg, #38A169 0%, #2F855A 100%)',
        error: 'linear-gradient(135deg, #E53E3E 0%, #C53030 100%)',
        warning: 'linear-gradient(135deg, #D69E2E 0%, #B7791F 100%)',
        info: 'linear-gradient(135deg, #4C6EF5 0%, #3B5BDB 100%)'
    };

    notification.style.background = colors[type] || colors.info;

    notification.textContent = message;
    document.body.appendChild(notification);

    // Animate in
    setTimeout(() => {
        notification.style.transform = 'translateX(0)';
    }, 10);

    // Auto remove after 5 seconds
    setTimeout(() => {
        if (notification.parentNode) {
            notification.style.transform = 'translateX(100%)';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.remove();
                }
            }, 300);
        }
    }, 5000);
};

// Enhanced buy course function with professional UX
async function buyCourse(courseId, price, courseName) {
    if (isLoading) return;
    
    try {
        showLoading();
        console.log("Initiating payment for:", courseId, courseName, price);
        
        // Show processing notification
        showNotification('Processing your payment...', 'info');

        // Send payment request to our server
        const response = await fetch('/khalti-pay', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                amount: price,
                courseId: courseId,
                courseName: courseName
            })
        });

        const result = await response.json();
        
        if (result.success) {
            showNotification('Redirecting to payment gateway...', 'success');
            // Small delay for user to see the message
            setTimeout(() => {
                window.location.href = result.payment_url;
            }, 1500);
        } else {
            showNotification('Payment initialization failed: ' + result.message, 'error');
            console.error('Payment failed:', result.message);
        }
    } catch (error) {
        console.error('Payment Error:', error);
        showNotification('Network error. Please check your connection and try again.', 'error');
    } finally {
        hideLoading();
    }
}

// Enhanced free enrollment function
async function enrollFree(courseId) {
    if (isLoading) return;
    
    if (!confirm('Are you sure you want to enroll in the free preview? You will be redirected to your dashboard.')) {
        return;
    }

    try {
        showLoading();
        showNotification('Enrolling in course...', 'info');

        const response = await fetch(`/enroll-free/${courseId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            }
        });

        if (response.ok) {
            showNotification('Successfully enrolled in free preview!', 'success');
            // Redirect after a short delay to show the success message
            setTimeout(() => {
                window.location.href = '/dashboard';
            }, 1500);
        } else {
            const errorData = await response.text();
            showNotification('Enrollment failed. Please try again.', 'error');
            console.error('Enrollment failed:', errorData);
        }
    } catch (error) {
        console.error('Enrollment error:', error);
        showNotification('Network error. Please check your connection.', 'error');
    } finally {
        hideLoading();
    }
}

// Course search functionality (if implemented in future)
function searchCourses() {
    const searchTerm = document.getElementById('course-search')?.value.toLowerCase();
    const courseCards = document.querySelectorAll('.course-card');
    
    courseCards.forEach(card => {
        const title = card.querySelector('.course-title')?.textContent.toLowerCase();
        const description = card.querySelector('.course-description')?.textContent.toLowerCase();
        
        if (title.includes(searchTerm) || description.includes(searchTerm)) {
            card.style.display = 'block';
            card.style.animation = 'slideIn 0.5s ease';
        } else {
            card.style.display = 'none';
        }
    });
}

// Smooth scrolling for anchor links
document.addEventListener('DOMContentLoaded', function() {
    // Smooth scroll for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });

    // Add loading states to all buttons
    document.querySelectorAll('button, .cta-button').forEach(button => {
        button.addEventListener('click', function() {
            if (this.getAttribute('data-loading') !== 'true') {
                this.setAttribute('data-original-text', this.textContent);
                this.innerHTML = '<span class="loading-spinner"></span> Processing...';
                this.setAttribute('data-loading', 'true');
                this.disabled = true;
            }
        });
    });

    // Course card hover effects
    const courseCards = document.querySelectorAll('.course-card');
    courseCards.forEach(card => {
        card.addEventListener('mouseenter', () => {
            card.style.transform = 'translateY(-8px) scale(1.02)';
        });
        
        card.addEventListener('mouseleave', () => {
            card.style.transform = 'translateY(0) scale(1)';
        });
    });
});

// Keyboard navigation support
document.addEventListener('keydown', function(e) {
    // ESC key closes notifications
    if (e.key === 'Escape') {
        const notification = document.getElementById('custom-notification');
        if (notification) {
            notification.remove();
        }
    }
});

// Network status monitoring
window.addEventListener('online', function() {
    showNotification('Connection restored', 'success');
});

window.addEventListener('offline', function() {
    showNotification('You are offline. Some features may not work.', 'warning');
});

// Performance monitoring
const reportWebVitals = () => {
    if ('connection' in navigator) {
        console.log('Connection type:', navigator.connection.effectiveType);
        console.log('Data saving mode:', navigator.connection.saveData);
    }
};

// Initialize when DOM is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', reportWebVitals);
} else {
    reportWebVitals();
}

// Error boundary for the script
window.addEventListener('error', function(e) {
    console.error('Script error:', e.error);
    showNotification('A technical error occurred. Please refresh the page.', 'error');
});

// Add CSS for loading spinner
const addLoadingStyles = () => {
    const style = document.createElement('style');
    style.textContent = `
        .loading-spinner {
            display: inline-block;
            width: 16px;
            height: 16px;
            border: 2px solid #ffffff;
            border-radius: 50%;
            border-top-color: transparent;
            animation: spin 1s ease-in-out infinite;
            margin-right: 8px;
        }
        
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        
        #custom-notification {
            font-family: 'Inter', sans-serif;
        }
        
        button[data-loading="true"] {
            opacity: 0.8;
            pointer-events: none;
        }
        
        /* Focus styles for accessibility */
        button:focus, 
        .cta-button:focus {
            outline: 2px solid #e10600;
            outline-offset: 2px;
        }
        
        /* Reduced motion support */
        @media (prefers-reduced-motion: reduce) {
            .loading-spinner {
                animation: none;
            }
            
            .course-card {
                transition: none;
            }
            
            #custom-notification {
                transition: none;
            }
        }
    `;
    document.head.appendChild(style);
};

// Initialize styles when script loads
addLoadingStyles();

// Export functions for potential module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { buyCourse, enrollFree, showNotification };
}