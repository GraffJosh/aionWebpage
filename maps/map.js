/**
 * map.js
 * 
 * This module initializes the Leaflet map and provides functions to add and remove GPX tracks,
 * manage their display, and handle map view fitting and track coloring.
 * 
 * Features:
 * - Initializes the Leaflet map with OpenStreetMap and OpenSeaMap layers.
 * - Adds GPX tracks to the map with color-coding and info labels (duration, distance).
 * - Removes tracks and associated info labels from the map.
 * - Fits the map view to all loaded tracks.
 * - Assigns consistent colors to tracks based on filename.
 * 
 * Exports:
 *   - addTrackToMap(filename): Loads and displays a GPX track on the map.
 *   - removeTrackFromMap(filename): Removes a GPX track and its info label from the map.
 *   - addBoatMarker(tree): Adds a marker for the most recent boat position based on the latest GPX track.
 * 
 * Dependencies:
 *   - constants.js (for color palette, fallback view, loadedTracks)
 *   - fetch_tree.js (for getGpxInfo, findStartPoint)
 *   - ui_helpers.js (for formatDurationDistance)
 *   - Leaflet and leaflet-gpx
 * 
 * Usage:
 *   Import and use addTrackToMap and removeTrackFromMap to control GPX track display on the map.
 * */

import { GPX_DIRECTORY, globalColorMap, globalColorPalette, globalColorIndex, fallbackView, loadedTracks } from './constants.js';
import { getGpxInfo, findStartPoint, findEndPoint, findMostRecentTrack, fetchGpxText} from './fetch_tree.js';
import { formatDurationDistance } from './ui_helpers.js';
let boatMarker = null;
const map = L.map('map').setView(fallbackView.center, fallbackView.zoom);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: 'Map data © OpenStreetMap contributors'
}).addTo(map);
L.tileLayer('http://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', {
    attribution: 'Map data © openseamap contributors'
}).addTo(map);
console.log('L.GPX:', L.GPX);

async function addTrackToMap(filename) {
    const gpxLayer = new L.GPX(filename, {
        async: true,
        marker_options: { startIconUrl: null, endIconUrl: null }
    });

    gpxLayer.on('loaded', async () => {
        const subtracks = gpxLayer.getLayers(); // Each <trk> is a layer now

        if (!subtracks.length) {
            console.warn('No subtracks found in GPX layer for', filename);
            return;
        }

        // Color and label each subtrack individually
        for (let i = 0; i < subtracks.length; i++) {
            const subLayer = subtracks[i];
            const trackId = `${filename}::trk${i}`; // Unique ID for coloring & tracking
            colorTrackByFile(subLayer, trackId);

            try {
                const info = await getGpxInfo(filename, i); // support index for per-trk
                const summary = formatDurationDistance(info.durationSeconds, info.distanceMeters);
                const markerPoint = findEndPoint(subLayer);

                if (markerPoint) {
                    const infoIcon = L.divIcon({
                        className: 'track-info-label',
                        html: summary,
                        iconSize: null
                    });

                    const label = L.marker(markerPoint, { icon: infoIcon, interactive: false });
                    label.addTo(map);

                    // Attach label to this subLayer so we can remove it later
                    subLayer._infoLabel = label;
                } else {
                    console.warn('No end point found for subtrack:', trackId);
                }
            } catch (e) {
                console.error('Failed to get label for subtrack', trackId, e);
            }

            // Add subtrack to map
            subLayer.addTo(map);
        }

        loadedTracks[filename] = gpxLayer;
        fitMapToAllTracks();
    });

    gpxLayer.addTo(map); // still needed to kick off the loading process
}


