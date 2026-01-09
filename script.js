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
let reviewCodingMode = false;
let currentReviewCodes = [];
let codeSelectionPopover = null;
let currentSelection = null; // { text, start, end, segmentId }
let currentTempMark = null; // Reference to the temporary visual highlight
let generalNotes = []; // { content, timestamp }

let selectedSegmentId = null; // For inline notes
let currentCodeAssignments = []; // Loaded coded text assignments

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

// Code Modal Listeners
const createCodeBtn = document.getElementById('createCodeBtn');
const closeCodeModalBtn = document.getElementById('closeCodeModal');
const saveCodeBtn = document.getElementById('saveCodeBtn');
const cancelCodeBtn = document.getElementById('cancelCodeBtn');
const codeModal = document.getElementById('codeModal');

if (createCodeBtn) {
    createCodeBtn.addEventListener('click', () => {
        if (currentProjectId) {
            openCodeModal(currentProjectId);
        }
    });
}

if (closeCodeModalBtn) closeCodeModalBtn.addEventListener('click', closeCodeModal);
if (saveCodeBtn) saveCodeBtn.addEventListener('click', saveCode);
if (cancelCodeBtn) cancelCodeBtn.addEventListener('click', closeCodeModal);

if (codeModal) {
    codeModal.addEventListener('click', (e) => {
        if (e.target === codeModal) closeCodeModal();
    });
}

// Color picker event listeners
document.addEventListener('click', (e) => {
    if (e.target.closest('.color-option')) {
        const option = e.target.closest('.color-option');
        if (option.dataset.color) {
            updateColorSelection(option.dataset.color);
        }
    }
});

// Custom color picker
const customColorInput = document.getElementById('customColorInput');
const customColorBubble = document.getElementById('customColorBubble');
if (customColorInput) {
    customColorInput.addEventListener('input', (e) => {
        const color = e.target.value;
        updateColorSelection(color);
        // Update the bubble background
        if (customColorBubble) {
            customColorBubble.style.background = color;
        }
    });
}

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

    // Load and render codes
    renderCodesList(id);

    // Switch View
    projectsOverview.classList.add('hidden');
    projectDetailView.classList.remove('hidden');
    window.scrollTo(0, 0);
}

// ============================================================================
// CODES MANAGEMENT
// ============================================================================

let currentCodeData = null; // { projectId, codeId? }
let selectedColor = '#3b82f6'; // Default blue

/**
 * Render codes list for a project
 */
/**
 * Render codes list for a project
 */
async function renderCodesList(projectId) {
    const list = document.getElementById('codesList');
    if (!list) {
        console.warn('codesList element not found');
        return;
    }

    try {
        list.className = 'list-container loading-state';
        list.innerHTML = '<p>Loading codes...</p>';

        const codes = await window.loadCodesForProject(projectId);

        if (!codes || codes.length === 0) {
            list.className = 'list-container empty-list-placeholder';
            list.innerHTML = '<p>No codes yet.</p>';
            return;
        }

        list.className = 'list-container';
        list.innerHTML = codes.map(code => `
            <div class="code-item" data-code-id="${code.id}">
                <div class="code-item-left">
                    <div class="code-color-preview" style="background: ${code.color};"></div>
                    <div class="code-item-info">
                        <div class="code-item-name">${escapeHtml(code.name || 'Untitled')}</div>
                    </div>
                </div>
                <div class="code-item-actions">
                    <button onclick="window.editCode('${projectId}', '${code.id}')" title="Edit code">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                    <button class="delete-code-btn" onclick="window.deleteCodeWithConfirm('${code.id}')" title="Delete code">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                </div>
            </div>
        `).join('');

    } catch (error) {
        console.error('Error rendering codes:', error);
        list.innerHTML = '<p style="color: var(--text-muted); text-align: center;">Error loading codes</p>';
    }
}

/**
 * Open code creation/edit modal
 */
function openCodeModal(projectId, codeId = null) {
    console.log('Opening code modal with projectId:', projectId, 'codeId:', codeId);

    if (!projectId) {
        console.error('No projectId provided to openCodeModal');
        alert('Error: No project selected');
        return;
    }

    currentCodeData = { projectId, codeId };
    const modal = document.getElementById('codeModal');
    const modalTitle = document.getElementById('codeModalTitle');
    const nameInput = document.getElementById('codeName');

    modal.classList.remove('hidden');

    if (codeId) {
        // Edit mode - load code data
        modalTitle.textContent = 'Edit Code';
        window.loadCodesForProject(projectId).then(codes => {
            const code = codes.find(c => c.id === codeId);
            if (code) {
                nameInput.value = code.name;
                selectedColor = code.color;
                updateColorSelection(code.color);
            }
        });
    } else {
        // Create mode
        modalTitle.textContent = 'Create Code';
        nameInput.value = '';
        selectedColor = '#3b82f6';
        updateColorSelection('#3b82f6');
    }

    setTimeout(() => nameInput.focus(), 50);
}

/**
 * Update color selection visual state
 */
function updateColorSelection(color) {
    document.querySelectorAll('.color-option').forEach(opt => {
        opt.classList.remove('selected');
        if (opt.dataset.color === color) {
            opt.classList.add('selected');
        }
    });
    selectedColor = color;
}

/**
 * Close code modal
 */
function closeCodeModal() {
    document.getElementById('codeModal').classList.add('hidden');
    currentCodeData = null;
}

/**
 * Save code (create or update)
 */
async function saveCode() {
    if (!currentCodeData) {
        console.error('No code data available');
        alert('Error: No project selected. Please try again.');
        return;
    }

    const name = document.getElementById('codeName').value.trim();

    if (!name) {
        alert('Please enter a code name');
        return;
    }

    if (!selectedColor) {
        alert('Please select a color');
        return;
    }

    const codeData = {
        name,
        color: selectedColor
    };

    // Capture projectId before potentially clearing data
    const projectId = currentCodeData.projectId;
    const codeId = currentCodeData.codeId;

    try {
        if (codeId) {
            // Update existing code
            await window.updateCodeInFirestore(projectId, codeId, codeData);
            showToast('Code updated');
        } else {
            // Create new code
            await window.saveCodeToFirestore(projectId, codeData);
            showToast('Code created');
        }

        closeCodeModal();
        await renderCodesList(projectId);

        // If we are in review mode, update that list too
        if (typeof transcriptReviewView !== 'undefined' && !transcriptReviewView.classList.contains('hidden')) {
            await loadCodesForReview();
        }
    } catch (error) {
        console.error('Error saving code:', error);
        alert('Failed to save code. Please try again.');
    }
}

/**
 * Edit existing code
 */
function editCode(projectId, codeId) {
    openCodeModal(projectId, codeId);
}

/**
 * Delete code with confirmation
 */
function deleteCodeWithConfirm(codeId) {
    itemToDelete = { type: 'code', id: codeId, projectId: currentProjectId };

    const titleEl = document.getElementById('deleteModalTitle');
    const textEl = document.getElementById('deleteModalText');
    if (titleEl) titleEl.textContent = "Delete Code";
    if (textEl) textEl.textContent = "Are you sure you want to delete this code? All code assignments will also be deleted.";

    deleteModal.classList.remove('hidden');
}

