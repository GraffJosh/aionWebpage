/**
 * map.js
 *
 * This module initializes the Leaflet map and provides functions to add and remove GPX tracks,
 * manage their display, and handle map view fitting and track coloring.
 */

import { fallbackView, loadedTracks } from './constants.js';
import { getGpxInfo, findEndPoint, findMostRecentTrack, fetchGpxText } from './fetch_tree.js';
import { formatDurationDistance } from './ui_helpers.js';

const map = L.map('map').setView(fallbackView.center, fallbackView.zoom);
let boatMarker = null;

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: 'Map data © OpenStreetMap contributors'
}).addTo(map);

L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', {
    attribution: 'Map data © openseamap contributors'
}).addTo(map);

const fileColorMap = {};
const COLORS = [
    '#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231',
    '#911eb4', '#46f0f0', '#f032e6', '#bcf60c', '#fabebe',
    '#008080', '#e6beff', '#9a6324', '#fffac8', '#800000',
    '#aaffc3', '#808000', '#ffd8b1', '#000075', '#808080'
];
let colorIndex = 0;

const HOVER_DISTANCE_PX = 18;
const HOVER_GRID_SIZE_PX = 30;
const COMPACT_METADATA_ROW_LIMIT = 4;
const METADATA_DESCRIPTOR_KEYS = new Set([
    'value', 'val', 'reading', 'data', 'amount',
    'unit', 'units', 'uom', 'type', 'datatype', 'dataType'
]);

const trackPointMetadata = new Map();
let pointMetadataTooltip = null;
let pendingHoverEvent = null;
let hoverAnimationFrameId = null;
let lastHoveredPoint = null;
let metadataDisplayMode = 'compact';
let metadataModeButton = null;

createMetadataModeControl();

map.on('mousemove', queueHoverMetadataUpdate);
map.on('mouseout', hidePointMetadataTooltip);
map.on('zoomstart', hidePointMetadataTooltip);

async function addTrackToMap(filename) {
    const gpxLayer = new L.GPX(filename, {
        async: true,
        marker_options: { startIconUrl: null, endIconUrl: null }
    });

    gpxLayer.on('loaded', async () => {
        const subtracks = gpxLayer.getLayers();
        if (!subtracks.length) {
            console.warn('No subtracks found in GPX layer for', filename);
            return;
        }

        let trackInfo = null;
        try {
            trackInfo = await getGpxInfo(filename);
        } catch (error) {
            console.error('Failed to parse GPX summary for', filename, error);
        }

        for (let i = 0; i < subtracks.length; i++) {
            const subLayer = subtracks[i];
            const trackId = `${filename}::trk${i}`;
            colorTrackByFile(subLayer, trackId);

            const markerPoint = findEndPoint(subLayer);
            if (markerPoint && trackInfo) {
                const summary = formatDurationDistance(trackInfo.durationSeconds, trackInfo.distanceMeters);
                const infoIcon = L.divIcon({
                    className: 'track-info-label',
                    html: summary,
                    iconSize: null
                });

                const label = L.marker(markerPoint, { icon: infoIcon, interactive: false });
                label.addTo(map);
                subLayer._infoLabel = label;
            }

            subLayer.addTo(map);
        }

        loadedTracks[filename] = gpxLayer;
        fitMapToAllTracks();
        void cacheTrackPointMetadata(filename);
    });

    gpxLayer.addTo(map);
}

function removeTrackFromMap(filename) {
    const gpxLayer = loadedTracks[filename];
    if (!gpxLayer) {
        console.warn('Track not found in loadedTracks:', filename);
        return;
    }

    const childLayers = gpxLayer.getLayers();
    if (childLayers && childLayers.length) {
        childLayers.forEach(layer => {
            if (layer._infoLabel && map.hasLayer(layer._infoLabel)) {
                map.removeLayer(layer._infoLabel);
            }
            if (map.hasLayer(layer)) {
                map.removeLayer(layer);
            }
        });
    }

    if (map.hasLayer(gpxLayer)) {
        map.removeLayer(gpxLayer);
    }

    delete loadedTracks[filename];
    trackPointMetadata.delete(filename);
    hidePointMetadataTooltip();
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
    if (layers.length === 0) {
        return;
    }

    let combinedBounds = null;
    layers.forEach(layer => {
        const bounds = layer.getBounds();
        combinedBounds = combinedBounds ? combinedBounds.extend(bounds) : bounds;
    });

    if (!combinedBounds) {
        return;
    }

    map.fitBounds(combinedBounds, {
        padding: [20, 20],
        animate: true
    });

    const minZoom = 15;
    setTimeout(() => {
        const currentZoom = map.getZoom();
        if (currentZoom > minZoom) {
            map.setZoom(minZoom);
        }
    }, 250);
}

