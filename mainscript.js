// main.js

import { trackListDiv, trackCheckboxesDiv } from './constants.js';
import { fetchGpxTree, sortTreeByDate, findMostRecentTrack } from './fetch_tree.js';
import { createUIFromTree } from './create_ui.js';
import { addTrackToMap, removeTrackFromMap } from './map.js';

// === UI Controls ===
document.getElementById('selectAll').addEventListener('click', () => {
  const checkboxes = trackListDiv.querySelectorAll('input[type="checkbox"]');
  checkboxes.forEach(cb => {
    if (!cb.checked) {
      cb.checked = true;
      cb.dispatchEvent(new Event('change'));
    }
  });
});

document.getElementById('clearAll').addEventListener('click', () => {
  const checkboxes = trackListDiv.querySelectorAll('input[type="checkbox"]');
  checkboxes.forEach(cb => {
    if (cb.checked) {
      cb.checked = false;
      cb.dispatchEvent(new Event('change'));
    }
  });
});

document.getElementById('toggleTrackList').addEventListener('click', () => {
  trackListDiv.classList.toggle('hidden');
});

// Add event listeners to track checkboxes to add/remove tracks on the map
function addTrackCheckboxListeners() {
  const checkboxes = trackCheckboxesDiv.querySelectorAll('input[type="checkbox"]');
  checkboxes.forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) {
        addTrackToMap(cb.value);
      } else {
        removeTrackFromMap(cb.value);
      }
    });
  });
}

// === Initialization ===
fetchGpxTree().then(async tree => {
  // Sort the entire tree by GPX date (files ascending, folders descending)
  const sortedTree = await sortTreeByDate(tree);

  // Clear existing UI, then create UI from sorted tree
  trackCheckboxesDiv.innerHTML = '';
  createUIFromTree(sortedTree, trackCheckboxesDiv);

  // Add event listeners to checkboxes for map toggling
  addTrackCheckboxListeners();

  // Auto-select most recent track checkbox and trigger map add
  const mostRecentTrack = await findMostRecentTrack(sortedTree);
  if (mostRecentTrack) {
    const checkbox = trackCheckboxesDiv.querySelector(`input[value="${mostRecentTrack}"]`);
    if (checkbox) {
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));
    }
  }
});
