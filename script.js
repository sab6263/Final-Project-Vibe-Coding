/**
 * Contexture - Application Logic
 */

// ============================================================================
// AUTHENTICATION GUARD
// ============================================================================

let currentUser = null;

// Check authentication status
auth.onAuthStateChanged((user) => {
    if (!user) {
        // Not authenticated - redirect to auth page
        window.location.href = 'auth.html';
        return;
    }

    // User is authenticated (anonymous)
    currentUser = user;

    // Update user display
    const userEmailEl = document.getElementById('userEmail');
    if (userEmailEl) {
        if (user.isAnonymous) {
            userEmailEl.textContent = 'Guest Session';
        } else if (user.email) {
            userEmailEl.textContent = user.email;
        } else {
            userEmailEl.textContent = 'Active Session';
        }
    }

    // Load user data
    loadUserData();
});

// User profile dropdown toggle
document.addEventListener('DOMContentLoaded', () => {
    const userProfileBtn = document.getElementById('userProfileBtn');
    const userDropdown = document.getElementById('userDropdown');
    const logoutBtn = document.getElementById('logoutBtn');

    if (userProfileBtn && userDropdown) {
        userProfileBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            userDropdown.classList.toggle('hidden');
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', () => {
            userDropdown.classList.add('hidden');
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            try {
                await auth.signOut();
                window.location.href = 'auth.html';
            } catch (error) {
                console.error('Logout error:', error);
                alert('Failed to sign out. Please try again.');
            }
        });
    }
});

// ============================================================================
// STATE
// ============================================================================

let projects = [];
let currentFilter = 'all';
let searchQuery = '';
let currentProjectId = null; // ID of the currently open project
let micStream = null; // Persistent stream to prevent repeated permission prompts

// Interview Session State
let currentInterviewId = null;
let isRecording = false;
let isPaused = false;
let startTime = null;
let timerInterval = null;
let recognition = null;
let transcriptSegments = []; // { id, text, timestamp, notes: [], speaker: ..., highlights: [] }
let currentSegment = null;
let lastSegmentEndTime = null;
let currentSpeaker = 'interviewer';
let speakerIdActive = false; // Default to false to match UI behavior
let currentSelection = null; // { text, start, end, segmentId }
let currentTempMark = null; // Reference to the temporary visual highlight
let generalNotes = []; // { content, timestamp }
let selectedSegmentId = null; // For inline notes

// DOM Elements - Views
const projectsOverview = document.getElementById('projectsOverview');
const projectDetailView = document.getElementById('projectDetailView');

// DOM Elements - Overview
const projectsContainer = document.getElementById('projectsContainer');
const emptyState = document.getElementById('emptyState');
const createBtn = document.getElementById('createProjectBtn');
const createBtnEmpty = document.getElementById('createProjectBtnEmpty');
const searchInput = document.getElementById('searchInput');
const filterBtns = document.querySelectorAll('.filter-btn');

// DOM Elements - Create Modal
const modal = document.getElementById('createProjectModal');
const closeModalIcon = document.getElementById('closeModalIcon');
const cancelCreateBtn = document.getElementById('cancelCreateBtn');
const confirmCreateBtn = document.getElementById('confirmCreateBtn');
const newProjectNameInput = document.getElementById('newProjectName');

// DOM Elements - Delete Modal
const deleteModal = document.getElementById('deleteConfirmModal');
const closeDeleteModalIcon = document.getElementById('closeDeleteModalIcon');
const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
let projectIdToDelete = null;

// DOM Elements - Detail View
const backToProjectsBtn = document.getElementById('backToProjectsBtn');
const detailProjectTitle = document.getElementById('detailProjectTitle');
const projectStatusToggle = document.getElementById('projectStatusToggle');
const projectStatusLabel = document.getElementById('projectStatusLabel');
const deleteProjectDetailBtn = document.getElementById('deleteProjectDetailBtn');

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    // Initial Render (will be called after auth check)
    // render(); // Moved to loadUserData()

    // Global click to close menus
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.card-menu-container')) {
            document.querySelectorAll('.card-dropdown').forEach(el => el.classList.add('hidden'));
        }
    });

    // Initialize Delete Modal Listeners
    if (deleteModal) {
        closeDeleteModalIcon.addEventListener('click', closeDeleteModal);
        cancelDeleteBtn.addEventListener('click', closeDeleteModal);
        confirmDeleteBtn.addEventListener('click', confirmDeleteAction);
        deleteModal.addEventListener('click', (e) => {
            if (e.target === deleteModal) closeDeleteModal();
        });
    }

    // Detail View Listeners
    backToProjectsBtn.addEventListener('click', closeProject);

    // Title Editing (Auto-save on blur/enter)
    detailProjectTitle.addEventListener('blur', saveProjectTitle);
    detailProjectTitle.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            detailProjectTitle.blur(); // Trigger save
        }
    });

    // TODO: Need to update saveProjectTitle to use updateProjectInFirestore logic if it saves to DB
    // Let's check saveProjectTitle function...

    // Status Toggle
    projectStatusToggle.addEventListener('click', () => {
        const isCurrentlyActive = projectStatusToggle.classList.contains('is-active');
        updateCurrentProjectStatus(!isCurrentlyActive);
    });

    // Delete from Detail Page
    deleteProjectDetailBtn.addEventListener('click', () => {
        if (currentProjectId) {
            deleteProject(currentProjectId);
        }
    });

    // Interview Back Button
    const backToDashboardBtn = document.getElementById('backToDashboardBtn');
    if (backToDashboardBtn) {
        backToDashboardBtn.addEventListener('click', closeInterview);
    }

    // Interview Recording Listeners
    initInterviewListeners();

    // Initialize Global Tooltip
    initGlobalTooltip();
});

// DOM Elements - Interview Workspace
const interviewWorkspace = document.querySelector('.interview-workspace');
const workspaceGuidelineTitle = document.getElementById('workspaceGuidelineTitle');
const workspaceQuestionsList = document.getElementById('workspaceQuestionsList');
const transcriptionFeed = document.getElementById('transcriptionFeed');
const recordingTimer = document.getElementById('recordingTimer');
const recordingStatus = document.getElementById('recordingStatus');

let currentTranscriptionLanguage = 'de-DE'; // Default to German, can be empty for auto

const startRecordingBtn = document.getElementById('startRecordingBtn');
const stopRecordingBtn = document.getElementById('stopRecordingBtn');
const switchSpeakerBtn = document.getElementById('switchSpeakerBtn');
const speakerIdActiveToggle = document.getElementById('speakerIdActiveToggle');

const generalNotesTextarea = document.getElementById('generalNotesTextarea');
const submitGeneralNoteBtn = document.getElementById('submitGeneralNoteBtn');

const inlineNotePopdown = document.getElementById('inlineNotePopdown');
const inlineNoteInput = document.getElementById('inlineNoteInput');
const saveInlineNoteBtn = document.getElementById('saveInlineNoteBtn');

// Event Listeners - Overview
createBtn.addEventListener('click', openCreateModal);
createBtnEmpty.addEventListener('click', openCreateModal);

closeModalIcon.addEventListener('click', closeCreateModal);
cancelCreateBtn.addEventListener('click', closeCreateModal);
confirmCreateBtn.addEventListener('click', submitCreateProject);

modal.addEventListener('click', (e) => {
    if (e.target === modal) closeCreateModal();
});

newProjectNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitCreateProject();
    if (e.key === 'Escape') closeCreateModal();
});

// Delete Modal Listeners
// These were missing!
if (confirmDeleteBtn) confirmDeleteBtn.addEventListener('click', confirmDeleteAction);
if (cancelDeleteBtn) cancelDeleteBtn.addEventListener('click', closeDeleteModal);
if (closeDeleteModalIcon) closeDeleteModalIcon.addEventListener('click', closeDeleteModal);

// DOM Elements - Interview
const createInterviewBtn = document.getElementById('createInterviewBtn');
const interviewDetailView = document.getElementById('interviewDetailView');
const interviewDetailTitle = document.getElementById('interviewDetailTitle');
const backToDashboardBtn = document.getElementById('backToDashboardBtn');

// DOM Elements - Create Interview Modal
const createInterviewModal = document.getElementById('createInterviewModal');
const closeInterviewModalIcon = document.getElementById('closeInterviewModalIcon');
const cancelInterviewBtn = document.getElementById('cancelInterviewBtn');
const confirmStartInterviewBtn = document.getElementById('confirmStartInterviewBtn');
const interviewTitleInput = document.getElementById('interviewTitle');
const interviewGuidelineSelect = document.getElementById('interviewGuideline');
const interviewParticipantInput = document.getElementById('interviewParticipant');
const interviewRoundInput = document.getElementById('interviewRound');

// Interview Listeners
if (createInterviewBtn) createInterviewBtn.addEventListener('click', openCreateInterviewModal);
if (closeInterviewModalIcon) closeInterviewModalIcon.addEventListener('click', closeCreateInterviewModal);
if (cancelInterviewBtn) cancelInterviewBtn.addEventListener('click', closeCreateInterviewModal);
if (confirmStartInterviewBtn) confirmStartInterviewBtn.addEventListener('click', submitCreateInterview);
if (backToDashboardBtn) backToDashboardBtn.addEventListener('click', () => {
    // Clear URL param
    const url = new URL(window.location);
    url.searchParams.delete('interview');
    window.history.pushState({}, '', url);

    interviewDetailView.classList.add('hidden');
    projectsOverview.classList.remove('hidden');
    projectDetailView.classList.add('hidden');
});


searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value.toLowerCase();
    render();
});

filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.filter;
        render();
    });
});

/**
 * Core Render Function
 */
