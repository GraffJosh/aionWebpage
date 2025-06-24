import { globalColorMap, globalColorPalette, globalColorIndex, fallbackView, loadedTracks } from './constants.js';

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

    gpxLayer.on('loaded', () => {
        fitMapToAllTracks();
        colorTrackByFile(gpxLayer, filename);
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
