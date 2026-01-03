/**
 * Project Overview Logic
 * Handles state management, rendering, and interaction for projects.
 */

// State
let projects = []; // Start with empty array as requested
let currentFilter = 'all'; // 'all' | 'active' | 'inactive'
let searchQuery = '';

// DOM Elements
const projectsContainer = document.getElementById('projectsContainer');
const emptyState = document.getElementById('emptyState');
const createBtn = document.getElementById('createProjectBtn');
const createBtnEmpty = document.getElementById('createProjectBtnEmpty');
const searchInput = document.getElementById('searchInput');
const filterBtns = document.querySelectorAll('.filter-btn');

// Modal Elements
const modal = document.getElementById('createProjectModal');
const closeModalIcon = document.getElementById('closeModalIcon');
const cancelCreateBtn = document.getElementById('cancelCreateBtn');
const confirmCreateBtn = document.getElementById('confirmCreateBtn');
const newProjectNameInput = document.getElementById('newProjectName');

// Delete Modal Elements
const deleteModal = document.getElementById('deleteConfirmModal');
const closeDeleteModalIcon = document.getElementById('closeDeleteModalIcon');
const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');

// State for deletion
let projectIdToDelete = null;

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    render();

    // Global click listener to close dropdowns
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.card-menu-container')) {
            document.querySelectorAll('.card-dropdown').forEach(el => el.classList.add('hidden'));
        }
    });

    // Delete Modal Listeners
    if (deleteModal) {
        closeDeleteModalIcon.addEventListener('click', closeDeleteModal);
        cancelDeleteBtn.addEventListener('click', closeDeleteModal);
        confirmDeleteBtn.addEventListener('click', confirmDeleteAction);

        deleteModal.addEventListener('click', (e) => {
            if (e.target === deleteModal) closeDeleteModal();
        });
    }
});

// Event Listeners
createBtn.addEventListener('click', openCreateModal);
createBtnEmpty.addEventListener('click', openCreateModal);

// Modal Interactions
closeModalIcon.addEventListener('click', closeCreateModal);
cancelCreateBtn.addEventListener('click', closeCreateModal);
confirmCreateBtn.addEventListener('click', submitCreateProject);

// Close modal on click outside
modal.addEventListener('click', (e) => {
    if (e.target === modal) {
        closeCreateModal();
    }
});

// Allow Enter key to submit in modal
newProjectNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        submitCreateProject();
    }
    if (e.key === 'Escape') {
        closeCreateModal();
    }
});

searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value.toLowerCase();
    render();
});

filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        // Update UI
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // Update State
        currentFilter = btn.dataset.filter;
        render();
    });
});

/**
 * Opens the create project modal and resets input
 */
function openCreateModal() {
    newProjectNameInput.value = '';
    modal.classList.remove('hidden');
    // Small timeout to allow element to become visible before focusing
    setTimeout(() => {
        newProjectNameInput.focus();
    }, 50);
}

/**
 * Closes the create project modal
 */
function closeCreateModal() {
    modal.classList.add('hidden');
}

/**
 * Handles the actual creation of the project from the modal
 */
function submitCreateProject() {
    let rawName = newProjectNameInput.value.trim();
    if (!rawName) {
        rawName = "Untitled Project";
    }

    // allow creation
    newProjectNameInput.style.borderColor = '';

    createNewProject(rawName);
    closeCreateModal();
}

/**
 * Creates a new project and adds it to the list
 * @param {string} name - The name of the new project
 */
function createNewProject(name) {
    const now = new Date();

    const newProject = {
        id: Date.now().toString(),
        name: name,
        status: 'active', // Default to active
        updatedAt: now
    };

    projects.unshift(newProject); // Add to top

    // Clear filters/search to show the new project
    if (searchQuery) {
        searchQuery = '';
        searchInput.value = '';
    }
    if (currentFilter !== 'all') {
        currentFilter = 'all';
        filterBtns.forEach(b => b.classList.toggle('active', b.dataset.filter === 'all'));
    }

    render();

    // Simple toast feedback
    showToast(`"${newProject.name}" created`);
}

/**
 * Toggles project status between active and inactive
 */
function toggleProjectStatus(id) {
    const project = projects.find(p => p.id === id);
    if (project) {
        project.status = project.status === 'active' ? 'inactive' : 'active';
        render(); // Re-render to update UI
    }
}

/**
 * Deletes a project - Opens Confirmation
 */
function deleteProject(id) {
    projectIdToDelete = id;

    // Hide any open menus
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
        render();
        showToast('Project deleted');
    }
    closeDeleteModal();
}

/**
 * Toggles the dropdown menu for a card
 */
function toggleCardMenu(event, id) {
    event.stopPropagation(); // Prevent closing immediately

    // Close other open menus first
    document.querySelectorAll('.card-dropdown').forEach(el => {
        if (el.id !== `menu-${id}`) el.classList.add('hidden');
    });

    const menu = document.getElementById(`menu-${id}`);
    if (menu) {
        menu.classList.toggle('hidden');
    }
}

/**
 * Renders the projects list or empty state based on current state
 */
function render() {
    // 1. Check if total projects exist (for global empty state)
    if (projects.length === 0) {
        projectsContainer.classList.add('hidden');
        emptyState.classList.remove('hidden');
        projectsContainer.innerHTML = '';
        return;
    } else {
        emptyState.classList.add('hidden');
        projectsContainer.classList.remove('hidden');
    }

    // 2. Filter and Search
    const filteredProjects = projects.filter(project => {
        const matchesFilter = currentFilter === 'all' || project.status === currentFilter;
        const matchesSearch = project.name.toLowerCase().includes(searchQuery);
        return matchesFilter && matchesSearch;
    });

    // 3. Render Content
    if (filteredProjects.length === 0) {
        // No matches for filter/search
        projectsContainer.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; color: var(--text-secondary); padding: 2rem;">
                <p>No projects match your search or filter.</p>
            </div>
        `;
    } else {
        projectsContainer.innerHTML = filteredProjects.map(project => `
            <div class="project-card">
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
                                <button class="dropdown-item" onclick="toggleProjectStatus('${project.id}')">
                                    ${project.status === 'active' ? 'Mark as Inactive' : 'Mark as Active'}
                                </button>
                                <button class="dropdown-item delete" onclick="deleteProject('${project.id}')">
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
 * Helper to format date
 */
function formatDate(date) {
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

/**
 * Helper to escape HTML to prevent XSS
 */
function escapeHtml(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function showToast(message) {
    // Implementation of a simple toast
    console.log(message);
    const toast = document.getElementById('toast');
    if (toast) {
        toast.textContent = message;
        toast.classList.remove('hidden');
        setTimeout(() => toast.classList.add('hidden'), 3000);
    }
}

// Make functions active globally for inline onclick
window.toggleCardMenu = toggleCardMenu;
window.toggleProjectStatus = toggleProjectStatus;
window.deleteProject = deleteProject;