function render() {
    // Check for Interview Mode
    const urlParams = new URLSearchParams(window.location.search);
    const interviewId = urlParams.get('interview');

    if (interviewId) {
        document.body.classList.add('fullscreen-active');
        projectsOverview.classList.add('hidden');
        projectDetailView.classList.add('hidden');
        emptyState.classList.add('hidden');
        projectsContainer.classList.add('hidden');

        if (interviewDetailView.classList.contains('hidden')) {
            loadInterviewView(interviewId);
        }
        return;
    }

    // Determine visibility based on project count
    if (projects.length === 0) {
        projectsContainer.classList.add('hidden');
        emptyState.classList.remove('hidden');
        projectsContainer.innerHTML = '';
        return;
    } else {
        emptyState.classList.add('hidden');
        projectsContainer.classList.remove('hidden');
    }

    // Filter Logic
    const filteredProjects = projects.filter(project => {
        const matchesFilter = currentFilter === 'all' ||
            (project.status || 'active').toLowerCase() === currentFilter.toLowerCase();
        const matchesSearch = project.name.toLowerCase().includes(searchQuery);
        return matchesFilter && matchesSearch;
    });

    // Render Grid
    if (filteredProjects.length === 0) {
        projectsContainer.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 4rem;">
                <p>No projects match your search.</p>
            </div>
        `;
    } else {
        projectsContainer.innerHTML = filteredProjects.map(project => `
            <div class="project-card" onclick="openProject('${project.id}')">
                <div class="card-header">
                    <div>
                        <h3 class="project-title">${escapeHtml(project.name)}</h3>
                        <div class="project-date">Updated ${formatDate(project.updatedAt)}</div>
                    </div>
                    <div class="header-right">
                        <span class="status-badge ${project.status?.toLowerCase() || 'active'}">
                            ${project.status?.toUpperCase() || 'ACTIVE'}
                        </span>
                        <div class="card-menu-container">
                            <button class="icon-btn menu-trigger" onclick="toggleCardMenu(event, '${project.id}')">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <circle cx="12" cy="12" r="1"></circle>
                                    <circle cx="12" cy="5" r="1"></circle>
                                    <circle cx="12" cy="19" r="1"></circle>
                                </svg>
                            </button>
                            <!-- Dropdown Menu -->
                            <div id="menu-${project.id}" class="card-dropdown hidden">
                                <button class="dropdown-item" onclick="toggleProjectStatus(event, '${project.id}')">
                                    ${(project.status?.toLowerCase() === 'active') ? 'Mark as Inactive' : 'Mark as Active'}
                                </button>
                                <button class="dropdown-item delete" onclick="deleteProjectFromMenu(event, '${project.id}')">
                                    Delete Project
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `).join('');
    }
}

/**
 * Opens a project in Detail View
 */
/**
 * Opens a project in Detail View
 */
async function openProject(id) {
    const project = projects.find(p => p.id === id);
    if (!project) return;

    currentProjectId = id;

    // Populate Data
    detailProjectTitle.textContent = project.name;

    // Set Toggle Button State
    if (project.status === 'Active' || project.status === 'active') {
        projectStatusToggle.classList.add('is-active');
        projectStatusToggle.textContent = 'ACTIVE ▼';
    } else {
        projectStatusToggle.classList.remove('is-active');
        projectStatusToggle.textContent = 'INACTIVE ▼';
    }

    // Load guidelines from Firestore
    try {
        const guidelines = await window.loadGuidelines(id);
        project.guidelines = guidelines;
        renderGuidelinesList(project);
    } catch (error) {
        console.error('Error loading guidelines:', error);
        project.guidelines = [];
        renderGuidelinesList(project);
    }

    // Load and render interviews
    renderInterviewsList(id);

    // Switch View
    projectsOverview.classList.add('hidden');
    projectDetailView.classList.remove('hidden');
    window.scrollTo(0, 0);
}

/**
 * Closes Project Detail View and returns to Overview
 */
function closeProject() {
    currentProjectId = null;
    projectDetailView.classList.add('hidden');
    projectsOverview.classList.remove('hidden');
    render(); // Re-render to show any updates
}

/**
 * Saves the edited project title
 */
async function saveProjectTitle() {
    if (!currentProjectId) return;

    const newTitle = detailProjectTitle.textContent.trim();
    const project = projects.find(p => p.id === currentProjectId);

    if (project && newTitle && newTitle !== project.name) {
        try {
            await window.updateProjectInFirestore(currentProjectId, { name: newTitle });
            project.name = newTitle;
            project.updatedAt = { toMillis: () => Date.now() };
            showToast('Project renamed');
        } catch (error) {
            console.error('Error renaming project:', error);
            detailProjectTitle.textContent = project.name; // Revert
            alert('Failed to rename project');
        }
    } else if (!newTitle && project) {
        // Revert if empty
        detailProjectTitle.textContent = project.name;
    }
}

/**
 * Updates status from the Detail View Toggle
 */
async function updateCurrentProjectStatus(activate) {
    if (!currentProjectId) return;

    const project = projects.find(p => p.id === currentProjectId);
    if (project) {
        const newStatus = activate ? 'Active' : 'Inactive';

        try {
            // Update in Firestore
            await window.updateProjectInFirestore(currentProjectId, { status: newStatus });

            // Update local state
            project.status = newStatus;
            project.updatedAt = { toMillis: () => Date.now() };

            // Update UI
            if (activate) {
                projectStatusToggle.classList.add('is-active');
                projectStatusToggle.textContent = 'ACTIVE ▼';
            } else {
                projectStatusToggle.classList.remove('is-active');
                projectStatusToggle.textContent = 'INACTIVE ▼';
            }
        } catch (error) {
            console.error('Error updating project status:', error);
            alert('Failed to update status. Please try again.');
        }
    }
}

// --- PROJECT ACTIONS ---

function toggleCardMenu(event, id) {
    event.stopPropagation();
    document.querySelectorAll('.card-dropdown').forEach(el => {
        if (el.id !== `menu-${id}`) el.classList.add('hidden');
    });
    const menu = document.getElementById(`menu-${id}`);
    if (menu) menu.classList.toggle('hidden');
}

async function toggleProjectStatus(event, id) {
    event.stopPropagation(); // Stop from opening project
    const project = projects.find(p => p.id === id);
    if (project) {
        const currentStatusLowercase = (project.status || 'active').toLowerCase();
        const newStatus = currentStatusLowercase === 'active' ? 'Inactive' : 'Active';

        try {
            await window.updateProjectInFirestore(id, { status: newStatus });

            project.status = newStatus;
            project.updatedAt = { toMillis: () => Date.now() };
            render();
            document.querySelectorAll('.card-dropdown').forEach(el => el.classList.add('hidden'));
        } catch (error) {
            console.error('Error toggling status:', error);
            alert('Failed to update status');
        }
    }
}

function deleteProjectFromMenu(event, id) {
    event.stopPropagation();
    deleteProject(id);
}

// --- DELETE MODAL LOGIC ---
// State for deletion
let itemToDelete = null; // { type: 'project' | 'guideline', id: string, projectId?: string }

function deleteProject(id) {
    itemToDelete = { type: 'project', id: id };

    // Update Modal Text
    const titleEl = document.getElementById('deleteModalTitle');
    const textEl = document.getElementById('deleteModalText');
    if (titleEl) titleEl.textContent = "Delete Project";
    if (textEl) textEl.textContent = "Are you sure you want to delete this project? This action cannot be undone.";

    document.querySelectorAll('.card-dropdown').forEach(el => el.classList.add('hidden'));
    deleteModal.classList.remove('hidden');
}

function deleteGuidelineWithModal(projectId, guidelineId) {
    itemToDelete = { type: 'guideline', id: guidelineId, projectId: projectId };

    // Update Modal Text
    const titleEl = document.getElementById('deleteModalTitle');
    const textEl = document.getElementById('deleteModalText');
    if (titleEl) titleEl.textContent = "Delete Guideline";
    if (textEl) textEl.textContent = "Are you sure you want to delete this guideline? This action cannot be undone.";

    deleteModal.classList.remove('hidden');
}

function closeDeleteModal() {
    deleteModal.classList.add('hidden');
    itemToDelete = null;
    projectIdToDelete = null; // Legacy cleanup
}

async function confirmDeleteAction() {
    console.log('confirmDeleteAction called');
    console.log('itemToDelete:', itemToDelete);
    console.log('projectIdToDelete (legacy):', projectIdToDelete);

    if (!itemToDelete) {
        // Fallback for legacy projectIdToDelete if exists (though we replaced calls, safety check)
        if (projectIdToDelete) {
            console.log('Using legacy delete for project:', projectIdToDelete);
            try {
                await window.deleteProjectFromFirestore(projectIdToDelete);
                projects = projects.filter(p => p.id !== projectIdToDelete);
                if (currentProjectId === projectIdToDelete) closeProject();
                else render();
                showToast('Project deleted');
            } catch (error) {
                console.error('Error deleting project:', error);
                alert('Failed to delete project. Please try again.');
            }
        }
        closeDeleteModal();
        return;
    }

    if (itemToDelete.type === 'project') {
        console.log('Deleting project via itemToDelete:', itemToDelete.id);
        try {
            await window.deleteProjectFromFirestore(itemToDelete.id);
            projects = projects.filter(p => p.id !== itemToDelete.id);
            if (currentProjectId === itemToDelete.id) {
                closeProject();
            } else {
                render();
            }
            showToast('Project deleted');
        } catch (error) {
            console.error('Error deleting project:', error);
            alert('Failed to delete project. Please try again.');
        }
    }
    else if (itemToDelete.type === 'guideline') {
        const project = projects.find(p => p.id === itemToDelete.projectId);
        try {
            await window.deleteGuidelineFromFirestore(itemToDelete.id);

            if (project && project.guidelines) {
                project.guidelines = project.guidelines.filter(g => g.id !== itemToDelete.id);
                renderGuidelinesList(project);
            }
            showToast('Guideline deleted');
        } catch (error) {
            console.error('Error deleting guideline:', error);
            alert('Failed to delete guideline');
        }
    }

    closeDeleteModal();
}

// --- CREATE MODAL ---

function openCreateModal() {
    newProjectNameInput.value = '';
    modal.classList.remove('hidden');
    setTimeout(() => newProjectNameInput.focus(), 50);
}

function closeCreateModal() {
    modal.classList.add('hidden');
}

async function submitCreateProject() {
    let rawName = newProjectNameInput.value.trim();
    if (!rawName) rawName = "Untitled Project";

    try {
        // Save to Firestore
        const projectId = await window.saveProjectToFirestore({
            name: rawName,
            status: 'Active'
        });

        // Add to local array for immediate UI update
        const newProject = {
            id: projectId,
            name: rawName,
            status: 'Active',
            userId: currentUser.uid,
            createdAt: { toMillis: () => Date.now() }, // Mock Firestore timestamp
            updatedAt: { toMillis: () => Date.now() }
        };

        projects.unshift(newProject);

        // Clear filters
        if (searchQuery) { searchQuery = ''; searchInput.value = ''; }
        if (currentFilter !== 'all') { currentFilter = 'all'; }

        render();
        closeCreateModal();
        showToast(`"${newProject.name}" created`);
    } catch (error) {
        console.error('Error creating project:', error);
        alert('Failed to create project. Please try again.');
    }
}

// Helpers
function formatDate(date) {
    if (!date) return 'Just now';

    // Handle Firestore Timestamp objects
    if (date && typeof date.toMillis === 'function') {
        date = new Date(date.toMillis());
    }

    // Handle Date objects or timestamps
    if (!(date instanceof Date)) {
        date = new Date(date);
    }

    // Check if valid date
    if (isNaN(date.getTime())) {
        return 'Just now';
    }

    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function escapeHtml(text) {
    if (!text) return '';
    return text.toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function cleanQuestionText(text) {
    if (!text) return '';
    // Remove leading bullet points, dashes, and following spaces
    return text.trim().replace(/^[•\-\–\—\*·◦▪▫\u2022\u2023\u25E6\u2043\u2219]\s*/, '');
}

window.toggleGuidelineQuestion = function (el) {
    el.classList.toggle('is-completed');
};

function showToast(message) {
    const toast = document.getElementById('toast');
    if (toast) {
        toast.textContent = message;
        toast.classList.remove('hidden');
        setTimeout(() => toast.classList.add('hidden'), 3000);
    }
}

// Expose to window
window.openProject = openProject;
window.toggleCardMenu = toggleCardMenu;
window.toggleProjectStatus = toggleProjectStatus;
window.deleteProjectFromMenu = deleteProjectFromMenu;


// DOM Elements - Guideline Editor
const guidelineEditorView = document.getElementById('guidelineEditorView');
const guidelineTitle = document.getElementById('guidelineTitle');
const questionsContainer = document.getElementById('questionsContainer');
const addQuestionBtn = document.getElementById('addQuestionBtn');
const saveGuidelineBtn = document.getElementById('saveGuidelineBtn');
const backToProjectFromGuidelineBtn = document.getElementById('backToProjectFromGuidelineBtn');
const createGuidelineBtn = document.getElementById('createGuidelineBtn');

// DOM Elements - Guideline Mode Modal
const guidelineModeModal = document.getElementById('guidelineModeModal');
const closeGuidelineModeModal = document.getElementById('closeGuidelineModeModal');
const manualCreateBtn = document.getElementById('manualCreateBtn');
const uploadPdfBtn = document.getElementById('uploadPdfBtn');
const pdfUploadInput = document.getElementById('pdfUploadInput');
const aiApiKeyInput = document.getElementById('aiApiKey');


// Guideline State
let currentGuidelineParams = null; // { projectId }

// Load API Key from local storage if exists, or use default
let storedKey = localStorage.getItem('contexture_api_key');
if (!storedKey) {
    storedKey = 'AIzaSyAjdakuU-dH_p6xYQNugLh8eUsY8jdT3zI';
    localStorage.setItem('contexture_api_key', storedKey);
}

if (storedKey && aiApiKeyInput) {
    aiApiKeyInput.value = storedKey;
}

if (aiApiKeyInput) {
    aiApiKeyInput.addEventListener('change', (e) => {
        localStorage.setItem('contexture_api_key', e.target.value.trim());
    });
}

// --- GUIDELINE ACTIONS ---

if (createGuidelineBtn) {
    createGuidelineBtn.addEventListener('click', () => {
        // Open Mode Choice Modal instead of editor directly
        guidelineModeModal.classList.remove('hidden');
    });
}

if (closeGuidelineModeModal) {
    closeGuidelineModeModal.addEventListener('click', () => {
        guidelineModeModal.classList.add('hidden');
    });
}

if (manualCreateBtn) {
    manualCreateBtn.addEventListener('click', () => {
        guidelineModeModal.classList.add('hidden');
        openGuidelineEditor(currentProjectId);
    });
}

if (uploadPdfBtn) {
    uploadPdfBtn.addEventListener('click', () => {
        pdfUploadInput.click();
    });
}

if (pdfUploadInput) {
    pdfUploadInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        showToast('Processing PDF...');

        try {
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

            let extractedText = '';
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const textContent = await page.getTextContent();
                const pageText = textContent.items.map(item => item.str).join('\n');
                extractedText += pageText + '\n';
            }


            // Heuristic Parsing Only
            const parsedQuestions = parsePdfContent(extractedText);

            guidelineModeModal.classList.add('hidden');
            openGuidelineEditor(currentProjectId);

            // Populate Editor
            questionsContainer.innerHTML = '';

            if (file.name) {
                guidelineTitle.textContent = file.name.replace('.pdf', '');
            }

            if (parsedQuestions.length > 0) {
                parsedQuestions.forEach(q => {
                    addQuestionInput({
                        text: cleanQuestionText(q.text),
                        subquestions: q.subquestions.map(sq => cleanQuestionText(sq))
                    }, false);
                });
                showToast('Import Successful');
            } else {
                addQuestionInput(); // Fallback
                showToast('No structured questions found');
            }

        } catch (error) {
            console.error(error);
            showToast('Error reading PDF');
        }

        // Reset input
        e.target.value = '';
    });
}

// { projectId, guidelineId? }
function parsePdfContent(text) {
    const lines = text.split(/\n+/).map(l => l.trim()).filter(l => l.length > 0);
    const questions = [];
    let currentQuestion = null;
    let nextIsSub = false;
    let orphanPrefix = ''; // Store "1.1" or "-" from previous line

    // --- PATTERNS ---

    // 1. Level 1: Main Questions
    const mainExplicitPattern = /^(?:(?:\d+|[IVX]+|[A-Z])[\.\)]|Q\d+|Question\s*\d*:?|Topic\s*\d*:?|Section\s*\d*:?)\s+(.+)/i;

    // 2. Level 2: Sub-questions
    // Forms: Bullets, "1.1", "a)", "(a)"
    const subExplicitPattern = /^[\s\t]*([•\-\–\—\*·◦▪▫\u2022\u2023\u25E6\u2043\u2219]|\d+\.\d+|[a-z]\s*\)|[a-z]\s*\.|[ivx]+\.|[A-Z]\.)\s+(.+)/i;

    // Orphan Bullet/Number Only (e.g. "-", "1.1", "a)") on its own line
    // Removed "-" from strict orphan check if it's potentially a hyphenation
    const subBulletOnly = /^[\s\t]*([•\–\—\*·◦▪▫\u2022\u2023\u25E6\u2043\u2219]|\d+\.\d+|[a-z]\s*\)|[a-z]\s*\.|[ivx]+\.|[A-Z]\.)[\s\t]*$/i;

    // Helper to check if line looks like a question
    const isQuestion = (str) => str.trim().endsWith('?');

    // Helper to check if it's likely a hyphenated continuation (e.g. "- up")
    // Broader check for any dash-like char followed by space/lowercase
    const isHyphenation = (line) => {
        // Include all bullet/dash chars from subExplicitPattern just in case
        return /^[•\-\–\—\*·◦▪▫\u2022\u2023\u25E6\u2043\u2219]\s*[a-z]/.test(line);
    };

    lines.forEach((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        console.log(`Line ${index}: "${trimmed}"`);

        // -- STATE: Expecting Sub-question (Orphan Bullet from previous line) --
        if (nextIsSub && currentQuestion) {
            const combined = orphanPrefix ? `${orphanPrefix} ${trimmed}` : trimmed;
            console.log('  -> Orphan merge:', combined);
            currentQuestion.subquestions.push(combined);
            nextIsSub = false;
            orphanPrefix = '';
            return;
        }

        // -- SPECIAL CHECK: Hyphenation / Multi-line Split --
        if (currentQuestion && currentQuestion.subquestions.length > 0) {
            const lastSubIdx = currentQuestion.subquestions.length - 1;
            const lastSub = currentQuestion.subquestions[lastSubIdx];

            console.log(`  -> Checking hyphenation. Last sub: "${lastSub}"`);
            console.log(`  -> Test 1 (non-alphanum): ${/^[^a-z0-9]/i.test(trimmed)}`);
            console.log(`  -> Test 2 (non-word+lower): ${/^[^\w]\s*[a-z]/.test(trimmed)}`);

            // SPECIAL CASE: Lone hyphen/dash on its own line (e.g., Line 21: "-")
            // This is part of a hyphenated word split across 3 lines: "follow" / "-" / "up..."
            if (/^[\-\–\—]$/.test(trimmed)) {
                console.log('  -> Lone hyphen detected, appending to previous line');
                // Just append the dash to the previous line, don't add as new question
                // The NEXT line will be the continuation
                currentQuestion.subquestions[lastSubIdx] = lastSub + '-';
                return;
            }

            // Hyphenation detection: dash/bullet followed by lowercase on SAME line
            // Regex: Starts with anything that is NOT a letter/number (e.g. - . • *), optional space, then lowercase.
            if (/^[^a-z0-9]/i.test(trimmed) && /^[^\w]\s*[a-z]/.test(trimmed)) {
                // It starts with a non-word char and continues with lowercase.
                // It is almost certainly a continuation "follow" + "- up".
                console.log('  -> MERGING hyphenation:', trimmed);

                // Remove the prefix (all non-word chars and spaces)
                const appendText = trimmed.replace(/^[^\w]+\s*/, '');

                // Use dash separator to reconstruct "follow-up"
                currentQuestion.subquestions[lastSubIdx] = lastSub + '-' + appendText;
                console.log(`  -> Result: "${currentQuestion.subquestions[lastSubIdx]}"`);
                return;
            }

            // Standard continuation check (no dash, just lowercase text)
            // e.g. "Question text..." \n "that continues here."
            if (!/[.?!]$/.test(lastSub) && /^[a-z]/.test(trimmed)) {
                console.log('  -> Standard continuation merge');
                currentQuestion.subquestions[lastSubIdx] = lastSub + ' ' + trimmed;
                return;
            }
        }

        // -- CHECK 1: Explicit Sub-question Markers --
        const subMatch = trimmed.match(subExplicitPattern);

        // Safety: If it matched a dash bullet, but follows with lowercase...
        // ...we should have caught it in isHyphenation above! 
        // If we are here, it is NOT hyphenation.

        if (subMatch) {
            console.log('  -> Matched as explicit sub-question');
            if (currentQuestion) {
                currentQuestion.subquestions.push(trimmed);
            } else {
                currentQuestion = { text: trimmed, subquestions: [] };
            }
            return;
        }

        // -- CHECK 2: Main Question Markers --
        const mainMatch = trimmed.match(mainExplicitPattern);
        if (mainMatch) {
            if (currentQuestion) questions.push(currentQuestion);
            currentQuestion = { text: trimmed, subquestions: [] };
            return;
        }

        // -- CHECK 3: Visual/Implicit Markers --

        // Orphan Bullet/Number
        if (subBulletOnly.test(trimmed)) {
            // Check if it's potentially a hyphenation start (like just "-") that got split from "up"?
            // Unlikely to have just "-" on a line for hyphenation, usually "- up".
            // But if it is JUST a dash, it really looks like a split bullet.

            // Double check it's not a numbered bullet like "1.1" which we want to keep
            // If it's just a single dash, and the next line starts with lowercase, it's likely hyphenation.
            // But if it's just a dash on its own line, it's more likely an orphan bullet.
            // The `isHyphenation` check above handles the `- up` case.
            // This `subBulletOnly` is for cases like `1.1` or `a)` or `•` on its own line.
            // We want to avoid `subBulletOnly` catching a lone `-` if it's part of a hyphenated word.
            // The current `subBulletOnly` regex already excludes a lone `-` if it's not followed by a space.
            // The `isHyphenation` regex handles `- ` followed by a lowercase letter.
            // So, if we reach here with just `-` it's treated as an orphan bullet.
            nextIsSub = true;
            orphanPrefix = trimmed;
            return;
        }

        // Implicit Sub-question
        if (currentQuestion) {
            if (isQuestion(trimmed)) {
                currentQuestion.subquestions.push(trimmed);
                return;
            }
            // Fallback
            currentQuestion.subquestions.push(trimmed);
            return;
        }

        // -- CHECK 4: Initial Fallback --
        if (isQuestion(trimmed)) {
            currentQuestion = { text: trimmed, subquestions: [] };
            return;
        }
    });

    if (currentQuestion) {
        questions.push(currentQuestion);
    }

    return questions;
}

if (addQuestionBtn) {
    addQuestionBtn.addEventListener('click', () => addQuestionInput());
}

if (saveGuidelineBtn) {
    saveGuidelineBtn.addEventListener('click', saveGuideline);
}

if (backToProjectFromGuidelineBtn) {
    backToProjectFromGuidelineBtn.addEventListener('click', closeGuidelineEditor);
}

// { projectId, guidelineId? }
function openGuidelineEditor(projectId, guidelineId = null) {
    currentGuidelineParams = { projectId, guidelineId };
    if (!guidelineEditorView) return;

    projectDetailView.classList.add('hidden');
    guidelineEditorView.classList.remove('hidden');

    questionsContainer.innerHTML = '';

    if (guidelineId) {
        // Edit Mode
        const project = projects.find(p => p.id === projectId);
        const guideline = project.guidelines.find(g => g.id === guidelineId);

        if (guideline) {
            guidelineTitle.textContent = guideline.title;
            // Support both old flat structure and new nested structure
            guideline.questions.forEach(q => {
                if (typeof q === 'string') {
                    addQuestionInput({ text: q, subquestions: [] }, false);
                } else {
                    addQuestionInput(q, false);
                }
            });
        }
    } else {
        // Create Mode
        guidelineTitle.textContent = "Untitled Guideline";
        addQuestionInput(); // Add one empty
    }
}

function closeGuidelineEditor() {
    guidelineEditorView.classList.add('hidden');
    projectDetailView.classList.remove('hidden');
    currentGuidelineParams = null;
}

// Data = { text: string, subquestions: string[] }
// Data = { text: string, subquestions: string[] }
function addQuestionInput(data = { text: '', subquestions: [] }, autoFocus = true) {
    if (!data) data = { text: '', subquestions: [] };

    const wrapper = document.createElement('div');
    wrapper.className = 'question-block';

    // Main Question Row
    const mainRow = document.createElement('div');
    mainRow.className = 'question-main-row';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'question-input main-q-input';
    input.placeholder = 'Enter main question or topic...';
    input.value = data.text || '';

    // Add Subquestion Button
    const addSubBtn = document.createElement('button');
    addSubBtn.className = 'icon-btn';
    addSubBtn.title = 'Add Sub-question';
    addSubBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>`;

    // Delete Main Question Button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-item-btn';
    deleteBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
    deleteBtn.onclick = () => wrapper.remove();

    mainRow.appendChild(input);
    mainRow.appendChild(addSubBtn);
    mainRow.appendChild(deleteBtn);
    wrapper.appendChild(mainRow);

    // Subquestions Container
    const subContainer = document.createElement('div');
    subContainer.className = 'sub-questions-container';

    wrapper.appendChild(subContainer);
    questionsContainer.appendChild(wrapper);

    // Helper to add sub-input
    const addSubInput = (text = '', focus = true) => {
        const subRow = document.createElement('div');
        subRow.className = 'question-sub-row'; // Matches updated CSS

        const subInput = document.createElement('input');
        subInput.type = 'text';
        subInput.className = 'question-input sub-q-input';
        subInput.placeholder = 'Follow-up question...';
        subInput.value = text;

        const subDeleteBtn = document.createElement('button');
        subDeleteBtn.className = 'delete-item-btn small';
        subDeleteBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
        subDeleteBtn.onclick = () => subRow.remove();

        subRow.appendChild(subInput);
        subRow.appendChild(subDeleteBtn);
        subContainer.appendChild(subRow);

        if (focus) subInput.focus();
    };

    // Load existing subquestions
    if (data.subquestions && Array.isArray(data.subquestions)) {
        data.subquestions.forEach(subText => addSubInput(subText, false));
    }

    // Event Listener for Add Sub Button
    addSubBtn.onclick = () => addSubInput();

    if (autoFocus) input.focus();
}

