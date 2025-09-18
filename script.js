// script.js
async function buyCourse(courseId, price, courseName) {
    try {
        console.log("Initiating payment for:", courseId, courseName, price);
        
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
            // Redirect to Khalti payment page
            window.location.href = result.payment_url;
        } else {
            alert('Payment failed to initialize: ' + result.message);
        }
    } catch (error) {
        console.error('Error:', error);
        alert('An error occurred. Please try again.');
    }
}

// Free enrollment function
async function enrollFree(courseId) {
    try {
        const response = await fetch(`/enroll-free/${courseId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            }
        });

        if (response.ok) {
            alert('Successfully enrolled in free preview!');
            window.location.href = '/dashboard';
        } else {
            alert('Enrollment failed. Please try again.');
        }
    } catch (error) {
        console.error('Enrollment error:', error);
        alert('An error occurred during enrollment.');
    }
}