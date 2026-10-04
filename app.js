// Trip Fuel Cost — geocoding via Photon, routing via OSRM, map via Leaflet/OSM.

const PHOTON = 'https://photon.komoot.io';
const OSRM = 'https://router.project-osrm.org/route/v1/driving';

// Rough Dutch pump averages; the user overrides these with today's price.
const FUELS = {
  e10:    { price: 2.34, usage: 6.5, unit: 'L' },
  e98:    { price: 2.10, usage: 6.8, unit: 'L' },
  diesel: { price: 1.75, usage: 5.5, unit: 'L' },
  lpg:    { price: 0.85, usage: 8.5, unit: 'L' },
  ev:     { price: 0.35, usage: 17,  unit: 'kWh' },
};

const $ = (id) => document.getElementById(id);
const eur = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' });

const state = { from: null, to: null, bias: null };

// ---------- settings (persisted per device) ----------

function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem('tfc-settings') || '{}'); } catch {}
  const fuel = FUELS[s.fuel] ? s.fuel : 'e10';
  $('fuel').value = fuel;
  // Only a price the user typed themselves sticks; otherwise follow the current default.
  priceCustom = !!s.priceCustom;
  $('price').value = priceCustom ? s.price : FUELS[fuel].price;
  $('usage').value = s.usage ?? FUELS[fuel].usage;
  $('people').value = s.people ?? 1;
  $('roundtrip').checked = !!s.roundtrip;
  applyUnits();
}

let priceCustom = false;

function saveSettings() {
  const s = {
    fuel: $('fuel').value, price: +$('price').value, priceCustom, usage: +$('usage').value,
    people: Math.max(1, +$('people').value || 1), roundtrip: $('roundtrip').checked,
  };
  try { localStorage.setItem('tfc-settings', JSON.stringify(s)); } catch {}
  applyUnits();
}

function applyUnits() {
  const unit = FUELS[$('fuel').value].unit;
  $('price-label').textContent = `Price €/${unit}`;
  $('usage-label').textContent = `${unit} / 100 km`;
  $('settings-summary').textContent =
    `· ${eur.format(+$('price').value || 0)}/${unit} · ${$('usage').value || 0} ${unit}/100km`;
}

$('fuel').addEventListener('change', () => {
  const f = FUELS[$('fuel').value];
  $('price').value = f.price;
  $('usage').value = f.usage;
  priceCustom = false;
  saveSettings();
  if (!$('result').hidden) calculate();
});
$('price').addEventListener('input', () => { priceCustom = true; });
['price', 'usage', 'people', 'roundtrip'].forEach((id) =>
  $(id).addEventListener('change', () => { saveSettings(); if (!$('result').hidden) calculate(); }));
// Parking is per journey, so it isn't saved; just refresh the total as it's typed.
$('parking').addEventListener('input', () => { if (lastRoute) render(lastRoute, false); });

// ---------- place search with autocomplete ----------

function labelFor(p) {
  const name = p.name || [p.street, p.housenumber].filter(Boolean).join(' ');
  const street = p.name && p.street ? [p.street, p.housenumber].filter(Boolean).join(' ') : '';
  const area = [street, p.postcode, p.city || p.town || p.village, p.country]
    .filter((x) => x && x !== name).join(', ');
  return { name: name || p.city || p.country || 'Unnamed place', area };
}