// Update confirmDeleteAction to handle codes
const originalConfirmDeleteAction = confirmDeleteAction;
confirmDeleteAction = async function () {
    if (itemToDelete && itemToDelete.type === 'code') {
        try {
            await window.deleteCodeFromFirestore(itemToDelete.projectId, itemToDelete.id);
            showToast('Code deleted');
            if (itemToDelete.projectId) {
                renderCodesList(itemToDelete.projectId);
            }
        } catch (error) {
            console.error('Error deleting code:', error);
            alert('Failed to delete code');
        }
        closeDeleteModal();
    } else {
        // Call original function for other types
        await originalConfirmDeleteAction();
    }
};

// Expose functions globally
window.openCodeModal = openCodeModal;
window.editCode = editCode;
window.deleteCodeWithConfirm = deleteCodeWithConfirm;

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

            // Icon for imported transcripts - removed as requested
            const importIcon = '';

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
        // Extended speaker patterns to handle various formats found in interview transcripts

        // Build comprehensive pattern to match all speaker markers
        // Interviewer patterns: I, INT, Interviewer, Interviewer (I), Interviewer (R1), Moderator, Facilitator, Researcher, Fieldworker, Q
        // Participant patterns: P, P1, P-1, P - 1, P - 01, Participant, Participant #1, Participant One, Interviewee, Respondent, Speaker, A
        const speakerMarkers = [
            // Interviewer variations
            'Interviewer\\s*(?:\\([^)]*\\))?:', // Interviewer:, Interviewer (I):, Interviewer (R1):, Interviewer (INT):
            'INT:', // Common abbreviation
            'I\\s*-?\\s*\\d*:', // I:, I1:, I-1:, I - 1:
            'Q:', // Question
            'Moderator:', 'Mod:',
            'Facilitator:',
            'Researcher:',
            'Fieldworker:',

            // Participant variations
            'Participant\\s*(?:#?\\d+|One|Two|Three|Four|Five|[A-Z])?\\s*(?:\\([^)]*\\))?:', // Participant:, Participant 1:, Participant #1:, Participant One:, Participant (P):
            'P\\s*-?\\s*\\d*\\s*(?:\\([^)]*\\))?:', // P:, P1:, P-1:, P - 1:, P - 01:, P1 (Interviewee):
            'A:', // Answer
            'Speaker\\s*(?:#?\\d*)?:',
            'Interviewee\\s*(?:\\([^)]*\\))?:',
            'Respondent\\s*(?:#?\\d*)?:',
            'Subject\\s*(?:#?\\d*)?:',
            'User\\s*(?:#?\\d*)?:'
        ];
        const speakerPatternStr = '(?:' + speakerMarkers.join('|') + ')';
        const speakerPattern = new RegExp('(?:^|\\s)(' + speakerPatternStr + ')', 'gi');

        let segments = [];
        let text = importedTranscriptText;

        // Check if text has speaker markers
        const hasMarkers = speakerPattern.test(text);
        speakerPattern.lastIndex = 0; // Reset regex

        if (hasMarkers) {
            // Split by speaker markers - use lookahead to keep the marker with the text
            const splitPattern = new RegExp('(?=\\s*' + speakerPatternStr + ')', 'gi');
            const parts = text.split(splitPattern);

            parts.forEach((part, index) => {
                const trimmedPart = part.trim();
                if (!trimmedPart) return;

                // Detect speaker from the start of the text
                let speaker = null;
                let cleanText = trimmedPart;

                // Check for interviewer markers
                const interviewerMatch = /^(?:Interviewer\s*(?:\([^)]*\))?:|INT:|I\s*-?\s*\d*:|Q:|Moderator:|Mod:|Facilitator:|Researcher:|Fieldworker:)\s*/i;
                // Check for participant markers
                const participantMatch = /^(?:Participant\s*(?:#?\d+|One|Two|Three|Four|Five|[A-Z])?\s*(?:\([^)]*\))?:|P\s*-?\s*\d*\s*(?:\([^)]*\))?:|A:|Speaker\s*(?:#?\d*)?:|Interviewee\s*(?:\([^)]*\))?:|Respondent\s*(?:#?\d*)?:|Subject\s*(?:#?\d*)?:|User\s*(?:#?\d*)?:)\s*/i;

                if (interviewerMatch.test(trimmedPart)) {
                    speaker = 'interviewer';
                    cleanText = trimmedPart.replace(interviewerMatch, '').trim();
                }
                else if (participantMatch.test(trimmedPart)) {
                    speaker = 'participant';
                    cleanText = trimmedPart.replace(participantMatch, '').trim();
                }

                // If this is the first part and has no speaker, it might be a header/intro
                // Skip if it's very short (likely just a title) or add as unmarked segment
                if (index === 0 && !speaker && cleanText.length < 100) {
                    // Skip document headers like "Interview Transcript"
                    return;
                }

                if (cleanText) {
                    segments.push({
                        id: 'seg_' + Date.now() + '_' + segments.length,
                        text: cleanText,
                        timestamp: segments.length * 10,
                        notes: [],
                        speaker: speaker,
                        highlights: []
                    });
                }
            });
        } else {
            // No speaker markers found - split by paragraphs or sentences
            // Try double newlines first, then single newlines, then by periods for long text
            let paragraphs = text.split(/\n\n+/).filter(p => p.trim());

            // If only one paragraph, try splitting by single newlines
            if (paragraphs.length <= 1) {
                paragraphs = text.split(/\n/).filter(p => p.trim());
            }

            // If still only one or text is very long, split by sentences
            if (paragraphs.length <= 1 && text.length > 500) {
                paragraphs = text.split(/(?<=[.!?])\s+/).filter(p => p.trim());
            }

            segments = paragraphs.map((para, index) => ({
                id: 'seg_' + Date.now() + '_' + index,
                text: para.trim(),
                timestamp: index * 10,
                notes: [],
                speaker: null,
                highlights: []
            }));
        }

        // Ensure at least one segment
        if (segments.length === 0) {
            segments.push({
                id: 'seg_' + Date.now() + '_0',
                text: text.trim() || 'No text extracted from PDF',
                timestamp: 0,
                notes: [],
                speaker: null,
                highlights: []
            });
        }

        console.log('Created', segments.length, 'segments from imported PDF');

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

    // Reset mode states - Set Edit mode as default
    reviewEditMode = true;
    reviewNotesMode = false;
    reviewCodingMode = false;

    // Load codes for this interview's project
    loadCodesForReview();

    // Merge and Render first so we have accurate data
    renderReview();
    pushToReviewHistory();

    // Setup mode toggle listeners
    setupReviewModeListeners();

    // Apply initial toolbar visual state
    updateToolbarModes();
}

// Coding mode state
// reviewCodingMode, currentReviewCodes, matches are managed globally or locally
// currentCodeAssignments is now global at top of file

/**
 * Load codes for the current project in review mode
 */
async function loadCodesForReview() {
    if (!currentProjectId) return;

    try {
        currentReviewCodes = await window.loadCodesForProject(currentProjectId);
        if (currentInterviewId) {
            currentCodeAssignments = await window.loadCodeAssignments(currentInterviewId);
            // Re-render to show highlights on transcript
            renderReview();
        }
        renderReviewCodesSidebar();
    } catch (error) {
        console.error('Error loading codes for review:', error);
    }
}