function generateNextColor() {
    const color = COLORS[colorIndex % COLORS.length];
    colorIndex += 1;
    return color;
}

function colorTrackByFile(trackLayer, id) {
    if (!fileColorMap[id]) {
        fileColorMap[id] = generateNextColor();
    }

    const color = fileColorMap[id];
    trackLayer.eachLayer(layer => {
        if (layer.setStyle) {
            layer.setStyle({ color });
        }
    });
}

async function cacheTrackPointMetadata(filename) {
    try {
        const gpxText = await fetchGpxText(filename);
        if (!loadedTracks[filename]) {
            return;
        }

        const points = parseTrackPointsWithMetadata(gpxText);
        if (!points.length) {
            trackPointMetadata.delete(filename);
            return;
        }

        trackPointMetadata.set(filename, {
            points,
            indexZoom: null,
            spatialIndex: null
        });
    } catch (error) {
        console.warn('Unable to cache point metadata for', filename, error);
        trackPointMetadata.delete(filename);
    }
}

function parseTrackPointsWithMetadata(gpxText) {
    const parser = new DOMParser();
    const xml = parser.parseFromString(gpxText, 'application/xml');

    if (xml.querySelector('parsererror')) {
        return [];
    }

    const trkpts = xml.querySelectorAll('trkpt');
    const points = [];

    trkpts.forEach(trkpt => {
        const lat = Number.parseFloat(trkpt.getAttribute('lat'));
        const lon = Number.parseFloat(trkpt.getAttribute('lon'));
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
            return;
        }

        const metadata = extractMetadataObject(trkpt);
        if (!metadata) {
            return;
        }

        const metadataEntries = normalizeMetadataEntries(metadata);
        if (!metadataEntries.length) {
            return;
        }

        const elevationRaw = getChildText(trkpt, 'ele');
        const elevation = Number.parseFloat(elevationRaw);

        points.push({
            latlng: L.latLng(lat, lon),
            time: getChildText(trkpt, 'time'),
            elevation: Number.isFinite(elevation) ? elevation : null,
            metadataEntries
        });
    });

    return points;
}

function getChildText(parent, childName) {
    for (const child of parent.children) {
        const nodeName = (child.localName || child.tagName || '').toLowerCase();
        if (nodeName === childName) {
            return (child.textContent || '').trim();
        }
    }
    return '';
}

function extractMetadataObject(trackPointNode) {
    const candidates = [];

    for (const child of trackPointNode.children) {
        const nodeName = (child.localName || child.tagName || '').toLowerCase();
        const text = (child.textContent || '').trim();
        if (!text) {
            continue;
        }

        if (nodeName === 'desc' || nodeName === 'cmt') {
            candidates.push(text);
        } else if (nodeName === 'extensions') {
            collectJsonCandidates(child, candidates);
        }
    }

    for (const candidate of candidates) {
        const parsed = tryParseMetadataJson(candidate);
        if (parsed && typeof parsed === 'object') {
            return parsed;
        }
    }

    return null;
}

function collectJsonCandidates(rootNode, targetList) {
    for (const node of rootNode.querySelectorAll('*')) {
        const text = (node.textContent || '').trim();
        if (!text || (!looksLikeJson(text) && !text.includes('{') && !text.includes('['))) {
            continue;
        }
        targetList.push(text);
    }
}

function looksLikeJson(value) {
    const text = value.trim();
    return text.startsWith('{') || text.startsWith('[');
}

