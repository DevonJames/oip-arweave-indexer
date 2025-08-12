// Use env-driven API base injected by /config.js; fallback to same-origin
const backendURL = (typeof window !== 'undefined' && window.API_BASE_URL) ? window.API_BASE_URL : '';

// Function to save JWT token to local storage
function saveJwtToken(token) {
    localStorage.setItem('jwt', token);
    console.log('JWT token saved successfully.');
}

// Function to remove JWT token from local storage
function removeJwtToken() {
    localStorage.removeItem('jwt');
    console.log('JWT token removed successfully.');
}

// Handle login form submission
document.getElementById('login-form').addEventListener('submit', (event) => {
    event.preventDefault();

    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    fetch(`${backendURL}/api/user/login`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, password })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            saveJwtToken(data.token);
            document.getElementById('login-message').textContent = 'Login successful! Redirecting...';
            setTimeout(() => {
                window.location.href = 'admin.html';  // Redirect to the admin page
            }, 1000);
        } else {
            document.getElementById('login-message').textContent = data.error || 'Login failed.';
        }
    })
    .catch(error => {
        console.error('Error during login:', error);
        document.getElementById('login-message').textContent = 'An error occurred. Please try again.';
    });
});