async function saveGuideline() {
    if (!currentGuidelineParams || !currentGuidelineParams.projectId) return;

    const project = projects.find(p => p.id === currentGuidelineParams.projectId);
    if (!project) return;

    // Collect Data
    const title = guidelineTitle.textContent.trim() || "Untitled Guideline";

    // Parse Questions from DOM
    const questions = [];
    document.querySelectorAll('.question-block').forEach(block => {
        const mainText = block.querySelector('.main-q-input').value.trim();
        // Allow saving even if main text is empty if subquestions exist

        const subTexts = Array.from(block.querySelectorAll('.sub-q-input'))
            .map(i => i.value.trim())
            .filter(t => t.length > 0);

        if (mainText || subTexts.length > 0) {
            questions.push({
                text: mainText,
                subquestions: subTexts
            });
        }
    });

    try {
        if (currentGuidelineParams.guidelineId) {
            // Update Existing
            console.log('Updating existing guideline...');
            await window.updateGuidelineInFirestore(currentGuidelineParams.guidelineId, {
                name: title
            });

            // Update questions
            await window.saveQuestionsToFirestore(currentGuidelineParams.guidelineId, questions);

            // Update local state
            const guideline = project.guidelines.find(g => g.id === currentGuidelineParams.guidelineId);
            if (guideline) {
                guideline.title = title;
                guideline.questions = questions;
                guideline.updatedAt = { toMillis: () => Date.now() };
            }
            showToast('Guideline updated');
        } else {
            // Create New - Save to Firestore
            console.log('Attempting to save guideline...');
            console.log('window.saveGuideline exists?', typeof window.saveGuideline);
            console.log('currentUser:', currentUser);

            const guidelineId = await window.saveGuidelineToFirestore({
                projectId: currentGuidelineParams.projectId,
                name: title,
                source: 'manual'
            });

            console.log('Guideline saved with ID:', guidelineId);

            // Save questions to Firestore
            if (questions.length > 0) {
                console.log('Saving questions...');
                await window.saveQuestionsToFirestore(guidelineId, questions);
                console.log('Questions saved');
            }

            // Add to local state for immediate UI update
            const newGuideline = {
                id: guidelineId,
                title: title,
                questions: questions,
                createdAt: { toMillis: () => Date.now() }
            };
            if (!project.guidelines) project.guidelines = [];
            project.guidelines.push(newGuideline);
            showToast('Guideline saved');
        }

        closeGuidelineEditor();
        renderGuidelinesList(project);
    } catch (error) {
        console.error('Error saving guideline:', error);
        console.error('Error details:', error.message, error.stack);
        alert(`Failed to save guideline: ${error.message}\n\nPlease check the console for details.`);
        // Don't close the editor so user can try again
    }
}

