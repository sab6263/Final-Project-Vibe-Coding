# Firebase Setup for Anonymous Authentication

## Step 1: Enable Anonymous Authentication

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project "contexture-app"
3. In the left sidebar, click **Authentication**
4. Go to the **Sign-in method** tab
5. Click on **Anonymous**
6. Toggle **Enable**
7. Click **Save**

## Step 2: Verify Firestore and Storage

Make sure Firestore and Storage are still enabled with the security rules from the previous setup.

### Firestore Rules
Should already be set from before. If not, use these rules:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isAuthenticated() {
      return request.auth != null;
    }
    
    match /users/{userId} {
      allow read, write: if isAuthenticated() && request.auth.uid == userId;
      match /metadata/{document=**} {
        allow read, write: if isAuthenticated() && request.auth.uid == userId;
      }
    }
    
    match /projects/{projectId} {
      allow read, write: if isAuthenticated() && resource.data.userId == request.auth.uid;
      allow create: if isAuthenticated() && request.resource.data.userId == request.auth.uid;
    }
    
    match /guidelines/{guidelineId} {
      allow read, write: if isAuthenticated() && resource.data.userId == request.auth.uid;
      allow create: if isAuthenticated() && request.resource.data.userId == request.auth.uid;
    }
    
    match /questions/{questionId} {
      allow read, write: if isAuthenticated() && resource.data.userId == request.auth.uid;
      allow create: if isAuthenticated() && request.resource.data.userId == request.auth.uid;
    }
    
    match /subquestions/{subquestionId} {
      allow read, write: if isAuthenticated() && resource.data.userId == request.auth.uid;
      allow create: if isAuthenticated() && request.resource.data.userId == request.auth.uid;
    }

    match /interviews/{interviewId} {
      allow read, write: if isAuthenticated() && resource.data.userId == request.auth.uid;
      allow create: if isAuthenticated() && request.resource.data.userId == request.auth.uid;
    }
  }
}
```

### Storage Rules
Should already be set. If not:

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /users/{userId}/pdfs/{allPaths=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

## Step 3: Test the Application

1. Open `auth.html` in your browser
2. Click **"Start Using Contexture"**
3. You should be redirected to the main app
4. Create a project to test data persistence
5. Refresh the page - your project should still be there!

## Important Notes

### Privacy
- ✅ **Zero personal data collected** - no email, name, or phone number
- ✅ **Anonymous user ID** - Firebase assigns a unique ID to each device
- ✅ **Data stays on device** - tied to browser storage

### Data Persistence
- ✅ Data persists across page refreshes
- ✅ Data syncs to Firebase cloud
- ⚠️ **Clearing browser data deletes the anonymous account**
- ⚠️ **Cannot access data from other devices** (no login credentials)

### User Experience
- Users click one button to start
- No forms, no passwords, no email verification
- Instant access to the app

## Troubleshooting

### "Anonymous authentication is not enabled"
- Make sure you enabled Anonymous auth in Firebase Console
- Check that you clicked "Save" after enabling

### Data not persisting
- Check Firestore security rules are published
- Verify Storage rules are published
- Check browser console for errors

## Next Steps

The app is now fully functional with:
- ✅ Anonymous authentication
- ✅ Project persistence
- ✅ Guideline persistence  
- ✅ Question persistence
- ✅ Maximum privacy (zero personal data)
