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
    // Mapa base (Esri)
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
      }
      document.querySelectorAll('.basemap-card')
        .forEach(c => c.classList.toggle('active', c.dataset.base === name));
    }

    // Eventos del widget
    document.querySelectorAll('.basemap-card').forEach(card=>{
      card.addEventListener('click', ()=> setBase(card.dataset.base));
    });

    // ======================
    // Capas
    // ======================
    const layerAll = L.layerGroup().addTo(map);     // capa principal
    const layerCar = L.layerGroup().addTo(map);      // capa del coche

    const COLOR = {
      pendiente: '#F59E0B', // amber acorde al tema
      ejecutada: '#0B8FFF'  // azul acento acorde al tema
    };

    const markers = []; // {marker, latlng:[lat,lon], estado:'pendientes'|'ejecutadas', data:report}

    // ======================
    // UI inicial
    // ======================
    const elInicio = document.getElementById('fechaInicio');
    const elFin = document.getElementById('fechaFin');
    const elFiltro = document.getElementById('filtroEstado');
    const elBtn = document.getElementById('btnCargar');
    const elHud = document.getElementById('hud');
    const elToast = document.getElementById('toast');
    // Replay/velocidad/ruta removidos

    /* NUEVO: helper de carga en mapa */
    const loadingMask = document.getElementById('loadingMask');
    function showLoading(on){ if(loadingMask) loadingMask.classList.toggle('show', !!on); }

    /* NUEVO: por defecto, últimos 2 días (zona MX) */
(function setLast2Days(){
      const tz = { timeZone: 'America/Mexico_City' };
      const fin = new Date(new Date().toLocaleString('en-US', tz));     // hoy MX
      const inicio = new Date(fin); inicio.setDate(inicio.getDate()-1); // ayer MX
      const ymdMX = d => d.toLocaleDateString('en-CA', tz);             // YYYY-MM-DD
      elInicio.value = ymdMX(inicio);
      elFin.value    = ymdMX(fin);
})();

    function toast(msg, ms=1800){
      elToast.innerText = msg; elToast.style.display='block';
      clearTimeout(toast._t); toast._t = setTimeout(()=> elToast.style.display='none', ms);
    }