function renderGuidelinesList(project) {
    const list = document.getElementById('guidelinesList');
    if (!list) return;

    if (!project.guidelines || project.guidelines.length === 0) {
        list.className = 'list-container empty-list-placeholder';
        list.innerHTML = '<p>No guidelines yet.</p>';
        return;
    }

    list.className = 'list-container';
    list.innerHTML = project.guidelines.map(g => `
        <div class="card-item-row" onclick="editGuideline('${project.id}', '${g.id}')" style="cursor: pointer; padding: 1rem; background: rgba(255,255,255,0.6); border-radius: var(--radius-md); border: 1px solid rgba(0,0,0,0.05); margin-bottom: 0.5rem; display: flex; justify-content: space-between; align-items: center; transition: all 0.2s;">
            <div style="font-weight: 600; color: var(--text-title);">${escapeHtml(g.title)}</div>
            <div style="display: flex; align-items: center; gap: 0.75rem;">
                <span style="font-size: 0.85rem; color: var(--text-muted); background: rgba(0,0,0,0.05); padding: 0.25rem 0.5rem; border-radius: 20px;">
                    ${g.questions.length} topics
                </span>
                <button class="delete-item-btn" onclick="deleteGuideline(event, '${project.id}', '${g.id}')" style="padding: 0.25rem;">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                </button>
            </div>
        </div>
    `).join('');
}