/**
 * Render codes in the review sidebar
 */
function renderReviewCodesSidebar() {
    const codesList = document.getElementById('reviewCodesList');
    if (!codesList) return;

    if (!currentReviewCodes || currentReviewCodes.length === 0) {
        codesList.innerHTML = '<p style="text-align: center; color: var(--text-muted); font-size: 0.8rem; padding: 2rem 1rem;">No codes yet</p>';
        return;
    }

    codesList.innerHTML = currentReviewCodes.map(code => `
        <div class="review-code-badge" 
             draggable="true"
             style="display: flex; align-items: center; gap: 0.65rem; padding: 0.65rem 0.85rem; background: white; border: 1px solid #e2e8f0; border-radius: 8px; cursor: grab; transition: all 0.2s; border-left: 3px solid ${code.color};" 
             data-code-id="${code.id}"
             data-code-name="${escapeHtml(code.name)}"
             data-code-color="${code.color}">
            <div style="width: 10px; height: 10px; border-radius: 50%; background: ${code.color}; flex-shrink: 0;"></div>
            <span style="font-size: 0.85rem; font-weight: 600; color: var(--text-title); flex: 1;">${escapeHtml(code.name)}</span>
        </div>
    `).join('');

    // Add hover and drag effect via event listeners
    document.querySelectorAll('.review-code-badge').forEach(badge => {
        // Hover effects
        badge.addEventListener('mouseenter', function () {
            this.style.background = '#f8fafc';
            this.style.transform = 'translateX(2px)';
            this.style.boxShadow = '0 2px 4px rgba(0,0,0,0.05)';
        });
        badge.addEventListener('mouseleave', function () {
            if (!this.classList.contains('dragging')) {
                this.style.background = 'white';
                this.style.transform = 'translateX(0)';
                this.style.boxShadow = 'none';
            }
        });

        // Drag events
        badge.addEventListener('dragstart', function (e) {
            this.classList.add('dragging');
            this.style.opacity = '0.5';
            this.style.cursor = 'grabbing';
            e.dataTransfer.effectAllowed = 'copy';
            e.dataTransfer.setData('application/json', JSON.stringify({
                codeId: this.dataset.codeId,
                codeName: this.dataset.codeName,
                codeColor: this.dataset.codeColor
            }));
        });

        badge.addEventListener('dragend', function (e) {
            this.classList.remove('dragging');
            this.style.opacity = '1';
            this.style.cursor = 'grab';
            this.style.background = 'white';
            this.style.transform = 'translateX(0)';
            this.style.boxShadow = 'none';
        });
    });
}

/**
 * Setup review mode toggle listeners
 */
function setupReviewModeListeners() {
    const revModeEdit = document.getElementById('revModeEdit');
    const revModeNotes = document.getElementById('revModeNotes');
    const revModeCoding = document.getElementById('revModeCoding');
    const newCodeFromReview = document.getElementById('newCodeFromReview');

    if (revModeEdit) {
        revModeEdit.onclick = () => {
            reviewEditMode = true;
            reviewNotesMode = false;
            reviewCodingMode = false;

            updateToolbarModes();
            renderReview(); // Re-render to update visibility
            enableTextSelection(); // Ensure listeners are removed
        };
    }

    if (revModeNotes) {
        revModeNotes.onclick = () => {
            reviewEditMode = false;
            reviewNotesMode = true;
            reviewCodingMode = false;
            updateToolbarModes();
            renderReview(); // Re-render to update visibility
            enableTextSelection(); // Ensure listeners are removed
        };
    }

    if (revModeCoding) {
        revModeCoding.onclick = () => {
            reviewEditMode = false;
            reviewNotesMode = false;
            reviewCodingMode = true;
            updateToolbarModes();
            renderReview(); // Re-render to update visibility
            enableTextSelection();
            showToast('Select text, then drag a code from the sidebar to assign it', 'info');
        };
    }

    // Attach listeners to static speaker badges in toolbar
    document.querySelectorAll('.draggable-label').forEach(label => {
        label.addEventListener('dragstart', (e) => {
            const speaker = label.getAttribute('data-speaker');
            console.log('Dragging speaker:', speaker);
            currentDraggingSpeaker = speaker; // Set global tracker

            e.dataTransfer.setData('application/x-speaker-data', JSON.stringify({ speaker: speaker }));
            e.dataTransfer.setData('type', 'speaker');
            e.dataTransfer.setData('speaker', speaker);
            e.dataTransfer.effectAllowed = 'copy';
        });

        label.addEventListener('dragend', () => {
            currentDraggingSpeaker = null; // Reset
        });
    });

    if (newCodeFromReview) {
        newCodeFromReview.onclick = () => {
            if (currentProjectId) {
                openCodeModal(currentProjectId);
            }
        };
    }
}

/**
 * Enable text selection and drag & drop for coding
 */
function enableTextSelection() {
    const reviewFeed = document.getElementById('reviewFeed');
    if (!reviewFeed) return;

    // Remove old event listeners
    reviewFeed.removeEventListener('mouseup', handleTextSelectionForCoding);
    reviewFeed.removeEventListener('dragover', handleDragOver);
    reviewFeed.removeEventListener('drop', handleCodeDrop);

    if (reviewCodingMode) {
        // Add selection and drag & drop handlers
        reviewFeed.addEventListener('mouseup', handleTextSelectionForCoding);
        reviewFeed.addEventListener('dragover', handleDragOver);
        reviewFeed.addEventListener('drop', handleCodeDrop);
    }
}

// Store current selection info for coding
let codeSelection = null;

/**
 * Handle text selection - create persistent grey highlight
 */
function handleTextSelectionForCoding(event) {
    const selection = window.getSelection();
    const selectedText = selection.toString().trim();

    if (selectedText.length === 0) {
        return;
    }

    try {
        const range = selection.getRangeAt(0);

        // Find the segment containing the selection
        let segmentElement = selection.anchorNode;
        while (segmentElement && !segmentElement.classList?.contains('review-segment')) {
            segmentElement = segmentElement.parentElement;
        }

        if (!segmentElement) return;

        const segmentId = segmentElement.dataset.segmentId;

        // Create a persistent grey highlight
        const span = document.createElement('span');
        span.className = 'code-pending-highlight';
        span.style.backgroundColor = 'transparent';
        span.style.borderBottom = '3px solid #9ca3af';
        span.style.paddingBottom = '2px';
        span.style.cursor = 'pointer';
        span.setAttribute('data-segment-id', segmentId);
        span.setAttribute('data-highlight-text', selectedText);

        try {
            range.surroundContents(span);

            // Clear browser selection
            window.getSelection().removeAllRanges();

            showToast('Text highlighted - drag a code to assign it', 'info');
        } catch (e) {
            console.warn('Could not highlight selection:', e);
            showToast('Could not highlight text - try selecting within a single segment', 'error');
        }

    } catch (error) {
        console.error('Error handling selection:', error);
    }
}

/**
 * Add grey highlight to current selection
 */
