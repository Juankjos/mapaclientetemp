// ======================
// Utilidad de formato
// ======================
const fmt = {
  ymd: d => d.toISOString().slice(0,10),
  ymd_slash: d => fmt.ymd(d).replaceAll('-', '/'),
  toMX: (s) => { // 'YYYY-MM-DD hh:mm:ss' o 'YYYY-MM-DD'
    if (!s) return '—';
    const parts = s.replace('T',' ').split(' ');
    const d = parts[0]?.split('-') || [];
    const time = parts[1] || '';
    if (d.length === 3) return `${d[2]}/${d[1]}/${d[0]} ${time}`.trim();
    const s2 = s.replace(/\//g,'-');
    const d2 = s2.split(' ')[0]?.split('-');
    if (d2 && d2.length===3) return `${d2[2]}/${d2[1]}/${d2[0]} ${s2.split(' ')[1]||''}`.trim();
    return s;
  }
};

// ======================
// Mapa base (Esri / OSM)
// ======================
const map = L.map('map', {
  zoomControl: false,
  zoomSnap: 0.25,
  zoomDelta: 0.5,
  wheelDebounceTime: 25,
  wheelPxPerZoomLevel: 100,
  preferCanvas: true,
  maxZoom: 20,
  minZoom: 10
});
const center = [20.814, -102.76]; // Tepatitlán de Morelos, Jalisco
map.setView(center, 12);
// Ubicar controles de zoom en esquina inferior derecha para no chocar con el banner
L.control.zoom({ position: 'bottomright' }).addTo(map);
// Exponer el mapa para overlays modulares
window._leafletMap = map;

const esriImagery = L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 20, maxNativeZoom: 18, attribution: '&copy; Esri', crossOrigin: true,
  errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='
});

// Overlays opcionales (ej: límites/places de Esri)
const esriRef = L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 20, maxNativeZoom: 18, opacity: 0.75,
  errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='
});
// esriRef opcional en vista satelital; no se activa por defecto en modo claro

// Capas base adicionales
const baseLight = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; OpenStreetMap, &copy; CARTO', subdomains: 'abcd',
  detectRetina: true, updateWhenZooming: true,
  maxNativeZoom: 19, maxZoom: 22, noWrap: true, crossOrigin: true, keepBuffer: 4
}).addTo(map);
const baseDark  = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; OpenStreetMap, &copy; CARTO', subdomains: 'abcd',
  maxNativeZoom: 19, maxZoom: 22, noWrap: true, crossOrigin: true, keepBuffer: 4
});

// Overlay de transporte para engrosar y clarificar calles en alto zoom
const roadsOverlay = L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', {
  opacity: 0.45, maxNativeZoom: 19, maxZoom: 22, crossOrigin: true
}).addTo(map);

// Gestor de capa base
let currentBase = baseLight; // por defecto: mapa claro
function setBase(name){
  const target = ({ sat: esriImagery, light: baseLight, dark: baseDark })[name] || esriImagery;
  if (currentBase !== target){
    if (currentBase) currentBase.remove();
    target.addTo(map);
    currentBase = target;
    // (Opcional) activar referencia en satélite
    if (target === esriImagery){
      try { esriRef.addTo(map); } catch(e){}
    } else {
      try { esriRef.remove(); } catch(e){}
    }
  }
  document.querySelectorAll('.basemap-card')
    .forEach(c => c.classList.toggle('active', c.dataset.base === name));
}

// Eventos del widget (mini-switcher)
document.querySelectorAll('.basemap-card').forEach(card=>{
  card.addEventListener('click', ()=> setBase(card.dataset.base));
});

// ======================
// Capas
// ======================
const layerAll = L.layerGroup().addTo(map);     // capa principal
const layerCar = L.layerGroup().addTo(map);     // capa del coche

const COLOR = {
  pendiente: '#F59E0B', // amber acorde al tema
  ejecutada: '#0B8FFF'  // azul acento acorde al tema
};

const markers = []; // {marker, latlng:[lat,lon], estado:'pendientes'|'ejecutadas', data:report}