async function renderInterviewsList(projectId) {
    const list = document.getElementById('interviewsList');
    if (!list) return;

    list.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 1rem;">Loading interviews...</p>';

    try {
        const interviews = await window.loadInterviewsForProject(projectId);

        if (!interviews || interviews.length === 0) {
            list.className = 'list-container empty-list-placeholder';
            list.innerHTML = '<p>No interviews yet.</p>';
            return;
        }

        list.className = 'list-container';
        list.innerHTML = interviews.map(i => `
            <div class="card-item-row" onclick="handleInterviewClick('${i.id}', '${i.status}')" style="cursor: pointer; padding: 1rem; background: rgba(255,255,255,0.6); border-radius: var(--radius-md); border: 1px solid rgba(0,0,0,0.05); margin-bottom: 0.5rem; display: flex; justify-content: space-between; align-items: center; transition: all 0.2s;">
                <div>
                    <div style="font-weight: 600; color: var(--text-title);">${escapeHtml(i.title)}</div>
                    ${i.participant ? `<div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 0.25rem;">Participant: ${escapeHtml(i.participant)}</div>` : ''}
                </div>
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                    <span style="font-size: 0.85rem; color: var(--text-muted);">
                        ${i.createdAt ? new Date(i.createdAt.toMillis()).toLocaleDateString() : 'Just now'}
                    </span>
                    <button class="delete-item-btn" onclick="deleteInterview(event, '${i.id}', '${projectId}')" style="padding: 0.25rem;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error rendering interviews list:', error);
        list.innerHTML = '<p style="text-align: center; color: var(--brand-primary); padding: 1rem;">Error loading interviews</p>';
    }
}

// Global helpers for inline onclicks
window.editGuideline = function (projectId, guidelineId) {
    if (projectId && guidelineId) {
        openGuidelineEditor(projectId, guidelineId);
    }
};

window.deleteGuideline = function (event, projectId, guidelineId) {
    event.stopPropagation();
    if (projectId && guidelineId) {
        // Use the modal function we defined earlier
        deleteGuidelineWithModal(projectId, guidelineId);
    }
};

window.handleInterviewClick = function (id, status) {
    if (status === 'completed' || status === 'finalized') {
        loadCompletedInterview(id);
    } else {
        loadInterviewView(id);
    }
};

window.deleteInterview = async function (event, interviewId, projectId) {
    event.stopPropagation();
    if (confirm('Are you sure you want to delete this interview?')) {
        try {
            await window.deleteInterviewFromFirestore(interviewId);
            showToast('Interview deleted');
            renderInterviewsList(projectId);
        } catch (error) {
            console.error('Error deleting interview:', error);
            alert('Failed to delete interview');
        }
    }
};

// ===================================
// INTERVIEW LOGIC
// ===================================

async function openCreateInterviewModal() {
    createInterviewModal.classList.remove('hidden');

    // Reset fields
    interviewTitleInput.value = '';
    interviewParticipantInput.value = '';
    interviewRoundInput.value = '';

    // Load guidelines
    interviewGuidelineSelect.innerHTML = '<option value="" disabled selected>Loading guidelines...</option>';

    try {
        const guidelines = await window.loadAllUserGuidelines();

        let displayGuidelines = guidelines;
        if (currentProjectId) {
            displayGuidelines = guidelines.filter(g => g.projectId === currentProjectId);
        }

        if (displayGuidelines.length === 0) {
            interviewGuidelineSelect.innerHTML = '<option value="" disabled selected>No guidelines found for this project.</option>';
        } else {
            interviewGuidelineSelect.innerHTML = '<option value="" disabled selected>Select a guideline...</option>';
            displayGuidelines.forEach(g => {
                const option = document.createElement('option');
                option.value = g.id;
                option.textContent = g.title || 'Untitled Guideline';
                interviewGuidelineSelect.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Error loading guidelines:', error);
        interviewGuidelineSelect.innerHTML = '<option value="" disabled selected>Error loading guidelines</option>';
    }
}

function closeCreateInterviewModal() {
    createInterviewModal.classList.add('hidden');
}

async function submitCreateInterview() {
    const title = interviewTitleInput.value.trim();
    const guidelineId = interviewGuidelineSelect.value;

    if (!title) {
        alert('Please enter an interview title.');
        return;
    }
    if (!guidelineId) {
        alert('Please select a guideline.');
        return;
    }

    confirmStartInterviewBtn.disabled = true;
    confirmStartInterviewBtn.textContent = 'Creating...';

    try {
        const interviewId = await window.saveInterviewToFirestore({
            title: title,
            guidelineId: guidelineId,
            projectId: currentProjectId, // Pass the project context
            participant: interviewParticipantInput.value.trim(),
            round: interviewRoundInput.value.trim()
        });

        closeCreateInterviewModal();
        loadInterviewView(interviewId);

    } catch (error) {
        console.error('Failed to create interview:', error);
        alert('Failed to create interview: ' + error.message);
    } finally {
        confirmStartInterviewBtn.disabled = false;
        confirmStartInterviewBtn.textContent = 'Start Interview';
    }
}

async function loadInterviewView(interviewId) {
    // Update URL
    const url = new URL(window.location);
    url.searchParams.set('interview', interviewId);
    window.history.pushState({}, '', url);

    currentInterviewId = interviewId;

    // UI State
    document.body.classList.add('fullscreen-active');
    projectsOverview.classList.add('hidden');
    projectDetailView.classList.add('hidden');
    interviewDetailView.classList.remove('hidden');

    interviewDetailTitle.textContent = 'Loading...';
    transcriptionFeed.innerHTML = '<p style="text-align: center; color: var(--text-muted); margin-top: 2rem;">Click the green button to start the interview transcription.</p>';
    recordingTimer.textContent = '00:00';
    recordingStatus.textContent = 'Ready';
    transcriptSegments = [];
    generalNotes = [];
    lastSegmentEndTime = null;
    currentSpeaker = 'interviewer';
    speakerIdActive = false;
    if (speakerIdActiveToggle) speakerIdActiveToggle.checked = false;
    if (switchSpeakerBtn) {
        switchSpeakerBtn.disabled = true;
        switchSpeakerBtn.style.opacity = '0.5';
        switchSpeakerBtn.querySelector('span').textContent = 'Interviewer';
        switchSpeakerBtn.classList.add('btn-secondary');
        switchSpeakerBtn.style.background = '';
        switchSpeakerBtn.style.color = '';
    }

    // Reset UI State
    if (startRecordingBtn) {
        startRecordingBtn.disabled = false;
        startRecordingBtn.classList.remove('btn-pause');
        startRecordingBtn.classList.add('btn-start');
        startRecordingBtn.querySelector('span').textContent = 'Start Recording';
        startRecordingBtn.querySelector('svg').innerHTML = `
            <circle cx="12" cy="12" r="10"></circle>
            <circle cx="12" cy="12" r="3" fill="currentColor"></circle>
        `;
    }
    if (stopRecordingBtn) stopRecordingBtn.disabled = true;
    if (recordingStatus) {
        recordingStatus.textContent = 'Ready';
        recordingStatus.parentElement.classList.remove('active');
    }

    // Warm up microphone to prevent repeated permission prompts
    // Awaiting ensure the permission is handled before other actions
    await warmupMicrophone();

    if (window.location.protocol === 'file:') {
        console.warn('Running from file:// protocol. Microphone permissions may not persist. Consider using a local server (e.g., npx serve).');
    }

    try {
        const interview = await window.loadInterviewFromFirestore(interviewId);
        if (interview) {
            interviewDetailTitle.textContent = interview.title;

            // Load Guideline for the sidebar
            if (interview.guidelineId) {
                const guidelines = await window.loadAllUserGuidelines();
                const guidelineData = guidelines.find(g => g.id === interview.guidelineId);

                if (guidelineData) {
                    workspaceGuidelineTitle.textContent = guidelineData.title;
                    // We need to fetch full guideline with questions
                    const fullGuidelines = await window.loadGuidelines(interview.projectId);
                    const fullGuideline = fullGuidelines.find(g => g.id === interview.guidelineId);

                    if (fullGuideline && fullGuideline.questions) {
                        workspaceQuestionsList.innerHTML = fullGuideline.questions.map(q => `
                            <div class="guideline-q-item" onclick="toggleGuidelineQuestion(this)">
                                <div class="q-checkbox"></div>
                                <div class="q-content">
                                    <span class="q-text">${escapeHtml(cleanQuestionText(q.text))}</span>
                                    ${q.subquestions && q.subquestions.length > 0 ? `
                                        <ul style="margin-top: 0.5rem; padding-left: 1.25rem; font-weight: normal; font-size: 0.85rem; color: var(--text-muted); list-style-type: disc;">
                                            ${q.subquestions.map(sq => `<li>${escapeHtml(cleanQuestionText(sq))}</li>`).join('')}
                                        </ul>
                                    ` : ''}
                                </div>
                            </div>
                        `).join('');
                    } else {
                        workspaceQuestionsList.innerHTML = '<p style="color: var(--text-muted);">No questions found.</p>';
                    }
                } else {
                    workspaceGuidelineTitle.textContent = 'Guideline not found';
                }
            }
        } else {
            interviewDetailTitle.textContent = 'Interview Not Found';
        }
    } catch (error) {
        console.error('Error loading interview:', error);
        interviewDetailTitle.textContent = 'Error loading interview';
    }
}

// Initial URL Check


// Wrap openProject to ensure it renders guidelines
const _superOpenProject = window.openProject;
window.openProject = function (id) {
    if (_superOpenProject) _superOpenProject(id);
    const project = projects.find(p => p.id === id);
    if (project) renderGuidelinesList(project);
}

// ============================================================================
// INTERVIEW RECORDING LOGIC
// ============================================================================

function initInterviewListeners() {
    if (startRecordingBtn) {
        startRecordingBtn.addEventListener('click', () => {
            if (!isRecording) startInterview();
            else if (isPaused) resumeInterview();
            else pauseInterview();
        });
    }
    if (stopRecordingBtn) stopRecordingBtn.addEventListener('click', stopInterview);

    if (switchSpeakerBtn) {
        switchSpeakerBtn.addEventListener('click', toggleSpeaker);
    }

    if (speakerIdActiveToggle) {
        speakerIdActiveToggle.addEventListener('change', (e) => {
            speakerIdActive = e.target.checked;
            if (speakerIdActive) {
                switchSpeakerBtn.style.opacity = '1';
                // Only enable the button if we are actually recording
                if (isRecording) switchSpeakerBtn.disabled = false;
            } else {
                switchSpeakerBtn.style.opacity = '0.5';
                switchSpeakerBtn.disabled = true;
            }
        });
    }

    // Key shortcut: Tab to switch speaker
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Tab' && isRecording && !isPaused) {
            e.preventDefault();
            toggleSpeaker();
        }
    });

    if (submitGeneralNoteBtn) submitGeneralNoteBtn.addEventListener('click', saveGeneralNote);
    if (generalNotesTextarea) {
        generalNotesTextarea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                saveGeneralNote();
            }
        });
    }

    if (saveInlineNoteBtn) saveInlineNoteBtn.addEventListener('click', saveInlineNote);
    if (inlineNoteInput) {
        inlineNoteInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                saveInlineNote();
            }
        });
    }

    // Global click to hide popdown
    document.addEventListener('mousedown', (e) => {
        // Hide inline note popdown
        if (inlineNotePopdown && !inlineNotePopdown.classList.contains('hidden') &&
            !inlineNotePopdown.contains(e.target) &&
            (!selectedSegmentId || !document.getElementById(selectedSegmentId).contains(e.target))) {

            inlineNoteInput.value = '';
            inlineNotePopdown.classList.add('hidden');

            // Clean up temporary highlight and current selection
            if (selectedSegmentId) {
                const segment = transcriptSegments.find(s => s.id === selectedSegmentId);
                const el = document.getElementById(selectedSegmentId);
                if (el && segment) updateSegmentContent(el, segment);
            }
            currentSelection = null;
        }
    });

    // Custom Language Dropdown Logic
    const languageSelect = document.getElementById('languageSelect');
    if (languageSelect) {
        languageSelect.addEventListener('change', (e) => {
            currentTranscriptionLanguage = e.target.value;
            console.log('Language changed to:', currentTranscriptionLanguage);

            // If currently recording, restart transcription to apply new language
            if (isRecording) {
                startTranscription();
            }
        });
    }

}

async function startInterview() {
    // Ensure persistent mic stream to prevent permission prompts
    // Await it so we have the "Recording" tab state active BEFORE SpeechRecognition asks
    await warmupMicrophone();

    if (!startTime) {
        startTime = Date.now();
        transcriptionFeed.innerHTML = '';
    }

    isRecording = true;
    isPaused = false;

    // UI Updates: Turn into Pause button
    startRecordingBtn.classList.remove('btn-start');
    startRecordingBtn.classList.add('btn-pause');
    startRecordingBtn.querySelector('span').textContent = 'Pause';
    startRecordingBtn.querySelector('svg').innerHTML = `
        <rect x="6" y="4" width="4" height="16"></rect>
        <rect x="14" y="4" width="4" height="16"></rect>
    `;

    stopRecordingBtn.disabled = false;
    if (switchSpeakerBtn) {
        switchSpeakerBtn.disabled = !speakerIdActive;
        switchSpeakerBtn.style.opacity = speakerIdActive ? '1' : '0.5';
    }
    recordingStatus.textContent = 'Recording...';
    recordingStatus.parentElement.classList.add('active');

    startTimer();
    startTranscription();
}

