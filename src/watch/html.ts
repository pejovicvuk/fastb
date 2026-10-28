export const watchHtml = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>fastb lanes</title>
<style>
:root { color-scheme: dark; font: 15px/1.5 system-ui, sans-serif; background: #10131a; color: #e8edf5; }
* { box-sizing: border-box; }
body { margin: 0; padding: 24px; }
header { display: flex; justify-content: space-between; gap: 16px; align-items: baseline; margin-bottom: 20px; }
h1 { margin: 0; font-size: 22px; } #connection { color: #a9b4c5; font-size: 13px; }
#grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr)); gap: 18px; }
.tile { overflow: hidden; min-width: 0; background: #1b2130; border: 1px solid #333e50; border-radius: 10px; }
.picture { position: relative; aspect-ratio: 8 / 5; background: #080b11; display: grid; place-items: center; }
.picture span { color: #a9b4c5; } .picture img { display: block; width: 100%; height: 100%; object-fit: contain; position: absolute; }
[hidden] { display: none !important; }
.details { padding: 12px 14px; } .label { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
h2 { font-size: 16px; margin: 0; overflow-wrap: anywhere; }
.badge { font-size: 12px; padding: 2px 9px; border-radius: 12px; background: #485366; color: white; flex-shrink: 0; }
.badge[data-state=running] { background: #225cbd; } .badge[data-state=ok] { background: #23733e; }
.badge[data-state=stopped] { background: #b42c3b; } .badge[data-state=idle] { background: #485366; }
.step { min-height: 1.5em; margin: 8px 0 0; color: #bfcadd; overflow-wrap: anywhere; white-space: pre-wrap; }
#empty { color: #a9b4c5; }
@media (max-width: 480px) { body { padding: 12px; } }
</style>
</head>
<body>
<header><h1>fastb lanes</h1><span id="connection" role="status">Connecting…</span></header>
<main><p id="empty">No lanes yet.</p><div id="grid"></div></main>
<script>
const grid = document.getElementById('grid');
const empty = document.getElementById('empty');
const connection = document.getElementById('connection');
const tiles = new Map();
const events = new EventSource('events'); // relative: the page lives under its secret path
events.onopen = () => { connection.textContent = 'Live'; };
events.onerror = () => { connection.textContent = 'Reconnecting…'; };
events.addEventListener('lanes', (event) => {
  const lanes = JSON.parse(event.data);
  const names = new Set(lanes.map(lane => lane.name));
  for (const [name, tile] of tiles) {
    if (!names.has(name)) { tile.root.remove(); tiles.delete(name); }
  }
  for (const lane of lanes) {
    let tile = tiles.get(lane.name);
    if (!tile) {
      const root = document.createElement('article');
      root.className = 'tile';
      root.innerHTML = '<div class="picture"><span>Waiting for picture…</span><img hidden></div><div class="details"><div class="label"><h2></h2><span class="badge"></span></div><p class="step"></p></div>';
      tile = { root, image: root.querySelector('img'), name: root.querySelector('h2'), badge: root.querySelector('.badge'), step: root.querySelector('.step') };
      tile.name.textContent = lane.name;
      tile.image.alt = 'Live view of ' + lane.name;
      tiles.set(lane.name, tile);
      grid.append(root);
    }
    tile.badge.textContent = lane.state;
    tile.badge.dataset.state = lane.state;
    tile.step.textContent = lane.step || '';
  }
  empty.hidden = lanes.length !== 0;
});
events.addEventListener('frame', (event) => {
  const frame = JSON.parse(event.data);
  const tile = tiles.get(frame.lane);
  if (tile) {
    tile.image.src = 'data:image/jpeg;base64,' + frame.jpegBase64;
    tile.image.hidden = false;
  }
});
</script>
</body>
</html>`;