// ======================
// UI inicial
// ======================
const elInicio = document.getElementById('fechaInicio');
const elFin    = document.getElementById('fechaFin');
const elFiltro = document.getElementById('filtroEstado');
const elBtn    = document.getElementById('btnCargar');
const elHud    = document.getElementById('hud');
const elToast  = document.getElementById('toast');

// NUEVO: overlay de carga en mapa
const loadingMask = document.getElementById('loadingMask');
function showLoading(on){ if(loadingMask) loadingMask.classList.toggle('show', !!on); }

// Por defecto, últimos 2 días (zona MX)
(function setLast2Days(){
  if (!elInicio || !elFin) return;
  const tz = { timeZone: 'America/Mexico_City' };
  const fin = new Date(new Date().toLocaleString('en-US', tz));     // hoy MX
  const inicio = new Date(fin); inicio.setDate(inicio.getDate()-1); // ayer MX
  const ymdMX = d => d.toLocaleDateString('en-CA', tz);             // YYYY-MM-DD
  elInicio.value = ymdMX(inicio);
  elFin.value    = ymdMX(fin);
})();

function toast(msg, ms=1800){
  if (!elToast) return;
  elToast.innerText = msg; elToast.style.display='block';
  clearTimeout(toast._t); toast._t = setTimeout(()=> elToast.style.display='none', ms);
}

function resetLayers(){
  layerAll.clearLayers();
  markers.length = 0;
}

// ======================
// OFFCANVAS HELPERS
// ======================

// Rellena las pestañas del offcanvas y lo abre.
// Requiere Bootstrap 5 (bundle) cargado en la página.
window.openRightPanelTabs = function({ tituloPedido, porcentaje, comentario } = {}) {
  // Colocar textos en los elementos de las pestañas
  const tEl = document.getElementById('pedidoTitulo');
  const pEl = document.getElementById('satisPorcentaje');
  const cEl = document.getElementById('satisComentario');

  if (tEl) tEl.textContent = tituloPedido || '—';
  if (pEl) pEl.textContent = (porcentaje != null ? `${porcentaje}%` : '—');
  if (cEl) cEl.textContent = comentario || 'Detalles de Satisfacción';

  // Mostrar el offcanvas
  const panelEl = document.getElementById('sidePanel');
  if (!panelEl) { console.warn('sidePanel no encontrado'); return; }

  // Si Bootstrap no está, salimos silenciosamente
  if (!(window.bootstrap && bootstrap.Offcanvas && bootstrap.Tab)) {
    console.warn('Bootstrap no está cargado. Offcanvas no disponible.');
    return;
  }

  const off = bootstrap.Offcanvas.getOrCreateInstance(panelEl);
  off.show();

  // Activar siempre la primera pestaña al abrir
  const firstTabBtn = document.querySelector('#tab-pedido');
  if (firstTabBtn) new bootstrap.Tab(firstTabBtn).show();
};

// ======================
// Marcadores
// ======================
function markerFor(report){
  const estado = report.estado; // 'pendientes'|'ejecutadas'
  const lat = report.latitude, lon = report.longitude;
  const color = estado === 'pendientes' ? COLOR.pendiente : COLOR.ejecutada;

  const m = L.circleMarker([lat,lon], {
    radius: 6, weight: 1.2, color: '#001014', fillColor: color, fillOpacity: 0.95
  });

  // NUEVO: abrir offcanvas con pestañas al hacer click
  m.on('click', () => {
    // Texto fijo solicitado por ti:
    const titulo = 'Instalación de acometida';
    // Si más adelante quieres hacerlo dinámico, puedes leer r.reporte_cliente o r.clasificacion
    const pct = (typeof report.satisfaccion === 'number') ? report.satisfaccion : 92;
    window.openRightPanelTabs({
      tituloPedido: titulo,
      porcentaje: pct,
      comentario: 'Detalles de Satisfacción'
    });
  });

  m.addTo(layerAll);
  return m;
}

