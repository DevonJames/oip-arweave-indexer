// Use env-driven API base injected by /config.js; fallback to same-origin
const backendURL = (typeof window !== 'undefined' && window.API_BASE_URL) ? window.API_BASE_URL : '';
let token; 
// Ensure admin is authenticated when the page loads
document.addEventListener('DOMContentLoaded', () => {
    token = localStorage.getItem('jwt');
    console.log("Retrieved token:", token);

    if (!token) {
        alert('User not authenticated. Redirecting to login page.');
        window.location.href = 'admin_login.html';  // Redirect to login if not authenticated
    } else {
        // Fetch admin details using the token
        fetchAdminDetails(token);
    }
});

// Fetch admin details or protected data
function fetchAdminDetails(token) {
    fetch(`${backendURL}/api/user/admin/users`, {  // Updated endpoint for admin users
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`
        }
    })
    .then(response => {
        if (!response.ok) {
            throw new Error('Unauthorized or session expired');
        }
        return response.json();
    })
    .then(data => {
        populateUserTable(data);  // Populate user data into the table
    })
    .catch(error => {
        console.error('Error fetching admin details:', error);
        alert('Session expired or unauthorized. Redirecting to login.');
        removeJwtToken();
        window.location.href = 'admin_login.html';
    });
}

// Populate user data into the table
function populateUserTable(users) {
    const userTableBody = document.getElementById('user-table-body');

    // Clear any existing rows
    userTableBody.innerHTML = '';

    users.forEach(user => {
        const row = document.createElement('tr');

        // Populate table with user information
        row.innerHTML = `
            <td>${user.email}</td>
            <td>${user.userId || 'N/A'}</td>
            <td>${user.subscriptionStatus || 'Inactive'}</td>
            <td>${user.waitlistStatus || 'N/A'}</td>
            <td>${user.isAdmin ? 'Yes' : 'No'}</td>
        `;

        userTableBody.appendChild(row);
    });
}

// Logout and token removal
function removeJwtToken() {
    localStorage.removeItem('jwt');
}

// Handle logout button, if present
document.getElementById('logout-btn')?.addEventListener('click', () => {
    removeJwtToken();
    alert('You have been logged out.');
    window.location.href = 'admin_login.html';
});