function setupAutocomplete(key) {
  const input = $(key);
  const list = $(`${key}-list`);
  let timer, controller, items = [], active = -1;

  const close = () => { list.innerHTML = ''; items = []; active = -1; };

  const choose = (i) => {
    const it = items[i];
    if (!it) return;
    state[key] = it;
    input.value = it.label;
    close();
    if (key === 'from' && !state.to) $('to').focus();
  };

  input.addEventListener('input', () => {
    state[key] = null;
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 3) return close();
    timer = setTimeout(async () => {
      controller?.abort();
      controller = new AbortController();
      const url = new URL(`${PHOTON}/api/`);
      url.searchParams.set('q', q);
      url.searchParams.set('limit', '6');
      url.searchParams.set('lang', 'en');
      if (state.bias) { url.searchParams.set('lat', state.bias.lat); url.searchParams.set('lon', state.bias.lon); }
      try {
        const res = await fetch(url, { signal: controller.signal });
        const data = await res.json();
        items = data.features.map((f) => {
          const { name, area } = labelFor(f.properties);
          return { lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], name, area,
                   label: area ? `${name}, ${area.split(', ').slice(-2).join(', ')}` : name };
        });
        active = -1;
        list.innerHTML = items.map((it, i) =>
          `<li role="option" data-i="${i}">${esc(it.name)}<small>${esc(it.area)}</small></li>`).join('');
      } catch (e) { if (e.name !== 'AbortError') close(); }
    }, 250);
  });

  list.addEventListener('pointerdown', (e) => {
    const li = e.target.closest('li');
    if (li) { e.preventDefault(); choose(+li.dataset.i); }
  });

  input.addEventListener('keydown', (e) => {
    if (!items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      [...list.children].forEach((li, i) => li.setAttribute('aria-selected', i === active));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(active >= 0 ? active : 0);
    } else if (e.key === 'Escape') close();
  });

  input.addEventListener('blur', () => setTimeout(close, 150));
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- current location ----------

$('locate').addEventListener('click', () => {
  if (!navigator.geolocation) return showError('Location is not available on this device.');
  const btn = $('locate');
  btn.textContent = '…';
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const { latitude: lat, longitude: lon } = pos.coords;
    state.bias = { lat, lon };
    let label = 'My location';
    try {
      const res = await fetch(`${PHOTON}/reverse?lat=${lat}&lon=${lon}&lang=en`);
      const f = (await res.json()).features[0];
      if (f) {
        const p = f.properties;
        const city = p.city || p.town || p.village;
        label = `📍 ${labelFor(p).name}${city && city !== labelFor(p).name ? ', ' + city : ''}`;
      }
    } catch {}
    state.from = { lat, lon, label, name: 'My location' };
    $('from').value = label;
    btn.textContent = '📍 Me';
    hideError();
    if (!state.to) $('to').focus();
  }, (err) => {
    btn.textContent = '📍 Me';
    showError(err.code === 1 ? 'Location permission was denied. Type your start address instead.'
                             : 'Could not get your location. Type your start address instead.');
  }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
});

$('swap').addEventListener('click', () => {
  [state.from, state.to] = [state.to, state.from];
  [$('from').value, $('to').value] = [$('to').value, $('from').value];
  if (!$('result').hidden) calculate();
});

// ---------- route + cost ----------

let map, routeLayer, lastRoute;

