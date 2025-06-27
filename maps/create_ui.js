/**
 * create_ui.js
 * 
 * This module provides functions to recursively generate the UI for displaying 
 * a tree of GPX files and folders, including checkboxes for selection and 
 * info bubbles for track/folder statistics (duration and distance).
 */

import { createCheckbox, formatDurationDistance, updateUrlParams } from './ui_helpers.js';
import { getGpxInfo, getLocalGpxPath } from './fetch_tree.js';

let isBulkUpdating = false;
export { isBulkUpdating };

async function getFolderStats(node, getGpxInfo) {
    let totalDuration = 0;
    let totalDistance = 0;

    if (node.files) {
        for (const file of node.files) {
            try {
                const { durationSeconds, distanceMeters } = await getGpxInfo(file);
                totalDuration += durationSeconds;
                totalDistance += distanceMeters;
            } catch (e) {
                // ignore file if it fails
            }
        }
    }

    if (node.subfolders) {
        for (const sub of Object.values(node.subfolders)) {
            const stats = await getFolderStats(sub, getGpxInfo);
            totalDuration += stats.totalDuration;
            totalDistance += stats.totalDistance;
        }
    }

    return { totalDuration, totalDistance };
}

async function createUIFromTree(tree, container, depth = 0) {
    if (tree.files) {
        for (const file of tree.files) {
            const localPath = getLocalGpxPath(file);
            const checkboxWrapper = createCheckbox(localPath);

            const infoBubble = document.createElement('span');
            infoBubble.classList.add('info-bubble');
            infoBubble.textContent = 'Loading...';
            checkboxWrapper.appendChild(infoBubble);

            getGpxInfo(file).then(({ durationSeconds, distanceMeters }) => {
                infoBubble.textContent = formatDurationDistance(durationSeconds, distanceMeters);
            }).catch(() => {
                infoBubble.textContent = 'Info unavailable';
            });

            container.appendChild(checkboxWrapper);
        }
    }

    if (tree.subfolders) {
        for (const folderName of Object.keys(tree.subfolders)) {
            const folderDiv = document.createElement('div');
            folderDiv.classList.add('folder');

            const folderHeader = document.createElement('div');
            folderHeader.classList.add('folder-header');

            const folderInfo = document.createElement('span');
            folderInfo.className = 'info-bubble';
            folderInfo.textContent = 'Loading...';
            folderHeader.appendChild(folderInfo);

            getFolderStats(tree.subfolders[folderName], getGpxInfo).then(({ totalDuration, totalDistance }) => {
                folderInfo.textContent = formatDurationDistance(totalDuration, totalDistance);
            }).catch(() => {
                folderInfo.textContent = 'Info unavailable';
            });

            const toggleIcon = document.createElement('span');
            toggleIcon.textContent = '▸';
            toggleIcon.className = 'toggle-icon';

            const label = document.createElement('span');
            label.textContent = folderName;
            label.className = 'folder-label';

            const folderCheckbox = document.createElement('input');
            folderCheckbox.type = 'checkbox';
            folderCheckbox.className = 'folder-checkbox';

            folderHeader.append(toggleIcon, label, folderInfo, folderCheckbox);
            folderDiv.appendChild(folderHeader);

            const subList = document.createElement('div');
            subList.className = 'sublist';

            await createUIFromTree(tree.subfolders[folderName], subList, depth + 1);

            const checkboxes = subList.querySelectorAll('input[type="checkbox"]');
            folderCheckbox.addEventListener('change', () => {
                isBulkUpdating = true;
                try {
                    checkboxes.forEach(cb => {
                        cb.checked = folderCheckbox.checked;
                        cb.dispatchEvent(new Event('change'));
                    });
                } catch (e) {
                    console.error('Error updating checkboxes:', e);
                }
                updateUrlParams();
                isBulkUpdating = false;
            });

            checkboxes.forEach(cb => {
                cb.addEventListener('change', () => {
                    if (!isBulkUpdating) {
                        const anyChecked = [...checkboxes].some(cb => cb.checked);
                        folderCheckbox.checked = anyChecked;
                    }
                });
            });

            folderHeader.addEventListener('click', (e) => {
                if (e.target === folderCheckbox) return;
                const expanded = subList.classList.toggle('expanded');
                toggleIcon.textContent = expanded ? '▾' : '▸';
            });

            folderDiv.appendChild(subList);
            container.appendChild(folderDiv);
        }
    }
}

export { createUIFromTree };
