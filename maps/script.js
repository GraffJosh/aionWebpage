// === 2. Globals ===
const trackListDiv = document.getElementById('trackList');
const trackCheckboxesDiv = document.getElementById('trackCheckboxes');
const loadedTracks = {};
const globalColorMap = {};
const globalColorPalette = ['red', 'blue', 'green', 'orange', 'purple', 'teal', 'brown', 'pink', 'gray'];
const globalColorIndex = { value: 0 };
const fallbackView = {
    center: [39.279545, -76.584707],
    zoom: 13
};

const GITHUB_USER = 'graffjosh';
const GITHUB_REPO = 'aionWebpage';
const GITHUB_BRANCH = 'main';
const GPX_DIRECTORY = 'gpxFiles';

// 1. Set up the Leaflet map
const map = L.map('map').setView(fallbackView.center, fallbackView.zoom);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: 'Map data © OpenStreetMap contributors'
}).addTo(map);
L.tileLayer('http://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', {
    attribution: 'Map data © openseamap contributors'
}).addTo(map);

// === Fetch files and build a nested tree structure ===
async function fetchGpxTree() {
    const url = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/git/trees/${GITHUB_BRANCH}?recursive=1`;
    const response = await fetch(url);
    const data = await response.json();
    if (!data.tree) return {};

    const root = {};
    const dateCache = {};

    async function getDate(path) {
        if (dateCache[path]) return dateCache[path];
        const rawUrl = `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${path}`;
        try {
            const res = await fetch(rawUrl);
            const text = await res.text();
            const match = text.match(/<time>([^<]+)<\/time>/);
            if (match) {
                const d = new Date(match[1]);
                dateCache[path] = d;
                return d;
            }
        } catch {}
        const d = new Date(0);
        dateCache[path] = d;
        return d;
    }

    for (const item of data.tree) {
        if (!item.path.startsWith(GPX_DIRECTORY + '/') || !item.path.endsWith('.gpx')) continue;
        const relativePath = item.path.slice(GPX_DIRECTORY.length + 1);
        const parts = relativePath.split('/');
        let current = root;
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (i === parts.length - 1) {
                if (!current._files) current._files = [];
                current._files.push(item.path);
            } else {
                if (!current[part]) current[part] = {};
                current = current[part];
            }
        }
    }

    async function sortTreeByDate(node) {
        if (node._files) {
            const filesWithDates = await Promise.all(node._files.map(async f => ({ f, d: await getDate(f) })));
            filesWithDates.sort((a, b) => a.d - b.d);
            node._files = filesWithDates.map(x => x.f);
        }

        const children = Object.entries(node).filter(([k]) => k !== '_files');
        await Promise.all(children.map(async ([k, child]) => await sortTreeByDate(child)));

        children.sort(async ([aKey, a], [bKey, b]) => {
            const aDate = await getDate((a._files && a._files[0]) || '');
            const bDate = await getDate((b._files && b._files[0]) || '');
            return aDate - bDate;
        });

        const sorted = {};
        for (const [k, child] of children) sorted[k] = child;
        if (node._files) sorted._files = node._files;
        Object.keys(node).forEach(k => delete node[k]);
        Object.assign(node, sorted);
    }

    await sortTreeByDate(root);
    return root;
}

let isBulkUpdatingFolders = false;
function createUIFromTree(tree, container, depth = 0) {
    if (tree._files) {
        tree._files.forEach(file => {
            const checkboxWrapper = createCheckbox(file);
            container.appendChild(checkboxWrapper);
        });
    }
    for (const key in tree) {
        if (key === '_files') continue;
        const folderDiv = document.createElement('div');
        folderDiv.classList.add('folder');

        const folderHeader = document.createElement('div');
        folderHeader.classList.add('folder-header');

        const toggleIcon = document.createElement('span');
        toggleIcon.textContent = '▸';
        toggleIcon.className = 'toggle-icon';

        const folderLabel = document.createElement('span');
        folderLabel.textContent = key;
        folderLabel.className = 'folder-label';

        const folderCheckbox = document.createElement('input');
        folderCheckbox.type = 'checkbox';
        folderCheckbox.className = 'folder-checkbox';
        folderCheckbox.title = 'Toggle all tracks in this folder';

        folderHeader.append(toggleIcon, folderLabel, folderCheckbox);
        folderDiv.appendChild(folderHeader);

        const subList = document.createElement('div');
        subList.className = 'sublist';
        folderDiv.appendChild(subList);

        const checkboxes = [];
        const observer = new MutationObserver(() => {
            folderCheckbox.checked = checkboxes.some(cb => cb.checked);
        });
        observer.observe(subList, { childList: true, subtree: true });

        folderCheckbox.addEventListener('change', () => {
            isBulkUpdatingFolders = true;
            checkboxes.forEach(cb => {
                if (cb.checked !== folderCheckbox.checked) {
                    cb.checked = folderCheckbox.checked;
                    cb.dispatchEvent(new Event('change'));
                }
            });
            isBulkUpdatingFolders = false;
        });

        folderHeader.addEventListener('click', (e) => {
            if (e.target === folderCheckbox) return;
            const isExpanded = subList.classList.toggle('expanded');
            toggleIcon.textContent = isExpanded ? '▾' : '▸';
        });

        container.appendChild(folderDiv);
        createUIFromTree(tree[key], subList, depth + 1);
        const childCBs = subList.querySelectorAll('input[type="checkbox"]');
        childCBs.forEach(cb => checkboxes.push(cb));
    }
}

function createCheckbox(filename, autoLoad = false) {
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
        const isChecked = e.target.checked;
        isChecked ? addTrackToMap(filename) : removeTrackFromMap(filename);

        if (window.innerWidth < 600) {
            trackListDiv.classList.add('hidden');
        }
    });

    if (autoLoad) {
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change'));
    }

    return wrapper;
}

// === Track display ===
function addTrackToMap(filename) {
    const gpxLayer = new L.GPX(filename, {
        async: true,
        marker_options: { startIconUrl: null, endIconUrl: null }
    });

    gpxLayer.on('loaded', () => {
        fitMapToAllTracks();
        colorTrackByFile(gpxLayer, filename, globalColorMap, globalColorPalette, globalColorIndex);
    });

    gpxLayer.addTo(map);
    loadedTracks[filename] = gpxLayer;
}

function removeTrackFromMap(filename) {
    if (loadedTracks[filename]) {
        map.removeLayer(loadedTracks[filename]);
        delete loadedTracks[filename];
        fitMapToAllTracks();

        if (Object.keys(loadedTracks).length === 0) {
            map.setView(fallbackView.center, fallbackView.zoom);
        }
    }
}

function fitMapToAllTracks() {
    const layers = Object.values(loadedTracks);
    if (layers.length === 0) return;

    let combinedBounds = null;

    layers.forEach(layer => {
        const bounds = layer.getBounds();
        if (!combinedBounds) {
            combinedBounds = bounds;
        } else {
            combinedBounds.extend(bounds);
        }
    });

    if (combinedBounds) {
        map.fitBounds(combinedBounds, { padding: [20, 20] });
    }
}

function colorTrackByFile(gpxLayer, filename, colorMap, palette, colorIndex) {
    const colorKey = filename.split('/').pop();

    if (!colorMap[colorKey]) {
        colorMap[colorKey] = palette[colorIndex.value % palette.length];
        colorIndex.value++;
    }

    const color = colorMap[colorKey];
    const gpxElement = gpxLayer.getLayers()[0];
    if (!gpxElement) return;

    gpxElement.eachLayer(layer => {
        if (layer.setStyle) {
            layer.setStyle({ color: color, weight: 4 });
        }
    });
}

// Initialize and load
fetchGpxTree().then(tree => {
    trackCheckboxesDiv.innerHTML = '';
    createUIFromTree(tree, trackCheckboxesDiv);

    const allInputs = trackCheckboxesDiv.querySelectorAll('input[type="checkbox"]');
    const lastCheckbox = [...allInputs].filter(cb => cb.value.endsWith('.gpx')).sort((a, b) => b.value.localeCompare(a.value))[0];
    if (lastCheckbox) {
        lastCheckbox.checked = true;
        lastCheckbox.dispatchEvent(new Event('change'));
    }
});

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
