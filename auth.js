// Anonymous Authentication
const startBtn = document.getElementById('start-btn');
const authError = document.getElementById('auth-error');

// Check if already signed in
auth.onAuthStateChanged((user) => {
    if (user) {
        // Already signed in, redirect to app
        window.location.href = 'index.html';
    }
});

// Handle anonymous sign in
startBtn.addEventListener('click', async () => {
    try {
        startBtn.disabled = true;
        startBtn.textContent = 'Starting...';
        authError.textContent = '';

        await auth.signInAnonymously();

        // Redirect happens automatically via onAuthStateChanged
    } catch (error) {
        console.error('Authentication error:', error);
        authError.textContent = getErrorMessage(error.code);
        startBtn.disabled = false;
        startBtn.textContent = 'Start Using Contexture';
    }
});

function getErrorMessage(code) {
    switch (code) {
        case 'auth/operation-not-allowed':
            return 'Anonymous authentication is not enabled. Please contact support.';
        case 'auth/network-request-failed':
            return 'Network error. Please check your connection.';
        default:
            return 'An error occurred. Please try again.';
    }
}