function addSelectionHighlight(range) {
    const span = document.createElement('span');
    span.className = 'code-selection-highlight';
    span.style.backgroundColor = 'transparent';
    span.style.borderBottom = '3px solid #9ca3af';
    span.style.paddingBottom = '2px';
    span.style.transition = 'all 0.2s';

    try {
        range.surroundContents(span);
    } catch (e) {
        // If surroundContents fails (e.g., selection spans multiple elements),
        // just mark the selection differently
        console.warn('Could not highlight selection:', e);
    }
}

/**
 * Clear selection highlight
 */
function clearSelectionHighlight() {
    const highlights = document.querySelectorAll('.code-selection-highlight');
    highlights.forEach(highlight => {
        const parent = highlight.parentNode;
        while (highlight.firstChild) {
            parent.insertBefore(highlight.firstChild, highlight);
        }
        parent.removeChild(highlight);
        parent.normalize();
    });
}

/**
 * Handle drag over to allow drop
 */
function handleDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';

    // Check if we're hovering over a pending highlight OR already coded text
    const targetHighlight = event.target.closest('.code-pending-highlight, .coded-text');

    if (targetHighlight) {
        try {
            const data = JSON.parse(event.dataTransfer.getData('application/json'));
            if (data && data.codeColor) {
                targetHighlight.style.borderBottom = `3px solid ${data.codeColor}`;
            }
        } catch (e) {
            // Fallback
        }
    }
}

/**
 * Handle dropping a code onto a grey highlighted text (or replacing existing code)
 */
async function handleCodeDrop(event) {
    event.preventDefault();

    // Find if we dropped on a pending highlight or coded text
    const targetHighlight = event.target.closest('.code-pending-highlight, .coded-text');

    if (!targetHighlight) {
        showToast('Please drop on a grey-highlighted text or an existing coded text', 'info');
        return;
    }

    try {
        // Get the dropped code data
        const data = JSON.parse(event.dataTransfer.getData('application/json'));

        const text = targetHighlight.getAttribute('data-highlight-text');
        const segmentId = targetHighlight.getAttribute('data-segment-id');

        console.log('Dropped code data:', data);
        console.log('Highlight text:', text, 'Segment:', segmentId);

        // Check if this highlight already has a code (replacing)
        const isReplacing = targetHighlight.classList.contains('coded-text');

        if (isReplacing) {
            const oldAssignmentId = targetHighlight.getAttribute('data-assignment-id');
            if (oldAssignmentId) {
                console.log('Replacing assignment:', oldAssignmentId);
                try {
                    // Delete from DB
                    await window.deleteCodeAssignment(oldAssignmentId);
                    // Update local state
                    currentCodeAssignments = currentCodeAssignments.filter(a => a.id !== oldAssignmentId);
                    console.log('Successfully deleted old assignment from DB');
                } catch (err) {
                    console.error('Failed to delete old assignment:', err);
                }
            } else {
                console.warn('Is replacing but no data-assignment-id found on element:', targetHighlight);
            }

            // Remove old code tag if exists (it's after the highlight, not inside)
            const oldTag = targetHighlight.nextElementSibling;
            if (oldTag && oldTag.classList.contains('code-tag')) {
                oldTag.remove();
            }
        }

        // Assign the code
        const docId = await assignCodeToText(data.codeId, text, segmentId);

        if (!docId) return; // Failed to save

        // Transform into coded highlight (background color, no underline)
        targetHighlight.className = 'coded-text';
        targetHighlight.style.backgroundColor = data.codeColor + '30';
        targetHighlight.style.borderBottom = 'none';
        targetHighlight.style.padding = '2px 4px';
        targetHighlight.style.borderRadius = '3px';
        targetHighlight.style.cursor = 'pointer';
        targetHighlight.style.display = 'inline';
        targetHighlight.setAttribute('data-code-name', data.codeName);
        targetHighlight.setAttribute('data-code-color', data.codeColor);
        targetHighlight.setAttribute('data-code-id', data.codeId);
        targetHighlight.setAttribute('data-assignment-id', docId);

        // Add visible code tag AFTER the highlighted text
        const codeTag = document.createElement('span');
        codeTag.className = 'code-tag';
        codeTag.style.cssText = `
            display: inline-block;
            margin-left: 6px;
            margin-right: 6px;
            padding: 2px 8px;
            font-size: 0.7rem;
            font-weight: 600;
            color: white;
            background: ${data.codeColor};
            border-radius: 4px;
            vertical-align: baseline;
            white-space: nowrap;
        `;

        // Tag name
        const tagName = document.createElement('span');
        tagName.textContent = data.codeName;
        codeTag.appendChild(tagName);

        // Delete button
        const deleteBtn = document.createElement('span');
        deleteBtn.innerHTML = '&times;';
        deleteBtn.title = 'Remove code';
        deleteBtn.style.cssText = `
            margin-left: 6px;
            cursor: pointer;
            opacity: 0.7;
            font-weight: 700;
        `;
        deleteBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            removeCodeAssignment(docId, targetHighlight);
        };
        deleteBtn.onmouseenter = () => deleteBtn.style.opacity = '1';
        deleteBtn.onmouseleave = () => deleteBtn.style.opacity = '0.7';

        codeTag.appendChild(deleteBtn);

        // Insert the tag after the highlighted text (not inside)
        targetHighlight.insertAdjacentElement('afterend', codeTag);

    } catch (error) {
        console.error('Error handling code drop:', error);
        showToast('Failed to assign code', 'error');
    }
}

/**
 * Assign code to selected text
 */
async function assignCodeToText(codeId, text, segmentId) {
    if (!currentInterviewId) return;

    console.log('Assigning code:', { codeId, text, segmentId });

    const assignmentData = {
        codeId: codeId,
        segmentId: segmentId,
        startOffset: 0,
        endOffset: text.length,
        text: text
    };

    try {
        const docId = await window.saveCodeAssignment(currentInterviewId, currentProjectId, assignmentData);
        currentCodeAssignments = await window.loadCodeAssignments(currentInterviewId);
        showToast('Code assigned');
        window.getSelection().removeAllRanges();
        return docId;
    } catch (error) {
        console.error('Error assigning code:', error);
        showToast('Failed to assign code', 'error');
        return null; // Return null on error
    }
}

/**
 * Delete a code assignment
 */
async function removeCodeAssignment(assignmentId, elementToRemove) {
    // Instant removal without confirmation as requested


    try {
        await window.deleteCodeAssignment(assignmentId);
        showToast('Code removed');

        // Update local state
        currentCodeAssignments = currentCodeAssignments.filter(a => a.id !== assignmentId);

        // Remove from DOM
        if (elementToRemove) {
            // Find the coded text element (previous sibling of the tag, or the parent if we change structure)
            // In our structure: highlight element, then code tag element
            // check structure: elementToRemove is the code tag? or the highlight?
            // If we pass the highlight element, we can revert it.

            // Revert visual style
            // Actually, we should just re-render or let the DOM update handle it.
            // But for instant feedback:
            if (elementToRemove.classList.contains('code-tag')) {
                // It's the tag. The highlight is the previous sibling.
                const highlight = elementToRemove.previousElementSibling;
                if (highlight && highlight.classList.contains('coded-text')) {
                    // Unwrap the highlight content
                    const text = highlight.firstChild; // Assuming simple text
                    highlight.parentNode.insertBefore(text, highlight);
                    highlight.remove();
                }
                elementToRemove.remove();
            } else if (elementToRemove.classList.contains('coded-text')) {
                // It's the highlight. The tag is next sibling.
                const tag = elementToRemove.nextElementSibling;
                if (tag && tag.classList.contains('code-tag')) tag.remove();

                const text = elementToRemove.firstChild;
                elementToRemove.parentNode.insertBefore(text, elementToRemove);
                elementToRemove.remove();
            }
        }
    } catch (error) {
        console.error('Error removing code:', error);
        showToast('Failed to remove code', 'error');
    }
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

    // Apply visual code assignments
    if (window.applyCodeAssignments) {
        window.applyCodeAssignments();
    }
}

