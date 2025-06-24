// ui_helpers.js
import { addTrackToMap, removeTrackFromMap } from './map.js';


function createCheckbox(filename) {
  const id = `track-${filename.replace(/[^\w-]/g, '_')}`;

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.value = filename; // <-- Make sure this is full path e.g. 'folder1/track.gpx'
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
  });

  return wrapper;
}


/**
 * Format duration (seconds) and distance (meters) into a user-friendly string.
 * Example: "Duration: 1h 12m, Distance: 10.3 km"
 */
function formatDurationDistance(durationSeconds, distanceMeters) {
    const hours = Math.floor(durationSeconds / 3600);
    const minutes = Math.floor((durationSeconds % 3600) / 60);

    let durationStr = '';
    if (hours > 0) durationStr += `${hours}h `;
    durationStr += `${minutes}m`;

    // Convert meters to kilometers with one decimal place
    const distanceKm = (distanceMeters / 1000).toFixed(1);

    return `Duration: ${durationStr}, Distance: ${distanceKm} km`;
}

export { createCheckbox, formatDurationDistance };
