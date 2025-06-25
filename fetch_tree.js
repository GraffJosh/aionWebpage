// fetch_tree.js

import {
  GITHUB_USER,
  GITHUB_REPO,
  GITHUB_BRANCH,
  GPX_DIRECTORY
} from './constants.js';

/**
 * Fetch the GitHub repo tree recursively and build a nested directory tree
 * structure with GPX files organized by folders up to any depth.
 */
export async function fetchGpxTree() {
  const url = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/git/trees/${GITHUB_BRANCH}?recursive=1`;
  const response = await fetch(url);
  const data = await response.json();
  if (!data.tree) return {};

  // Build nested tree structure { name, files: [], subfolders: {} }
  const root = {
    name: GPX_DIRECTORY,
    files: [],
    subfolders: {}
  };

  data.tree.forEach(item => {
    if (item.path.startsWith(GPX_DIRECTORY + '/') && item.path.endsWith('.gpx')) {
      const relativePath = item.path.slice(GPX_DIRECTORY.length + 1); // strip gpxFiles/
      const parts = relativePath.split('/');
      insertPath(root, parts, item.path);
    }
  });

  return root;
}

/**
 * Recursive helper to insert file path into nested tree structure.
 * parts: array of path segments, e.g. ['folder1', 'subfolder', 'file.gpx']
 * fullPath: full path including GPX_DIRECTORY
 */
function insertPath(node, parts, fullPath) {
  if (parts.length === 1) {
    // It's a file in this folder
    node.files.push(fullPath);
  } else {
    const folderName = parts[0];
    if (!node.subfolders[folderName]) {
      node.subfolders[folderName] = {
        name: folderName,
        files: [],
        subfolders: {}
      };
    }
    insertPath(node.subfolders[folderName], parts.slice(1), fullPath);
  }
}

/**
 * Fetch raw GPX file text from GitHub repo.
 * @param {string} gpxPath - path to GPX file in repo
 * @returns {Promise<string>}
 */
export async function fetchGpxText(gpxPath) {
  const rawUrl = `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${gpxPath}`;
  const res = await fetch(rawUrl);
  return await res.text();
}

/**
 * Fetch the first <time> date from a GPX file (returns a Date object).
 * Returns new Date(0) if no valid date found.
 */
export async function getGpxFirstDate(gpxPath) {
  try {
    const text = await fetchGpxText(gpxPath);
    const match = text.match(/<time>([^<]+)<\/time>/);
    if (match) return new Date(match[1]);
  } catch (e) {
    // Fail silently and return fallback date
  }
  return new Date(0);
}

/**
 * Parse GPX text to extract duration (in seconds) and distance (in meters).
 * Simple parsing approach using <time> and <trkpt> with lat/lon.
 * 
 * @param {string} gpxText 
 * @returns {{durationSeconds: number, distanceMeters: number}}
 */
export function parseGpxInfo(gpxText) {
  // Extract <time> tags - ISO strings
  const timeMatches = [...gpxText.matchAll(/<time>([^<]+)<\/time>/g)].map(m => new Date(m[1]));
  if (timeMatches.length < 2) return { durationSeconds: 0, distanceMeters: 0 };

  // Duration: difference between last and first timestamps
  const durationSeconds = (timeMatches[timeMatches.length - 1] - timeMatches[0]) / 1000;

  // Extract lat/lon of track points
  const coordMatches = [...gpxText.matchAll(/<trkpt lat="([^"]+)" lon="([^"]+)"/g)];
  if (coordMatches.length < 2) return { durationSeconds, distanceMeters: 0 };

  // Helper to compute distance between two lat/lon points in meters (Haversine formula)
  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth radius in meters
    const toRad = x => x * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  let distanceMeters = 0;
  for (let i = 1; i < coordMatches.length; i++) {
    const [_, lat1, lon1] = coordMatches[i-1];
    const [__, lat2, lon2] = coordMatches[i];
    distanceMeters += haversine(parseFloat(lat1), parseFloat(lon1), parseFloat(lat2), parseFloat(lon2));
  }

  return { durationSeconds, distanceMeters };
}

/**
 * Get duration and distance info for a GPX file path.
 * Fetches and parses the GPX file.
 * @param {string} gpxPath 
 * @returns {Promise<{durationSeconds: number, distanceMeters: number}>}
 */
export async function getGpxInfo(gpxPath) {
  const text = await fetchGpxText(gpxPath);
  return parseGpxInfo(text);
}

/**
 * Recursively sort the tree's files and subfolders by date of tracks.
 * Files sorted by GPX first date ascending.
 * Folders sorted by date of their most recent track descending (newest first).
 */
export async function sortTreeByDate(node) {
  // Sort files by date
  const filesWithDates = await Promise.all(
    node.files.map(async (file) => ({
      file,
      date: await getGpxFirstDate(file)
    }))
  );
  filesWithDates.sort((a, b) => a.date - b.date);
  node.files = filesWithDates.map(f => f.file);

  // Recursively sort subfolders
  const folderEntries = Object.entries(node.subfolders);
  for (const [folderName, folderNode] of folderEntries) {
    await sortTreeByDate(folderNode);
  }

  // Sort folders by most recent track date descending
  const foldersWithDates = await Promise.all(
    folderEntries.map(async ([name, folderNode]) => {
      const track = await findMostRecentTrack(folderNode);
      const date = track ? await getGpxFirstDate(track) : new Date(0);
      return { name, node: folderNode, date };
    })
  );

  foldersWithDates.sort((a, b) => b.date - a.date);

  // Rebuild subfolders object in sorted order
  node.subfolders = {};
  foldersWithDates.forEach(f => {
    node.subfolders[f.name] = f.node;
  });

  return node;
}

/**
 * Recursively find the most recent track in the tree (by GPX <time> tag).
 * Returns the file path of the most recent track, or null if none.
 */
export async function findMostRecentTrack(node) {
  let mostRecent = null;
  let mostRecentDate = new Date(0);

  // Check files
  for (const file of node.files) {
    const date = await getGpxFirstDate(file);
    if (date > mostRecentDate) {
      mostRecentDate = date;
      mostRecent = file;
    }
  }

  // Check subfolders recursively
  for (const folderNode of Object.values(node.subfolders)) {
    const recentInSub = await findMostRecentTrack(folderNode);
    if (recentInSub) {
      const date = await getGpxFirstDate(recentInSub);
      if (date > mostRecentDate) {
        mostRecentDate = date;
        mostRecent = recentInSub;
      }
    }
  }

  return mostRecent;
}
export function findStartPoint(layer) {
    if (layer instanceof L.Polyline) {
        const latlngs = layer.getLatLngs();
        if (latlngs.length > 0) {
            // Handle multi-part polylines
            return Array.isArray(latlngs[0]) ? latlngs[0][0] : latlngs[0];
        }
    } else if (layer instanceof L.LayerGroup) {
        for (const sublayer of Object.values(layer._layers)) {
            const point = findStartPoint(sublayer);
            if (point) return point;
        }
    }
    return null;
}