/**
 * Apply loaded code assignments to the DOM
 */
window.applyCodeAssignments = function () {
    if (!reviewCodingMode) return; // Only show codes in Coding Mode
    if (!currentCodeAssignments || currentCodeAssignments.length === 0) return;

    currentCodeAssignments.forEach(assignment => {
        const segmentEl = document.getElementById(assignment.segmentId);
        if (!segmentEl) return;

        // Find the text span
        const textSpan = segmentEl.querySelector('span:last-child');
        if (!textSpan) return;

        // Search for the text
        // This is a simplified approach searching for the text content
        // Ideal approach uses precise offsets saved in DB
        const textContent = textSpan.textContent;
        const searchStr = assignment.text;
        const index = textContent.indexOf(searchStr);

        if (index !== -1) {
            // We found match. Check if already wrapped?
            // Since we rebuild renderReview every time, we assume clean slate (mostly)
            // But we need to be careful not to double-wrap if multiple codes match same text.
            // Converting simple search to DOM range wrapping is complex if checking for existing wraps.

            // Strategy: Use a TreeWalker to find distinct text node matches
            // For now, let's try to find the text node containing this string
            findAndHighlightText(textSpan, searchStr, assignment);
        }
    });
};

function findAndHighlightText(rootNode, text, assignment) {
    const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while (node = walker.nextNode()) {
        const index = node.textContent.indexOf(text);
        if (index !== -1) {
            // Found it!
            // Split node if necessary
            const range = document.createRange();
            range.setStart(node, index);
            range.setEnd(node, index + text.length);

            // Check if already inside a coded highlight?
            if (node.parentElement.classList.contains('coded-text')) return;

            // Apply visual style (Same as handleCodeDrop)
            const highlight = document.createElement('span');
            highlight.className = 'coded-text';
            // Get color from codeId? assignment only has codeId.
            // We need to look up code details
            const code = currentReviewCodes.find(c => c.id === assignment.codeId);
            const color = code ? code.color : '#3b82f6';
            const codeName = code ? code.name : 'Code';

            highlight.style.backgroundColor = color + '30';
            highlight.style.borderBottom = 'none';
            highlight.style.padding = '2px 4px';
            highlight.style.borderRadius = '3px';
            highlight.style.cursor = 'pointer';
            highlight.style.display = 'inline';
            highlight.setAttribute('data-code-name', codeName);
            highlight.setAttribute('data-code-color', color);
            highlight.setAttribute('data-code-id', assignment.codeId);
            highlight.setAttribute('data-assignment-id', assignment.id);
            // Critical: Add these so replacement works later
            highlight.setAttribute('data-highlight-text', assignment.text);
            highlight.setAttribute('data-segment-id', assignment.segmentId);

            try {
                range.surroundContents(highlight);

                // Add visible code tag AFTER
                const codeTag = document.createElement('span');
                codeTag.className = 'code-tag';
                codeTag.style.cssText = `
                    display: inline-block;
                    margin-left: 6px;
                    margin-right: 6px;
                    padding: 2px 8px;
                    font-size: 0.7rem;
                    font-weight: 600;
                    color: white;
                    background: ${color};
                    border-radius: 4px;
                    vertical-align: baseline;
                    white-space: nowrap;
                `;

                const tagName = document.createElement('span');
                tagName.textContent = codeName;
                codeTag.appendChild(tagName);

                // Delete button
                const deleteBtn = document.createElement('span');
                deleteBtn.innerHTML = '&times;';
                deleteBtn.title = 'Remove code';
                deleteBtn.style.cssText = `
                    margin-left: 6px;
                    cursor: pointer;
                    opacity: 0.7;
                    font-weight: 700;
                `;
                deleteBtn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    removeCodeAssignment(assignment.id, highlight);
                };
                deleteBtn.onmouseenter = () => deleteBtn.style.opacity = '1';
                deleteBtn.onmouseleave = () => deleteBtn.style.opacity = '0.7';

                codeTag.appendChild(deleteBtn);

                highlight.insertAdjacentElement('afterend', codeTag);

                // Stop after first match for this assignment to avoid duplicates
                // (Limitation: duplicate text content might be highlighted wrong)
                return true;

            } catch (e) {
                console.warn('Highlight intersection error', e);
            }
        }
    }
}

