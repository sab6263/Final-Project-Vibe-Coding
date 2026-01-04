// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyD7GG1N_-RHd29ta2E5f92CbZ0T0s-fUu4",
    authDomain: "contexture-app.firebaseapp.com",
    projectId: "contexture-app",
    storageBucket: "contexture-app.firebasestorage.app",
    messagingSenderId: "906861687750",
    appId: "1:906861687750:web:4a4233b4cb70ea1a1ff8c7"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Initialize services
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

// Enable offline persistence
db.enablePersistence()
    .catch((err) => {
        if (err.code === 'failed-precondition') {
            console.warn('Multiple tabs open, persistence can only be enabled in one tab at a time.');
        } else if (err.code === 'unimplemented') {
            console.warn('The current browser does not support offline persistence');
        }
    });

// Auth persistence
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