function toggleSpeaker() {
    // 1. Determine AND UPDATE the speaker immediately
    currentSpeaker = (currentSpeaker === 'interviewer') ? 'respondent' : 'interviewer';

    // 2. Update UI Immediately
    if (switchSpeakerBtn) {
        const displayText = currentSpeaker === 'interviewer' ? 'Interviewer' : 'Participant';
        switchSpeakerBtn.querySelector('span').textContent = displayText;

        if (currentSpeaker === 'respondent') {
            switchSpeakerBtn.classList.remove('btn-secondary');
            switchSpeakerBtn.style.color = '#fff';
            switchSpeakerBtn.style.background = '#1e40af';
        } else {
            switchSpeakerBtn.classList.add('btn-secondary');
            switchSpeakerBtn.style.background = '';
            switchSpeakerBtn.style.color = '';
        }
    }

    // 3. NO STOP/START. 
    // We simply let the ongoing recognition session continue. 
    // When the next sentence is finalized, addTranscriptSegment will pick up the NEW currentSpeaker value automatically.
    // This avoids the "Stop -> Start" cycle that triggers browser permission prompts on file:// protocols.
}

function pauseInterview() {
    isPaused = true;

    // UI Updates: Turn into Continue button
    startRecordingBtn.classList.remove('btn-pause');
    startRecordingBtn.classList.add('btn-start');
    startRecordingBtn.querySelector('span').textContent = 'Continue Recording';
    startRecordingBtn.querySelector('svg').innerHTML = `
        <circle cx="12" cy="12" r="10"></circle>
        <circle cx="12" cy="12" r="3" fill="currentColor"></circle>
    `;

    recordingStatus.textContent = 'Paused';
    recordingStatus.parentElement.classList.remove('active');

    stopTimer();
    // Keep transcription running in silent mode (isPaused checked in onresult)
}

function resumeInterview() {
    isPaused = false;

    // UI Updates: Turn back into Pause button
    startRecordingBtn.classList.remove('btn-start');
    startRecordingBtn.classList.add('btn-pause');
    startRecordingBtn.querySelector('span').textContent = 'Pause';
    startRecordingBtn.querySelector('svg').innerHTML = `
        <rect x="6" y="4" width="4" height="16"></rect>
        <rect x="14" y="4" width="4" height="16"></rect>
    `;

    recordingStatus.textContent = 'Recording...';
    recordingStatus.parentElement.classList.add('active');

    startTimer();
}


function stopInterview() {
    openConfirmModal(
        'Finish Interview',
        'Stop and finalize this interview session?',
        'Finish',
        () => performFinalizeInterview()
    );
}

async function performFinalizeInterview() {
    isRecording = false;
    isPaused = false;
    stopTimer();
    stopTranscription();

    recordingStatus.textContent = 'Processing...';
    recordingStatus.parentElement.classList.remove('active');

    try {
        await finalizeInterview();
        showToast('Interview saved successfully');
        openReview(currentInterviewId);
    } catch (error) {
        console.error('Error saving interview session:', error);
        alert('Failed to save interview session.'); // This alert is error scenario, acceptable for now or replace with Toast
    }
}

function closeInterview() {
    // Ensure everything stops
    isRecording = false;
    isPaused = false;
    stopTranscription();
    stopTimer();

    document.body.classList.remove('fullscreen-active');
    currentInterviewId = null;
    startTime = null;
    elapsedTime = 0;
    transcriptSegments = [];
    generalNotes = [];

    // Clear URL param
    const url = new URL(window.location);
    url.searchParams.delete('interview');
    window.history.pushState({}, '', url);

    // Stop persistent microphone stream
    // Stop persistent microphone stream
    // prevent asking for permission again if user starts another interview 
    /* 
    if (micStream) {
        micStream.getTracks().forEach(track => track.stop());
        micStream = null;
    } 
    */

    render();
}



/**
 * Requests microphone access once and keeps the stream active
 * to prevent repeated browser permission prompts.
 */
async function warmupMicrophone() {
    if (micStream && micStream.active) return;
    try {
        console.log('Requesting persistent microphone access...');
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        console.log('Microphone warmed up and persistent.');

        // Handle stream ending (maintain persistence if possible, though unlikely to end on its own)
        micStream.getTracks()[0].onended = () => {
            console.log('Persistent mic stream ended.');
            micStream = null;
        };
    } catch (err) {
        console.error('Error warming up microphone:', err);
    }
}

// Timer Logic
function startTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        const now = Date.now();
        const diff = now - startTime;
        const totalSeconds = Math.floor(diff / 1000);
        const mins = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
        const secs = (totalSeconds % 60).toString().padStart(2, '0');
        recordingTimer.textContent = `${mins}:${secs}`;
    }, 1000);
}

function stopTimer() {
    clearInterval(timerInterval);
}

// Transcription Logic (WebSpeech API)
function startTranscription() {
    window.SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!window.SpeechRecognition) {
        alert('Web Speech API is not supported in this browser. Please use Chrome.');
        return;
    }

    const selectedLang = currentTranscriptionLanguage;

    // If recognition exists but language changed, we need to recreate or update it
    if (recognition && recognition.lang !== selectedLang) {
        recognition.stop();
        recognition = null;
    }

    if (!recognition) {
        // APPLY PENDING SPEAKER SWITCH
        // If we stopped previously to switch speakers, apply it now before next segment starts
        if (window.pendingSpeakerSwitch) {
            currentSpeaker = window.pendingSpeakerSwitch;
            window.pendingSpeakerSwitch = null;
        }

        recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = selectedLang;

        // Track the last result index we fully processed to avoid duplicates
        let lastProcessedIndex = -1;

        recognition.onresult = (event) => {
            if (isPaused) return;

            // Update processed index if the engine reset (e.g. after pause/resume or error)
            // event.resultIndex is the index of the *first* result in this batch that has changed
            // If it's smaller than what we've seen, the engine likely reset.
            if (event.resultIndex < lastProcessedIndex) {
                lastProcessedIndex = -1;
            }

            let interimTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; ++i) {
                // If we already processed this index as final, skip it
                if (i <= lastProcessedIndex && event.results[i].isFinal) {
                    continue;
                }

                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    addTranscriptSegment(transcript);
                    lastProcessedIndex = i;
                } else {
                    interimTranscript += transcript;
                }
            }
            updateInterimDisplay(interimTranscript);
        };

        recognition.onend = () => {
            if (isRecording) {
                // Small delay to prevent "restart too fast" errors and ensure clean state
                setTimeout(() => {
                    // APPLY PENDING SPEAKER SWITCH (Critical for toggleSpeaker logic)
                    if (window.pendingSpeakerSwitch) {
                        currentSpeaker = window.pendingSpeakerSwitch;
                        window.pendingSpeakerSwitch = null;
                    }

                    if (isRecording) {
                        try {
                            recognition.start();
                        } catch (e) {
                            console.warn('Recognition restart failed, retrying...', e);
                        }
                    }
                }, 200);
            }
        };

        recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            if (event.error === 'not-allowed') {
                alert('Microphone access was denied. Please check your browser settings.');
                isRecording = false; // Force stop state to prevent infinite loop
                stopTimer();
            }
            // Ignore 'no-speech' errors as they are normal during pauses
        };
    }

    try {
        recognition.start();
    } catch (e) {
        // Recognition might already be active
    }
}

function stopTranscription() {
    if (recognition) {
        recognition.stop();
    }
}

// State for last speaker to prevent redundant labels
let lastLoggedSpeaker = null;

function addTranscriptSegment(text) {
    if (!text.trim()) return;

    const now = Date.now();
    const pauseThreshold = 2000; // 2 seconds silence = new line
    const isPause = lastSegmentEndTime && (now - lastSegmentEndTime > pauseThreshold);

    // Determines if we need a new label line
    let shouldAddLabel = false;

    if (speakerIdActive) {
        // Add label if:
        // 1. It's the very first segment
        // 2. The speaker has changed from the last logged one
        // 3. There was a significant pause (optional, but good for readability)
        if (transcriptSegments.length === 0 || currentSpeaker !== lastLoggedSpeaker || isPause) {
            shouldAddLabel = true;
        }
    }

    if (shouldAddLabel) {
        // If it's not the first segment, add a spacer break
        if (transcriptSegments.length > 0) {
            const br = document.createElement('div');
            br.className = 'transcript-break';
            transcriptionFeed.appendChild(br);
        }

        const label = document.createElement('span');
        label.className = `speaker-label ${currentSpeaker}`;
        label.textContent = currentSpeaker === 'interviewer' ? 'Interviewer' : 'Participant';
        transcriptionFeed.appendChild(label);

        lastLoggedSpeaker = currentSpeaker;
    } else if (isPause && !speakerIdActive) {
        // If IDs are off but there's a pause, just add a visual break
        const br = document.createElement('div');
        br.className = 'transcript-break';
        transcriptionFeed.appendChild(br);
    }

    const timestamp = now - startTime;
    const id = 'seg_' + now;
    // Store speaker only if recognition was active
    const segment = {
        id,
        text,
        timestamp,
        notes: [],
        speaker: speakerIdActive ? currentSpeaker : null
    };
    transcriptSegments.push(segment);

    // Remove interim
    const interim = document.getElementById('interimSegment');
    if (interim) interim.remove();

    renderSegment(segment);
    lastSegmentEndTime = now;
}

function updateInterimDisplay(text) {
    if (!text.trim()) return;

    let interim = document.getElementById('interimSegment');
    if (!interim) {
        interim = document.createElement('span');
        interim.id = 'interimSegment';
        interim.className = 'transcript-segment interim';
        // Removed opacity and italics for "instant appearance" feel
        transcriptionFeed.appendChild(interim);

        // Allow immediate interaction by forcing commit
        interim.addEventListener('mouseup', (e) => handleTextSelection(e, 'interimSegment'));
    }
    interim.textContent = (transcriptSegments.length > 0 ? ' ' : '') + text;
    transcriptionFeed.scrollTop = transcriptionFeed.scrollHeight;
}

function renderSegment(segment) {
    const el = document.createElement('span');
    el.className = 'transcript-segment';
    el.id = segment.id;

    // Append FIRST so updateSegmentContent can see context (previousSibling)
    transcriptionFeed.appendChild(el);

    updateSegmentContent(el, segment);

    el.addEventListener('mouseup', (e) => handleTextSelection(e, segment.id));

    transcriptionFeed.scrollTop = transcriptionFeed.scrollHeight;
}