// Firebase Save Logic
async function saveReviewChanges() {
    if (!currentInterviewId) return;

    // Sync all currently editing segments before saving
    syncAllEditableSegments();

    // Provide visual feedback
    const originalText = saveReviewBtn.textContent;
    saveReviewBtn.textContent = 'Saving...';
    saveReviewBtn.disabled = true;

    try {
        // Save to both 'transcript' and 'transcriptSegments' for compatibility
        // Regular interviews use 'transcript', imported use 'transcriptSegments'
        await db.collection('interviews').doc(currentInterviewId).update({
            transcript: transcriptSegments,
            transcriptSegments: transcriptSegments,
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

// Helper function to sync all editable segments to the data model
function syncAllEditableSegments() {
    const editableSpans = document.querySelectorAll('.review-segment span[contenteditable="true"]');
    editableSpans.forEach(textSpan => {
        const segmentDiv = textSpan.closest('.review-segment');
        if (!segmentDiv) return;

        const segmentId = segmentDiv.getAttribute('data-segment-id');
        const segment = transcriptSegments.find(s => s.id === segmentId);

        if (segment) {
            const currentText = textSpan.innerText;
            const currentHtml = textSpan.innerHTML;

            // Update the segment data
            segment.text = currentText;
            segment.html = currentHtml;
        }
    });
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
let currentDraggingSpeaker = null; // Track which speaker is being dragged for highlighting

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
    const revModeEdit = document.getElementById('revModeEdit');
    const revModeNotes = document.getElementById('revModeNotes');
    const revModeCoding = document.getElementById('revModeCoding');

    // Edit mode visual
    if (revModeEdit) {
        if (reviewEditMode) {
            revModeEdit.style.background = '#ffffff';
            revModeEdit.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
            revModeEdit.style.color = 'var(--brand-primary)';
        } else {
            revModeEdit.style.background = 'transparent';
            revModeEdit.style.boxShadow = 'none';
            revModeEdit.style.color = 'var(--text-muted)';
        }
    }

    // Notes mode visual
    if (revModeNotes) {
        if (reviewNotesMode) {
            revModeNotes.style.background = '#ffffff';
            revModeNotes.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
            revModeNotes.style.color = 'var(--brand-primary)';
        } else {
            revModeNotes.style.background = 'transparent';
            revModeNotes.style.boxShadow = 'none';
            revModeNotes.style.color = 'var(--text-muted)';
        }
    }

    // Coding mode visual
    if (revModeCoding) {
        if (reviewCodingMode) {
            revModeCoding.style.background = '#ffffff';
            revModeCoding.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
            revModeCoding.style.color = 'var(--brand-primary)';
        } else {
            revModeCoding.style.background = 'transparent';
            revModeCoding.style.boxShadow = 'none';
            revModeCoding.style.color = 'var(--text-muted)';
        }
    }

    // Show/Hide sub-actions
    const speakerLabelsContainer = document.getElementById('speakerLabelsContainer');
    if (speakerLabelsContainer) speakerLabelsContainer.style.display = reviewEditMode ? 'flex' : 'none';

    // Show/Hide Bottom Toolbar Row (Formatting) - Only visible in Edit Mode
    const bottomRow = document.querySelector('.toolbar-bottom-row');
    if (bottomRow) {
        bottomRow.style.display = reviewEditMode ? 'flex' : 'none';
    }

    // Toggle the new staging area bar for notes
    const stagingArea = document.getElementById('notesStagingArea');
    if (stagingArea) stagingArea.style.display = reviewNotesMode ? 'flex' : 'none';

    // Show/Hide codes sidebar in coding mode
    const codingSidebar = document.getElementById('reviewCodingSidebar');
    if (codingSidebar) {
        if (reviewCodingMode) {
            codingSidebar.classList.remove('hidden');
        } else {
            codingSidebar.classList.add('hidden');
        }
    }

    // Make notes read-only in coding mode
    const noteCards = document.querySelectorAll('.review-note-card');
    noteCards.forEach(card => {
        if (reviewCodingMode) {
            card.classList.add('read-only');
        } else {
            card.classList.remove('read-only');
        }
    });

    // Undo/Redo Button Visuals
    const revUndoBtn = document.getElementById('revUndoBtn');
    const revRedoBtn = document.getElementById('revRedoBtn');

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

        // Don't show orange indicators in coding mode
        if (reviewCodingMode) {
            return;
        }

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

    // Use Grid for 2-column layout (Sidebar | Content)
    div.style.display = 'grid';
    div.style.gridTemplateColumns = '140px 1fr'; // Increased to prevent wrap
    div.style.gap = '1rem';
    div.style.alignItems = 'stretch'; // CRITICAL: Make grid items fill full row height

    div.style.marginBottom = '0.75rem';
    div.style.marginTop = '0.5rem';

    // In edit mode, add visual boundaries
    if (reviewEditMode) {
        div.style.padding = '0.5rem';
        div.style.borderRadius = '8px';
        div.style.transition = 'background-color 0.2s';

        // Add Listeners for speaker badge dragging
        // Add Listeners for speaker badge dragging
        div.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';

            // Check global variable since dataTransfer is restricted in dragover
            const speakerType = currentDraggingSpeaker;

            // Add appropriate class based on speaker type
            if (speakerType === 'interviewer') {
                div.classList.add('drag-over-interviewer');
                div.classList.remove('drag-over-participant', 'drag-over-speaker');
            } else if (speakerType === 'participant') {
                div.classList.add('drag-over-participant');
                div.classList.remove('drag-over-interviewer', 'drag-over-speaker');
            } else {
                // Fallback (e.g. if dragging something else or global var missing)
                div.classList.add('drag-over-speaker');
                div.classList.remove('drag-over-interviewer', 'drag-over-participant');
            }
        });

        div.addEventListener('dragleave', (e) => {
            // Only remove if we are leaving the element proper, not entering a child
            if (!div.contains(e.relatedTarget)) {
                div.classList.remove('drag-over-speaker', 'drag-over-interviewer', 'drag-over-participant');
            }
        });

        div.addEventListener('drop', (e) => {
            div.classList.remove('drag-over-speaker', 'drag-over-interviewer', 'drag-over-participant');
            // We need to handle the drop here too or bubble it up? 
            // The existing drop listener on document might handle it, but let's see.
        });
    }

    // Connect visually to previous speaker block if no speaker change
    if (segment.speaker) {
        div.style.marginTop = '1.5rem'; // New Speaker Section
    }

    // --- LEFT COLUMN (Sidebar) ---
    const sidebarDiv = document.createElement('div');
    sidebarDiv.className = 'segment-sidebar';
    sidebarDiv.style.textAlign = 'left'; // Left align as requested
    sidebarDiv.style.display = 'flex';
    sidebarDiv.style.flexDirection = 'column';
    sidebarDiv.style.alignSelf = 'stretch'; // Force to fill grid cell height
    sidebarDiv.style.minHeight = '100%';
    div.appendChild(sidebarDiv);

    // Speaker Label
    if (segment.speaker) {
        const speakerLabel = document.createElement('div'); // Block element
        speakerLabel.className = `speaker-label ${segment.speaker}`;
        speakerLabel.style.display = 'inline-block'; // Keep badge look
        speakerLabel.style.whiteSpace = 'nowrap'; // Prevent wrapping (User request: "no umbruch")
        speakerLabel.style.marginBottom = '0';
        speakerLabel.style.lineHeight = '1';
        speakerLabel.style.fontSize = '0.85rem';

        if (reviewEditMode) {
            // Add cross indicator for removal
            // Reverted to full names as requested
            speakerLabel.innerHTML = `${segment.speaker === 'interviewer' ? 'Interviewer' : 'Participant'} <span style="margin-left: 0.3rem; opacity: 0.6; font-size: 1.1em; cursor: pointer; line-height: 1;">×</span>`;
            speakerLabel.title = segment.speaker === 'interviewer' ? 'Interviewer' : 'Participant';
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
            speakerLabel.title = segment.speaker === 'interviewer' ? 'Interviewer' : 'Participant';
        }

        sidebarDiv.appendChild(speakerLabel);
    }

    // --- RIGHT COLUMN (Content) ---
    const contentDiv = document.createElement('div');
    contentDiv.className = 'segment-content';
    contentDiv.style.minWidth = '0'; // Crucial for text wrapping in grid
    div.appendChild(contentDiv);

    const textSpan = document.createElement('span');
    textSpan.contentEditable = reviewEditMode;
    textSpan.spellcheck = false;
    textSpan.style.outline = 'none';
    textSpan.style.whiteSpace = 'pre-wrap';
    textSpan.style.wordBreak = 'break-word'; // Ensure long words break
    textSpan.style.overflowWrap = 'break-word';
    textSpan.style.display = 'block'; // Block display
    textSpan.style.lineHeight = '1.6';

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

    contentDiv.appendChild(textSpan);

    textSpan.querySelectorAll('.word-highlight').forEach(mark => {
        mark.title = "";
        mark.style.cursor = "pointer";

        // Allow removal on click when in edit/notes mode (but NOT in coding mode)
        mark.addEventListener('click', (e) => {
            if (reviewCodingMode) return;

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
    // Align with text column: Sidebar (140px) + Gap (1rem approx 16px)
    div.style.marginLeft = 'calc(140px + 1rem)';
    div.style.marginTop = '0.75rem';
    div.style.marginBottom = '0.75rem';

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
// ============================================================================
// CODE MANAGER & ANALYSIS
// ============================================================================

const codeManagerModal = document.getElementById('codeManagerModal');
const closeCodeManagerModal = document.getElementById('closeCodeManagerModal');
const openCodeManagerBtn = document.getElementById('openCodeManagerBtn');

if (openCodeManagerBtn) {
    openCodeManagerBtn.addEventListener('click', () => {
        if (currentProjectId) {
            openCodeManager(currentProjectId);
        }
    });
}

if (closeCodeManagerModal) {
    closeCodeManagerModal.addEventListener('click', () => {
        codeManagerModal.classList.add('hidden');
    });
}

// Make globally accessible for the onclick handlers in HTML string
window.renderCodeUsageDetail = renderCodeUsageDetail;
window.jumpToSegment = jumpToSegment;

/**
 * Open Code Manager and Load Data
 */
async function openCodeManager(projectId) {
    codeManagerModal.classList.remove('hidden');
    const listContainer = document.getElementById('codeManagerList');
    listContainer.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--text-muted);">Loading code analysis...</div>';

    // Clear Detail View
    document.getElementById('codeManagerDetailEmpty').classList.remove('hidden');
    document.getElementById('codeManagerDetailContent').classList.add('hidden');

    try {
        // 1. Fetch Codes and All Project Segments in parallel
        const [codes, allSegments] = await Promise.all([
            window.loadCodesForProject(projectId),
            window.getAllCodedSegments(projectId)
        ]);

        // 2. Aggregate Usage Counts
        const codeUsageMap = {};
        allSegments.forEach(seg => {
            if (!codeUsageMap[seg.codeId]) {
                codeUsageMap[seg.codeId] = [];
            }
            codeUsageMap[seg.codeId].push(seg);
        });

        // 3. Render Code List (Left Sidebar)
        renderCodeManagerSidebar(codes, codeUsageMap);

    } catch (error) {
        console.error("Error loading code manager:", error);
        listContainer.innerHTML = '<div style="color: red; padding: 1rem;">Error loading data.</div>';
    }
}

/**
 * Render Sidebar List
 */
function renderCodeManagerSidebar(codes, codeUsageMap) {
    const listContainer = document.getElementById('codeManagerList');

    if (!codes || codes.length === 0) {
        listContainer.innerHTML = '<div style="padding: 1rem; color: var(--text-muted);">No codes created yet.</div>';
        return;
    }

    listContainer.innerHTML = codes.map(code => {
        const usage = codeUsageMap[code.id] || [];
        const count = usage.length;

        // Escape data for attribute
        const usageData = JSON.stringify(usage).replace(/"/g, '&quot;');

        return `
            <div class="code-manager-item code-item" 
                 id="code-item-${code.id}"
                 data-code-name="${escapeHtml(code.name)}"
                 data-code-color="${code.color}"
                 onclick="window.renderCodeUsageDetail('${code.id}', '${escapeHtml(code.name)}', '${code.color}', this)"
                 style="/* style managed by css now mostly, but keep minimal */">
                
                <div class="code-item-left">
                    <div class="code-color-preview" style="background: ${code.color};"></div>
                    <span class="code-item-name" style="/* managed by css */">${escapeHtml(code.name)}</span>
                </div>

                <div class="code-item-actions">
                     <button onclick="event.stopPropagation(); window.editCode('${code.id}')" title="Edit">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                     </button>
                     <button onclick="event.stopPropagation(); window.confirmDeleteCode('${code.id}')" class="delete-code-btn" title="Delete">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                     </button>
                </div>

                <!-- Hidden data storage -->
                <div id="data-${code.id}" style="display:none;" data-usage="${usageData}"></div>
            </div>
        `;
    }).join('');
}

/**
 * Render Right Content (Occurrences)
 */
function renderCodeUsageDetail(codeId, name, color, startEl) {
    // UI Selection State
    document.querySelectorAll('.code-manager-item').forEach(el => {
        el.style.background = 'transparent';
        el.style.borderColor = 'transparent';
    });
    startEl.style.background = 'white';
    startEl.style.borderColor = 'var(--brand-primary)';

    // Get Data
    const dataEl = document.getElementById(`data-${codeId}`);
    const occurrences = JSON.parse(dataEl.dataset.usage || '[]');

    // Update Header
    document.getElementById('codeManagerDetailEmpty').classList.add('hidden');
    document.getElementById('codeManagerDetailContent').classList.remove('hidden');

    // Update title area with controls
    const titleContainer = document.querySelector('#codeManagerDetailContent .detail-header');

    // Store current raw color AND ID for edit modal retrieval
    const detailContentElement = document.getElementById('codeManagerDetailContent');
    detailContentElement.dataset.currentCodeColor = color;
    detailContentElement.dataset.currentCodeId = codeId;

    // Clear existing content relative to header actions if any (we are rewriting innerHTML of container or just parts)
    // Actually, let's just rewrite the header content to include buttons
    titleContainer.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem;">
            <div style="display: flex; align-items: center; gap: 1rem;">
                <div id="codeDetailColor" style="width: 32px; height: 32px; border-radius: 50%; background: ${color}; flex-shrink: 0;"></div>
                <h3 id="codeDetailTitle" style="margin: 0; font-size: 1.75rem; font-weight: 700; line-height: 1.2;">${escapeHtml(name)}</h3>
            </div>
            <div style="display: flex; gap: 0.5rem; flex-shrink: 0;">
                <button onclick="window.editCode('${codeId}')" class="btn-secondary small" title="Edit Code">
                   <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                    Edit
                </button>
                <button onclick="window.confirmDeleteCode('${codeId}')" class="btn-secondary small" style="color: #ef4444; border-color: #fee2e2; background: #fff1f2;" title="Delete Code">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2v2"></path>
                    </svg>
                    Delete
                </button>
            </div>
        </div>
        
        <div style="display: flex; align-items: center; gap: 1rem; color: var(--text-muted); font-size: 0.9rem;">
            <span id="codeDetailCount" class="badge" style="font-size: 0.85rem; padding: 0.25rem 0.75rem;">${occurrences.length} segments</span>
            <span style="width: 4px; height: 4px; background: #cbd5e1; border-radius: 50%;"></span>
            <p id="codeDetailDesc" style="margin: 0;">
                ${occurrences.length > 0
            ? `Used in ${new Set(occurrences.map(o => o.interviewId)).size} interviews (Total: ${occurrences.length} times)`
            : 'This code has not been used in any transcript yet.'}
            </p>
        </div>
    `;

    // Render List
    const container = document.getElementById('codeSegmentsList');
    if (occurrences.length === 0) {
        container.innerHTML = '<div style="color:var(--text-muted); font-style:italic;">No coded segments found.</div>';
        return;
    }

    container.innerHTML = occurrences.map(occ => {
        // Capitalize Speaker
        let speaker = occ.segmentSpeaker || 'Speaker';
        if (speaker.toLowerCase() === 'interviewer') {
            speaker = 'Interviewer';
        } else if (speaker.toLowerCase() === 'participant') {
            speaker = 'Participant';
        }

        return `
        <div class="segment-card" style="background: #f8fafc; border: 1px solid var(--border-light); border-radius: 8px; padding: 1rem; transition: all 0.2s;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem; font-size: 0.85rem; color: var(--text-muted);">
                <span style="font-weight: 600; color: var(--text-title);">
                    ${occ.interviewTitle || 'Unknown Interview'}
                </span>
                <span style="font-weight: 500;">${speaker}</span>
            </div>
            <div style="font-size: 0.95rem; line-height: 1.5; color: var(--text-body); margin-bottom: 1rem; border-left: 3px solid ${color}; padding-left: 0.75rem;">
                "${escapeHtml(occ.segmentText)}"
            </div>
            <button onclick="window.jumpToSegment('${occ.interviewId}', '${occ.segmentId}')" 
                    class="btn-secondary small" style="width: 100%; justify-content: center;">
                Go to Transcript context
            </button>
        </div>
    `}).join('');
}

/**
 * Jump to Segment Logic
 */
async function jumpToSegment(interviewId, segmentId) {
    // Close Modal
    codeManagerModal.classList.add('hidden');

    // 1. If currently in the right interview, just scroll
    if (currentInterviewId === interviewId && !transcriptReviewView.classList.contains('hidden')) {
        scrollToAndHighlight(segmentId);
        return;
    }

    // 2. Otherwise, load the interview first
    // Use loadCompletedInterview to ensure we enter Review Mode where coding happens
    await loadCompletedInterview(interviewId);

    // Switch to Coding Mode explicitly
    // We do this after loadCompletedInterview because openReview resets it to Edit mode
    reviewEditMode = false;
    reviewNotesMode = false;
    reviewCodingMode = true;
    updateToolbarModes();
    renderReview(); // Re-render to ensure coding styles are applied
    enableTextSelection();
    showToast('Switched to Coding Mode', 'info');

    // 3. Then scroll after a slight delay to ensure render
    setTimeout(() => {
        scrollToAndHighlight(segmentId);
    }, 800);
}

function scrollToAndHighlight(segmentId) {
    const segmentEl = document.getElementById(segmentId);
    if (segmentEl) {
        segmentEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Add temporary flash effect
        segmentEl.style.transition = 'background 0.5s';
        const originalBg = segmentEl.style.backgroundColor;
        segmentEl.style.backgroundColor = '#fff7ed'; // Flash orange/yellow
        setTimeout(() => {
            segmentEl.style.backgroundColor = originalBg || 'transparent';
        }, 2000);
    } else {
        showToast('Could not find segment in this transcript.', 'error');
    }
}

// ============================================================================
// CODE MANAGER ACTIONS (Edit / Delete)
// ============================================================================

window.confirmDeleteCode = function (codeId) {
    openConfirmModal(
        'Delete Code',
        'Are you sure you want to delete this code? This will remove it from all assigned segments.',
        'Delete',
        () => performDeleteCode(codeId)
    );
};

window.editCode = function (codeId) {
    // Reuse the create code modal but populate it
    const modal = document.getElementById('codeModal');
    const title = document.getElementById('codeModalTitle');
    const nameInput = document.getElementById('codeName');

    // Strategy: Try to find the source data in the sidebar list first (most reliable)
    // Then fall back to the detail view if that ID is currently open
    // This solves the issue where edit args were stale or missing
    let currentName = "";
    let currentColor = "";

    const listItem = document.getElementById(`code-item-${codeId}`);
    if (listItem) {
        currentName = listItem.dataset.codeName;
        currentColor = listItem.dataset.codeColor;
    } else {
        // Fallback: Check if the detail view is open for this code
        // If sidebar item is missing/hidden, and we are editing, we are likely in the detail view header.
        // We trust the visible title matches the edit button context.
        const detailTitle = document.getElementById('codeDetailTitle');
        const detailContent = document.getElementById('codeManagerDetailContent');

        if (detailTitle) {
            currentName = detailTitle.textContent;
        }
        if (detailContent && detailContent.dataset.currentCodeColor) {
            currentColor = detailContent.dataset.currentCodeColor;
        }
    }

    // Default fallback
    if (!currentColor) currentColor = '#3b82f6';

    // Setup Modal
    if (title) title.textContent = "Edit Code";
    if (nameInput) {
        nameInput.value = currentName || '';
    }

    // Pre-select Color
    // 1. Reset all
    document.querySelectorAll('.color-option').forEach(el => el.classList.remove('selected'));
    document.querySelectorAll('.custom-color-wrapper').forEach(el => el.classList.remove('selected'));

    // 2. Find match
    let matchFound = false;
    if (currentColor) {
        // Normal Hex Match
        const normalize = (c) => c.toLowerCase().trim();
        const target = normalize(currentColor);

        document.querySelectorAll('.color-option').forEach(el => {
            if (normalize(el.dataset.color) === target) {
                el.classList.add('selected');
                matchFound = true;
            }
        });

        // If no predefined match, assume custom
        if (!matchFound) {
            const customWrapper = document.querySelector('.custom-color-wrapper');
            const customInput = document.getElementById('customColorInput');
            const customBubble = document.getElementById('customColorBubble');

            if (customWrapper && customInput && customBubble) {
                customWrapper.classList.add('selected');
                customInput.value = currentColor; // works for hex
                customBubble.style.background = currentColor;

                // If the color isn't hex (e.g. rgba), input type='color' might ignore it, 
                // but style.background will work for the bubble.
            }
        }
    }

    // Store editing ID
    modal.dataset.editingId = codeId;

    modal.classList.remove('hidden');

    // Overwrite save handler temporarily
    saveBtn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const newName = nameInput.value.trim();
        const activeColorEl = document.querySelector('.color-option.selected') || document.querySelector('.custom-color-wrapper.selected');
        let newColor = '#3b82f6';

        if (activeColorEl) {
            if (activeColorEl.classList.contains('custom-color-wrapper')) {
                newColor = document.getElementById('customColorInput').value;
            } else {
                newColor = activeColorEl.dataset.color;
            }
        }

        if (!newName) return;

        saveBtn.disabled = true;
        saveBtn.textContent = 'Updating...';

        try {
            if (window.updateCode) {
                await window.updateCode(codeId, { name: newName, color: newColor });
            } else {
                // Fallback
                await db.collection('codes').doc(codeId).update({
                    name: newName,
                    color: newColor,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            }

            showToast('Code updated');
            modal.classList.add('hidden');
            delete modal.dataset.editingId;


            // Refresh
            if (currentProjectId) openCodeManager(currentProjectId);

            // Reset UI
            if (title) title.textContent = "Create Code";
            if (nameInput) nameInput.value = "";
            saveBtn.onclick = null; // Remove this handler?
            // Re-attach original handler?? This is messy. 
            // Better to have one handler that checks mode.

        } catch (e) {
            console.error(e);
            showToast('Error updating code', 'error');
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save code';
        }
    };
};

async function performDeleteCode(codeId) {
    if (!codeId) return;

    try {
        await window.deleteCode(codeId); // Assumes this is exposed in firebase-data.js
        showToast('Code deleted');

        // Refresh Code Manager
        if (currentProjectId) {
            openCodeManager(currentProjectId);
        }
    } catch (error) {
        console.error('Error deleting code:', error);
        showToast('Failed to delete code', 'error');
    }
}
