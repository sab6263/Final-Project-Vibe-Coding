# Editing Experience Fix Plan

## Problem Analysis
The current editing experience in the "Edit Transcript" view is brittle because it relies on standard `contenteditable` behavior, which conflicts with our custom inline note highlights (`<mark>` tags).

**Specific Issues:**
1. **Deleting Inline Notes:** Removing a note's text or deleting from the sidebar causes layout breakage because the DOM update logic for the Edit view is using a function (`updateSegmentContent`) designed for the Recording view's structure.
2. **Merging Lines:** Pressing Backspace at the start of a line to merge it with the previous line causes the browser to "flatten" the HTML, stripping out our `<mark>` tags and losing inline notes.
3. **Ghost Highlights:** Sometimes deleted highlights persist in the HTML even after being removed from the data model.

## Proposed Solution: MutationObserver & Controlled Editing

We need to treat the `contenteditable` area as a "view" that renders the underlying data model, rather than the source of truth.

### Step 1: Implement `updateReviewSegment` Function
Create a dedicated function to update segments in the Review/Edit view, separate from the Recording view logic.

```javascript
/**
 * Updates a segment's DOM element in the Review View
 * @param {HTMLElement} el - The segment element (or review-row)
 * @param {Object} segment - The segment data object
 */
function updateReviewSegment(el, segment) {
    const textSpan = el.querySelector('[contenteditable]');
    if (!textSpan) return;

    // 1. Reconstruct HTML from Text + Highlights
    let html = '';
    let lastIndex = 0;
    // Sort highlights by start position
    const sortedHighlights = (segment.highlights || []).sort((a, b) => a.start - b.start);

    sortedHighlights.forEach(h => {
        // Add text before highlight
        if (h.start > lastIndex) {
            html += escapeHtml(segment.text.substring(lastIndex, h.start));
        }
        // Add highlighted text
        const chunk = segment.text.substring(h.start, h.end);
        html += `<mark class="word-highlight" data-segment-id="${segment.id}" data-highlight-start="${h.start}" data-note="${escapeHtml(h.note || '')}">${escapeHtml(chunk)}</mark>`;
        lastIndex = h.end;
    });

    // Add remaining text
    if (lastIndex < segment.text.length) {
        html += escapeHtml(segment.text.substring(lastIndex));
    }

    // 2. Safely update DOM (preserving cursor if possible)
    // Note: To preserve cursor, we'd need more complex logic, but for now specific updates > broken layout
    textSpan.innerHTML = html;
}
```

### Step 2: Intercept Deletion & Merging
Add a `keydown` listener to the contenteditable areas to handle Backspace/Delete keys specifically when they would cause a merge.

```javascript
document.addEventListener('keydown', (e) => {
    if (!e.target.isContentEditable) return;
    
    // Handle merging lines
    if (e.key === 'Backspace') {
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            
            // If cursor is at start of line
            if (range.startOffset === 0 && range.collapsed) {
                // Prevent browser default merge (which strips tags)
                e.preventDefault();
                
                // Identify current and previous segments
                const currentSegmentEl = e.target.closest('[data-segment-id]');
                const prevSegmentEl = currentSegmentEl.previousElementSibling;
                
                if (prevSegmentEl) {
                    mergeSegments(prevSegmentEl.dataset.segmentId, currentSegmentEl.dataset.segmentId);
                }
            }
        }
    }
});
```

### Step 3: Implement `mergeSegments` Method
We need a logic function to merge two segments' data (text AND highlights) correctly.

```javascript
function mergeSegments(prevId, currId) {
    const prevSeg = transcriptSegments.find(s => s.id === prevId);
    const currSeg = transcriptSegments.find(s => s.id === currId);
    
    if (!prevSeg || !currSeg) return;
    
    const originalPrevLength = prevSeg.text.length;
    
    // 1. Append text
    // Add a space if needed
    const separator = (prevSeg.text.endsWith(' ') || currSeg.text.startsWith(' ')) ? '' : ' ';
    prevSeg.text += separator + currSeg.text;
    
    // 2. Shift and merge highlights
    const offset = originalPrevLength + separator.length;
    const shiftedHighlights = (currSeg.highlights || []).map(h => ({
        ...h,
        start: h.start + offset,
        end: h.end + offset
    }));
    
    prevSeg.highlights = [...(prevSeg.highlights || []), ...shiftedHighlights];
    
    // 3. Remove current segment
    transcriptSegments = transcriptSegments.filter(s => s.id !== currId);
    
    // 4. Re-render UI
    // Full re-render of the list might be safest, or remove current DOM and update prev DOM
    const currEl = document.querySelector(`[data-segment-id="${currId}"]`);
    if (currEl) currEl.remove();
    
    const prevEl = document.querySelector(`[data-segment-id="${prevId}"]`);
    if (prevEl) updateReviewSegment(prevEl, prevSeg);
    
    // 5. Update Backend
    saveTranscript();
}
```

## Immediate Next Steps
1. Add the `updateReviewSegment` function to `script.js`.
2. Update the `deleteInlineNote` function to call `updateReviewSegment` instead of trying to patch the specific highlight span.
3. Add the `keydown` listener to intercept merges.

This approach ensures "What You See Is What You Get" and prevents the browser from destroying our highlight metadata.