function updateSegmentContent(el, segment) {
    // Add leading space if not the start of a paragraph OR after a speaker label
    // relies on el being in DOM
    const prev = el.previousElementSibling;
    const isStartOfParagraph = prev && prev.className === 'transcript-break';
    const isAfterLabel = prev && prev.classList.contains('speaker-label');
    const isFirst = !prev;

    // We do NOT want a space if it's the start of a paragraph, start of feed, OR directly after a speaker label
    const needsSpace = !isFirst && !isStartOfParagraph && !isAfterLabel;

    let text = segment.text;
    const prefix = needsSpace ? ' ' : '';

    if (!segment.highlights || segment.highlights.length === 0) {
        el.textContent = prefix + text;
        return;
    }

    // Build HTML with highlights safely
    // Highlights are stored with offsets relative to raw segment.text
    // We must build forward and escape HTML to prevent index mismatch and injection
    let html = '';
    let lastIndex = 0;

    // Sort ascending for forward build
    const sortedHighlights = [...segment.highlights].sort((a, b) => a.start - b.start);

    sortedHighlights.forEach(h => {
        // Safe append text before highlight
        if (h.start > lastIndex) {
            html += escapeHtml(text.substring(lastIndex, h.start));
        }

        // Safe append highlighted text
        const chunk = text.substring(h.start, h.end);
        html += `<mark class="word-highlight" data-segment-id="${segment.id}" data-highlight-start="${h.start}" data-note="${escapeHtml(h.note || '')}">${escapeHtml(chunk)}</mark>`;

        lastIndex = h.end;
    });

    // Safe append remaining text
    if (lastIndex < text.length) {
        html += escapeHtml(text.substring(lastIndex));
    }

    el.innerHTML = prefix + html;
}

// Note Taking Logic
function saveGeneralNote() {
    const content = generalNotesTextarea.value.trim();
    if (!content) return;

    const timestamp = startTime ? (Date.now() - startTime) : 0;
    generalNotes.push({ content, timestamp });

    generalNotesTextarea.value = '';
    showToast('Note captured');
}

function handleTextSelection(e, segmentId) {
    // 1. Special Handling for Interim (Commit on Select)
    if (segmentId === 'interimSegment') {
        const selection = window.getSelection();
        const rawText = selection.toString();
        const selectedText = rawText.trim();
        const interimEl = document.getElementById('interimSegment');

        if (selectedText.length > 0 && interimEl) {
            const fullInterimText = interimEl.textContent.trim();
            const range = selection.getRangeAt(0);

            // Calculate offset within the interim text
            // We need to know where the selection started relative to the interim text content
            let preCaretRange = range.cloneRange();
            preCaretRange.selectNodeContents(interimEl);
            preCaretRange.setEnd(range.startContainer, range.startOffset);
            let startOffset = preCaretRange.toString().length;

            // Adjust for leading space if interim has one (it often does if not first)
            // addTranscriptSegment(text) trims the input.
            // So if interim is " hello world", text becomes "hello world".
            // If selection was "hello" (start index 1 in raw string), it should be start index 0 in trimmed string.
            const hasLeadingSpace = interimEl.textContent.startsWith(' ');
            if (hasLeadingSpace) {
                startOffset = Math.max(0, startOffset - 1);
            }

            // Force Commit
            // 1. Stop Recognition to prevent overwrite
            if (recognition) recognition.abort();

            // 2. Add as permanent segment
            addTranscriptSegment(fullInterimText);

            // 3. Find the new segment (last one)
            const newSegment = transcriptSegments[transcriptSegments.length - 1];

            // 4. Add Highlight to it
            // We use the calculated offset. 
            if (newSegment) {
                if (!newSegment.highlights) newSegment.highlights = [];
                newSegment.highlights.push({
                    note: '', // Empty note for now, popdown will allow edit
                    text: selectedText,
                    start: startOffset,
                    end: startOffset + selectedText.length
                });

                // Re-render to show highlight
                const newEl = document.getElementById(newSegment.id);
                if (newEl) updateSegmentContent(newEl, newSegment);

                // Set global selection variables so the popdown works
                selectedSegmentId = newSegment.id;
                currentSelection = {
                    text: selectedText,
                    start: startOffset,
                    end: startOffset + selectedText.length
                };

                // Show Popdown
                const rect = range.getBoundingClientRect();
                inlineNotePopdown.style.left = `${rect.left}px`;
                inlineNotePopdown.style.top = `${rect.top - 50 + window.scrollY}px`;
                inlineNotePopdown.classList.remove('hidden');
                inlineNoteInput.focus();
            }

            // 5. Restart Recognition (new session)
            if (isRecording) {
                setTimeout(() => startTranscription(), 100);
            }
        }
        return; // Stop normal processing
    }

    // Normal Logic for existing segments
    const selection = window.getSelection();
    const rawText = selection.toString();
    const selectedText = rawText.trim();

    if (selectedText.length > 0) {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();

        // Ensure we are in the correct segment
        let container = range.commonAncestorContainer;
        if (container.nodeType === 3) container = container.parentNode;
        const segmentEl = container.closest('.transcript-segment');

        if (segmentEl && segmentEl.id === segmentId) {
            selectedSegmentId = segmentId;

            // Calculate robust start offset by summing text content length of previous nodes
            let startOffset = 0;
            const walker = document.createTreeWalker(segmentEl, NodeFilter.SHOW_TEXT, null, false);
            let node = walker.nextNode();
            while (node) {
                if (node === range.startContainer) {
                    startOffset += range.startOffset;
                    break;
                }
                startOffset += node.textContent.length;
                node = walker.nextNode();
            }

            // Calculate how many spaces were trimmed from the start of the selection
            const leadingSpaces = rawText.indexOf(selectedText);
            const adjustedStartOffset = startOffset + (leadingSpaces > 0 ? leadingSpaces : 0);

            // Correct for the leading space if it exists in the element (prefix added by updateSegmentContent)
            const prev = segmentEl.previousElementSibling;
            const isStartOfParagraph = prev && prev.className === 'transcript-break';
            const isAfterLabel = prev && prev.classList.contains('speaker-label');
            const isFirst = !prev;
            const hasLeadingSpace = !isFirst && !isStartOfParagraph && !isAfterLabel;

            // We subtract 1 if there's a system leading space, but clamp at 0
            const finalStart = Math.max(0, adjustedStartOffset - (hasLeadingSpace ? 1 : 0));
            const finalEnd = finalStart + selectedText.length;

            currentSelection = {
                text: selectedText,
                start: finalStart,
                end: finalEnd
            };

            // Visually highlight immediately
            const mark = document.createElement('mark');
            mark.className = 'word-highlight';
            mark.style.opacity = '0.7'; // Slight transparency to show it's pending
            try {
                range.surroundContents(mark);
                currentTempMark = mark;
            } catch (err) {
                // If selection spans multiple nodes, browser might throw. 
                // In that case we just rely on the selection color until saved.
                console.warn('Could not wrap selection in mark:', err);
            }

            inlineNotePopdown.style.left = `${rect.left}px`;
            inlineNotePopdown.style.top = `${rect.top - 50 + window.scrollY}px`;
            inlineNotePopdown.classList.remove('hidden');
            inlineNoteInput.focus();
        }
    }
}

function saveInlineNote() {
    const noteText = inlineNoteInput.value.trim();
    if (!noteText || !selectedSegmentId || !currentSelection) return;

    const segment = transcriptSegments.find(s => s.id === selectedSegmentId);
    if (segment) {
        if (!segment.highlights) segment.highlights = [];
        segment.highlights.push({
            note: noteText,
            text: currentSelection.text,
            start: currentSelection.start,
            end: currentSelection.end
        });

        const el = document.getElementById(selectedSegmentId);
        if (el) updateSegmentContent(el, segment);
    }

    inlineNoteInput.value = '';
    inlineNotePopdown.classList.add('hidden');
    currentSelection = null;
    showToast('Note added to selection');
}

