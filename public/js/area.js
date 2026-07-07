// area.js: shared helper: maps an area name to its wayfinding color-slug.
// Loaded before any script that renders area chips (main.js, listing.js, admin.js, post.js).

// Escapes user-entered text before it's dropped into innerHTML, a hostel
// title or student name is free text typed by someone else, so it must
// never be trusted as raw HTML.
function escapeHTML(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function areaSlug(area) {
  if (!area) return '';
  const key = area.trim().toLowerCase();
  if (key.startsWith('fante')) return 'fante';
  if (key.startsWith('asafo')) return 'asafo';
  if (key.startsWith('amakom')) return 'amakom';
  return '';
}

function areaChipHTML(area) {
  const slug = areaSlug(area);
  return `<span class="area-chip area-${slug}">${area}</span>`;
}
