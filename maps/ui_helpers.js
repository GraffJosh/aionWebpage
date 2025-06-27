/**
 * ui_helpers.js
 * 
 * This module provides helper functions for UI components related to GPX track selection
 * and display. It includes utilities for creating track checkboxes and formatting
 * track statistics for display in the UI.
 * 
 * Features:
 * - Creates a checkbox UI element for a GPX track, with event handlers to add/remove the track from the map.
 * - Formats duration (seconds) and distance (meters) into a user-friendly string (hours, minutes, nautical miles).
 * 
 * Exports:
 *   - createCheckbox(filename): Returns a DOM element for a track checkbox and label.
 *   - formatDurationDistance(durationSeconds, distanceMeters): Returns a formatted string for stats.
 * 
 * Dependencies:
 *   - map.js (for addTrackToMap, removeTrackFromMap)
 * 
 * Usage:
 *   Import and use these helpers when rendering track lists and displaying track statistics.
 */
import { addTrackToMap, removeTrackFromMap } from './map.js';
// You will need to import or otherwise access trackCheckboxesDiv in updateUrlParams below
import { trackCheckboxesDiv } from './constants.js'; 
import {isBulkUpdating} from './create_ui.js';
export function updateUrlParams() {
  const params = new URLSearchParams(window.location.search);

  if (isBulkUpdating) {
    // Bulk update: update folders param only
    const checkedFolders = [...trackCheckboxesDiv.querySelectorAll('input.folder-checkbox:checked')]
      .map(cb => {
        const folderLabel = cb.parentElement.querySelector('.folder-label');
        return folderLabel ? folderLabel.textContent.trim() : null;
      })
      .filter(Boolean);

    if (checkedFolders.length > 0) {
      const encodedFolders = checkedFolders.map(encodeURIComponent).join(',');
      params.set('folders', encodedFolders);
    } else {
      params.delete('folders');
    }

    // Remove tracks param because during bulk updating, track params get out of sync
    params.delete('tracks');

  } else {
    // Normal update: update tracks param only
    const checkedTracks = [...trackCheckboxesDiv.querySelectorAll('input[type="checkbox"]:not(.folder-checkbox):checked')]
      .map(cb => cb.value);

    if (checkedTracks.length > 0) {
      const encodedTracks = checkedTracks.map(encodeURIComponent).join(',');
      params.set('tracks', encodedTracks);
    } else {
      params.delete('tracks');
    }

    // Remove folders param because during single track selection, folder param can be misleading
    params.delete('folders');
  }

  const newUrl = `${window.location.pathname}?${params.toString()}`;
  history.replaceState(null, '', newUrl);
}


function createCheckbox(filename) {
  const id = `track-${filename.replace(/[^\w-]/g, '_')}`;

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.value = filename;
  checkbox.id = id;

  const label = document.createElement('label');
  label.setAttribute('for', id);
  label.textContent = ' ' + filename.split('/').pop();

  const wrapper = document.createElement('div');
  wrapper.classList.add('track-item');
  wrapper.appendChild(checkbox);
  wrapper.appendChild(label);

  checkbox.addEventListener('change', (e) => {
    if (e.target.checked) {
      addTrackToMap(filename);
    } else {
      removeTrackFromMap(filename);
    }
    updateUrlParams();
  });

  return wrapper;
}

export function escapeCSSSelector(value) {
  return CSS.escape ? CSS.escape(value) : value.replace(/[^\w-]/g, '\\$&');
}

/**
 * Format duration (seconds) and distance (meters) into a user-friendly string.
 * Example: "Duration: 1h 12m, Distance: 10.3 km"
 */
export function formatDurationDistance(durationSeconds, distanceMeters) {
    const hours = Math.floor(durationSeconds / 3600);
    const minutes = Math.floor((durationSeconds % 3600) / 60);
    const distanceNauticalMiles = distanceMeters * 0.000539957;
    const timeStr = `${hours}h ${minutes}m`;
    const distStr = `${distanceNauticalMiles.toFixed(1)} nm`;
    return `${timeStr} • ${distStr}`;
}


export { createCheckbox };