function removeTrackFromMap(filename) {
    const gpxLayer = loadedTracks[filename];
    if (!gpxLayer) {
        console.warn('Track not found in loadedTracks:', filename);
        return;
    }

    // Remove info label
    if (gpxLayer._infoLabel) {
        map.removeLayer(gpxLayer._infoLabel);
    }

    // Remove all child layers explicitly
    const childLayers = gpxLayer.getLayers();
    if (childLayers && childLayers.length) {
        childLayers.forEach(layer => {
            if (map.hasLayer(layer)) {
                map.removeLayer(layer);
            }
        });
    }

    // Remove parent gpxLayer if needed
    if (map.hasLayer(gpxLayer)) {
        map.removeLayer(gpxLayer);
    }

    delete loadedTracks[filename];
    fitMapToAllTracks();

    if (Object.keys(loadedTracks).length === 0) {
        map.setView(fallbackView.center, fallbackView.zoom);
    }
}

export function resetViewToFallback() {
    if (Object.keys(loadedTracks).length === 0) {
        map.setView(fallbackView.center, fallbackView.zoom);
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
  
  console.log('Fitting bounds:', combinedBounds);
    if (combinedBounds) {
        // Fit normally, animate it
        map.fitBounds(combinedBounds, {
            padding: [20, 20],
            animate: true
        });

        const currentZoom = map.getZoom();
        console.log('Zoom after fitBounds:', currentZoom);

        const minZoom = 15
        
        setTimeout(() => {
            const currentZoom = map.getZoom();
            if (currentZoom > minZoom) {
                map.setZoom(minZoom);
            }
        }, 250);
    }
}



const fileColorMap = {};
const COLORS = [
  '#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231',
  '#911eb4', '#46f0f0', '#f032e6', '#bcf60c', '#fabebe',
  '#008080', '#e6beff', '#9a6324', '#fffac8', '#800000',
  '#aaffc3', '#808000', '#ffd8b1', '#000075', '#808080'
];
let colorIndex = 0;
function generateNextColor() {
  const color = COLORS[colorIndex % COLORS.length];
  colorIndex++;
  return color;
}

function colorTrackByFile(trackLayer, id) {
    if (!fileColorMap[id]) {
        fileColorMap[id] = generateNextColor();
    }
    const color = fileColorMap[id];

    // Apply color to each polyline in the layer
    trackLayer.eachLayer(layer => {
        if (layer.setStyle) {
            layer.setStyle({ color });
        }
    });
}


export async function addBoatMarker(tree) {
  console.log('🔄 Starting addBoatMarker...');

  const mostRecent = await findMostRecentTrack(tree);
  if (!mostRecent) {
    console.warn('⚠️ No most recent track found. Aborting boat marker.');
    return;
  }

  console.log(`📍 Most recent track path: ${mostRecent}`);

  const gpxText = await fetchGpxText(mostRecent);
  if (!gpxText) {
    console.warn(`⚠️ Failed to fetch GPX text for ${mostRecent}`);
    return;
  }

  console.log('📄 GPX text successfully fetched. Parsing XML...');

  const parser = new DOMParser();
  const xml = parser.parseFromString(gpxText, 'application/xml');
  const trkpts = xml.querySelectorAll('trkpt');
  console.log(`🛰️ Found ${trkpts.length} track points in GPX file.`);

  if (trkpts.length === 0) {
    console.warn('⚠️ No <trkpt> elements found in GPX. Cannot place boat marker.');
    return;
  }

  const lastPt = trkpts[trkpts.length - 1];
  const lat = parseFloat(lastPt.getAttribute('lat'));
  const lon = parseFloat(lastPt.getAttribute('lon'));

  console.log(`🧭 Last point coordinates: lat=${lat}, lon=${lon}`);

    const boatIcon = L.divIcon({
        className: 'material-boat-icon',
        html: '<span class="material-symbols-outlined" style="font-size:45px; color:crimson;">sailing</span>',
        iconSize: [45,45],
        iconAnchor: [16, 16],
    });

  if (boatMarker) {
    console.log('🗑️ Removing existing boat marker...');
    map.removeLayer(boatMarker);
  }

  boatMarker = L.marker([lat, lon], {
    icon: boatIcon,
    interactive: false
  }).addTo(map);
  fallbackView.center = [lat, lon];

  boatMarker.setZIndexOffset(1000);

  console.log(`✅ Boat marker added at [${lat}, ${lon}] using icon URL: ${boatIcon.options.iconUrl}`);
}


export { addTrackToMap, removeTrackFromMap };