function resetLayers(){
  layerAll.clearLayers();
  markers.length = 0;
}

    function markerFor(report){
      const estado = report.estado; // 'pendientes'|'ejecutadas'
      const lat = report.latitude, lon = report.longitude;
      const color = estado === 'pendientes' ? COLOR.pendiente : COLOR.ejecutada;

      const m = L.circleMarker([lat,lon], {
        radius: 6, weight: 1.2, color: '#001014', fillColor: color, fillOpacity: 0.95
      });
      // Sin popup de Leaflet; solo nuestro modal:
      m.on('click', () => showClientModal(report));
      m.addTo(layerAll);
      return m;
    }



    /* ===== MODAL ===== */
    let _modalHoldTimer = null;
    let _modalHoldResolver = null;
    let isReplaying = false; // sin uso tras remover replay

    function openClientModal(){
      const m = document.getElementById('clientModal');
      m.classList.add('open');
      m.setAttribute('aria-hidden','false');
    }

    function closeClientModal(){
      const m = document.getElementById('clientModal');
      m.classList.remove('open');
      m.setAttribute('aria-hidden','true');
      // si hay temporizador esperando, libéralo
      if (_modalHoldTimer){ clearTimeout(_modalHoldTimer); _modalHoldTimer = null; }
      if (_modalHoldResolver){ const r = _modalHoldResolver; _modalHoldResolver = null; r(); }
    }

    // Replay eliminado

    /* Muestra el modal al menos `ms` ms; si el usuario lo cierra antes, también resuelve */
    function showClientModalTimed(r, ms = 10000){ // ya no se usa tras remover replay
      showClientModal(r); // rellena y abre
      if (_modalHoldTimer){ clearTimeout(_modalHoldTimer); }
      return new Promise(res=>{
        _modalHoldResolver = ()=>{ _modalHoldResolver = null; res(); };
        _modalHoldTimer = setTimeout(()=>{
          _modalHoldTimer = null;
          closeClientModal();
          res();
        }, ms);
      });
    }

    /* Cerrar por botón, fondo u Esc => además cancelar replay si estaba activo */
    document.getElementById('cm-close')?.addEventListener('click', ()=>{
      closeClientModal();
      // replay removido
    });
    document.getElementById('clientModal')?.addEventListener('click', (e)=>{
      if (e.target.id === 'clientModal'){
        closeClientModal();
        // replay removido
      }
    });
    document.addEventListener('keydown', (e)=>{
      if (e.key === 'Escape'){
        closeClientModal();
        // replay removido
      }
    });

    /* Rellena el modal y lo muestra */
    function showClientModal(r){
      const esEjec = (r.solucion && r.fecha_ejecucion);
      const badge = esEjec
        ? '<span class="badge-state ejec">Ejecutada</span>'
        : '<span class="badge-state pend">Pendiente</span>';

      const dir   = (r.direccion?.calle || '').trim();
      const col   = (r.direccion?.colonia || '').trim();
      const dirTxt = [dir, col && `Col. ${col}`].filter(Boolean).join(' · '); // ← usa dirTx

      document.getElementById('cm-title').innerHTML =
        `Contrato ${r.contrato || '—'} · Reporte ${r.reporte || '—'} ${badge}`;

      document.getElementById('cm-sub').textContent =
        `${(r.nombre||'').trim()}${dirTxt ? ' · '+dirTxt : ''}`;
      
      // ↓ Nuevo: separador debajo de la dirección (evita duplicados)
      document.getElementById('cm-sep-addr')?.remove();
      document.getElementById('cm-sub')
        .insertAdjacentHTML('afterend',
          '<hr id="cm-sep-addr" style="border:0;border-top:1px solid #123054;margin:10px 0" />'
        );
      
      // 1) Problema / Solución primero (SIN hr arriba)
      const problema = r.reporte_cliente || r.clasificacion || '—';
      const sol = esEjec ? (r.solucion || '—') : null;
      document.getElementById('cm-problema').innerHTML =
        esEjec
          ? `<div><b>Problema:</b><br>${problema}</div>
            <div style="margin-top:10px"><b>Solución:</b> ${sol}</div>`
          : `<div><b>Problema:</b><br>${problema}</div>`;

      // 2) ÚNICO separador: justo ANTES de las fechas
      document.getElementById('cm-creacion').innerHTML =
        `<hr style="border:0;border-top:1px solid #123054;margin:10px 0" />
        <b>Fecha de creación:</b> ${fmt.toMX(r.fecha_solicitud)}`;

      document.getElementById('cm-ejecucion').innerHTML =
        esEjec ? `<b>Fecha de ejecución:</b> ${fmt.toMX(r.fecha_ejecucion)}` : '';

      // No usamos un bloque de "solución" separado
      document.getElementById('cm-solucion').innerHTML = '';

      openClientModal();
    }

    // getSpeed removido

    function popupHTML(r){
      const problema = r.reporte_cliente || r.clasificacion || '—';
      const creada = r.fecha_solicitud ? fmt.toMX(r.fecha_solicitud) : '—';
      const esEjec = r.estado === 'ejecutadas';
      const ejec = esEjec && r.fecha_ejecucion ? fmt.toMX(r.fecha_ejecucion) : null;
      const sol  = esEjec ? (r.solucion || '—') : null;

      const fechas = `
        <div><b>Creación:</b> ${creada}</div>
        ${esEjec ? `<div><b>Ejecución:</b> ${ejec}</div>` : ``}
      `;
      const bloquePS = esEjec
        ? `<b>Problema:</b><br>${problema}<br><b>Solución:</b> ${sol}`
        : `<b>Problema:</b><br>${problema}`;

      return `
        <div style="font-family: 'Share Tech Mono', monospace;">
          <div style="font-weight:700;color:#cfe6ff;margin-bottom:6px">
            Contrato: ${r.contrato || '—'} · Reporte: ${r.reporte || '—'}
          </div>
          <div style="color:#a9bbd2">
            ${(r.nombre||'').trim()} · ${(r.direccion?.calle||'').trim()}
            ${(r.direccion?.colonia?('· '+r.direccion.colonia.trim()):'')}
          </div>
          <hr style="border:0;border-top:1px solid #13304f;margin:10px 0" />
          ${fechas}
          <hr style="border:0;border-top:1px solid #13304f;margin:10px 0" />
          <div>${bloquePS}</div>
        </div>`;
    }