function tryParseMetadataJson(value) {
    const text = value.trim();
    if (!text) {
        return null;
    }

    if (looksLikeJson(text)) {
        try {
            return JSON.parse(text);
        } catch (_) {
            // continue to fallback parsing
        }
    }

    const objectStart = text.indexOf('{');
    const objectEnd = text.lastIndexOf('}');
    if (objectStart >= 0 && objectEnd > objectStart) {
        try {
            return JSON.parse(text.slice(objectStart, objectEnd + 1));
        } catch (_) {
            // ignore
        }
    }

    const arrayStart = text.indexOf('[');
    const arrayEnd = text.lastIndexOf(']');
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
        try {
            return JSON.parse(text.slice(arrayStart, arrayEnd + 1));
        } catch (_) {
            // ignore
        }
    }

    return null;
}

function normalizeMetadataEntries(metadata) {
    const entries = [];

    if (Array.isArray(metadata)) {
        metadata.forEach((value, index) => {
            appendMetadataEntries(entries, `entry_${index + 1}`, value);
        });
        return entries;
    }

    if (metadata && typeof metadata === 'object') {
        Object.entries(metadata).forEach(([key, value]) => {
            appendMetadataEntries(entries, key, value);
        });
        return entries;
    }

    appendNormalizedMetadata(entries, 'value', metadata, '', inferValueType(metadata));
    return entries;
}

function appendMetadataEntries(entries, keyPath, value) {
    if (value === undefined || value === null) {
        return;
    }

    if (Array.isArray(value)) {
        value.forEach((item, index) => {
            appendMetadataEntries(entries, `${keyPath}[${index + 1}]`, item);
        });
        return;
    }

    if (typeof value === 'object') {
        const metricValue = firstDefined(value.value, value.val, value.reading, value.data, value.amount);
        const metricUnit = firstDefined(value.unit, value.units, value.uom);
        const metricType = firstDefined(value.type, value.dataType, value.datatype);

        if (metricValue !== undefined || metricUnit !== undefined || metricType !== undefined) {
            appendNormalizedMetadata(
                entries,
                keyPath,
                metricValue !== undefined ? metricValue : '-',
                metricUnit || '',
                metricType || (metricValue !== undefined ? inferValueType(metricValue) : '')
            );

            Object.entries(value).forEach(([nestedKey, nestedValue]) => {
                if (!METADATA_DESCRIPTOR_KEYS.has(nestedKey)) {
                    appendMetadataEntries(entries, `${keyPath}.${nestedKey}`, nestedValue);
                }
            });
            return;
        }

        Object.entries(value).forEach(([nestedKey, nestedValue]) => {
            appendMetadataEntries(entries, `${keyPath}.${nestedKey}`, nestedValue);
        });
        return;
    }

    appendNormalizedMetadata(entries, keyPath, value, '', inferValueType(value));
}

function appendNormalizedMetadata(entries, label, value, unit, type) {
    if (value === undefined || value === null) {
        return;
    }

    entries.push({
        label: prettyLabel(label),
        value,
        unit,
        type
    });
}

function prettyLabel(label) {
    const cleaned = label
        .replace(/\[(\d+)\]/g, ' $1')
        .split('.')
        .map(part => part
            .replace(/[_-]+/g, ' ')
            .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
            .trim())
        .filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1));

    return cleaned.join(' / ');
}

function inferValueType(value) {
    if (value === null) {
        return 'null';
    }
    if (Array.isArray(value)) {
        return 'array';
    }
    return typeof value;
}

function firstDefined(...values) {
    for (const value of values) {
        if (value !== undefined && value !== null && value !== '') {
            return value;
        }
    }
    return undefined;
}

function queueHoverMetadataUpdate(event) {
    pendingHoverEvent = event;

    if (hoverAnimationFrameId !== null) {
        return;
    }

    hoverAnimationFrameId = window.requestAnimationFrame(() => {
        hoverAnimationFrameId = null;
        if (pendingHoverEvent) {
            updateHoverMetadataTooltip(pendingHoverEvent);
        }
    });
}