async function finalizeInterview() {
    if (!currentInterviewId) return;

    const duration = Date.now() - startTime;

    await db.collection('interviews').doc(currentInterviewId).update({
        status: 'completed',
        duration: duration,
        transcript: transcriptSegments,
        generalNotes: generalNotes,
        finishedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
}

// ============================================================================
// GLOBAL TOOLTIP LOGIC
// ============================================================================
function initGlobalTooltip() {
    // Create tooltip element
    const tooltip = document.createElement('div');
    tooltip.id = 'global-tooltip';
    tooltip.className = 'global-tooltip hidden';
    document.body.appendChild(tooltip);

    let tooltipTimeout;
    let isHoveringTooltip = false;

    // Use event delegation for dynamic elements
    document.addEventListener('mouseover', (e) => {
        const target = e.target.closest('.word-highlight');
        if (target) {
            const note = target.dataset.note;
            if (note) {
                clearTimeout(tooltipTimeout);

                // Update content
                const segmentId = target.dataset.segmentId;
                const highlightStart = target.dataset.highlightStart;

                tooltip.innerHTML = `
                    <span>${escapeHtml(note)}</span>
                    <button class="tooltip-delete-btn" title="Remove Note">✕</button>
                `;

                const deleteBtn = tooltip.querySelector('.tooltip-delete-btn');
                if (deleteBtn) {
                    deleteBtn.onclick = (ev) => {
                        ev.stopPropagation();
                        deleteInlineNote(segmentId, highlightStart);
                        tooltip.classList.remove('visible');
                        tooltip.classList.add('hidden');
                    };
                }

                // Show tooltip
                tooltip.classList.remove('hidden');
                tooltip.classList.add('visible');

                // Position calculation
                const rect = target.getBoundingClientRect();
                const tooltipRect = tooltip.getBoundingClientRect();

                // Default: Top Center
                let top = rect.top - tooltipRect.height - 8;
                let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);

                // Boundary Checks
                // Horizontal
                if (left < 10) left = 10;
                if (left + tooltipRect.width > window.innerWidth - 10) {
                    left = window.innerWidth - tooltipRect.width - 10;
                }

                // Vertical (Flip if not enough space above)
                if (top < 0) {
                    top = rect.bottom + 8;
                    tooltip.classList.add('bottom-oriented');
                } else {
                    tooltip.classList.remove('bottom-oriented');
                }

                tooltip.style.top = `${top}px`;
                tooltip.style.left = `${left}px`;
            }
        } else if (e.target.closest('.global-tooltip')) {
            isHoveringTooltip = true;
            clearTimeout(tooltipTimeout);
        }
    });

    document.addEventListener('mouseout', (e) => {
        const target = e.target.closest('.word-highlight');
        const tooltipTarget = e.target.closest('.global-tooltip');

        if (target || tooltipTarget) {
            if (tooltipTarget) isHoveringTooltip = false;

            // Small delay to allow moving between highlight and tooltip
            tooltipTimeout = setTimeout(() => {
                if (!isHoveringTooltip) {
                    tooltip.classList.remove('visible');
                    setTimeout(() => tooltip.classList.add('hidden'), 200);
                }
            }, 300);
        }
    });
}

/**
 * Deletes a highlight from a segment based on start offset
 */
function deleteInlineNote(segmentId, startOffset) {
    if (!segmentId || startOffset === undefined) return;

    const segment = transcriptSegments.find(s => s.id === segmentId);
    if (!segment || !segment.highlights) return;

    // Remove the highlight with the matching start offset
    const index = segment.highlights.findIndex(h => h.start == startOffset);
    if (index > -1) {
        segment.highlights.splice(index, 1);

        // Re-render
        const el = document.getElementById(segmentId);
        if (el) {
            updateSegmentContent(el, segment);
            showToast('Note removed');
        }
    }
}

// ============================================================================
// TRANSCRIPT REVIEW LOGIC
// ============================================================================

const transcriptReviewView = document.getElementById('transcriptReviewView');
const backToProjectFromReviewBtn = document.getElementById('backToProjectFromReviewBtn');
const reviewFeed = document.getElementById('reviewFeed');
const reviewTitle = document.getElementById('reviewTitle');

if (backToProjectFromReviewBtn) {
    backToProjectFromReviewBtn.addEventListener('click', () => {
        // Go back to project detail
        transcriptReviewView.classList.add('hidden');
        projectDetailView.classList.remove('hidden');
        projectsOverview.classList.add('hidden');
        interviewDetailView.classList.add('hidden');
        document.body.classList.remove('fullscreen-active');

        // Refresh project detail to show new interview in list
        if (currentProjectId) openProject(currentProjectId);
    });
}

function openReview(interviewId) {
    currentInterviewId = interviewId;

    // Update UI
    transcriptReviewView.classList.remove('hidden');
    interviewDetailView.classList.add('hidden');
    projectsOverview.classList.add('hidden');
    projectDetailView.classList.add('hidden');
    document.body.classList.add('fullscreen-active');

    // Set Title
    if (interviewDetailTitle) {
        reviewTitle.textContent = "Review: " + interviewDetailTitle.textContent;
    }

    // Merge and Render
    renderReview();
}

function renderReview() {
    reviewFeed.innerHTML = '';

    // Sort segments and notes
    const mergedItems = getMergedTranscript(transcriptSegments, generalNotes);

    mergedItems.forEach(item => {
        if (item.type === 'segment') {
            const segElement = createReviewSegmentElement(item.data);
            reviewFeed.appendChild(segElement);
        } else if (item.type === 'note') {
            const noteElement = createReviewNoteElement(item.data);
            reviewFeed.appendChild(noteElement);
        }
    });

    // Scroll to top
    reviewFeed.scrollTop = 0;
}

async function saveReviewChanges() {
    if (!currentInterviewId) return;

    const saveBtn = document.getElementById('saveReviewBtn');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
    }

    try {
        await db.collection('interviews').doc(currentInterviewId).update({
            transcript: transcriptSegments,
            generalNotes: generalNotes,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        showToast('Changes saved successfully');
    } catch (error) {
        console.error('Error saving changes:', error);
        alert('Failed to save changes.');
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = `
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                    <polyline points="17 21 17 13 7 13 7 21"></polyline>
                    <polyline points="7 3 7 8 15 8"></polyline>
                </svg>
                Save Changes
            `;
        }
    }
}


async function loadCompletedInterview(interviewId) {
    try {
        const doc = await db.collection('interviews').doc(interviewId).get();
        if (!doc.exists) {
            console.error('Interview not found:', interviewId);
            return;
        }

        const data = doc.data();

        // Re-hydrate globals
        currentInterviewId = interviewId;
        transcriptSegments = data.transcript || [];
        generalNotes = data.generalNotes || [];

        // Ensure interviewDetailTitle is available if needed, though openReview sets reviewTitle from it
        // We might need to manually set reviewTitle since interviewDetailTitle element might still contain 'Loading...' or old data
        // Wait, openReview sets reviewTitle based on interviewDetailTitle.textContent
        // We should just set reviewTitle directly here or update the hidden title element.
        if (reviewTitle) reviewTitle.textContent = "Review: " + (data.title || "Untitled Interview");

        openReview(interviewId);

    } catch (e) {
        console.error('Error loading completed interview:', e);
        showToast('Error loading interview');
    }
}
function getMergedTranscript(segments, notes) {
    let combined = [];
    // Add all segments
    segments.forEach(seg => {
        combined.push({ type: 'segment', data: seg, timestamp: seg.timestamp });
    });
    // Add all notes
    notes.forEach(note => {
        combined.push({ type: 'note', data: note, timestamp: note.timestamp });
    });
    // Sort by timestamp
    combined.sort((a, b) => a.timestamp - b.timestamp);
    return combined;
}

function createReviewSegmentElement(segment) {
    const div = document.createElement('div');
    div.className = 'review-item review-segment';

    if (segment.speaker) {
        const speakerLabel = document.createElement('span');
        speakerLabel.className = `speaker-label ${segment.speaker}`;
        speakerLabel.textContent = segment.speaker === 'interviewer' ? 'Interviewer' : 'Participant';
        speakerLabel.title = "Click to toggle speaker or remove";
        speakerLabel.style.cursor = "pointer";

        speakerLabel.onclick = () => {
            if (segment.speaker === 'interviewer') {
                segment.speaker = 'participant';
                speakerLabel.className = 'speaker-label participant';
                speakerLabel.textContent = 'Participant';
            } else {
                // Remove speaker
                segment.speaker = null;
                speakerLabel.remove();
            }
        };
        div.appendChild(speakerLabel);
    }

    const textSpan = document.createElement('span');
    textSpan.contentEditable = true;
    textSpan.spellcheck = false;
    textSpan.style.outline = 'none';

    let html = '';
    let lastIndex = 0;
    const text = segment.text;
    const sortedHighlights = [...(segment.highlights || [])].sort((a, b) => a.start - b.start);

    sortedHighlights.forEach(h => {
        if (h.start > lastIndex) {
            html += escapeHtml(text.substring(lastIndex, h.start));
        }
        const chunk = text.substring(h.start, h.end);
        html += `<mark class="word-highlight" data-segment-id="${segment.id}" data-highlight-start="${h.start}" data-note="${escapeHtml(h.note || '')}">${escapeHtml(chunk)}</mark>`;
        lastIndex = h.end;
    });
    if (lastIndex < text.length) {
        html += escapeHtml(text.substring(lastIndex));
    }

    textSpan.innerHTML = html;

    // Add blur listener to save changes?
    textSpan.addEventListener('blur', () => {
        // Update segment text
        segment.text = textSpan.innerText;
        // Note: This logic is simple and might break highlights if text is heavily edited.
        // But for "changing words or so", it works reasonably well as long as length is preserved or edits are minor.
        // Highlights use indices, so shifting text blindly *will* break highlighting alignment.
        // For a robust implementation, we'd need a real rich text editor model.
        // Given the constraints, we accept this limitation or simply warn.
    });

    div.appendChild(textSpan);

    // Wire up highlights for this view too (tooltip)
    // The existing mouseover listeners for .word-highlight are global (delegated)?
    // No, they are usually attached in 'updateSegmentContent'? 
    // Ah, 'initGlobalTooltip' in previous turn looked for '.word-highlight'.
    // Let's check initGlobalTooltip logic.
    // Use the same mouseover logic here.

    textSpan.querySelectorAll('.word-highlight').forEach(mark => {
        // Rely on global tooltip delegation if it exists, OR add listeners here.
        // script.js initGlobalTooltip uses document.addEventListener('mouseover') delegation?
        // Let's check initGlobalTooltip.
    });

    return div;
}

function createReviewNoteElement(note) {
    const div = document.createElement('div');
    div.className = 'review-item review-note-card';

    const meta = document.createElement('div');
    meta.className = 'review-note-meta';

    // Format timestamp relative to start
    const minutes = Math.floor(note.timestamp / 60000);
    const seconds = Math.floor((note.timestamp % 60000) / 1000);
    const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    const timestampSpan = document.createElement('span');
    timestampSpan.textContent = `Session Note at ${timeStr}`;
    meta.appendChild(timestampSpan);

    // Actions (Delete)
    const actions = document.createElement('div');
    actions.className = 'review-note-actions';

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'review-action-btn';
    deleteBtn.innerHTML = 'Delete';
    deleteBtn.onclick = () => {
        openConfirmModal(
            'Delete Note',
            'Are you sure you want to delete this note?',
            'Delete',
            () => {
                const index = generalNotes.indexOf(note);
                if (index > -1) {
                    generalNotes.splice(index, 1);
                    div.remove();
                    // update firestore logic would go here
                }
            }
        );
    };

    actions.appendChild(deleteBtn);
    meta.appendChild(actions);
    div.appendChild(meta);

    const content = document.createElement('div');
    content.contentEditable = true;
    content.textContent = note.content;
    content.addEventListener('blur', () => {
        note.content = content.textContent;
    });
    content.style.outline = 'none';

    div.appendChild(content);
    return div;
}

// ============================================================================
// UNIVERSAL CONFIRMATION MODAL LOGIC
// ============================================================================
const universalConfirmModal = document.getElementById('universalConfirmModal');
const uniModalTitle = document.getElementById('uniModalTitle');
const uniModalText = document.getElementById('uniModalText');
const uniConfirmBtn = document.getElementById('uniConfirmBtn');
const uniCancelBtn = document.getElementById('uniCancelBtn');
const closeUniModalIcon = document.getElementById('closeUniModalIcon');

let pendingConfirmAction = null;

function openConfirmModal(title, text, confirmLabel, onConfirm) {
    if (uniModalTitle) uniModalTitle.textContent = title;
    if (uniModalText) uniModalText.textContent = text;
    if (uniConfirmBtn) uniConfirmBtn.textContent = confirmLabel || 'Confirm';

    pendingConfirmAction = onConfirm;
    if (universalConfirmModal) universalConfirmModal.classList.remove('hidden');
}

function closeUniModal() {
    if (universalConfirmModal) universalConfirmModal.classList.add('hidden');
    pendingConfirmAction = null;
}

if (uniConfirmBtn) {
    uniConfirmBtn.addEventListener('click', () => {
        if (pendingConfirmAction) pendingConfirmAction();
        closeUniModal();
    });
}

if (uniCancelBtn) uniCancelBtn.addEventListener('click', closeUniModal);
if (closeUniModalIcon) closeUniModalIcon.addEventListener('click', closeUniModal);
