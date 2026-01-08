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
            document.querySelectorAll('.project-card').forEach(el => el.classList.remove('menu-open'));
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

    // Logo Click Handler (Go Home)
    const logoEl = document.querySelector('.logo');
    if (logoEl) {
        logoEl.style.cursor = 'pointer';
        logoEl.addEventListener('click', () => {
            // Close any active interview clean up
            if (!interviewDetailView.classList.contains('hidden') || isRecording) {
                // If recording, maybe we should warn? For now, we force close for navigation responsiveness.
                // Reusing closeInterview logic but forcing to dashboard
                isRecording = false;
                isPaused = false;
                stopTranscription();
                stopTimer();
                document.body.classList.remove('fullscreen-active');
                interviewDetailView.classList.add('hidden');
                transcriptReviewView.classList.add('hidden');
                guidelineEditorView.classList.add('hidden');

                // Reset State
                currentInterviewId = null;
                startTime = null;
                const url = new URL(window.location);
                url.searchParams.delete('interview');
                window.history.pushState({}, '', url);
            }

            // Reset Project Context
            currentProjectId = null;

            // Navigate to Dashboard
            projectDetailView.classList.add('hidden');
            guidelineEditorView.classList.add('hidden');
            transcriptReviewView.classList.add('hidden');
            projectsOverview.classList.remove('hidden');

            render();
        });
    }
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

// DOM Elements - Interview Mode Selection Modal
const interviewModeModal = document.getElementById('interviewModeModal');
const closeInterviewModeModal = document.getElementById('closeInterviewModeModal');
const startNewInterviewBtn = document.getElementById('startNewInterviewBtn');
const importTranscriptBtn = document.getElementById('importTranscriptBtn');

// DOM Elements - Create Interview Modal
const createInterviewModal = document.getElementById('createInterviewModal');
const closeInterviewModalIcon = document.getElementById('closeInterviewModalIcon');
const cancelInterviewBtn = document.getElementById('cancelInterviewBtn');
const confirmStartInterviewBtn = document.getElementById('confirmStartInterviewBtn');
const interviewTitleInput = document.getElementById('interviewTitle');
const interviewGuidelineSelect = document.getElementById('interviewGuideline');
const interviewParticipantInput = document.getElementById('interviewParticipant');
const interviewRoundInput = document.getElementById('interviewRound');

// DOM Elements - Import Transcript Modal
const importTranscriptModal = document.getElementById('importTranscriptModal');
const closeImportTranscriptModal = document.getElementById('closeImportTranscriptModal');
const cancelImportTranscriptBtn = document.getElementById('cancelImportTranscriptBtn');
const confirmImportTranscriptBtn = document.getElementById('confirmImportTranscriptBtn');
const importTranscriptTitleInput = document.getElementById('importTranscriptTitle');
const importTranscriptParticipantInput = document.getElementById('importTranscriptParticipant');
const transcriptUploadArea = document.getElementById('transcriptUploadArea');
const transcriptPdfInput = document.getElementById('transcriptPdfInput');
const transcriptFileInfo = document.getElementById('transcriptFileInfo');
const transcriptFileName = document.getElementById('transcriptFileName');
const removeTranscriptFile = document.getElementById('removeTranscriptFile');

// State for imported transcript
let importedTranscriptText = '';
let importedTranscriptFile = null;

// Interview Mode Selection Modal Listeners
if (createInterviewBtn) createInterviewBtn.addEventListener('click', openInterviewModeModal);
if (closeInterviewModeModal) closeInterviewModeModal.addEventListener('click', () => interviewModeModal.classList.add('hidden'));
if (startNewInterviewBtn) startNewInterviewBtn.addEventListener('click', () => {
    interviewModeModal.classList.add('hidden');
    openCreateInterviewModal();
});
if (importTranscriptBtn) importTranscriptBtn.addEventListener('click', () => {
    interviewModeModal.classList.add('hidden');
    openImportTranscriptModal();
});

// Interview Modal Listeners
if (closeInterviewModalIcon) closeInterviewModalIcon.addEventListener('click', closeCreateInterviewModal);
if (cancelInterviewBtn) cancelInterviewBtn.addEventListener('click', closeCreateInterviewModal);
if (confirmStartInterviewBtn) confirmStartInterviewBtn.addEventListener('click', submitCreateInterview);

// Import Transcript Modal Listeners
if (closeImportTranscriptModal) closeImportTranscriptModal.addEventListener('click', closeImportTranscriptModalFn);
if (cancelImportTranscriptBtn) cancelImportTranscriptBtn.addEventListener('click', closeImportTranscriptModalFn);
if (confirmImportTranscriptBtn) confirmImportTranscriptBtn.addEventListener('click', submitImportTranscript);
if (transcriptUploadArea) transcriptUploadArea.addEventListener('click', () => transcriptPdfInput.click());
if (transcriptPdfInput) transcriptPdfInput.addEventListener('change', handleTranscriptFileSelect);
if (removeTranscriptFile) removeTranscriptFile.addEventListener('click', clearTranscriptFile);

// Drag and drop for transcript upload
if (transcriptUploadArea) {
    transcriptUploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        transcriptUploadArea.style.borderColor = 'var(--brand-primary)';
        transcriptUploadArea.style.background = '#fff7ed';
    });
    transcriptUploadArea.addEventListener('dragleave', () => {
        transcriptUploadArea.style.borderColor = '#e2e8f0';
        transcriptUploadArea.style.background = '#f8fafc';
    });
    transcriptUploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        transcriptUploadArea.style.borderColor = '#e2e8f0';
        transcriptUploadArea.style.background = '#f8fafc';
        const file = e.dataTransfer.files[0];
        if (file && file.type === 'application/pdf') {
            processTranscriptFile(file);
        } else {
            showToast('Please upload a PDF file', 'error');
        }
    });
}

