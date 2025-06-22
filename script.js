// This is JavaScript, similar to Python but for browsers

// Create a map centered at [latitude, longitude], with zoom level 13
var map = L.map('map').setView([39.9526, -75.1652], 13); // Philadelphia

// Add a tile layer (the actual map)
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors'
}).addTo(map);

// Add a marker
L.marker([39.9526, -75.1652]).addTo(map)
  .bindPopup('Hello from Leaflet + Raspberry Pi!')
  .openPopup();