function updateHoverMetadataTooltip(event) {
    if (!trackPointMetadata.size) {
        hidePointMetadataTooltip();
        return;
    }

    const zoom = map.getZoom();
    const thresholdSq = HOVER_DISTANCE_PX * HOVER_DISTANCE_PX;
    const cursorProjected = map.project(event.latlng, zoom);

    let closestPoint = null;
    let closestDistanceSq = thresholdSq;

    for (const [filename, metadata] of trackPointMetadata.entries()) {
        if (!loadedTracks[filename]) {
            continue;
        }

        const index = ensureSpatialIndex(metadata, zoom);
        const cursorCellX = Math.floor(cursorProjected.x / HOVER_GRID_SIZE_PX);
        const cursorCellY = Math.floor(cursorProjected.y / HOVER_GRID_SIZE_PX);

        for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
            for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
                const key = `${cursorCellX + xOffset}:${cursorCellY + yOffset}`;
                const candidates = index.get(key);
                if (!candidates) {
                    continue;
                }

                for (const candidate of candidates) {
                    const dx = candidate.projected.x - cursorProjected.x;
                    const dy = candidate.projected.y - cursorProjected.y;
                    const distanceSq = (dx * dx) + (dy * dy);
                    if (distanceSq < closestDistanceSq) {
                        closestDistanceSq = distanceSq;
                        closestPoint = candidate.point;
                    }
                }
            }
        }
    }

    if (!closestPoint) {
        hidePointMetadataTooltip();
        return;
    }

    showPointMetadataTooltip(closestPoint);
}

function ensureSpatialIndex(metadata, zoom) {
    if (metadata.indexZoom === zoom && metadata.spatialIndex) {
        return metadata.spatialIndex;
    }

    const spatialIndex = new Map();
    metadata.points.forEach(point => {
        const projected = map.project(point.latlng, zoom);
        const cellX = Math.floor(projected.x / HOVER_GRID_SIZE_PX);
        const cellY = Math.floor(projected.y / HOVER_GRID_SIZE_PX);
        const key = `${cellX}:${cellY}`;

        if (!spatialIndex.has(key)) {
            spatialIndex.set(key, []);
        }

        spatialIndex.get(key).push({ point, projected });
    });

    metadata.indexZoom = zoom;
    metadata.spatialIndex = spatialIndex;
    return spatialIndex;
}

function getPointMetadataTooltip() {
    if (!pointMetadataTooltip) {
        pointMetadataTooltip = L.tooltip({
            permanent: false,
            direction: 'top',
            offset: [0, -8],
            opacity: 0.98,
            className: 'point-metadata-tooltip'
        });
    }

    return pointMetadataTooltip;
}

function showPointMetadataTooltip(point) {
    lastHoveredPoint = point;
    const tooltip = getPointMetadataTooltip();
    const content = buildPointMetadataContent(point);

    tooltip.setLatLng(point.latlng);
    tooltip.setContent(content);

    if (!map.hasLayer(tooltip)) {
        tooltip.addTo(map);
    }
}

function hidePointMetadataTooltip() {
    pendingHoverEvent = null;
    lastHoveredPoint = null;
    if (pointMetadataTooltip && map.hasLayer(pointMetadataTooltip)) {
        map.removeLayer(pointMetadataTooltip);
    }
}

function buildPointMetadataContent(point) {
    const container = document.createElement('div');
    container.className = 'point-metadata-tooltip-content';

    const title = document.createElement('div');
    title.className = 'point-metadata-title';
    title.textContent = formatPointTime(point.time) || 'Point Details';
    container.appendChild(title);

    const mode = document.createElement('div');
    mode.className = 'point-metadata-mode';
    mode.textContent = metadataDisplayMode === 'compact' ? 'Mode: Compact' : 'Mode: Expanded';
    container.appendChild(mode);

    if (point.elevation !== null) {
        const elevation = document.createElement('div');
        elevation.className = 'point-metadata-subtitle';
        elevation.textContent = `Elevation: ${formatMetadataValue(point.elevation)} m`;
        container.appendChild(elevation);
    }

    const visibleEntries = metadataDisplayMode === 'compact'
        ? point.metadataEntries.slice(0, COMPACT_METADATA_ROW_LIMIT)
        : point.metadataEntries;

    visibleEntries.forEach(entry => {
        const row = document.createElement('div');
        row.className = 'point-metadata-row';

        const label = document.createElement('span');
        label.className = 'point-metadata-label';
        label.textContent = entry.label;

        const value = document.createElement('span');
        value.className = 'point-metadata-value';
        const unit = entry.unit ? ` ${entry.unit}` : '';
        value.textContent = `${formatMetadataValue(entry.value)}${unit}`;

        const type = document.createElement('span');
        type.className = 'point-metadata-type';
        type.textContent = entry.type || '';

        row.append(label, value, type);
        container.appendChild(row);
    });

    if (metadataDisplayMode === 'compact' && point.metadataEntries.length > COMPACT_METADATA_ROW_LIMIT) {
        const more = document.createElement('div');
        more.className = 'point-metadata-more';
        more.textContent = `Showing ${COMPACT_METADATA_ROW_LIMIT} of ${point.metadataEntries.length} metrics`;
        container.appendChild(more);
    }

    return container;
}

