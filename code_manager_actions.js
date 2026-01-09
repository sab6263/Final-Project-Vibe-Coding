
// ============================================================================
// CODE MANAGER ACTIONS (Edit / Delete)
// ============================================================================

window.confirmDeleteCode = function (codeId) {
    openConfirmModal(
        'Delete Code',
        'Are you sure you want to delete this code? This will remove it from all assigned segments.',
        'Delete API',
        () => performDeleteCode(codeId)
    );
};

window.editCode = function (codeId) {
    alert("Edit functionality coming soon!");
};

async function performDeleteCode(codeId) {
    if (!codeId) return;

    // We need to implement deleteCode in firebase-data.js first or use existing logic if available
    // But as per conversation history, user had issues with deleteCodeWithConfirm.
    // Let's implement a direct delete here for now or call a window function.

    try {
        await window.deleteCode(codeId);
        showToast('Code deleted successfully');

        // Refresh Code Manager
        if (currentProjectId) {
            openCodeManager(currentProjectId);
        }
    } catch (error) {
        console.error('Error deleting code:', error);
        showToast('Failed to delete code', 'error');
    }
}
