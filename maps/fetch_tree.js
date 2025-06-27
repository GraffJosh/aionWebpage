import {
  GITHUB_USER,
  GITHUB_REPO,
  GITHUB_BRANCH,
  GPX_DIRECTORY,
  WEBPAGE_ROOT_DIRECTORY
} from './constants.js';

// --- New helper ---
export function getLocalGpxPath(githubPath) {
  if (githubPath.startsWith(WEBPAGE_ROOT_DIRECTORY + '/')) {
    return githubPath.slice(WEBPAGE_ROOT_DIRECTORY.length + 1); // +1 for slash
  }
  return githubPath;
}

export async function fetchGpxTree() {
  try {
    const url = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/git/trees/${GITHUB_BRANCH}?recursive=1`;
    const response = await fetch(url);
    const data = await response.json();
    if (!data.tree) return {};

    const root = {
      name: GPX_DIRECTORY,
      files: [],
      subfolders: {}
    };

    data.tree.forEach(item => {
      const prefix = WEBPAGE_ROOT_DIRECTORY + '/' + GPX_DIRECTORY + '/';
      if (item.path.startsWith(prefix) && item.path.endsWith('.gpx')) {
        const localPath = item.path.slice(WEBPAGE_ROOT_DIRECTORY.length + 1); // strip "maps/"
        const relativePath = localPath.slice(GPX_DIRECTORY.length + 1); // strip "gpxFiles/"
        const parts = relativePath.split('/');
        insertPath(root, parts, localPath); // push local path
      }
    });

    return root;
  } catch (error) {
    console.error('Error fetching GPX tree:', error);
    return {};
  }
}

function insertPath(node, parts, fullPath) {
  if (parts.length === 1) {
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

export async function fetchGpxText(gpxPath) {
  const rawUrl = `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${WEBPAGE_ROOT_DIRECTORY}/${gpxPath}`;
  const res = await fetch(rawUrl);
  return await res.text();
}

export async function getGpxFirstDate(gpxPath) {
  try {
    const text = await fetchGpxText(gpxPath);
    const match = text.match(/<time>([^<]+)<\/time>/);
    if (match) return new Date(match[1]);
  } catch (_) {}
  return new Date(0);
}

export function parseGpxInfo(gpxText) {
  const timeMatches = [...gpxText.matchAll(/<time>([^<]+)<\/time>/g)].map(m => new Date(m[1]));
  if (timeMatches.length < 2) return { durationSeconds: 0, distanceMeters: 0 };

  const durationSeconds = (timeMatches.at(-1) - timeMatches[0]) / 1000;

  const coordMatches = [...gpxText.matchAll(/<trkpt lat="([^"]+)" lon="([^"]+)"/g)];
  if (coordMatches.length < 2) return { durationSeconds, distanceMeters: 0 };

  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = x => x * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  let distanceMeters = 0;
  for (let i = 1; i < coordMatches.length; i++) {
    const [_, lat1, lon1] = coordMatches[i - 1];
    const [__, lat2, lon2] = coordMatches[i];
    distanceMeters += haversine(+lat1, +lon1, +lat2, +lon2);
  }

  return { durationSeconds, distanceMeters };
}

export async function getGpxInfo(gpxPath) {
  const text = await fetchGpxText(gpxPath);
  return parseGpxInfo(text);
}

export async function sortTreeByDate(node) {
  const filesWithDates = await Promise.all(
    node.files.map(async (file) => ({
      file,
      date: await getGpxFirstDate(file)
    }))
  );
  filesWithDates.sort((a, b) => b.date - a.date);
  node.files = filesWithDates.map(f => f.file);

  const folderEntries = Object.entries(node.subfolders);
  for (const [_, folderNode] of folderEntries) {
    await sortTreeByDate(folderNode);
  }

  const foldersWithDates = await Promise.all(
    folderEntries.map(async ([name, folderNode]) => {
      const track = await findMostRecentTrack(folderNode);
      const date = track ? await getGpxFirstDate(track) : new Date(0);
      return { name, node: folderNode, date };
    })
  );

  foldersWithDates.sort((a, b) => b.date - a.date);
  node.subfolders = {};
  foldersWithDates.forEach(f => {
    node.subfolders[f.name] = f.node;
  });

  return node;
}

export async function findMostRecentTrack(node) {
  let mostRecent = null;
  let mostRecentDate = new Date(0);

  for (const file of node.files) {
    const date = await getGpxFirstDate(file);
    if (date > mostRecentDate) {
      mostRecentDate = date;
      mostRecent = file;
    }
  }

  for (const folderNode of Object.values(node.subfolders)) {
    const recent = await findMostRecentTrack(folderNode);
    if (recent) {
      const date = await getGpxFirstDate(recent);
      if (date > mostRecentDate) {
        mostRecentDate = date;
        mostRecent = recent;
      }
    }
  }

  return mostRecent;
}

export function findStartPoint(layer) {
  if (layer instanceof L.Polyline) {
    const latlngs = layer.getLatLngs();
    return Array.isArray(latlngs[0]) ? latlngs[0][0] : latlngs[0];
  } else if (layer instanceof L.LayerGroup) {
    for (const sub of Object.values(layer._layers)) {
      const point = findStartPoint(sub);
      if (point) return point;
    }
  }
  return null;
}

export function findEndPoint(layer) {
  if (layer instanceof L.Polyline) {
    const latlngs = layer.getLatLngs();
    if (Array.isArray(latlngs[0])) {
      const last = latlngs.at(-1);
      return last.at(-1);
    } else {
      return latlngs.at(-1);
    }
  } else if (layer instanceof L.LayerGroup) {
    let lastPoint = null;
    for (const sub of Object.values(layer._layers)) {
      const point = findEndPoint(sub);
      if (point) lastPoint = point;
    }
    return lastPoint;
  }
  return null;
}