function formatPointTime(timestamp) {
    if (!timestamp) {
        return '';
    }

    const date = new Date(timestamp);
    if (!Number.isFinite(date.getTime())) {
        return timestamp;
    }

    return date.toLocaleString();
}

function formatMetadataValue(value) {
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            return String(value);
        }
        return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
    }

    if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
    }

    if (value && typeof value === 'object') {
        return JSON.stringify(value);
    }

    return String(value);
}

function createMetadataModeControl() {
    const MetadataModeControl = L.Control.extend({
        options: { position: 'topright' },
        onAdd: () => {
            const container = L.DomUtil.create('div', 'leaflet-bar metadata-mode-control');
            const button = L.DomUtil.create('button', 'metadata-mode-button', container);
            button.type = 'button';
            button.title = 'Toggle metadata tooltip detail';
            metadataModeButton = button;
            updateMetadataModeButton();

            L.DomEvent.disableClickPropagation(container);
            L.DomEvent.disableScrollPropagation(container);
            L.DomEvent.on(button, 'click', () => {
                metadataDisplayMode = metadataDisplayMode === 'compact' ? 'expanded' : 'compact';
                updateMetadataModeButton();
                rerenderMetadataTooltip();
            });

            return container;
        }
    });

    map.addControl(new MetadataModeControl());
}

function updateMetadataModeButton() {
    if (!metadataModeButton) {
        return;
    }

    metadataModeButton.textContent = metadataDisplayMode === 'compact'
        ? 'Metadata: Compact'
        : 'Metadata: Expanded';
}

function rerenderMetadataTooltip() {
    if (!lastHoveredPoint) {
        return;
    }

    const tooltip = getPointMetadataTooltip();
    tooltip.setContent(buildPointMetadataContent(lastHoveredPoint));
    if (!map.hasLayer(tooltip)) {
        tooltip.addTo(map);
    }
}

export async function addBoatMarker(tree) {
    const mostRecent = await findMostRecentTrack(tree);
    if (!mostRecent) {
        console.warn('No most recent track found. Aborting boat marker.');
        return;
    }

    const gpxText = await fetchGpxText(mostRecent);
    if (!gpxText) {
        console.warn(`Failed to fetch GPX text for ${mostRecent}`);
        return;
    }

    const parser = new DOMParser();
    const xml = parser.parseFromString(gpxText, 'application/xml');
    const trkpts = xml.querySelectorAll('trkpt');
    if (trkpts.length === 0) {
        console.warn('No <trkpt> elements found in GPX. Cannot place boat marker.');
        return;
    }

    const lastPt = trkpts[trkpts.length - 1];
    const lat = parseFloat(lastPt.getAttribute('lat'));
    const lon = parseFloat(lastPt.getAttribute('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return;
    }

    const boatIcon = L.divIcon({
        className: 'material-boat-icon',
        html: '<span class="material-symbols-outlined" style="font-size:45px; color:crimson;">sailing</span>',
        iconSize: [45, 45],
        iconAnchor: [16, 16]
    });

    if (boatMarker) {
        map.removeLayer(boatMarker);
    }

    boatMarker = L.marker([lat, lon], {
        icon: boatIcon,
        interactive: false
    }).addTo(map);

    fallbackView.center = [lat, lon];
    boatMarker.setZIndexOffset(1000);
}

export { addTrackToMap, removeTrackFromMap };