// ======================
// (Modal legado) — lo dejamos por si lo quieres seguir usando
// ======================
let _modalHoldTimer = null;
let _modalHoldResolver = null;
let isReplaying = false; // sin uso tras remover replay

function openClientModal(){
  const m = document.getElementById('clientModal');
  if (!m) return;
  m.classList.add('open');
  m.setAttribute('aria-hidden','false');
}

function closeClientModal(){
  const m = document.getElementById('clientModal');
  if (!m) return;
  m.classList.remove('open');
  m.setAttribute('aria-hidden','true');
  if (_modalHoldTimer){ clearTimeout(_modalHoldTimer); _modalHoldTimer = null; }
  if (_modalHoldResolver){ const r = _modalHoldResolver; _modalHoldResolver = null; r(); }
}

// Cerrar por botón/fondo/Esc
document.getElementById('cm-close')?.addEventListener('click', ()=> closeClientModal());
document.getElementById('clientModal')?.addEventListener('click', (e)=>{
  if (e.target.id === 'clientModal'){ closeClientModal(); }
});
document.addEventListener('keydown', (e)=>{
  if (e.key === 'Escape'){ closeClientModal(); }
});

// Rellena el modal legado (no se usa con offcanvas, pero lo conservamos)
function showClientModal(r){
  const esEjec = (r.solucion && r.fecha_ejecucion);
  const badge = esEjec
    ? '<span class="badge-state ejec">Ejecutada</span>'
    : '<span class="badge-state pend">Pendiente</span>';

  const dir   = (r.direccion?.calle || '').trim();
  const col   = (r.direccion?.colonia || '').trim();
  const dirTxt = [dir, col && `Col. ${col}`].filter(Boolean).join(' · ');

  document.getElementById('cm-title')?.setAttribute('style','');
  const titleEl = document.getElementById('cm-title');
  if (titleEl) titleEl.innerHTML =
    `Contrato ${r.contrato || '—'} · Reporte ${r.reporte || '—'} ${badge}`;

  const subEl = document.getElementById('cm-sub');
  if (subEl) subEl.textContent = `${(r.nombre||'').trim()}${dirTxt ? ' · '+dirTxt : ''}`;

  document.getElementById('cm-sep-addr')?.remove();
  subEl?.insertAdjacentHTML('afterend',
    '<hr id="cm-sep-addr" style="border:0;border-top:1px solid #123054;margin:10px 0" />'
  );

  const problema = r.reporte_cliente || r.clasificacion || '—';
  const sol = esEjec ? (r.solucion || '—') : null;
  const probEl = document.getElementById('cm-problema');
  if (probEl) probEl.innerHTML =
    esEjec
      ? `<div><b>Problema:</b><br>${problema}</div>
          <div style="margin-top:10px"><b>Solución:</b> ${sol}</div>`
      : `<div><b>Problema:</b><br>${problema}</div>`;

  const creEl = document.getElementById('cm-creacion');
  if (creEl) creEl.innerHTML =
    `<hr style="border:0;border-top:1px solid #123054;margin:10px 0" />
      <b>Fecha de creación:</b> ${fmt.toMX(r.fecha_solicitud)}`;

  const ejeEl = document.getElementById('cm-ejecucion');
  if (ejeEl) ejeEl.innerHTML =
    esEjec ? `<b>Fecha de ejecución:</b> ${fmt.toMX(r.fecha_ejecucion)}` : '';

  document.getElementById('cm-solucion')?.setAttribute('style','');

  openClientModal();
}

elBtn?.addEventListener('click', ()=> cargar(true));

// ======================
// Carga inicial automática
// ======================
cargar(false);

// ======================
// Overlay 3D (carro.glb) — deshabilitado (usa car-overlay.js)
// ======================
(function initThreeCar(){
  console.log('[legacy-3d] overlay deshabilitado (usando car-overlay.js)');
  return;
  // (Código legado omitido intencionalmente)
})();

// Intento de centrar en punto inicial del overlay legado (protegido)
try{ map.flyTo(path[0], 19, { animate:true, duration:0.9 }); } catch(e){}