async function cargar(fitAfterLoad=false){
      const inicio = elInicio.value;
      const fin    = elFin.value;
      const filtro = elFiltro.value;
      const qs = new URLSearchParams({ action:'fetch_reports', inicio, fin, filter:filtro });
      const url = `${location.pathname}?${qs.toString()}`;

      elHud.textContent = 'Cargando…';
      showLoading(true);                 // NUEVO: muestra overlay
      resetLayers();

      try{
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        if (!data.ok) throw new Error(data.error || 'Respuesta inválida');
        const arr = data.data || [];
        if (!arr.length){
          toast('Sin datos para el rango/filtrado');
          elHud.textContent = `0 fallas · filtro=${filtro}`;
          return;
        }
        // Crear markers y preparar lista para proximidad
        arr.forEach(r => {
          const m = markerFor(r);
          markers.push({marker:m, latlng:[r.latitude, r.longitude], estado:r.estado, data:r});
        });
        // Ajuste de vista general
    if (fitAfterLoad && markers.length){
      const bounds = L.latLngBounds(markers.map(x=>x.latlng));
      map.fitBounds(bounds.pad(0.1));
    }
        elHud.textContent = `${markers.length} fallas (mostrando ${filtro})`;

        // Replay removido
      }catch(e){
        console.error(e);
        toast('Error al cargar');
        elHud.textContent = 'Error.';
      }finally{
        showLoading(false);              // NUEVO: oculta overlay
      }
    }

elBtn.addEventListener('click', ()=> cargar(true));

    // Replay y proximidad eliminados

    // ======================
    // Carga inicial automática (hoy/todas)
    // ======================
cargar(false);

