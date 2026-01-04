/**
 * Firebase Data Layer
 * Handles all Firestore operations for projects, guidelines, questions, and subquestions
 */

// ============================================================================
// FIRESTORE DATA OPERATIONS
// ============================================================================

/**
 * Load all user data from Firestore
 */
async function loadUserData() {
    if (!currentUser) return;

    try {
        // Check if this is first login - migrate from localStorage if needed
        await migrateFromLocalStorage();

        // Load projects from Firestore (without orderBy to avoid index requirement)
        const projectsSnapshot = await db.collection('projects')
            .where('userId', '==', currentUser.uid)
            .get();

        projects = projectsSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        // Sort by createdAt in JavaScript (newest first)
        projects.sort((a, b) => {
            const aTime = a.createdAt?.toMillis() || 0;
            const bTime = b.createdAt?.toMillis() || 0;
            return bTime - aTime;
        });

        // Render the UI
        render();

    } catch (error) {
        console.error('Error loading user data:', error);
        alert('Failed to load your data. Please refresh the page.');
    }
}

/**
 * Save a new project to Firestore
 */
async function saveProjectToFirestore(projectData) {
    if (!currentUser) return null;

    try {
        const docRef = await db.collection('projects').add({
            userId: currentUser.uid,
            name: projectData.name,
            status: projectData.status || 'Active',
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        return docRef.id;
    } catch (error) {
        console.error('Error saving project:', error);
        throw error;
    }
}

/**
 * Update a project in Firestore
 */
async function updateProjectInFirestore(projectId, updates) {
    if (!currentUser) return;

    try {
        await db.collection('projects').doc(projectId).update({
            ...updates,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    } catch (error) {
        console.error('Error updating project:', error);
        throw error;
    }
}

/**
 * Delete a project and all its related data from Firestore
 */
async function deleteProjectFromFirestore(projectId) {
    console.log('deleteProjectFromFirestore called for ID:', projectId);
    console.log('Current User:', currentUser);

    if (!currentUser) {
        console.error('Cannot delete: No user logged in');
        return;
    }

    try {
        // Delete all guidelines for this project
        const guidelinesSnapshot = await db.collection('guidelines')
            .where('projectId', '==', projectId)
            .where('userId', '==', currentUser.uid)
            .get();

        const batch = db.batch();

        for (const guidelineDoc of guidelinesSnapshot.docs) {
            const guidelineId = guidelineDoc.id;

            // Delete all questions for this guideline
            const questionsSnapshot = await db.collection('questions')
                .where('guidelineId', '==', guidelineId)
                .where('userId', '==', currentUser.uid)
                .get();

            for (const questionDoc of questionsSnapshot.docs) {
                const questionId = questionDoc.id;

                // Delete all subquestions for this question
                const subquestionsSnapshot = await db.collection('subquestions')
                    .where('questionId', '==', questionId)
                    .where('userId', '==', currentUser.uid)
                    .get();

                subquestionsSnapshot.docs.forEach(doc => batch.delete(doc.ref));
                batch.delete(questionDoc.ref);
            }

            // Delete PDF from storage if exists
            const pdfUrl = guidelineDoc.data().pdfUrl;
            if (pdfUrl) {
                try {
                    const pdfRef = storage.refFromURL(pdfUrl);
                    await pdfRef.delete();
                } catch (err) {
                    console.warn('Could not delete PDF:', err);
                }
            }

            batch.delete(guidelineDoc.ref);
        }

        // Delete the project itself
        const projectRef = db.collection('projects').doc(projectId);
        console.log('Deleting project doc:', projectId);
        batch.delete(projectRef);

        console.log('Committing delete batch...');
        await batch.commit();
        console.log('Project deleted successfully from Firestore');

    } catch (error) {
        console.error('Error deleting project:', error);
        console.error('Error code:', error.code);
        console.error('Error message:', error.message);
        throw error;
    }
}

/**
 * Delete a guideline and all its related data (questions, subquestions)
 */
async function deleteGuidelineFromFirestore(guidelineId) {
    if (!currentUser) return;
    console.log('deleteGuidelineFromFirestore called for ID:', guidelineId);

    try {
        const batch = db.batch();

        // 1. Get the guideline doc to check for PDF
        const guidelineDoc = await db.collection('guidelines').doc(guidelineId).get();
        if (!guidelineDoc.exists) {
            console.warn('Guideline not found:', guidelineId);
            return;
        }

        // 2. Delete questions and subquestions
        const questionsSnapshot = await db.collection('questions')
            .where('guidelineId', '==', guidelineId)
            .where('userId', '==', currentUser.uid)
            .get();

        for (const questionDoc of questionsSnapshot.docs) {
            const questionId = questionDoc.id;

            // Delete all subquestions for this question
            const subquestionsSnapshot = await db.collection('subquestions')
                .where('questionId', '==', questionId)
                .where('userId', '==', currentUser.uid)
                .get();

            subquestionsSnapshot.docs.forEach(doc => batch.delete(doc.ref));
            batch.delete(questionDoc.ref);
        }

        // 3. Delete PDF from storage if exists
        const pdfUrl = guidelineDoc.data().pdfUrl;
        if (pdfUrl) {
            try {
                const pdfRef = storage.refFromURL(pdfUrl);
                await pdfRef.delete();
            } catch (err) {
                console.warn('Could not delete PDF:', err);
            }
        }

        // 4. Delete the guideline itself
        batch.delete(guidelineDoc.ref);

        await batch.commit();
        console.log('Guideline deleted successfully');

    } catch (error) {
        console.error('Error deleting guideline:', error);
        throw error;
    }
}

/**
 * Save a guideline to Firestore
 */
async function saveGuidelineToFirestore(guidelineData) {
    console.log('saveGuidelineToFirestore called with:', guidelineData);
    console.log('currentUser:', currentUser);

    if (!currentUser) {
        console.error('No currentUser - cannot save guideline');
        throw new Error('User not authenticated');
    }

    if (!guidelineData || !guidelineData.projectId) {
        console.error('Invalid guideline data:', guidelineData);
        throw new Error('Invalid guideline data - missing projectId');
    }

    try {
        const docRef = await db.collection('guidelines').add({
            userId: currentUser.uid,
            projectId: guidelineData.projectId,
            name: guidelineData.name || 'Untitled',
            source: guidelineData.source || 'manual',
            pdfUrl: guidelineData.pdfUrl || null,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        console.log('Guideline saved successfully, ID:', docRef.id);
        return docRef.id;
    } catch (error) {
        console.error('Error saving guideline:', error);
        throw error;
    }
}

/**
 * Upload PDF to Firebase Storage and return download URL
 */
async function uploadPDF(file, guidelineId) {
    if (!currentUser) return null;

    try {
        const storageRef = storage.ref(`users/${currentUser.uid}/pdfs/${guidelineId}.pdf`);
        const snapshot = await storageRef.put(file);
        const downloadURL = await snapshot.ref.getDownloadURL();
        return downloadURL;
    } catch (error) {
        console.error('Error uploading PDF:', error);
        throw error;
    }
}

/**
 * Load guidelines for a project
 */
async function loadGuidelines(projectId) {
    if (!currentUser) return [];

    try {
        const snapshot = await db.collection('guidelines')
            .where('userId', '==', currentUser.uid)
            .where('projectId', '==', projectId)
            .get();

        const guidelines = snapshot.docs.map(doc => ({
            id: doc.id,
            title: doc.data().name || 'Untitled', // Map name to title for UI
            ...doc.data()
        }));

        // Sort by createdAt (oldest first)
        guidelines.sort((a, b) => {
            const aTime = a.createdAt?.toMillis() || 0;
            const bTime = b.createdAt?.toMillis() || 0;
            return aTime - bTime;
        });

        // 2. Fetch questions for each guideline
        await Promise.all(guidelines.map(async (guideline) => {
            try {
                const qSnapshot = await db.collection('questions')
                    .where('guidelineId', '==', guideline.id)
                    .where('userId', '==', currentUser.uid)
                    .get();

                const questions = qSnapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));

                // Sort questions by order
                questions.sort((a, b) => (a.order || 0) - (b.order || 0));

                // 3. Fetch subquestions for each question
                await Promise.all(questions.map(async (question) => {
                    const subSnapshot = await db.collection('subquestions')
                        .where('questionId', '==', question.id)
                        .where('userId', '==', currentUser.uid)
                        .get();

                    const subquestions = subSnapshot.docs.map(doc => ({
                        id: doc.id,
                        ...doc.data()
                    }));

                    // Sort subquestions
                    subquestions.sort((a, b) => (a.order || 0) - (b.order || 0));

                    // Map to simple string array as expected by UI or keep objects?
                    // script.js expects: questions: [{ text: "...", subquestions: ["..."] }]
                    // But in saveQuestions we stored them as objects. 
                    // Let's reconstruct the structure expected by script.js
                    question.subquestions = subquestions.map(sq => sq.text);
                }));

                guideline.questions = questions;
            } catch (err) {
                console.error(`Error loading questions for guideline ${guideline.id}:`, err);
                guideline.questions = [];
            }
        }));

        return guidelines;
    } catch (error) {
        console.error('Error loading guidelines:', error);
        return [];
    }
}

/**
 * Save questions and subquestions for a guideline
 */
async function saveQuestionsToFirestore(guidelineId, questionsData) {
    console.log('saveQuestionsToFirestore called with guidelineId:', guidelineId);
    console.log('questionsData:', questionsData);
    console.log('currentUser:', currentUser);

    if (!currentUser) {
        console.error('No currentUser');
        throw new Error('User not authenticated');
    }

    if (!guidelineId) {
        console.error('No guidelineId provided');
        throw new Error('guidelineId is required');
    }

    if (!questionsData || !Array.isArray(questionsData)) {
        console.error('Invalid questionsData:', questionsData);
        throw new Error('questionsData must be an array');
    }

    try {
        const batch = db.batch();

        questionsData.forEach((question, qIndex) => {
            const questionRef = db.collection('questions').doc();
            batch.set(questionRef, {
                userId: currentUser.uid,
                guidelineId: guidelineId,
                text: question.text || '',
                order: qIndex,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            // Handle subquestions if they exist
            if (question.subquestions && Array.isArray(question.subquestions)) {
                question.subquestions.forEach((subq, sqIndex) => {
                    const subqRef = db.collection('subquestions').doc();
                    batch.set(subqRef, {
                        userId: currentUser.uid,
                        questionId: questionRef.id,
                        text: typeof subq === 'string' ? subq : subq.text || '',
                        order: sqIndex,
                        createdAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                });
            }
        });

        console.log('Committing batch with', questionsData.length, 'questions');
        await batch.commit();
        console.log('Questions saved successfully');
    } catch (error) {
        console.error('Error saving questions:', error);
        throw error;
    }
}

// ============================================================================
// MIGRATION FROM LOCALSTORAGE
// ============================================================================

/**
 * One-time migration from localStorage to Firestore
 */
async function migrateFromLocalStorage() {
    if (!currentUser) return;

    try {
        // Check if migration already done
        const migrationDoc = await db.collection('users')
            .doc(currentUser.uid)
            .collection('metadata')
            .doc('migration')
            .get();

        if (migrationDoc.exists && migrationDoc.data().completed) {
            return; // Already migrated
        }

        // Get localStorage data
        const localData = localStorage.getItem('contexture_projects');
        if (!localData) {
            // No local data to migrate, mark as complete
            await db.collection('users')
                .doc(currentUser.uid)
                .collection('metadata')
                .doc('migration')
                .set({ completed: true, migratedAt: firebase.firestore.FieldValue.serverTimestamp() });
            return;
        }

        const localProjects = JSON.parse(localData);

        // Migrate each project
        for (const project of localProjects) {
            const projectId = await saveProject({
                name: project.name,
                status: project.status
            });

            // Migrate guidelines
            if (project.guidelines) {
                for (const guideline of project.guidelines) {
                    const guidelineId = await saveGuideline({
                        projectId: projectId,
                        name: guideline.name,
                        source: guideline.source || 'manual'
                    });

                    // Migrate questions
                    if (guideline.questions) {
                        await saveQuestions(guidelineId, guideline.questions);
                    }
                }
            }
        }

        // Mark migration as complete
        await db.collection('users')
            .doc(currentUser.uid)
            .collection('metadata')
            .doc('migration')
            .set({ completed: true, migratedAt: firebase.firestore.FieldValue.serverTimestamp() });

        console.log('Migration from localStorage completed successfully');

    } catch (error) {
        console.error('Migration error:', error);
        // Don't throw - allow app to continue even if migration fails
    }
}

// ============================================================================
// EXPORT FUNCTIONS TO GLOBAL SCOPE
// ============================================================================

// Make functions available to script.js
window.loadUserData = loadUserData;
window.loadUserData = loadUserData;
window.saveProjectToFirestore = saveProjectToFirestore;
window.updateProjectInFirestore = updateProjectInFirestore;
window.deleteProjectFromFirestore = deleteProjectFromFirestore;
window.deleteGuidelineFromFirestore = deleteGuidelineFromFirestore;
window.saveGuidelineToFirestore = saveGuidelineToFirestore;
window.uploadPDF = uploadPDF;
window.loadGuidelines = loadGuidelines;
window.saveQuestionsToFirestore = saveQuestionsToFirestore;
window.migrateFromLocalStorage = migrateFromLocalStorage;
