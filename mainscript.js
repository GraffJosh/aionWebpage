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
import { escapeCSSSelector } from './ui_helpers.js';
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


// === Initialization ===
// Inside the initialization:
fetchGpxTree().then(async tree => {
  const sortedTree = await sortTreeByDate(tree);
  trackCheckboxesDiv.innerHTML = '';
  await createUIFromTree(sortedTree, trackCheckboxesDiv);

  await addBoatMarker(sortedTree);

  // === Select track from URL if provided ===
  const params = new URLSearchParams(window.location.search);

  // === Select tracks from ?tracks= ===
  const trackList = params.get('tracks');
  if (trackList) {
    const filenames = trackList.split(',').map(decodeURIComponent);
    filenames.forEach(filename => {
      const selector = `input[type="checkbox"][value="${CSS.escape(filename)}"]`;
      const checkbox = trackCheckboxesDiv.querySelector(selector);
      if (checkbox) {
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change'));
      } else {
        console.warn(`⚠️ Track not found: ${filename}`);
      }
    });
  }

  // === Select folders from ?folders= ===
  const folderList = params.get('folders');
  if (folderList) {
    const folderNames = folderList.split(',').map(decodeURIComponent);
    folderNames.forEach(folderName => {
      const folderHeader = [...trackCheckboxesDiv.querySelectorAll('.folder-header')]
        .find(el => el.querySelector('.folder-label')?.textContent.trim() === folderName);

      if (folderHeader) {
        const folderCheckbox = folderHeader.querySelector('input.folder-checkbox');
        if (folderCheckbox && !folderCheckbox.checked) {
          folderCheckbox.checked = true;
          folderCheckbox.dispatchEvent(new Event('change'));
        }

        // Expand the folder
        const sublist = folderHeader.nextElementSibling;
        if (sublist && sublist.classList.contains('sublist')) {
          sublist.classList.add('expanded');
          const toggleIcon = folderHeader.querySelector('.toggle-icon');
          if (toggleIcon) toggleIcon.textContent = '▾';
        }
      } else {
        console.warn(`⚠️ Folder not found: ${folderName}`);
      }
    });
  }

});