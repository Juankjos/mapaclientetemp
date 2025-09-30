// ES Module overlay 3D para el coche, usando THREE como módulo
import * as THREE from 'three';
import { GLTFLoader } from 'https://unpkg.com/three@0.159.0/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'https://unpkg.com/three@0.159.0/examples/jsm/loaders/DRACOLoader.js';

const map = window._leafletMap;
console.log('[car-overlay] módulo inicializado');
if (!map) {
  console.warn('Leaflet map no disponible para overlay 3D');
} else {
  const parent = document.querySelector('.map');
  console.log('[car-overlay] parent .map encontrado:', !!parent);
  const overlay = document.createElement('div');
  overlay.id = 'three-overlay';
  parent.appendChild(overlay);

  // Tamaño compacto tipo Uber
  const W = 140, H = 140;
  const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1, 2));
  renderer.setSize(W, H);
  overlay.appendChild(renderer.domElement);
  console.log('[car-overlay] renderer listo', {W,H, dpr: window.devicePixelRatio});

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, W/H, 0.1, 1000);
  camera.position.set(0, 2.2, 4.5);
  camera.lookAt(0,0,0);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x8899aa, 0.9); scene.add(hemi);
  const dir  = new THREE.DirectionalLight(0xffffff, 0.85); dir.position.set(2,4,2); scene.add(dir);

  const carGroup = new THREE.Group(); // contenedor base (no salta)
  scene.add(carGroup);
  const modelGroup = new THREE.Group(); // grupo del modelo (sí salta)
  carGroup.add(modelGroup);

  // Halo pequeño (sombra) bajo el coche
  const floor = new THREE.Mesh(new THREE.CircleGeometry(0.55,32), new THREE.MeshBasicMaterial({color:0x000, transparent:true, opacity:0.12}));
  floor.rotation.x = -Math.PI/2; floor.position.y = -0.6; carGroup.add(floor);

  // No placeholder: evitamos mostrar un bloque azul antes de cargar el GLB
  let carReady = false;

  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath('https://unpkg.com/three@0.159.0/examples/jsm/libs/draco/');
  loader.setDRACOLoader(draco);

  const glbUrl = new URL('model/carro.glb', window.location.href).href;
  console.log('[car-overlay] cargando GLB:', glbUrl);
  loader.load(glbUrl, (gltf)=>{
    const car = gltf.scene;
    // Autoscale según bounding box
    const box = new THREE.Box3().setFromObject(car);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const target = 2.0; // tamaño objetivo en unidades
    const k = target / maxDim;
    car.scale.setScalar(k);
    console.log('[car-overlay] GLB cargado. bbox size:', size, 'scale:', k);

    // Centrar el modelo al origen
    const center = box.getCenter(new THREE.Vector3());
    car.position.sub(center); // mover al origen
    car.position.set(0,0,0);
    car.rotation.y = Math.PI;
    modelGroup.add(car);
    carReady = true;
  }, (evt)=>{
    const total = evt.total || 0; const loaded = evt.loaded || 0;
    if (total) console.log('[car-overlay] progreso GLB', ((loaded/total)*100).toFixed(1)+'%');
    else console.log('[car-overlay] progreso GLB bytes', loaded);
  }, (err)=> console.warn('No se pudo cargar carro.glb', err));

  // Ruta (vuelta al fraccionamiento) — puntos extraídos del KML
  // Formato [lat, lon]; bucle continuo, 5s por segmento
  const ROUTE = [
    [20.79317567186798, -102.7672214204949],
    [20.79354242108589, -102.7671164079807],
    [20.79406175046234, -102.7670825520826],
    [20.7941568122206,  -102.7678374090404],
    [20.79423369731665, -102.7685772359237],
    [20.79382307248717, -102.7686403702414],
    [20.79330281651172, -102.7686958083112],
    [20.79323373257632, -102.7681275124542],
    [20.79315544180124, -102.7675901754282],
    [20.79311270089282, -102.7673043851407]
  ];
  const MOVE_DURATION = 5.0;   // segundos de movimiento entre puntos
  const DWELL_DURATION = 10.0; // segundos detenido en cada punto
  let segIndex = 0;            // índice del punto actual (A)
  let phase = 'dwell';         // 'dwell' | 'move'
  let moveT = 0;               // tiempo acumulado en fase move
  let dwellT = 0;              // tiempo acumulado en fase dwell
  let followAcc = 0;           // acumulador de seguimiento
  let carMarker = null;

  function offsetLatLng([lat,lng], dxm, dym){
    const latR = lat * Math.PI/180;
    const dLat = dym / 111320;
    const dLng = dxm / (111320 * Math.cos(latR));
    return [lat + dLat, lng + dLng];
  }

  function lerp(a,b,t){ return a + (b-a)*t }
  function interpLatLng(a,b,t){ return [ lerp(a[0],b[0],t), lerp(a[1],b[1],t) ] }

  function positionOverlay(curLL){
    const adj = offsetLatLng(curLL, 0, 0);
    const p = map.latLngToContainerPoint(adj);
    const x = p.x - W/2, y = p.y - H/2;
    const dom = renderer.domElement;
    dom.style.position = 'absolute'; dom.style.left = `${x}px`; dom.style.top = `${y}px`;

    // Escala sutil acorde al zoom para que se vea pequeño
    const z = map.getZoom();
    const s = Math.max(0.55, Math.min(0.95, 0.7 + 0.12*(z-18))); // clamp ~0.55..0.95
    carGroup.scale.set(s,s,s);

    // Crear/actualizar marcador solo cuando el GLB esté listo
    if (carReady){
      if (!carMarker){
        carMarker = L.circleMarker(adj, { radius: 5, weight: 2, color: '#0B8FFF', fillColor:'#0B8FFF', fillOpacity:0.9 }).addTo(map);
      } else {
        carMarker.setLatLng(adj);
      }
    }
  }

  // Animación de salto sutil y movimiento por ruta
  let lastT = performance.now();
  let t = 0; // segundos acumulados para bobbing
  function render(now){
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    t += dt;

    // Bobbing vertical: seno suave ~1.2 Hz, amplitud pequeña
    const freq = 1.2; // Hz
    const omega = Math.PI * 2 * freq;
    const amp = 0.06; // unidades locales
    const bob = Math.sin(t * omega) * amp;
    modelGroup.position.y = bob;

    // Sin pitch lateral para evitar vaivén
    modelGroup.rotation.x = 0;

    // Avance con pausas: 10s detenido en cada punto, 5s de movimiento al siguiente
    const A = ROUTE[segIndex];
    const B = ROUTE[(segIndex + 1) % ROUTE.length];
    let curLL = A;
    if (phase === 'dwell'){
      dwellT += dt;
      if (dwellT >= DWELL_DURATION){ phase = 'move'; moveT = 0; }
    }
    if (phase === 'move'){
      moveT += dt;
      let k = Math.min(1, moveT / MOVE_DURATION);
      curLL = interpLatLng(A, B, k);
      if (k >= 1){
        segIndex = (segIndex + 1) % ROUTE.length;
        phase = 'dwell'; dwellT = 0; moveT = 0; curLL = ROUTE[segIndex];
      }
    }

    // Orientación geográfica suavizada (solo se actualiza mientras se mueve)
    const toRad = d=> d*Math.PI/180;
    const lat1 = toRad(A[0]), lon1 = toRad(A[1]);
    const lat2 = toRad(B[0]), lon2 = toRad(B[1]);
    const dLon = lon2 - lon1;
    let brng = Math.atan2(Math.sin(dLon)*Math.cos(lat2), Math.cos(lat1)*Math.sin(lat2) - Math.sin(lat1)*Math.cos(lat2)*Math.cos(dLon));
    if (brng < 0) brng += Math.PI*2;
    const FRONT_OFFSET = Math.PI; // corrige frente del modelo (evita reversa)
    const targetYaw = (Math.PI - brng) + FRONT_OFFSET; // mapear + offset frente
    carGroup.__yaw = typeof carGroup.__yaw === 'number' ? carGroup.__yaw : targetYaw;
    if (phase === 'move'){
      const tau = 0.25; // s
      const alpha = 1 - Math.exp(-dt / tau);
      let diff = (targetYaw - carGroup.__yaw + Math.PI) % (Math.PI*2) - Math.PI;
      carGroup.__yaw = carGroup.__yaw + diff * alpha;
    }
    carGroup.rotation.y = carGroup.__yaw;

    // Posicionar overlay y marcador
    positionOverlay(curLL);

    // Seguir suavemente al coche
    followAcc += dt;
    if (followAcc > 0.3){ followAcc = 0; try{ map.panTo(curLL, { animate:true, duration:0.3 }); }catch(e){} }

    renderer.render(scene, camera);
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);

  // Inicializar en primer punto: centra y hace zoom inmediato al coche
  try{
    map.setView(ROUTE[0], 20, { animate: false });
  }catch(e){}

  // (Opcional) Atajos de depuración desactivados
}
