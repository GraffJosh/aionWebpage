import { globalColorMap, globalColorPalette, globalColorIndex, fallbackView, loadedTracks } from './constants.js';
import { getGpxInfo, findStartPoint} from './fetch_tree.js';
import { formatDurationDistance } from './ui_helpers.js';
const map = L.map('map').setView(fallbackView.center, fallbackView.zoom);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: 'Map data © OpenStreetMap contributors'
}).addTo(map);
L.tileLayer('http://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', {
    attribution: 'Map data © openseamap contributors'
}).addTo(map);
console.log('L.GPX:', L.GPX);


function addTrackToMap(filename) {
    console.log('Loading GPX file:', filename);  // Debug log

    // const rawGpxUrl = `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${filename}`;
    
    const gpxLayer = new L.GPX(filename, {
        async: true,
        marker_options: { startIconUrl: null, endIconUrl: null }
    });
    gpxLayer.on('loaded', async () => {
        fitMapToAllTracks();
        colorTrackByFile(gpxLayer, filename);

        try {
            const info = await getGpxInfo(filename);
            const summary = formatDurationDistance(info.durationSeconds, info.distanceMeters);
            console.log('Track info summary:', summary);

            const startPoint = findStartPoint(gpxLayer);

            if (startPoint) {
                const infoIcon = L.divIcon({
                    className: 'track-info-label',
                    html: summary,
                    iconSize: null
                });

                const label = L.marker(startPoint, { icon: infoIcon, interactive: false });
                label.addTo(map);
                gpxLayer._infoLabel = label;
                console.log('Added label at', startPoint);
            } else {
                console.warn('No start point found for:', filename);
            }
        } catch (e) {
            console.error('Failed to add label for', filename, e);
        }
    });

    gpxLayer.addTo(map);
    loadedTracks[filename] = gpxLayer;
}


function removeTrackFromMap(filename) {
    if (loadedTracks[filename]) {
        const layer = loadedTracks[filename];
        if (layer._infoLabel) {
            map.removeLayer(layer._infoLabel);
        }
        map.removeLayer(layer);
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
        combinedBounds = combinedBounds ? combinedBounds.extend(bounds) : bounds;
    });

    if (combinedBounds) {
        map.fitBounds(combinedBounds, { padding: [20, 20] });
    }
}

function colorTrackByFile(gpxLayer, filename) {
    const key = filename.split('/').pop();
    if (!globalColorMap[key]) {
        globalColorMap[key] = globalColorPalette[globalColorIndex.value % globalColorPalette.length];
        globalColorIndex.value++;
    }
    const color = globalColorMap[key];
    const gpxElement = gpxLayer.getLayers()[0];
    if (!gpxElement) return;

    gpxElement.eachLayer(layer => {
        if (layer.setStyle) {
            layer.setStyle({ color, weight: 4 });
        }
    });
}

export { addTrackToMap, removeTrackFromMap };