async function calculate() {
  hideError();
  if (!state.from || !state.to) {
    return showError(!state.from ? 'Pick a start point from the suggestions (or tap 📍 Me).'
                                 : 'Pick a destination from the suggestions.');
  }
  const btn = $('go');
  btn.disabled = true;
  btn.textContent = 'Calculating…';
  try {
    const coords = `${state.from.lon},${state.from.lat};${state.to.lon},${state.to.lat}`;
    const res = await fetch(`${OSRM}/${coords}?overview=full&geometries=geojson`);
    const data = await res.json();
    if (data.code !== 'Ok' || !data.routes?.length) throw new Error('No driving route found between these places.');
    render(data.routes[0]);
  } catch (e) {
    showError(e.message.startsWith('No driving') ? e.message : 'Could not reach the routing service. Check your connection and try again.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Get journey price';
  }
}

function render(route, scroll = true) {
  lastRoute = route;
  const legs = $('roundtrip').checked ? 2 : 1;
  const km = (route.distance / 1000) * legs;
  const minutes = (route.duration / 60) * legs;
  const fuel = FUELS[$('fuel').value];
  const used = (km * (+$('usage').value || 0)) / 100;
  const cost = used * (+$('price').value || 0);
  const parking = Math.max(0, parseFloat(String($('parking').value).replace(',', '.')) || 0);
  const total = cost + parking;
  const people = Math.max(1, +$('people').value || 1);

  $('r-route').textContent = `${state.from.name} → ${state.to.name}${legs === 2 ? ' → back' : ''}`;
  $('r-cost').textContent = eur.format(total);
  $('r-breakdown').textContent = parking > 0
    ? `${fuel.unit === 'kWh' ? 'Charging' : 'Fuel'} ${eur.format(cost)} + parking ${eur.format(parking)}` : '';
  $('r-split').textContent = people > 1 ? `${eur.format(total / people)} each for ${people} people` : '';
  $('r-dist').textContent = `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
  $('r-time').textContent = minutes < 60 ? `${Math.round(minutes)} min`
    : `${Math.floor(minutes / 60)}h ${String(Math.round(minutes % 60)).padStart(2, '0')}`;
  $('r-fuel').textContent = `${used.toFixed(1)} ${fuel.unit}`;
  $('r-fuel-label').textContent = fuel.unit === 'kWh' ? 'energy' : 'fuel';
  $('result').hidden = false;

  if (!scroll) return;
  if (window.L) {
    if (!map) {
      map = L.map('map', { zoomControl: false, attributionControl: true });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '© OpenStreetMap',
      }).addTo(map);
    }
    routeLayer?.remove();
    routeLayer = L.layerGroup([
      L.geoJSON(route.geometry, { style: { color: '#0f766e', weight: 5, opacity: 0.85 } }),
      L.circleMarker([state.from.lat, state.from.lon], { radius: 7, color: '#0f766e', fillOpacity: 1 }),
      L.circleMarker([state.to.lat, state.to.lon], { radius: 7, color: '#b42318', fillOpacity: 1 }),
    ]).addTo(map);
    setTimeout(() => {
      map.invalidateSize();
      map.fitBounds(L.geoJSON(route.geometry).getBounds(), { padding: [24, 24] });
    }, 0);
  }
  $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- sharing ----------

const APP_URL = location.origin + location.pathname;
const placeParam = (p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)},${p.name}`;

async function share(title, text, url) {
  if (navigator.share) {
    try { await navigator.share({ title, text, url }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(url); toast('Link copied — paste it to your friends'); }
  catch { prompt('Copy this link:', url); }
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 2500);
}

$('share-app').addEventListener('click', () =>
  share('Trip Fuel Cost', 'Check what a car journey costs in fuel and parking:', APP_URL));

$('share-trip').addEventListener('click', () => {
  if (!state.from || !state.to) return;
  const q = new URLSearchParams({ from: placeParam(state.from), to: placeParam(state.to) });
  if ($('roundtrip').checked) q.set('rt', '1');
  if (+$('parking').value > 0) q.set('park', $('parking').value);
  share('Trip Fuel Cost', `${$('r-route').textContent}: ${$('r-cost').textContent}`, `${APP_URL}?${q}`);
});

// Open a shared journey link: ?from=lat,lon,name&to=lat,lon,name[&rt=1][&park=12.5]
function loadFromLink() {
  const q = new URLSearchParams(location.search);
  const parse = (v) => {
    const [lat, lon, ...name] = (v || '').split(',');
    if (isNaN(+lat) || isNaN(+lon) || lat === '' || lon === '') return null;
    const n = name.join(',') || 'Pinned place';
    return { lat: +lat, lon: +lon, name: n, label: n };
  };
  const from = parse(q.get('from')), to = parse(q.get('to'));
  if (!from || !to) return;
  state.from = from; state.to = to;
  $('from').value = from.label; $('to').value = to.label;
  if (q.has('rt')) $('roundtrip').checked = q.get('rt') === '1';
  if (q.has('park')) $('parking').value = q.get('park');
  calculate();
}

function showError(msg) { $('error').textContent = msg; $('error').hidden = false; }
function hideError() { $('error').hidden = true; }

$('trip').addEventListener('submit', (e) => { e.preventDefault(); calculate(); });

setupAutocomplete('from');
setupAutocomplete('to');
loadSettings();
loadFromLink();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