// backToDashboardBtn listener moved to closeInterview/initInterviewListeners logic


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

    // Close other menus
    document.querySelectorAll('.card-dropdown').forEach(el => {
        if (el.id !== `menu-${id}`) el.classList.add('hidden');
    });

    // Remove menu-open from other cards
    document.querySelectorAll('.project-card').forEach(el => {
        const menu = el.querySelector(`#menu-${id}`);
        if (!menu) el.classList.remove('menu-open');
    });

    const menu = document.getElementById(`menu-${id}`);
    const card = event.target.closest('.project-card');

    if (menu) {
        const isCurrentlyHidden = menu.classList.contains('hidden');
        menu.classList.toggle('hidden');
        if (card) {
            if (isCurrentlyHidden) {
                card.classList.add('menu-open');
            } else {
                card.classList.remove('menu-open');
            }
        }
    }
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
    else if (itemToDelete.type === 'interview') {
        try {
            await window.deleteInterviewFromFirestore(itemToDelete.id);
            showToast('Interview deleted');
            // itemToDelete.projectId is passed when deleting interview
            if (itemToDelete.projectId) {
                renderInterviewsList(itemToDelete.projectId);
            }
        } catch (error) {
            console.error('Error deleting interview:', error);
            alert('Failed to delete interview');
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
        <div class="card-item-row" onclick="editGuideline('${project.id}', '${g.id}')" style="cursor: pointer; padding: 1rem; background: white; border-radius: var(--radius-md); border: 1px solid #e2e8f0; margin-bottom: 0.5rem; display: flex; justify-content: space-between; align-items: center; transition: all 0.2s; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
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
        let interviews = await window.loadInterviewsForProject(projectId);

        if (!interviews || interviews.length === 0) {
            list.className = 'list-container empty-list-placeholder';
            list.innerHTML = '<p>No interviews yet.</p>';
            return;
        }

        // Sort by sortOrder if available, otherwise by createdAt
        interviews.sort((a, b) => {
            if (a.sortOrder !== undefined && b.sortOrder !== undefined) {
                return a.sortOrder - b.sortOrder;
            }
            const aTime = a.createdAt?.toMillis() || 0;
            const bTime = b.createdAt?.toMillis() || 0;
            return bTime - aTime;
        });

        list.className = 'list-container';
        list.innerHTML = interviews.map((i, index) => {
            const isImported = i.status === 'imported' || i.isImported;
            const isDone = i.status === 'completed' || i.status === 'finalized' || isImported;

            // Consistent badge styling with borders for all types
            let statusBadge;
            if (isImported) {
                // Imported badge - orange
                statusBadge = `<span class="status-badge imported" style="background: #fff7ed; color: #ea580c; border: 1px solid #fed7aa; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">Imported</span>`;
            } else if (isDone) {
                // Done badge - orange
                statusBadge = `<span class="status-badge done" style="background: #fff7ed; color: #ea580c; border: 1px solid #fed7aa; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">Done</span>`;
            } else {
                // Planned badge - grey
                statusBadge = `<span class="status-badge planned" style="background: #f8fafc; color: #64748b; border: 1px solid #e2e8f0; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">Planned</span>`;
            }

            // Same styling for all interviews - more visible boxes
            const cardStyle = 'padding: 1rem; background: white; border-radius: var(--radius-md); border: 1px solid #e2e8f0; margin-bottom: 0.5rem; display: flex; justify-content: space-between; align-items: center; transition: all 0.2s; user-select: none; box-shadow: 0 1px 3px rgba(0,0,0,0.05);';

            // Icon for imported transcripts - grey color
            const importIcon = isImported
                ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2" style="margin-right: 0.5rem; flex-shrink: 0;">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                   </svg>`
                : '';

            return `
            <div class="card-item-row interview-draggable ${isImported ? 'imported-transcript' : ''}" 
                 draggable="true" 
                 data-interview-id="${i.id}" 
                 data-interview-status="${i.status}"
                 data-index="${index}"
                 style="${cardStyle}">
                <div class="interview-drag-handle" style="cursor: grab; padding: 0.5rem; margin-right: 0.5rem; color: #94a3b8; display: flex; align-items: center;">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="9" cy="5" r="1" fill="currentColor"></circle>
                        <circle cx="9" cy="12" r="1" fill="currentColor"></circle>
                        <circle cx="9" cy="19" r="1" fill="currentColor"></circle>
                        <circle cx="15" cy="5" r="1" fill="currentColor"></circle>
                        <circle cx="15" cy="12" r="1" fill="currentColor"></circle>
                        <circle cx="15" cy="19" r="1" fill="currentColor"></circle>
                    </svg>
                </div>
                <div class="interview-content" style="display: flex; align-items: center; flex: 1; cursor: pointer;">
                    ${importIcon}
                    <div>
                        <div style="font-weight: 600; color: var(--text-title);">${escapeHtml(i.title)}</div>
                        ${i.participant ? `<div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 0.25rem;">Participant: ${escapeHtml(i.participant)}</div>` : ''}
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                     ${statusBadge}
                    <span style="font-size: 0.85rem; color: var(--text-muted);">
                        ${i.createdAt ? new Date(i.createdAt.toMillis()).toLocaleDateString() : 'Just now'}
                    </span>
                    <button class="delete-item-btn" style="padding: 0.25rem;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                </div>
            </div>
                `;
        }).join('');

        // Initialize drag and drop and click handlers
        initInterviewDragDrop(list, projectId);

    } catch (error) {
        console.error('Error rendering interviews list:', error);
        list.innerHTML = '<p style="text-align: center; color: var(--brand-primary); padding: 1rem;">Error loading interviews</p>';
    }
}

// Initialize drag and drop for interview list reordering using SortableJS
function initInterviewDragDrop(list, projectId) {
    // Add click handlers for interview content and delete buttons
    list.querySelectorAll('.interview-draggable').forEach(item => {
        const interviewId = item.dataset.interviewId;
        const interviewStatus = item.dataset.interviewStatus;

        // Click handler for interview content (to open the interview)
        const contentArea = item.querySelector('.interview-content');
        if (contentArea) {
            contentArea.addEventListener('click', (e) => {
                e.stopPropagation();
                handleInterviewClick(interviewId, interviewStatus);
            });
        }

        // Click handler for delete button
        const deleteBtn = item.querySelector('.delete-item-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteInterview(e, interviewId, projectId);
            });
        }
    });

    // Initialize SortableJS if available
    if (typeof Sortable !== 'undefined') {
        new Sortable(list, {
            animation: 150,
            handle: '.interview-drag-handle',
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            dragClass: 'sortable-drag',
            onEnd: async function (evt) {
                // Save new order to Firestore
                await saveInterviewOrder(list, projectId);
                showToast('Order updated');
            }
        });
    } else {
        console.warn('SortableJS not loaded - drag and drop disabled');
    }
}

// Save the new interview order to Firestore
async function saveInterviewOrder(list, projectId) {
    const items = list.querySelectorAll('.interview-draggable');
    const updates = [];

    items.forEach((item, index) => {
        const interviewId = item.dataset.interviewId;
        item.dataset.index = index; // Update index attribute
        updates.push({
            id: interviewId,
            sortOrder: index
        });
    });

    // Update each interview's sortOrder in Firestore
    try {
        for (const update of updates) {
            await window.updateInterviewInFirestore(update.id, { sortOrder: update.sortOrder });
        }
    } catch (error) {
        console.error('Error saving interview order:', error);
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
    if (status === 'completed' || status === 'finalized' || status === 'imported') {
        loadCompletedInterview(id);
    } else {
        loadInterviewView(id);
    }
};

window.deleteInterview = function (event, interviewId, projectId) {
    event.stopPropagation();

    itemToDelete = { type: 'interview', id: interviewId, projectId: projectId };

    // Update Modal Text
    const titleEl = document.getElementById('deleteModalTitle');
    const textEl = document.getElementById('deleteModalText');
    if (titleEl) titleEl.textContent = "Delete Interview";
    if (textEl) textEl.textContent = "Are you sure you want to delete this interview? This action cannot be undone.";

    const deleteModal = document.getElementById('deleteConfirmModal');
    if (deleteModal) deleteModal.classList.remove('hidden');
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

// Open the interview mode selection modal
function openInterviewModeModal() {
    interviewModeModal.classList.remove('hidden');
}

// ===================================
// IMPORT TRANSCRIPT FUNCTIONS
// ===================================

function openImportTranscriptModal() {
    importTranscriptModal.classList.remove('hidden');

    // Reset fields
    if (importTranscriptTitleInput) importTranscriptTitleInput.value = '';
    if (importTranscriptParticipantInput) importTranscriptParticipantInput.value = '';
    clearTranscriptFile();
}

function closeImportTranscriptModalFn() {
    importTranscriptModal.classList.add('hidden');
    clearTranscriptFile();
}

function clearTranscriptFile() {
    importedTranscriptText = '';
    importedTranscriptFile = null;
    if (transcriptPdfInput) transcriptPdfInput.value = '';
    if (transcriptFileInfo) transcriptFileInfo.classList.add('hidden');
    if (transcriptUploadArea) transcriptUploadArea.classList.remove('hidden');
}

function handleTranscriptFileSelect(e) {
    const file = e.target.files[0];
    if (file && file.type === 'application/pdf') {
        processTranscriptFile(file);
    } else if (file) {
        showToast('Please upload a PDF file', 'error');
    }
}

async function processTranscriptFile(file) {
    importedTranscriptFile = file;

    // Show file name
    if (transcriptFileName) transcriptFileName.textContent = file.name;
    if (transcriptUploadArea) transcriptUploadArea.classList.add('hidden');
    if (transcriptFileInfo) transcriptFileInfo.classList.remove('hidden');

    // Parse PDF text
    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        let fullText = '';

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(' ');
            fullText += pageText + '\n\n';
        }

        importedTranscriptText = fullText.trim();
        console.log('Extracted text length:', importedTranscriptText.length);
    } catch (error) {
        console.error('Error parsing PDF:', error);
        showToast('Error reading PDF file', 'error');
        clearTranscriptFile();
    }
}

async function submitImportTranscript() {
    const title = importTranscriptTitleInput?.value.trim();
    const participant = importTranscriptParticipantInput?.value.trim();

    if (!title) {
        alert('Please enter a transcript title.');
        return;
    }

    if (!importedTranscriptText) {
        alert('Please upload a PDF transcript.');
        return;
    }

    if (confirmImportTranscriptBtn) {
        confirmImportTranscriptBtn.disabled = true;
        confirmImportTranscriptBtn.textContent = 'Importing...';
    }

    try {
        // Convert the raw text to transcript segments
        // Split by double newlines or use the whole text as one segment
        const paragraphs = importedTranscriptText.split(/\n\n+/).filter(p => p.trim());
        const segments = paragraphs.map((text, index) => ({
            id: 'seg_' + Date.now() + '_' + index,
            text: text.trim(),
            timestamp: index * 10, // Spread timestamps for ordering
            notes: [],
            speaker: null,
            highlights: []
        }));

        // Save as a completed/imported interview
        const interviewData = {
            title: title,
            participant: participant,
            projectId: currentProjectId,
            status: 'imported', // Special status for imported transcripts
            isImported: true,
            transcriptSegments: segments,
            generalNotes: [],
            round: '',
            guidelineId: null
        };

        const interviewId = await window.saveInterviewToFirestore(interviewData);
        // Data is saved in initial call, no need for separate update

        closeImportTranscriptModalFn();
        showToast('Transcript imported successfully');

        // Refresh the interviews list
        if (currentProjectId) {
            renderInterviewsList(currentProjectId);
        }

    } catch (error) {
        console.error('Failed to import transcript:', error);
        alert('Failed to import transcript: ' + error.message);
    } finally {
        if (confirmImportTranscriptBtn) {
            confirmImportTranscriptBtn.disabled = false;
            confirmImportTranscriptBtn.textContent = 'Import transcript';
        }
    }
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
    if (projectsOverview) projectsOverview.classList.add('hidden');
    if (projectDetailView) projectDetailView.classList.add('hidden');
    if (transcriptReviewView) transcriptReviewView.classList.add('hidden');
    if (interviewDetailView) interviewDetailView.classList.remove('hidden');

    if (interviewDetailTitle) interviewDetailTitle.textContent = 'Loading...';
    if (transcriptionFeed) transcriptionFeed.innerHTML = '<p style="text-align: center; color: var(--text-muted); margin-top: 2rem; user-select: none; -webkit-user-select: none;">Click the orange button to start the interview transcription.</p>';
    if (recordingTimer) recordingTimer.textContent = '00:00';
    if (recordingStatus) {
        recordingStatus.textContent = 'Ready';
        if (recordingStatus.parentElement) recordingStatus.parentElement.classList.remove('active');
    }

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

    // Explicitly hide interview view
    if (interviewDetailView) interviewDetailView.classList.add('hidden');

    currentInterviewId = null;
    startTime = null;
    elapsedTime = 0;
    transcriptSegments = [];
    generalNotes = [];

    // Clear URL param
    const url = new URL(window.location);
    url.searchParams.delete('interview');
    window.history.pushState({}, '', url);

    // Stop persistent microphone stream (Optional)
    /* 
    if (micStream) {
        micStream.getTracks().forEach(track => track.stop());
        micStream = null;
    } 
    */

    // NAVIGATION LOGIC
    // If we have a project context, go back there. Otherwise go to global dashboard.
    if (currentProjectId) {
        projectsOverview.classList.add('hidden');
        projectDetailView.classList.remove('hidden');
        // We refresh the list to show the new interview if it was just created/completed
        renderInterviewsList(currentProjectId);
    } else {
        projectDetailView.classList.add('hidden');
        projectsOverview.classList.remove('hidden');
        render();
    }
}



/**
 * Requests microphone access once and keeps the stream active
 * to prevent repeated browser permission prompts.
 */
async function warmupMicrophone() {
    if (micStream && micStream.active) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.warn('getUserMedia not supported in this environment.');
        return;
    }
    try {
        console.log('Requesting persistent microphone access...');
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        console.log('Microphone warmed up and persistent.');

        // Handle stream ending
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
        recordingTimer.textContent = `${mins}:${secs} `;
    }, 1000);
}

function stopTimer() {
    clearInterval(timerInterval);
}

// Transcription Logic (WebSpeech API)
async function startTranscription() {
    window.SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!window.SpeechRecognition) {
        alert('Web Speech API is not supported in this browser. Please use Chrome.');
        return;
    }

    // --- PERMISSION FIX ---
    // If we haven't acquired a persistent stream yet, wait for it.
    // This guarantees the browser considers the page to have "Mic Access"
    // BEFORE we start the finicky SpeechRecognition engine.
    if (!window.persistentAudioStream) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            window.persistentAudioStream = stream;
        } catch (err) {
            console.warn("Could not acquire persistent mic stream:", err);
            // If the user denied this, SpeechRecognition will likely fail too, but we let it try.
        }
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

function toggleSpeaker() {
    const nextSpeaker = currentSpeaker === 'interviewer' ? 'participant' : 'interviewer';

    // Update UI
    const btn = document.getElementById('switchSpeakerBtn');
    if (btn) {
        const span = btn.querySelector('span');
        if (span) span.textContent = nextSpeaker === 'interviewer' ? 'Interviewer' : 'Participant';

        // Update styling
        if (nextSpeaker === 'participant') {
            btn.classList.add('participant');
        } else {
            btn.classList.remove('participant');
        }
    }

    // Hande Logic
    if (isRecording && recognition) {
        // update immediately - no need to stop/restart just for a label change
        // The next result (final or interim) will pick up the new speaker variable
        currentSpeaker = nextSpeaker;
        showToast(`Speaker switched to ${nextSpeaker === 'interviewer' ? 'Interviewer' : 'Participant'}`);
    } else {
        // If not recording or paused, just update state immediately
        currentSpeaker = nextSpeaker;
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

    // Provide visual feedback
    const originalText = submitGeneralNoteBtn.innerHTML;
    submitGeneralNoteBtn.innerHTML = '✓ Sent';

    // We keep the orange background defined in CSS

    setTimeout(() => {
        submitGeneralNoteBtn.innerHTML = originalText;
    }, 1500);

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

            // Capture positions BEFORE we modify DOM (which removes the element)
            const rect = range.getBoundingClientRect();

            // Adjust for leading space if interim has one (it often does if not first)
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

                // Show Popdown using captured rect
                inlineNotePopdown.style.position = 'fixed';
                inlineNotePopdown.style.left = `${rect.left}px`;
                inlineNotePopdown.style.top = `${rect.bottom + 10}px`;
                inlineNotePopdown.classList.remove('hidden'); // CRITICAL FIX: Ensure this is removed
                inlineNoteInput.focus();
            }

            // 5. Restart Recognition (new session)
            if (isRecording) {
                // Short delay to ensure DOM settles and we don't catch the abort
                setTimeout(() => startTranscription(), 200);
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
            mark.setAttribute('data-temp-id', 'pending-note'); // Unique ID for saving
            try {
                range.surroundContents(mark);
                currentTempMark = mark;
            } catch (err) {
                // If selection spans multiple nodes, browser might throw. 
                // In that case we just rely on the selection color until saved.
                console.warn('Could not wrap selection in mark:', err);
            }

            inlineNotePopdown.style.position = 'fixed';
            inlineNotePopdown.style.left = `${rect.left}px`;
            inlineNotePopdown.style.top = `${rect.bottom + 10}px`;
            inlineNotePopdown.classList.remove('hidden');
            inlineNoteInput.focus();
        }
    }
}

function saveInlineNote() {
    const noteText = inlineNoteInput.value.trim();
    if (!noteText || !selectedSegmentId || !currentSelection) return;

    const segment = transcriptSegments.find(s => s.id === selectedSegmentId);
    if (!segment) return;

    // 1. Sync Text Content First (Capture any user typo fixes)
    let el = document.getElementById(selectedSegmentId);
    if (!el) {
        // Fallback for Review Mode where IDs might not be set on the div
        el = document.querySelector(`.review-segment[data-segment-id="${selectedSegmentId}"]`);
    }

    if (el) {
        const contentSpan = el.querySelector('[contenteditable]');
        if (contentSpan) {
            segment.text = contentSpan.innerText; // Capture latest text
        }
    }

    // 2. Add new note to model
    if (!segment.highlights) segment.highlights = [];
    segment.highlights.push({
        note: noteText,
        text: currentSelection.text,
        start: currentSelection.start,
        end: currentSelection.end
    });

    // 3. Clear stored HTML to force regeneration
    // This is the "Nuclear" fix: instead of patching the DOM, we rebuild it from the model.
    // This ensures that the HTML structure always perfectly matches the highlights,
    // and guarantees that createReviewSegmentElement attaches the event listeners correctly.
    segment.html = '';

    // 4. Re-render
    if (el) {
        if (el.classList.contains('review-segment')) {
            const newEl = createReviewSegmentElement(segment);
            el.replaceWith(newEl);
        } else {
            updateSegmentContent(el, segment);
        }
    }

    pushToReviewHistory();

    // 5. Cleanup
    inlineNoteInput.value = '';
    inlineNotePopdown.classList.add('hidden');
    currentSelection = null;
    currentTempMark = null;
    showToast('Note added');
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

// Helper for tooltip content
function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

let globalTooltip = null;
let globalTooltipTimeout = null;
let isHoveringGlobalTooltip = false;

function showGlobalTooltip(target) {
    if (!globalTooltip) return;
    if (!target) return;

    const note = target.dataset.note || target.getAttribute('data-note');
    if (note) {
        clearTimeout(globalTooltipTimeout);

        // Update content
        const segmentId = target.dataset.segmentId;
        const highlightStart = target.dataset.highlightStart;

        globalTooltip.innerHTML = `
            <span style="flex: 1;">${escapeHtml(note)}</span>
            <button class="tooltip-delete-btn" title="Remove Note">✕</button>
        `;

        const deleteBtn = globalTooltip.querySelector('.tooltip-delete-btn');
        if (deleteBtn) {
            deleteBtn.onclick = (ev) => {
                ev.stopPropagation();
                deleteInlineNote(segmentId, highlightStart);
                globalTooltip.classList.remove('visible');
                globalTooltip.classList.add('hidden');
            };
        }

        // Show tooltip
        globalTooltip.classList.remove('hidden');
        globalTooltip.classList.add('visible');

        // Position calculation
        const rect = target.getBoundingClientRect();
        const tooltipRect = globalTooltip.getBoundingClientRect();

        // Default: Top Center
        let top = rect.top - tooltipRect.height - 8;
        let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);

        // Boundary Checks
        if (top < 10) top = rect.bottom + 10; // Flip to bottom if no space top
        if (left < 10) left = 10; // Left edge
        if (left + tooltipRect.width > window.innerWidth - 10) {
            left = window.innerWidth - tooltipRect.width - 10; // Right edge
        }

        globalTooltip.style.top = `${top}px`;
        globalTooltip.style.left = `${left}px`;
    }
}

function hideGlobalTooltip() {
    if (!globalTooltip) return;

    // Small delay
    globalTooltipTimeout = setTimeout(() => {
        if (!isHoveringGlobalTooltip) {
            globalTooltip.classList.remove('visible');
            setTimeout(() => globalTooltip.classList.add('hidden'), 200);
        }
    }, 3000);
}

function initGlobalTooltip() {
    // Create tooltip element if not exists
    if (!document.getElementById('global-tooltip')) {
        globalTooltip = document.createElement('div');
        globalTooltip.id = 'global-tooltip';
        globalTooltip.className = 'global-tooltip hidden';
        document.body.appendChild(globalTooltip);

        // Keep tooltip open when hovering over IT
        globalTooltip.addEventListener('mouseenter', () => {
            isHoveringGlobalTooltip = true;
            clearTimeout(globalTooltipTimeout);
        });
        globalTooltip.addEventListener('mouseleave', () => {
            isHoveringGlobalTooltip = false;
            hideGlobalTooltip();
        });
    } else {
        globalTooltip = document.getElementById('global-tooltip');
    }

    // Keep Event Delegation as Backup
    document.addEventListener('mouseover', (e) => {
        const el = e.target.nodeType === 3 ? e.target.parentElement : e.target;
        const target = el.closest('.word-highlight');
        if (target) showGlobalTooltip(target);
    });

    document.addEventListener('mouseout', (e) => {
        const el = e.target.nodeType === 3 ? e.target.parentElement : e.target;
        const target = el.closest('.word-highlight');
        if (target) hideGlobalTooltip();
    });

    // Hide on scroll (capture phase to catch all scrolling)
    document.addEventListener('scroll', () => {
        if (globalTooltip && globalTooltip.classList.contains('visible')) {
            clearTimeout(globalTooltipTimeout);
            globalTooltip.classList.remove('visible');
            globalTooltip.classList.add('hidden');
        }
    }, { capture: true, passive: true });
}

/**
 * Deletes a highlight from a segment based on start offset
 */
function deleteInlineNote(segmentId, startOffset) {
    if (!segmentId || startOffset === undefined) return;

    const segment = transcriptSegments.find(s => s.id === segmentId);
    if (!segment) return;

    console.log(`Deleting note: Segment ${segmentId}, Offset ${startOffset}`);

    // Robustly handle startOffset type (can be string from dataset or number from model)
    const offsetVal = parseInt(startOffset, 10);

    // 1. Update Model (Always do this)
    if (segment.highlights) {
        // Find by loose equality to handle string/number mismatch
        const index = segment.highlights.findIndex(h => h.start == offsetVal);
        if (index > -1) {
            segment.highlights.splice(index, 1);
            console.log('Removed from model highlights');
        } else {
            console.warn('Could not find highlight in model to delete');
        }
    }

    // 2. Update HTML (If present)
    if (segment.html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(segment.html, 'text/html');

        // Correct selector syntax: remove spaces around attributes
        // And handle potentially slightly different attribute values (string vs number)
        let mark = doc.querySelector(`.word-highlight[data-highlight-start="${offsetVal}"]`);

        // Fallback: Try string version if number didn't match
        if (!mark) {
            mark = doc.querySelector(`.word-highlight[data-highlight-start="${startOffset}"]`);
        }

        if (mark) {
            const textContent = doc.createTextNode(mark.textContent);
            mark.parentNode.replaceChild(textContent, mark);
            segment.html = doc.body.innerHTML;
            segment.text = doc.body.textContent; // Sync text text
            console.log('Removed from HTML');
        } else {
            // New Fallback: If we have HTML but can't find the mark (maybe Live mode artifact),
            // and we successfully removed it from the model above,
            // we should just REGENERATE the HTML from the text + highlights model.
            // This is safer than leaving a "ghost" highlight in the HTML.
            console.log('Mark not found in HTML, regenerating from model...');
            segment.html = ''; // Force regeneration in createReviewSegmentElement or renderReview logic if we were calling it directly
            // But here we just leave it empty so the next render step rebuilds it? 
            // Ideally we manually rebuild it here if we want to be safe, but clearing it 
            // forces the render logic to fall back to the text+highlights model.
            // HOWEVER, we need to be careful not to lose other rich text changes. 
            // If this was a "Live" transcript, it might not have other rich text yet.

            // Smart strategy: If it was legacy/Live note, strict HTML might not match.
            // If we found and removed it from highlights model, we can trust the render loop
            // to rebuild it correctly IF we clear the potentially stale HTML.
            // BUT, only clear HTML if we think it's "safe" (no edits).
            // For now, let's trust that if the selector failed, the HTML might be out of sync 
            // or the attribute was missing. 
        }
    }

    // 3. Re-render
    pushToReviewHistory();
    renderReview(); // This triggers the full re-render which handles the fallback if html is cleared/updated
    showToast('Note removed');
}

// ============================================================================
// FONT SIZE AND FORMATTING CONTROLS
// ============================================================================
const formatBoldBtn = document.getElementById('formatBoldBtn');
const formatItalicBtn = document.getElementById('formatItalicBtn');
const increaseFontSizeBtn = document.getElementById('increaseFontSizeBtn');
const decreaseFontSizeBtn = document.getElementById('decreaseFontSizeBtn');

// Helper to ensure we are targeting the right area
function ensureEditorFocus() {
    const selection = window.getSelection();
    if (!selection.rangeCount) return false;

    let focusNode = selection.focusNode;
    if (!focusNode) return false;

    // Check if we are inside the review feed
    const feed = focusNode.nodeType === 3 ? focusNode.parentNode.closest('#reviewFeed') : focusNode.closest('#reviewFeed');
    return !!feed;
}

// Bind handlers to mousedown to prevent focus loss
// Helper to sync formatting changes to history
function updateActiveSegmentFromDOM() {
    const selection = window.getSelection();
    if (!selection.rangeCount) return;
    const focusNode = selection.focusNode;
    if (!focusNode) return;

    // Find transcript-segment or review-segment
    const segmentEl = focusNode.nodeType === 3 ? focusNode.parentNode.closest('.review-segment') : focusNode.closest('.review-segment');

    if (segmentEl) {
        const id = segmentEl.getAttribute('data-segment-id');
        const segment = transcriptSegments.find(s => s.id === id);
        if (segment) {
            const textSpan = segmentEl.querySelector('[contenteditable]');
            if (textSpan) {
                segment.html = textSpan.innerHTML;
                segment.text = textSpan.innerText;
                pushToReviewHistory();
            }
        }
    }
}

// Bind handlers to mousedown to prevent focus loss and sync history
if (formatBoldBtn) {
    formatBoldBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        document.execCommand('bold', false, null);
        updateActiveSegmentFromDOM();
    });
}

if (formatItalicBtn) {
    formatItalicBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        document.execCommand('italic', false, null);
        updateActiveSegmentFromDOM();
    });
}

if (increaseFontSizeBtn) {
    increaseFontSizeBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        applyRelativeFontSize('1.25em');
        updateActiveSegmentFromDOM();
    });
}

if (decreaseFontSizeBtn) {
    decreaseFontSizeBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        applyRelativeFontSize('0.8em');
        updateActiveSegmentFromDOM();
    });
}

function applyRelativeFontSize(scale) {
    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    // Check if selection is inside editor
    let focusNode = selection.focusNode;
    if (!focusNode) return;
    const feed = focusNode.nodeType === 3 ? focusNode.parentNode.closest('#reviewFeed') : focusNode.closest('#reviewFeed');
    if (!feed) {
        showToast('Select text in the transcript first', 'info');
        return;
    }

    const range = selection.getRangeAt(0);
    if (range.collapsed) return;

    try {
        const span = document.createElement('span');
        span.style.fontSize = scale;

        // extractContents safely handles partial selections and preserves nested HTML (like highlights)
        const fragment = range.extractContents();
        span.appendChild(fragment);
        range.insertNode(span);

        // Re-select the new span for continuous formatting
        selection.removeAllRanges();
        const newRange = document.createRange();
        newRange.selectNodeContents(span);
        selection.addRange(newRange);
    } catch (e) {
        console.error("Font resize error:", e);
        // Fallback for very complex selections
        document.execCommand('styleWithCSS', false, true);
        if (scale.startsWith('1')) document.execCommand('increaseFontSize');
        else document.execCommand('decreaseFontSize');
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

    // Reset History for new session
    reviewHistoryStack = [];
    reviewRedoStack = [];

    // Merge and Render first so we have accurate data
    renderReview();

    // Initial state push (State 0)
    pushToReviewHistory();
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
            // Pass the index in generalNotes for drag and drop
            const noteIndex = generalNotes.indexOf(item.data);
            const noteElement = createReviewNoteElement(item.data, noteIndex);
            reviewFeed.appendChild(noteElement);
        }
    });

    // Scroll to top
    reviewFeed.scrollTop = 0;
}

// Firebase Save Logic
async function saveReviewChanges() {
    if (!currentInterviewId) return;

    // Provide visual feedback
    const originalText = saveReviewBtn.textContent;
    saveReviewBtn.textContent = 'Saving...';
    saveReviewBtn.disabled = true;

    try {
        await db.collection('interviews').doc(currentInterviewId).update({
            transcript: transcriptSegments,
            generalNotes: generalNotes,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        saveReviewBtn.textContent = 'Saved!';
        // saveReviewBtn.style.background = '#059669'; // User requested no green color

        setTimeout(() => {
            saveReviewBtn.textContent = originalText;
            saveReviewBtn.style.background = '';
            saveReviewBtn.disabled = false;
        }, 2000);

        showToast('Changes saved to cloud');
    } catch (error) {
        console.error("Error saving review:", error);
        saveReviewBtn.textContent = 'Error';
        saveReviewBtn.style.background = '#ef4444';
        setTimeout(() => {
            saveReviewBtn.textContent = originalText;
            saveReviewBtn.style.background = '';
            saveReviewBtn.disabled = false;
        }, 2000);
        showToast('Failed to save changes', 'error');
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
        console.log('Loaded interview data:', data);
        console.log('transcriptSegments:', data.transcriptSegments);
        console.log('transcript:', data.transcript);

        // Re-hydrate globals - check both 'transcriptSegments' (imported) and 'transcript' (regular)
        currentInterviewId = interviewId;
        transcriptSegments = data.transcriptSegments || data.transcript || [];
        generalNotes = data.generalNotes || [];

        console.log('Final transcriptSegments:', transcriptSegments);
        console.log('Number of segments:', transcriptSegments.length);

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



// Review Toolbar Controls
const revModeEdit = document.getElementById('revModeEdit');
const revModeNotes = document.getElementById('revModeNotes');
const speakerLabelsContainer = document.getElementById('speakerLabelsContainer');
const revNoteInput = document.getElementById('revNoteInput');
const downloadReviewBtn = document.getElementById('downloadReviewBtn');
const saveReviewBtn = document.getElementById('saveReviewBtn');
const revUndoBtn = document.getElementById('revUndoBtn');
const revRedoBtn = document.getElementById('revRedoBtn');

let reviewEditMode = true;
let reviewNotesMode = false;

// Undo/Redo Stacks
let reviewHistoryStack = [];
let reviewRedoStack = [];
const MAX_HISTORY = 50;

function pushToReviewHistory() {
    // Save a deep clone of current state
    const state = {
        transcript: JSON.parse(JSON.stringify(transcriptSegments)),
        notes: JSON.parse(JSON.stringify(generalNotes))
    };

    // Don't push if it's identical to the last state in the stack
    if (reviewHistoryStack.length > 0) {
        const last = reviewHistoryStack[reviewHistoryStack.length - 1];
        if (JSON.stringify(last) === JSON.stringify(state)) return;
    }

    reviewHistoryStack.push(state);
    if (reviewHistoryStack.length > MAX_HISTORY) reviewHistoryStack.shift();

    // Refresh UI to update Undo/Redo button states
    updateToolbarModes();
}

function undoReview() {
    if (reviewHistoryStack.length <= 1) return; // Need at least one state to revert to, plus current

    // Current state goes to redo stack
    const currentState = reviewHistoryStack.pop();
    reviewRedoStack.push(currentState);

    // Revert to previous
    const prevState = reviewHistoryStack[reviewHistoryStack.length - 1];
    transcriptSegments = JSON.parse(JSON.stringify(prevState.transcript));
    generalNotes = JSON.parse(JSON.stringify(prevState.notes));

    renderReview();
    updateToolbarModes();
}

function redoReview() {
    if (reviewRedoStack.length === 0) return;

    const nextState = reviewRedoStack.pop();
    reviewHistoryStack.push(nextState);

    transcriptSegments = JSON.parse(JSON.stringify(nextState.transcript));
    generalNotes = JSON.parse(JSON.stringify(nextState.notes));

    renderReview();
    updateToolbarModes();
}

// PDF Export Function
async function downloadTranscriptAsPDF() {
    const element = document.getElementById('reviewFeed');
    if (!element) return;

    // Show loading state
    const originalText = downloadReviewBtn.textContent;
    downloadReviewBtn.textContent = 'Generating...';
    downloadReviewBtn.disabled = true;

    // Store original modes to restore later
    const wasEditMode = reviewEditMode;
    const wasNotesMode = reviewNotesMode;

    // Turn off edit/note modes for a clean export
    reviewEditMode = false;
    reviewNotesMode = false;
    updateToolbarModes();
    renderReview();

    try {
        const sessionTitle = document.getElementById('reviewProjectName')?.textContent || 'Interview-Transcript';
        const opt = {
            margin: [15, 15],
            filename: `${sessionTitle.replace(/\s+/g, '-').toLowerCase()} -${Date.now()}.pdf`,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true, letterRendering: true },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
            pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
        };

        // Add a header for the PDF
        const dateStr = new Date().toLocaleDateString('de-DE', {
            year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
        });

        const headerHtml = `
            <div style="font-family: Inter, sans-serif; padding-bottom: 20px; border-bottom: 2px solid #eee; margin-bottom: 30px;">
                <h1 style="color: #1a202c; margin: 0; font-size: 24px; margin-bottom: 10px;">${sessionTitle}</h1>
                <div style="color: #4a5568; font-size: 14px; line-height: 1.6;">
                    <strong>Date:</strong> ${dateStr}<br>
                    <strong>Participant:</strong> ${sessionTitle}
                </div>
                <p style="color: #94a3b8; margin: 10px 0 0 0; font-size: 12px;">Transcript Exported from Contexture</p>
            </div>
        `;

        // Create a clone for the PDF to add the header without affecting the real UI
        const container = document.createElement('div');
        container.innerHTML = headerHtml;

        // Clone the feed content
        const feedClone = element.cloneNode(true);
        // Ensure white background for PDF
        feedClone.style.background = 'white';
        feedClone.style.padding = '0';

        // Remove interactive elements from clone
        feedClone.querySelectorAll('.delete-segment-btn, .review-action-btn').forEach(el => el.remove());

        // Process Inline Notes: Make them visible text for PDF
        feedClone.querySelectorAll('.word-highlight').forEach(highlight => {
            // Start fresh with no highlight for PDF readability
            highlight.style.backgroundColor = 'transparent';
            highlight.style.textDecoration = 'none';
            highlight.style.borderBottom = 'none'; // Removing the orange underline
            highlight.style.color = 'inherit';

            const noteText = highlight.getAttribute('data-note');
            if (noteText) {
                // Create a visible span for the note
                const noteSpan = document.createElement('span');
                noteSpan.innerHTML = `<span style="background-color: #f1f5f9; color: #475569; padding: 2px 6px; border-radius: 4px; font-size: 0.75em; border: 1px solid #e2e8f0; display: inline-block; margin-left: 6px; vertical-align: middle; font-weight: 600;">📝 ${noteText}</span>`;

                // Intelligent placement: Attempt to place note after the current word if inside one to avoid splitting words
                let targetNode = highlight;
                const nextNode = highlight.nextSibling;

                if (nextNode && nextNode.nodeType === 3) { // Text node
                    const text = nextNode.textContent;
                    // Check if it starts with a non-whitespace char (meaning word continues)
                    if (text && text.length > 0 && !/^\s/.test(text)) {
                        // Find end of this word
                        const match = text.match(/^(\S+)/);
                        if (match) {
                            const wordEndIndex = match[0].length;
                            // Split text node to creating a dedicated node for the suffix of the word
                            nextNode.splitText(wordEndIndex);
                            // Now nextNode contains just the word suffix.
                            // We want to insert AFTER this suffix.
                            targetNode = nextNode;
                        }
                    }
                }

                // insertAfter the targetNode
                if (targetNode.nextSibling) {
                    targetNode.parentNode.insertBefore(noteSpan, targetNode.nextSibling);
                } else {
                    targetNode.parentNode.appendChild(noteSpan);
                }
            }
        });

        // Fix Spacing and Layout for PDF
        // html2canvas struggles with complex flexbox. We simplify.
        feedClone.querySelectorAll('.review-segment').forEach(seg => {
            seg.style.display = 'flex';
            seg.style.alignItems = 'flex-start'; // Top align important for long text
            seg.style.gap = '15px'; // Explicit gap
            seg.style.marginBottom = '10px'; // Explicit margin
            seg.style.pageBreakInside = 'avoid';

            // Fix Speaker Label
            const label = seg.querySelector('.speaker-label');
            if (label) {
                label.style.minWidth = '80px'; // Ensure badge doesn't squish
                label.style.height = 'auto';
                label.style.alignSelf = 'flex-start';
                label.style.marginTop = '4px'; // Align with text baseline

                // Hardcode colors
                if (label.classList.contains('interviewer')) {
                    label.style.backgroundColor = '#f1f5f9';
                    label.style.color = '#64748b';
                } else {
                    label.style.backgroundColor = '#1e40af';
                    label.style.color = 'white';
                }
            }

            // Fix Text Area
            const textField = seg.querySelector('[contenteditable]');
            if (textField) {
                textField.style.flex = '1';
                textField.style.whiteSpace = 'pre-wrap';
                textField.style.textAlign = 'left';
            }
        });

        feedClone.style.fontFamily = 'Inter, sans-serif'; // Ensure font

        container.appendChild(feedClone);

        // Run html2pdf
        await html2pdf().set(opt).from(container).save();
        showToast('PDF downloaded successfully');
    } catch (error) {
        console.error('PDF Generation Error:', error);
        alert('Failed to generate PDF. Please try again.');
    } finally {
        // Restore UI
        reviewEditMode = wasEditMode;
        reviewNotesMode = wasNotesMode;
        updateToolbarModes();
        renderReview();

        downloadReviewBtn.textContent = originalText;
        downloadReviewBtn.disabled = false;
    }
}

// Helper to toggle button active style within the grouped toggle
function updateToolbarModes() {
    // Edit mode visual
    if (reviewEditMode) {
        revModeEdit.style.background = '#ffffff';
        revModeEdit.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
        revModeEdit.style.color = 'var(--brand-primary)';
    } else {
        revModeEdit.style.background = 'transparent';
        revModeEdit.style.boxShadow = 'none';
        revModeEdit.style.color = 'var(--text-muted)';
    }

    // Notes mode visual
    if (reviewNotesMode) {
        revModeNotes.style.background = '#ffffff';
        revModeNotes.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
        revModeNotes.style.color = 'var(--brand-primary)';
    } else {
        revModeNotes.style.background = 'transparent';
        revModeNotes.style.boxShadow = 'none';
        revModeNotes.style.color = 'var(--text-muted)';
    }

    // Show/Hide sub-actions
    if (speakerLabelsContainer) speakerLabelsContainer.style.display = reviewEditMode ? 'flex' : 'none';

    // Show/Hide Bottom Toolbar Row (Formatting) - Only visible in Edit Mode
    const bottomRow = document.querySelector('.toolbar-bottom-row');
    if (bottomRow) {
        bottomRow.style.display = reviewEditMode ? 'flex' : 'none';
        // Add borders/padding/margin logic if needed to keep it clean.
        // It has a top border in CSS/HTML style attribute, so hiding it removes that line. Perfect.
    }

    // Toggle the new staging area bar for notes
    const stagingArea = document.getElementById('notesStagingArea');
    if (stagingArea) stagingArea.style.display = reviewNotesMode ? 'flex' : 'none';

    // Undo/Redo Button Visuals
    if (revUndoBtn) {
        const canUndo = reviewHistoryStack.length > 1;
        revUndoBtn.style.opacity = canUndo ? '1' : '0.5';
        revUndoBtn.style.pointerEvents = canUndo ? 'auto' : 'none';
        revUndoBtn.style.background = canUndo ? '#fff' : '#f8fafc';
        revUndoBtn.style.borderColor = canUndo ? '#cbd5e1' : '#e2e8f0';
        revUndoBtn.style.color = canUndo ? '#1e293b' : '#94a3b8';
    }
    if (revRedoBtn) {
        const canRedo = reviewRedoStack.length > 0;
        revRedoBtn.style.opacity = canRedo ? '1' : '0.5';
        revRedoBtn.style.pointerEvents = canRedo ? 'auto' : 'none';
        revRedoBtn.style.background = canRedo ? '#fff' : '#f8fafc';
        revRedoBtn.style.borderColor = canRedo ? '#cbd5e1' : '#e2e8f0';
        revRedoBtn.style.color = canRedo ? '#1e293b' : '#94a3b8';
    }
}

if (revModeEdit) {
    revModeEdit.addEventListener('click', () => {
        reviewEditMode = !reviewEditMode;
        if (reviewEditMode) reviewNotesMode = false; // Mutually exclusive
        updateToolbarModes();
        renderReview();
    });
}

if (revModeNotes) {
    revModeNotes.addEventListener('click', () => {
        reviewNotesMode = !reviewNotesMode;
        if (reviewNotesMode) reviewEditMode = false; // Mutually exclusive
        updateToolbarModes();
        renderReview();
    });
}

if (revNoteInput) {
    revNoteInput.addEventListener('focus', () => {
        revNoteInput.style.borderColor = 'var(--brand-primary)';
    });
    revNoteInput.addEventListener('blur', () => {
        revNoteInput.style.borderColor = '#e2e8f0';
    });
}

if (downloadReviewBtn) {
    downloadReviewBtn.addEventListener('click', downloadTranscriptAsPDF);
}

if (revUndoBtn) revUndoBtn.addEventListener('click', undoReview);
if (revRedoBtn) revRedoBtn.addEventListener('click', redoReview);

// Global shortcuts for undo/redo in review
document.addEventListener('keydown', (e) => {
    if (transcriptReviewView && !transcriptReviewView.classList.contains('hidden')) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
            e.preventDefault();
            undoReview();
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
            e.preventDefault();
            redoReview();
        }
    }
});

if (saveReviewBtn) {
    saveReviewBtn.onclick = saveReviewChanges;
}

// Drag and Drop functionality
function initDragAndDrop() {
    let currentDragType = null;

    document.addEventListener('dragstart', (e) => {
        if (e.target.classList.contains('draggable-label')) {
            e.dataTransfer.setData('speaker', e.target.getAttribute('data-speaker'));
            e.dataTransfer.setData('type', 'speaker');
            e.dataTransfer.effectAllowed = 'copy';
            currentDragType = 'speaker';
        } else if (e.target.id === 'draggableNoteStick') {
            const content = revNoteInput.value.trim();
            if (!content) {
                e.preventDefault();
                showToast('Type a note first!', 'error');
                return;
            }
            e.dataTransfer.setData('content', content);
            e.dataTransfer.setData('type', 'new-note');
            e.dataTransfer.effectAllowed = 'copy';
            currentDragType = 'new-note';

            // Create preview ghost element that looks like a real note
            const dragImg = document.createElement('div');
            dragImg.className = 'review-item review-note-card';
            dragImg.style.width = '350px';
            dragImg.style.position = 'absolute';
            dragImg.style.top = '-1000px';
            dragImg.style.left = '-1000px';
            dragImg.style.opacity = '0.75';
            dragImg.style.boxShadow = '0 10px 15px -3px rgba(0, 0, 0, 0.1)';
            dragImg.style.pointerEvents = 'none';
            dragImg.innerHTML = `
                <div class="review-note-meta" style="margin-bottom: 0.5rem; opacity: 0.7;">
                    <span style="font-size: 0.75rem; font-weight: 600; text-transform: uppercase;">Session Note (Placing...)</span>
                </div>
                <div style="font-size: 0.95rem; line-height: 1.5; color: var(--text-primary);">
                    ${escapeHtml(content)}
                </div>
            `;
            document.body.appendChild(dragImg);
            e.dataTransfer.setDragImage(dragImg, 20, 20);

            // Clean up the ghost element after a minimal delay
            setTimeout(() => document.body.removeChild(dragImg), 0);

        } else if (e.target.classList.contains('review-note-card')) {
            const id = e.target.getAttribute('data-note-id');
            e.dataTransfer.setData('noteId', id);
            e.dataTransfer.setData('type', 'move-note');
            e.dataTransfer.effectAllowed = 'move';
            currentDragType = 'move-note';
        }
    });

    document.addEventListener('dragend', () => {
        currentDragType = null;
        // Cleanup all
        document.querySelectorAll('.review-segment').forEach(el => {
            el.classList.remove('drop-target-top', 'drop-target-bottom');
        });
    });

    document.addEventListener('dragover', (e) => {
        e.preventDefault(); // allow drop
        e.dataTransfer.dropEffect = 'copy';

        const segment = e.target.closest('.review-segment');

        // Cleanup others to prevent multiple highlights
        document.querySelectorAll('.review-segment').forEach(el => {
            if (el !== segment) {
                el.classList.remove('drop-target-top', 'drop-target-bottom');
            }
        });

        // Use the tracked drag type to decide visually
        if (segment && currentDragType !== 'speaker') {
            const rect = segment.getBoundingClientRect();
            const relY = e.clientY - rect.top;

            // Allow a bit of buffer, but essentially split in half
            if (relY < rect.height / 2) {
                segment.classList.add('drop-target-top');
                segment.classList.remove('drop-target-bottom');
            } else {
                segment.classList.add('drop-target-bottom');
                segment.classList.remove('drop-target-top');
            }
        }
    });

    document.addEventListener('dragleave', (e) => {
        // If we leave the segment, remove its classes
        const segment = e.target.closest('.review-segment');
        if (segment && !segment.contains(e.relatedTarget)) {
            segment.classList.remove('drop-target-top', 'drop-target-bottom');
        }
    });

    document.addEventListener('drop', (e) => {
        e.preventDefault();

        // Cleanup classes
        document.querySelectorAll('.review-segment').forEach(el => {
            el.classList.remove('drop-target-top', 'drop-target-bottom');
        });

        const type = e.dataTransfer.getData('type');
        const targetSegment = e.target.closest('.review-segment');

        if (type === 'speaker' && targetSegment) {
            const speaker = e.dataTransfer.getData('speaker');
            const segId = targetSegment.getAttribute('data-segment-id') || targetSegment.getAttribute('data-seg-id');

            // Find segment
            const seg = transcriptSegments.find(s => s.id === segId);
            if (seg) {
                pushToReviewHistory(); // Save state
                seg.speaker = speaker; // Update speaker
                renderReview(); // Re-render
                showToast('Speaker updated');
            }
        } else if ((type === 'new-note' || type === 'move-note') && targetSegment) {
            const segId = targetSegment.getAttribute('data-segment-id') || targetSegment.getAttribute('data-seg-id');
            const segmentIndex = transcriptSegments.findIndex(s => s.id === segId);
            const segment = transcriptSegments[segmentIndex];

            if (segment) {
                // Determine if drop was at top or bottom of segment
                const rect = targetSegment.getBoundingClientRect();
                const relY = e.clientY - rect.top;
                const isDropAtTop = relY < rect.height / 2;

                // Calculate the appropriate timestamp for insertion
                let insertTimestamp;
                if (isDropAtTop) {
                    // Drop at top: insert BEFORE this segment
                    // Use a timestamp slightly before this segment (between prev and current)
                    if (segmentIndex > 0) {
                        const prevSegment = transcriptSegments[segmentIndex - 1];
                        // Place note between previous segment and current segment
                        insertTimestamp = prevSegment.timestamp + (segment.timestamp - prevSegment.timestamp) / 2;
                    } else {
                        // First segment - use timestamp slightly before
                        insertTimestamp = segment.timestamp - 0.5;
                    }
                } else {
                    // Drop at bottom: insert AFTER this segment (original behavior)
                    insertTimestamp = segment.timestamp;
                }

                if (type === 'new-note') {
                    const content = e.dataTransfer.getData('content');
                    if (segment && content) {
                        pushToReviewHistory();
                        const newNote = { content, timestamp: insertTimestamp, isNew: true, isReviewNote: true };
                        generalNotes.push(newNote);
                        if (revNoteInput) revNoteInput.value = ''; // Clear input
                        renderReview(); // Re-render
                        showToast('Note added');

                        setTimeout(() => {
                            delete newNote.isNew;
                            renderReview();
                        }, 3000);
                    }
                } else if (type === 'move-note') {
                    const noteId = parseInt(e.dataTransfer.getData('noteId'));
                    if (!isNaN(noteId) && generalNotes[noteId]) {
                        pushToReviewHistory();
                        // Update timestamp to match new location
                        generalNotes[noteId].timestamp = insertTimestamp;
                        // Force resort
                        renderReview();
                        showToast('Note repositioned');
                    }
                }
            }
        }
    });
}

// Initialize drag and drop
initDragAndDrop();

// Add global listener for selection in review feed for inline notes
document.addEventListener('mouseup', (e) => {
    if (!reviewNotesMode) return;

    // Ignore if clicking inside the popdown itself
    if (e.target.closest('#inlineNotePopdown')) return;

    const selection = window.getSelection();
    const rawText = selection.toString();
    const selectedText = rawText.trim();

    if (selectedText.length > 0) {
        const segmentDiv = e.target.closest('.review-segment');
        if (segmentDiv) {
            const segmentId = segmentDiv.getAttribute('data-segment-id');
            const segment = transcriptSegments.find(s => s.id === segmentId);

            if (segment) {
                const textSpan = segmentDiv.querySelector('span:last-child');
                const range = selection.getRangeAt(0);

                // Calculate robust start offset
                let startOffset = 0;
                const walker = document.createTreeWalker(textSpan, NodeFilter.SHOW_TEXT, null, false);
                let node = walker.nextNode();
                while (node) {
                    if (node === range.startContainer) {
                        startOffset += range.startOffset;
                        break;
                    }
                    startOffset += node.textContent.length;
                    node = walker.nextNode();
                }

                const leadingSpaces = rawText.indexOf(selectedText);
                const finalStart = startOffset + (leadingSpaces > 0 ? leadingSpaces : 0);

                currentSelection = {
                    text: selectedText,
                    start: finalStart,
                    end: finalStart + selectedText.length
                };
                selectedSegmentId = segmentId;

                // Get rect BEFORE modifying the range
                const rect = range.getBoundingClientRect();

                // Visually highlight immediately
                const mark = document.createElement('mark');
                mark.className = 'word-highlight';
                try {
                    range.surroundContents(mark);
                    currentTempMark = mark;
                } catch (err) {
                    console.warn('Could not wrap selection in mark:', err);
                }

                // Show popdown - use fixed positioning relative to viewport
                inlineNotePopdown.style.position = 'fixed';
                inlineNotePopdown.style.top = `${rect.bottom + 10}px`;
                inlineNotePopdown.style.left = `${rect.left}px`;
                inlineNotePopdown.classList.remove('hidden');

                setTimeout(() => inlineNoteInput.focus(), 50);
            }
        }
    } else {
        // If clicking away and not on the popdown, hide it
        if (!e.target.closest('#inlineNotePopdown')) {
            inlineNotePopdown.classList.add('hidden');
            currentSelection = null;
            // Remove temporary mark if note wasn't saved
            if (currentTempMark) {
                // Actually we don't need to remove it manually if we just re-render on save
                // But if they click away we should probably re-render or unwrap.
                // Re-rendering is safest.
                renderReview();
                currentTempMark = null;
            }
        }
    }
});

function createReviewSegmentElement(segment) {
    const div = document.createElement('div');
    div.className = 'review-item review-segment';
    div.id = segment.id; // Important for DOM lookups
    div.setAttribute('data-segment-id', segment.id);

    // Use flex for horizontal alignment and vertical centering
    div.style.display = 'flex';
    div.style.alignItems = 'flex-start'; // Align to top for first-line consistency
    div.style.gap = '0.75rem';

    // Improved spacing for better readability
    div.style.marginBottom = '0.75rem';
    div.style.marginTop = '0.5rem';

    // In edit mode, add visual boundaries
    if (reviewEditMode) {
        div.style.padding = '0.1rem 0.5rem'; // Even reduced padding
        div.style.borderRadius = '8px';
        div.style.transition = 'background-color 0.2s';
    }

    // Connect visually to previous speaker block if no speaker change
    if (segment.speaker) {
        div.style.marginTop = '1.5rem'; // New Speaker Section
    }

    // Speaker Label
    if (segment.speaker) {
        const speakerLabel = document.createElement('span');
        speakerLabel.className = `speaker-label ${segment.speaker}`;
        speakerLabel.style.display = 'inline-flex';
        speakerLabel.style.alignItems = 'center';
        speakerLabel.style.justifyContent = 'center';
        speakerLabel.style.lineHeight = '1';
        speakerLabel.style.flexShrink = '0'; // Don't squash the badge
        speakerLabel.style.marginTop = '0.15rem'; // Visually center with the first line of text

        if (reviewEditMode) {
            // Add cross indicator for removal
            speakerLabel.innerHTML = `${segment.speaker === 'interviewer' ? 'Interviewer' : 'Participant'} <span style="margin-left: 0.5rem; opacity: 0.6; font-size: 1.1em; cursor: pointer; line-height: 1;">×</span>`;
            speakerLabel.title = "Click × to remove";
            speakerLabel.style.cursor = "default";

            // Only the cross is clickable
            speakerLabel.addEventListener('click', (e) => {
                if (e.target.tagName === 'SPAN') {
                    segment.speaker = null;
                    reviewRedoStack = []; // Clear redo on action
                    pushToReviewHistory();
                    renderReview();
                }
            });
        } else {
            speakerLabel.textContent = segment.speaker === 'interviewer' ? 'Interviewer' : 'Participant';
        }

        div.appendChild(speakerLabel);
    }

    const textSpan = document.createElement('span');
    textSpan.contentEditable = reviewEditMode;
    textSpan.spellcheck = false;
    textSpan.style.outline = 'none';
    textSpan.style.whiteSpace = 'pre-wrap';
    textSpan.style.wordBreak = 'break-word'; // Ensure long words break
    textSpan.style.overflowWrap = 'break-word';
    textSpan.style.flex = '1'; // Take up remaining space
    textSpan.style.lineHeight = '1.7';

    // Visual feedback for editable text
    if (reviewEditMode) {
        textSpan.style.borderBottom = '1px dashed #e2e8f0';
        textSpan.style.cursor = 'text';
    } else {
        textSpan.style.cursor = 'default';
        textSpan.title = "";
        textSpan.onmouseover = null;
        textSpan.onmouseout = null;
        textSpan.style.borderBottom = 'none';
    }

    // --- RENDER LOGIC UPDATE ---
    let html = segment.html || '';

    // If no stored HTML, construct it from text + highlights (Legacy/Plain Text Mode)
    if (!html) {
        let lastIndex = 0;
        const text = segment.text;
        const sortedHighlights = [...(segment.highlights || [])].sort((a, b) => a.start - b.start);

        sortedHighlights.forEach(h => {
            if (h.start > lastIndex) {
                html += escapeHtml(text.substring(lastIndex, h.start));
            }
            const chunk = text.substring(h.start, h.end);
            // Ensure we use a unique ID for easier DOM manipulation later if needed
            // But strict start-offset reliance is okay if we keep text sync'd.
            html += `<mark class="word-highlight" data-segment-id="${segment.id}" data-highlight-start="${h.start}" data-note="${escapeHtml(h.note || '')}">${escapeHtml(chunk)}</mark>`;
            lastIndex = h.end;
        });
        if (lastIndex < text.length) {
            html += escapeHtml(text.substring(lastIndex));
        }
    }

    textSpan.innerHTML = html;

    // Explicitly attach tooltip listeners to bypass any contenteditable/delegation issues
    textSpan.querySelectorAll('.word-highlight').forEach(mark => {
        mark.style.pointerEvents = 'all'; // Force pointer events
        mark.addEventListener('mouseenter', (e) => {
            if (typeof showGlobalTooltip === 'function') showGlobalTooltip(e.target);
        });
        mark.addEventListener('mouseleave', (e) => {
            if (typeof hideGlobalTooltip === 'function') hideGlobalTooltip();
        });
    });

    // Handle Enter key to create new paragraphs
    if (reviewEditMode) {
        textSpan.addEventListener('keydown', (e) => {
            // ENTER: Split Line
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();

                // Get global cursor position within the element
                const selection = window.getSelection();
                if (selection.rangeCount > 0) {
                    const range = selection.getRangeAt(0);
                    const preCaretRange = range.cloneRange();
                    preCaretRange.selectNodeContents(textSpan);
                    preCaretRange.setEnd(range.startContainer, range.startOffset);
                    const globalOffset = preCaretRange.toString().length;

                    // Update current segment
                    textSpan._isSplitting = true; // Prevent blur from overwriting

                    // 1. DOM Split (Safe HTML Handling)
                    // We allow the browser to handle the complex HTML splitting (closing/opening tags)
                    const rangeAfter = document.createRange();
                    rangeAfter.selectNodeContents(textSpan);
                    rangeAfter.setStart(range.startContainer, range.startOffset);
                    const fragment = rangeAfter.extractContents(); // This modifies textSpan in-place!

                    // Now textSpan contains the first half, fragment contains the second half
                    const htmlBefore = textSpan.innerHTML;
                    const textBefore = textSpan.innerText;

                    const tempDiv = document.createElement('div');
                    tempDiv.appendChild(fragment);
                    const htmlAfter = tempDiv.innerHTML;
                    const textAfter = tempDiv.innerText;

                    // 2. Highlight Data Model Split
                    // We still need to split the data model to ensure persistence is correct
                    const highlightsBefore = [];
                    const highlightsAfter = [];

                    if (segment.highlights) {
                        segment.highlights.forEach(h => {
                            if (h.end <= globalOffset) {
                                // Entirely before
                                highlightsBefore.push(h);
                            } else if (h.start >= globalOffset) {
                                // Entirely after - adjust relative offset
                                highlightsAfter.push({
                                    ...h,
                                    start: h.start - globalOffset,
                                    end: h.end - globalOffset
                                });
                            } else {
                                // Spanning Split
                                // Part 1 (Before)
                                highlightsBefore.push({
                                    ...h,
                                    end: globalOffset
                                });
                                // Part 2 (After)
                                highlightsAfter.push({
                                    ...h,
                                    start: 0,
                                    end: h.end - globalOffset
                                });
                            }
                        });
                    }

                    segment.text = textBefore.trim();
                    segment.html = htmlBefore;
                    segment.highlights = highlightsBefore;

                    // Create new segment
                    const newSegment = {
                        id: 'seg_' + Date.now(),
                        text: textAfter.trim(),
                        html: htmlAfter,
                        timestamp: segment.timestamp + 1,
                        notes: [],
                        speaker: null,
                        highlights: highlightsAfter
                    };

                    // Insert after current segment
                    const index = transcriptSegments.indexOf(segment);
                    transcriptSegments.splice(index + 1, 0, newSegment);

                    reviewRedoStack = [];
                    pushToReviewHistory();
                    renderReview();

                    // Focus the new segment
                    setTimeout(() => {
                        const newEl = document.querySelector(`[data-segment-id="${newSegment.id}"] span[contenteditable="true"]`);
                        if (newEl) {
                            newEl.focus();
                            const newRange = document.createRange();
                            const newSel = window.getSelection();
                            const targetNode = newEl.childNodes[0] || newEl;
                            newRange.setStart(targetNode, 0);
                            newRange.collapse(true);
                            newSel.removeAllRanges();
                            newSel.addRange(newRange);
                        }
                    }, 10);

                    showToast('Paragraph split');
                }
            }

            // BACKSPACE: Merge with previous line if at start
            if (e.key === 'Backspace') {
                const selection = window.getSelection();
                if (selection.rangeCount > 0) {
                    const range = selection.getRangeAt(0);
                    const preCaretRange = range.cloneRange();
                    preCaretRange.selectNodeContents(textSpan);
                    preCaretRange.setEnd(range.startContainer, range.startOffset);
                    const globalOffset = preCaretRange.toString().length;

                    if (globalOffset === 0) {
                        const index = transcriptSegments.indexOf(segment);
                        if (index > 0) {
                            e.preventDefault();

                            // Prevent blur overwrites
                            textSpan._isSplitting = true;

                            const prevSegment = transcriptSegments[index - 1];
                            const originalPrevLength = prevSegment.text.length;
                            const prevId = prevSegment.id;

                            // Merge Text
                            // Concatenate directly. User can manage spacing if needed.
                            prevSegment.text = prevSegment.text + segment.text;
                            prevSegment.html = (prevSegment.html || escapeHtml(prevSegment.text)) + (segment.html || escapeHtml(segment.text));


                            // Merge Highlights (adjust offsets)
                            if (segment.highlights && segment.highlights.length > 0) {
                                if (!prevSegment.highlights) prevSegment.highlights = [];
                                const shiftedHighlights = segment.highlights.map(h => ({
                                    ...h,
                                    start: h.start + originalPrevLength,
                                    end: h.end + originalPrevLength
                                }));
                                prevSegment.highlights.push(...shiftedHighlights);
                            }

                            // Remove current segment
                            transcriptSegments.splice(index, 1);

                            reviewRedoStack = [];
                            pushToReviewHistory();
                            renderReview();

                            // Focus at the merge point
                            setTimeout(() => {
                                const prevElSpan = document.querySelector(`[data-segment-id="${prevId}"] span[contenteditable="true"]`);
                                if (prevElSpan) {
                                    prevElSpan.focus();
                                    const newRange = document.createRange();
                                    const newSel = window.getSelection();

                                    // Robustly find target caret position across potential multiple text/element nodes
                                    let charCount = 0;
                                    let targetNode = null;
                                    let targetOffset = 0;

                                    if (prevElSpan.childNodes.length === 0) {
                                        targetNode = prevElSpan;
                                        targetOffset = 0;
                                    } else {
                                        const walker = document.createTreeWalker(prevElSpan, NodeFilter.SHOW_TEXT, null, false);
                                        let node = walker.nextNode();
                                        while (node) {
                                            const len = node.textContent.length;
                                            if (charCount + len >= originalPrevLength) {
                                                targetNode = node;
                                                targetOffset = originalPrevLength - charCount;
                                                break;
                                            }
                                            charCount += len;
                                            node = walker.nextNode();
                                        }
                                        // Fallback if at the very end
                                        if (!targetNode && node) {
                                            targetNode = node;
                                            targetOffset = node.textContent.length;
                                        } else if (!targetNode) {
                                            // Fallback to last text node or element end
                                            const lastNode = prevElSpan.childNodes[prevElSpan.childNodes.length - 1];
                                            targetNode = lastNode.nodeType === 3 ? lastNode : lastNode.lastChild || lastNode;
                                            targetOffset = targetNode.textContent ? targetNode.textContent.length : 0;
                                        }
                                    }

                                    if (targetNode) {
                                        try {
                                            newRange.setStart(targetNode, targetOffset);
                                            newRange.collapse(true);
                                            newSel.removeAllRanges();
                                            newSel.addRange(newRange);
                                        } catch (err) {
                                            console.warn("Merge focus failed:", err);
                                        }
                                    }
                                }
                            }, 10);
                        }
                    }
                }
            }
        });
    }

    // --- BLUR / SYNC LOGIC UPDATE ---
    textSpan.addEventListener('blur', () => {
        if (textSpan._isSplitting) return;

        if (reviewEditMode) {
            // 1. Save plain text
            const currentText = textSpan.innerText;

            // 2. Save HTML (Rich Text Support)
            // We want to save the formatting (b, i, span style)
            const currentHtml = textSpan.innerHTML;

            const hasChanged = segment.text !== currentText || segment.html !== currentHtml;

            if (hasChanged) {
                segment.text = currentText;
                segment.html = currentHtml;

                // 3. Re-Sync Highlights from DOM
                // Because editing text shifts offsets, we must recalculate them from the live DOM
                // to stay consistent.
                const newHighlights = [];

                // Helper to calculate offset relative to text content
                // We walk the text nodes of the span.
                let runningOffset = 0;
                const walker = document.createTreeWalker(textSpan, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, null, false);

                let currentNode = walker.nextNode();
                while (currentNode) {
                    if (currentNode.nodeType === Node.TEXT_NODE) {
                        runningOffset += currentNode.textContent.length;
                    } else if (currentNode.nodeType === Node.ELEMENT_NODE && currentNode.classList.contains('word-highlight')) {
                        // Found a highlight!
                        const note = currentNode.getAttribute('data-note');
                        const start = runningOffset; // Start is current running offset
                        const contentLen = currentNode.innerText.length; // Length of text inside the mark
                        const end = start + contentLen;

                        // Update attribute just in case (for next DOM read)
                        currentNode.setAttribute('data-highlight-start', start);

                        newHighlights.push({
                            start: start,
                            end: end,
                            note: note
                        });

                        // The runningOffset will be correctly advanced by the text node(s) inside this mark
                        // when the walker visits them. So no need to add contentLen here.
                    }
                    currentNode = walker.nextNode();
                }

                segment.highlights = newHighlights;

                reviewRedoStack = [];
                pushToReviewHistory();
                updateToolbarModes();
            }
        }
    });

    div.appendChild(textSpan);

    textSpan.querySelectorAll('.word-highlight').forEach(mark => {
        mark.title = "";
        mark.style.cursor = "pointer";

        // Allow removal on click when in edit/notes mode
        mark.addEventListener('click', (e) => {
            if (reviewEditMode || reviewNotesMode) {
                e.preventDefault();
                e.stopPropagation();

                const start = mark.getAttribute('data-highlight-start');
                const segId = mark.getAttribute('data-segment-id');

                openConfirmModal(
                    'Remove Note',
                    'Are you sure you want to remove this highlight and note?',
                    'Remove',
                    () => deleteInlineNote(segId, start)
                );
            }
        });
    });

    return div;
}

function createReviewNoteElement(note, index) {
    const div = document.createElement('div');
    div.className = 'review-item review-note-card';
    if (note.isNew) div.classList.add('just-placed');
    div.draggable = true;
    div.setAttribute('data-note-id', index);
    div.style.margin = '0.75rem 0 0.75rem 1rem';
    div.style.lineHeight = '1.6';
    div.title = "Drag to reposition in transcript";

    const meta = document.createElement('div');
    meta.className = 'review-note-meta';

    // Format timestamp relative to start
    const minutes = Math.floor(note.timestamp / 60000);
    const seconds = Math.floor((note.timestamp % 60000) / 1000);
    const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')} `;

    const timestampSpan = document.createElement('span');

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
                // Determine true index
                const noteIndex = generalNotes.indexOf(note);
                if (noteIndex > -1) {
                    generalNotes.splice(noteIndex, 1);
                    pushToReviewHistory(); // Allow undo
                    renderReview(); // Re-render to update
                }
            }
        );
    };

    actions.appendChild(deleteBtn);

    // DIFFERENTIATE: Live Session Notes vs Review Added Notes
    if (note.isReviewNote) {
        // For review notes, we want the delete button to float on the right, vertically centered
        // and NOT take up vertical space with a meta header row.

        // Hide standard meta flow
        meta.style.display = 'none';

        // Position actions absolutely
        actions.style.position = 'absolute';
        actions.style.right = '1rem';
        actions.style.top = '50%';
        actions.style.transform = 'translateY(-50%)';
        actions.style.zIndex = '10';

        // Add padding to content right so text doesn't overlap button
        div.style.paddingRight = '4rem';

        div.appendChild(actions); // Append actions directly to card, ignoring meta
    } else {
        // Standard Session Note
        timestampSpan.textContent = `Session Note at ${timeStr} `;
        meta.appendChild(timestampSpan);
        meta.appendChild(actions);
        div.appendChild(meta);
    }

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

function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
