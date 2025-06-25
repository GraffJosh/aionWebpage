/**
 * mainscript.js
 * 
 * This is the main entry point for the Aion's Track web application. It initializes
 * the UI, handles user interactions, and coordinates loading and displaying GPX tracks
 * on the map.
 * 
 * Features:
 * - Handles UI controls for selecting, clearing, and toggling the track list.
 * - Loads the GPX folder tree from GitHub, sorts it by date, and renders the UI.
 * - Adds/removes tracks on the map when checkboxes are toggled.
 * - Automatically selects and displays the most recent track on load.
 * 
 * Exports:
 *   (none; this is the main script and runs on page load)
 * 
 * Dependencies:
 *   - constants.js (for UI container elements)
 *   - fetch_tree.js (for fetching and sorting the GPX tree)
 *   - create_ui.js (for rendering the folder/file UI)
 *   - map.js (for adding/removing tracks on the map)
 * 
 * Usage:
 *   Included as a module in index.html. Runs automatically on page
 * */
import { trackListDiv, trackCheckboxesDiv } from './constants.js';
import { fetchGpxTree, sortTreeByDate, findMostRecentTrack } from './fetch_tree.js';
import { createUIFromTree } from './create_ui.js';
import { addTrackToMap, removeTrackFromMap, addBoatMarker, resetViewToFallback } from './map.js';

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

}

// === Initialization ===
// Inside the initialization:
fetchGpxTree().then(async tree => {
  const sortedTree = await sortTreeByDate(tree);
  trackCheckboxesDiv.innerHTML = '';
  await createUIFromTree(sortedTree, trackCheckboxesDiv);

  // addTrackCheckboxListeners();

  await addBoatMarker(sortedTree); // ← ✅ Always add on page load
  resetViewToFallback();
  // setInterval(() => {
  //   addBoatMarker(window.gpxTree);
  // }, 60_000);

  const mostRecentTrack = await findMostRecentTrack(sortedTree);
  if (mostRecentTrack) {
    const checkbox = trackCheckboxesDiv.querySelector(`input[value="${mostRecentTrack.path}"]`);
    if (checkbox) {
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));
    }
  }
});

