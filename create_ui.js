// create_ui.js
import { createCheckbox, formatDurationDistance } from './ui_helpers.js';
import { getGpxInfo } from './fetch_tree.js';

let isBulkUpdating = false;

async function getFolderStats(node, getGpxInfo) {
    let totalDuration = 0;
    let totalDistance = 0;

    // Sum this folder's files
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

    // Recurse into subfolders
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
    // Add GPX files UI with info bubbles
    if (tree.files) {
        for (const file of tree.files) {
            const checkboxWrapper = createCheckbox(file);

            // Create info bubble element
            const infoBubble = document.createElement('span');
            infoBubble.classList.add('info-bubble');
            infoBubble.textContent = 'Loading...';
            checkboxWrapper.appendChild(infoBubble);

            // Fetch and update duration and distance info asynchronously
            getGpxInfo(file).then(({durationSeconds, distanceMeters}) => {
                infoBubble.textContent = formatDurationDistance(durationSeconds, distanceMeters);
            }).catch(() => {
                infoBubble.textContent = 'Info unavailable';
            });

            container.appendChild(checkboxWrapper);
        }
    }

    // Add folders recursively (unchanged except recursive call to async function)
    if (tree.subfolders) {
        for (const folderName of Object.keys(tree.subfolders)) {
            const folderDiv = document.createElement('div');
            folderDiv.classList.add('folder');

            const folderHeader = document.createElement('div');
            folderHeader.classList.add('folder-header');
            
            
            // Create and insert info bubble for folder
            const folderInfo = document.createElement('span');
            folderInfo.className = 'info-bubble';
            folderInfo.textContent = 'Loading...';
            folderHeader.appendChild(folderInfo);
            
            // Fetch cumulative folder stats
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
                checkboxes.forEach(cb => {
                    cb.checked = folderCheckbox.checked;
                    cb.dispatchEvent(new Event('change'));
                });
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
