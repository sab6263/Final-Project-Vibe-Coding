/**
 * Contexture - Application Logic
 */

// State
let projects = [];
let currentFilter = 'all';
let searchQuery = '';
let currentProjectId = null; // ID of the currently open project

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

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    // Initial Render
    render();

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
});

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
        const matchesFilter = currentFilter === 'all' || project.status === currentFilter;
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
                        <span class="status-badge ${project.status}">
                            ${project.status}
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
                                    ${project.status === 'active' ? 'Mark as Inactive' : 'Mark as Active'}
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
function openProject(id) {
    const project = projects.find(p => p.id === id);
    if (!project) return;

    currentProjectId = id;

    // Populate Data
    detailProjectTitle.textContent = project.name;

    // Set Toggle Button State
    if (project.status === 'active') {
        projectStatusToggle.classList.add('is-active');
        projectStatusToggle.textContent = 'ACTIVE ▼';
    } else {
        projectStatusToggle.classList.remove('is-active');
        projectStatusToggle.textContent = 'INACTIVE ▼';
    }

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
function saveProjectTitle() {
    if (!currentProjectId) return;

    const newTitle = detailProjectTitle.textContent.trim();
    const project = projects.find(p => p.id === currentProjectId);

    if (project && newTitle && newTitle !== project.name) {
        project.name = newTitle;
        project.updatedAt = new Date();
    } else if (!newTitle && project) {
        // Revert if empty
        detailProjectTitle.textContent = project.name;
    }
}

/**
 * Updates status from the Detail View Toggle
 */
function updateCurrentProjectStatus(activate) {
    if (!currentProjectId) return;

    const project = projects.find(p => p.id === currentProjectId);
    if (project) {
        project.status = activate ? 'active' : 'inactive';
        project.updatedAt = new Date();

        // Update UI
        if (activate) {
            projectStatusToggle.classList.add('is-active');
            projectStatusToggle.textContent = 'ACTIVE ▼';
        } else {
            projectStatusToggle.classList.remove('is-active');
            projectStatusToggle.textContent = 'INACTIVE ▼';
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

function toggleProjectStatus(event, id) {
    event.stopPropagation(); // Stop from opening project
    const project = projects.find(p => p.id === id);
    if (project) {
        project.status = project.status === 'active' ? 'inactive' : 'active';
        render();
        document.querySelectorAll('.card-dropdown').forEach(el => el.classList.add('hidden'));
    }
}

function deleteProjectFromMenu(event, id) {
    event.stopPropagation();
    deleteProject(id);
}

function deleteProject(id) {
    projectIdToDelete = id;
    document.querySelectorAll('.card-dropdown').forEach(el => el.classList.add('hidden'));
    deleteModal.classList.remove('hidden');
}

function closeDeleteModal() {
    deleteModal.classList.add('hidden');
    projectIdToDelete = null;
}

function confirmDeleteAction() {
    if (projectIdToDelete) {
        projects = projects.filter(p => p.id !== projectIdToDelete);

        // If we deleted the currently open project, go back to overview
        if (currentProjectId === projectIdToDelete) {
            closeProject();
        } else {
            render();
        }

        showToast('Project deleted');
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

function submitCreateProject() {
    let rawName = newProjectNameInput.value.trim();
    if (!rawName) rawName = "Untitled Project";

    const newProject = {
        id: Date.now().toString(),
        name: rawName,
        status: 'active',
        updatedAt: new Date()
    };

    projects.unshift(newProject);

    // Clear filters
    if (searchQuery) { searchQuery = ''; searchInput.value = ''; }
    if (currentFilter !== 'all') { currentFilter = 'all'; }

    render();
    closeCreateModal();
    showToast(`"${newProject.name}" created`);
}

// Helpers
function formatDate(date) {
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function escapeHtml(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

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