// ======================
// Overlay 3D (carro.glb)
// ======================
(function initThreeCar(){
  console.log('[legacy-3d] overlay deshabilitado (usando car-overlay.js)');
  return;
  const parent = document.querySelector('.map');
  if (!parent || !window.THREE) return;
  const overlay = document.createElement('div');
  overlay.id = 'three-overlay';
  parent.appendChild(overlay);

  const W = 300, H = 300; // tamaño del viewport del coche (más visible)
  const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1, 2));
  renderer.setSize(W, H);
  overlay.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, W/H, 0.1, 1000);
  camera.position.set(0, 2.2, 4.5); // ligera vista 3/4
  camera.lookAt(0, 0, 0);

  // Luces suaves
  const hemi = new THREE.HemisphereLight(0xffffff, 0x8899aa, 0.9); scene.add(hemi);
  const dir  = new THREE.DirectionalLight(0xffffff, 0.8); dir.position.set(2,4,2); scene.add(dir);

  const carGroup = new THREE.Group();
  scene.add(carGroup);

  // Piso sutil (sombra simulada)
  const floorGeom = new THREE.CircleGeometry(1.3, 32);
  const floorMat  = new THREE.MeshBasicMaterial({ color:0x000000, transparent:true, opacity:0.1 });
  const floor = new THREE.Mesh(floorGeom, floorMat); floor.rotation.x = -Math.PI/2; floor.position.y = -0.6; carGroup.add(floor);

  // Cargar modelo GLB
  const loader = (window.GLTFLoader ? new window.GLTFLoader() : null);
  let carReady = false;
  // Placeholder visible hasta que cargue el GLB
  const placeholder = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 0.5, 2.2),
    new THREE.MeshStandardMaterial({ color:0x0B8FFF, metalness:0.2, roughness:0.65 })
  );
  placeholder.position.set(0, 0, 0);
  carGroup.add(placeholder);
  if (loader) loader.load('modelo/carro.glb', (gltf)=>{
    const car = gltf.scene;
    car.scale.set(0.9,0.9,0.9);
    car.position.set(0,0,0);
    // Orientación inicial (asumiendo que el frente mira -Z en el modelo)
    car.rotation.y = Math.PI;
    carGroup.add(car);
    // Retirar placeholder cuando el modelo está listo
    carGroup.remove(placeholder);
    carReady = true;
  }, undefined, (err)=>{
    console.warn('No se pudo cargar carro.glb', err);
  });

  // Ruta de simulación (aprox. calles en Tepatitlán)
  // Trayectoria aproximada por calles céntricas de Tepatitlán
  const path = [
    [20.81610, -102.75930], // inicio
    [20.81580, -102.76020],
    [20.81530, -102.76090],
    [20.81470, -102.76110],
    [20.81410, -102.76060],
    [20.81390, -102.75980],
    [20.81420, -102.75890],
    [20.81490, -102.75850],
    [20.81560, -102.75860],
    [20.81610, -102.75930], // cierra el ciclo
  ];
  let seg = 0, t = 0; // 0..1 dentro del segmento
  let lastPx = null;
  let followAcc = 0; // acumulador para seguir el coche
  let carMarker = null;

  function latlngToPx(lat, lng){ return map.latLngToContainerPoint([lat,lng]); }

  function step(dt){
    // Animación a velocidad constante
    const speed = 0.35; // seg por segundo
    t += dt * speed;
    if (t > 1){ t = 0; seg = (seg+1) % (path.length-1); }
    const a = path[seg], b = path[seg+1];
    const lat = a[0] + (b[0]-a[0])*t;
    const lng = a[1] + (b[1]-a[1])*t;
    const p = latlngToPx(lat, lng);

    // Posicionar canvas centrado sobre el punto
    const rect = parent.getBoundingClientRect();
    const x = p.x - W/2; const y = p.y - H/2;
    renderer.domElement.style.position = 'absolute';
    renderer.domElement.style.left = `${x}px`;
    renderer.domElement.style.top  = `${y}px`;

    // Orientar el coche según dirección de movimiento
    if (!lastPx) lastPx = p; else {
      const dx = p.x - lastPx.x, dy = p.y - lastPx.y;
      if (dx*dx + dy*dy > 0.1){
        const bearing = Math.atan2(dx, dy); // pantalla: x derecha, y abajo
        carGroup.rotation.y = bearing; // gira en Y para ver "de lado" al girar
      }
      lastPx = p;
    }

    // Escalar con zoom para mantener tamaño visual adecuado
    const z = map.getZoom();
    const s = Math.min(1.5, Math.max(0.6, (z-10)*0.15 + 0.8));
    carGroup.scale.set(s,s,s);

    // Marcador 2D de respaldo (por si el GLB no carga aún)
    if (!carMarker){
      carMarker = L.circleMarker([lat, lng], { radius: 8, weight: 2, color: '#0B8FFF', fillColor:'#0B8FFF', fillOpacity:0.85 });
      carMarker.addTo(layerCar);
    } else {
      carMarker.setLatLng([lat, lng]);
    }

    // Seguir al coche suavemente cada ~0.25s
    followAcc += dt;
    if (followAcc > 0.25){
      followAcc = 0;
      try { map.panTo([lat, lng], { animate:true, duration:0.25 }); } catch(e){}
    }
  }

  let last = performance.now();
  function loop(now){
    const dt = Math.min(0.05, (now-last)/1000); last = now;
    step(dt);
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // Reposicionar al mover/zoom
  map.on('move zoom', ()=>{ /* step on next frame will reposition */ });
  window.addEventListener('resize', ()=>{
    // opcional: mantener tamaño fijo; si quieres escalar con viewport, ajustar aquí
  });
})();
  // Centrar el mapa en el coche al cargar
  try{ map.flyTo(path[0], 19, { animate:true, duration:0.9 }); } catch(e){}
