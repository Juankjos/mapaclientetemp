<?php
/**
 * coordenadas2.php — v10.0
 *
 * Cambios principales vs v9.5 (NO borra la base de comentarios ni la estructura general):
 * - NUEVO origen de datos: se reemplazan las consultas SQL de reportes por llamadas HTTP internas
 *   a `reportes_x_tipo.php` (GET) y a `gps/bulk` (POST) usando cURL.
 * - NUEVOS controles de fecha: `inicio` y `fin` (YYYY-MM-DD en UI → YYYY/MM/DD en backend).
 * - SIEMPRE pedimos `tipo=todas` al endpoint de reportes y filtramos en el cliente: 'todas', 'pendientes', 'ejecutadas'.
 * - Representación en mapa:
 *   * Pendiente: pin/círculo **amarillo**.
 *   * Ejecutada: pin/círculo **verde oscuro**.
 * - Popup por falla: Problema (reporte_cliente), Fecha de creación (fecha_solicitud) y, si ejecutada,
 *   Fecha de ejecución + Solución aplicada.
 * - Conserva el "cinemático" de recorrido por **proximidad** y la base de Leaflet + Esri.
 * - Long-polling del backend original: **deshabilitado** por ahora; el modo Live puede simularse
 *   recargando periódicamente (ver TODO). La API previa `action=poll` responde 501.
 *
 * NOTA: No se eliminan las credenciales DB ni comentarios heredados para referencia histórica.
 */

// ======================
// Configuración heredada
// ======================
$DB_HOST = 'localhost';
$DB_NAME = 'clientes';
https://store.fastly.steamstatic.com/public/images/applications/store/steam_spinner.png?v=8669e97b288da32670e77181618c3dfb
$DB_USER = '';
$DB_PASS = '';

// ==========================
// Configuración NUEVO origen
// ==========================
$INTERNAL_BASE = 'http://127.0.0.1:9091';
$INTERNAL_TOKEN = '___token_super_secreto___';

// Endpoints específicos
$EP_REPORTES = $INTERNAL_BASE . '/reportes_x_tipo.php'; // GET ?inicio=YYYY/MM/DD&fin=YYYY/MM/DD&tipo=todas
$EP_GPS_BULK = $INTERNAL_BASE . '/gps/bulk';           // POST {contracts: ["1111-1", ...]}

// ===============
// Utilidades PHP
// ===============
function json_response($data, $code = 200) {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function curl_get_json($url, $headers = []) {
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5);
    curl_setopt($ch, CURLOPT_TIMEOUT, 20);
    if (!empty($headers)) curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    $resp = curl_exec($ch);
    $err  = curl_error($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($resp === false) {
        return [null, $code ?: 500, $err ?: 'curl_get_json error'];
    }
    $json = json_decode($resp, true);
    if ($json === null && json_last_error() !== JSON_ERROR_NONE) {
        return [null, $code ?: 500, 'JSON decode error: ' . json_last_error_msg()];
    }
    return [$json, $code, null];
}

function curl_post_json($url, $payload, $headers = []) {
    $ch = curl_init();
    $headers = array_merge($headers, ['Content-Type: application/json']);
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5);
    curl_setopt($ch, CURLOPT_TIMEOUT, 25);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload, JSON_UNESCAPED_UNICODE));
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    $resp = curl_exec($ch);
    $err  = curl_error($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($resp === false) {
        return [null, $code ?: 500, $err ?: 'curl_post_json error'];
    }
    $json = json_decode($resp, true);
    if ($json === null && json_last_error() !== JSON_ERROR_NONE) {
        return [null, $code ?: 500, 'JSON decode error: ' . json_last_error_msg()];
    }
    return [$json, $code, null];
}

// Normaliza contrato tipo "00012345-6" → "12345"
function normalize_contract($c) {
    $c = trim((string)$c);
    if ($c === '') return '';
    // Mantener sólo dígitos y guión para detectar sufijo; luego quitar ceros a la izquierda
    // Formato esperado: digitos[-digitos]
    if (preg_match('/^0*(\d+)(?:-\d+)?$/', $c, $m)) {
        return ltrim($m[1], '0') === '' ? '0' : ltrim($m[1], '0');
    }
    // fallback: quitar todo salvo dígitos, luego quitar ceros a la izquierda
    $digits = preg_replace('/\D+/', '', $c);
    return $digits === '' ? '' : (ltrim($digits, '0') === '' ? '0' : ltrim($digits, '0'));
}

// Enriquecer reportes con GPS usando /gps/bulk
function enrich_with_gps($reports, $gps_bulk_endpoint, $auth_header) {
    // Recopilar contratos tal como vienen y también normalizados
    $contracts = [];
    foreach ($reports as $r) {
        if (!isset($r['contrato'])) continue;
        $contracts[] = $r['contrato'];
    }
    $contracts = array_values(array_unique(array_filter($contracts, fn($x) => (string)$x !== '')));
    if (empty($contracts)) {
        return [$reports, ['count'=>0, 'found'=>0, 'not_found'=>[], 'results'=>[]]];
    }

    [$gps, $code, $err] = curl_post_json($gps_bulk_endpoint, ['contracts' => $contracts], [$auth_header]);
    if ($gps === null) {
        // Devolver sin GPS pero indicando error
        return [$reports, ['error' => $err, 'http' => $code, 'count'=>0, 'found'=>0, 'not_found'=>$contracts, 'results'=>[]]];
    }

    // Índices por contract_input y por contract_normalized
    $by_input = [];
    $by_norm  = [];
    foreach ($gps['results'] ?? [] as $g) {
        if (isset($g['contract_input'])) $by_input[(string)$g['contract_input']] = $g;
        if (isset($g['contract_normalized'])) $by_norm[(string)$g['contract_normalized']] = $g;
    }

    foreach ($reports as &$r) {
        $lat = null; $lon = null;
        $raw = $r['contrato'] ?? '';
        $norm = normalize_contract($raw);
        if ($raw !== '' && isset($by_input[$raw]) && !isset($by_input[$raw]['error_code'])) {
            $lat = $by_input[$raw]['latitude'] ?? null;
            $lon = $by_input[$raw]['longitude'] ?? null;
        }
        if (($lat === null || $lon === null) && $norm !== '' && isset($by_norm[$norm]) && !isset($by_norm[$norm]['error_code'])) {
            $lat = $by_norm[$norm]['latitude'] ?? null;
            $lon = $by_norm[$norm]['longitude'] ?? null;
        }
        if ($lat !== null && $lon !== null) {
            $r['latitude']  = $lat;
            $r['longitude'] = $lon;
        }
    }
    unset($r);

    return [$reports, $gps];
}

// Determinar estado de la falla
function compute_status($r) {
    $hasSol = isset($r['solucion']) && $r['solucion'] !== null && $r['solucion'] !== '';
    $hasExe = isset($r['fecha_ejecucion']) && $r['fecha_ejecucion'] !== null && $r['fecha_ejecucion'] !== '';
    return ($hasSol && $hasExe) ? 'ejecutadas' : 'pendientes';
}

// =====================
// API interna (misma URL)
// =====================
$action = $_GET['action'] ?? null;
if ($action === 'fetch_reports') {
    // Params UI: YYYY-MM-DD → Backend requiere YYYY/MM/DD
    $inicio_ui = $_GET['inicio'] ?? date('Y-m-d');
    $fin_ui    = $_GET['fin'] ?? date('Y-m-d');
    $filter    = $_GET['filter'] ?? 'todas'; // 'todas' | 'pendientes' | 'ejecutadas'

    // Validación básica de fechas
    $inicio_ui = preg_replace('/[^0-9-]/', '', $inicio_ui);
    $fin_ui    = preg_replace('/[^0-9-]/', '', $fin_ui);
    $inicio_q  = str_replace('-', '/', $inicio_ui);
    $fin_q     = str_replace('-', '/', $fin_ui);

    // 1) Obtener reportes por tipo=todas
    $url = $GLOBALS['EP_REPORTES'] . '?' . http_build_query([
        'inicio' => $inicio_q,
        'fin'    => $fin_q,
        'tipo'   => 'todas'
    ]);
    [$reports, $code1, $err1] = curl_get_json($url, ['X-Internal-Auth: ' . $GLOBALS['INTERNAL_TOKEN']]);
    if ($reports === null || !is_array($reports)) {
        json_response([
            'ok' => false,
            'error' => 'No se pudo obtener reportes_x_tipo',
            'http' => $code1,
            'detail' => $err1,
        ], 502);
    }

    // 2) Enriquecer con GPS en bulk
    [$enriched, $gps_meta] = enrich_with_gps($reports, $GLOBALS['EP_GPS_BULK'], 'X-Internal-Auth: ' . $GLOBALS['INTERNAL_TOKEN']);

    // 3) Calcular estado y filtrar (cliente pidió que SIEMPRE pidamos tipo=todas y filtremos nosotros)
    $out = [];
    foreach ($enriched as $r) {
        $status = compute_status($r); // 'pendientes' | 'ejecutadas'
        $r['estado'] = $status;
        if ($filter === 'todas' || $filter === $status) {
            // Sólo incluir con GPS válido
            if (isset($r['latitude']) && isset($r['longitude'])) {
                $out[] = $r;
            }
        }
    }

    json_response([
        'ok' => true,
        'params' => [
            'inicio' => $inicio_ui,
            'fin'    => $fin_ui,
            'filter' => $filter,
        ],
        'count' => count($out),
        'gps'   => $gps_meta,
        'data'  => $out,
    ]);
}
else if ($action === 'poll') {
    // No implementado en el nuevo flujo; devolver 501 para ser explícitos
    json_response(['ok'=>false,'error'=>'poll no disponible en v10.0'], 501);
}

// =====================
// HTML + CSS + JS (UI)
// =====================
?>
<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Mapa de Fallas — Fechas & Estado (v10.0)</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin=""/>
  <link rel="stylesheet" href="style.css" />
  <style></style>
</head>
<body>
  <div class="wrap">
    <div class="map">
      <!-- Top toolbar -->
      <div class="ui-topbar">
        <div class="group">
          <span class="lbl">Inicio</span>
          <div class="field"><input type="date" id="fechaInicio" /></div>
        </div>
        <div class="group">
          <span class="lbl">Fin</span>
          <div class="field"><input type="date" id="fechaFin" /></div>
        </div>
        <div class="group">
          <span class="lbl">Filtro</span>
          <div class="field">
            <select id="filtroEstado">
              <option value="todas">Todas</option>
              <option value="pendientes">Pendientes</option>
              <option value="ejecutadas">Ejecutadas</option>
            </select>
          </div>
          <div class="legend">
            <div class="dot yellow"></div> <small>Pendientes</small>
            <div class="dot green" style="margin-left:6px"></div> <small>Ejecutadas</small>
          </div>
        </div>
        <div class="group">
          <button class="btn" id="btnCargar">Cargar</button>
        </div>
        <div class="hud" id="hud">—</div>
      </div>

      <!-- Playback options removidas -->

      <!-- Basemap switcher (compact) -->
      <div class="ui-card below" id="grpBaseMaps">
        <div class="basemap-grid">
          <div class="basemap-card" data-base="sat">
            <div class="bm-thumb"
                style="background-image:url('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/3/2/2');"></div>
            <div class="bm-title">Satélite</div>
          </div>
          <div class="basemap-card active" data-base="light">
            <div class="bm-thumb"
                style="background-image:url('https://a.basemaps.cartocdn.com/rastertiles/voyager/12/1138/1657.png');"></div>
            <div class="bm-title">Claro HD</div>
          </div>
          <div class="basemap-card" data-base="dark">
            <div class="bm-thumb"
                style="background-image:url('https://a.basemaps.cartocdn.com/dark_all/3/2/2.png');"></div>
            <div class="bm-title">Oscuro</div>
          </div>
        </div>
      </div>

      <div id="map"></div>
      <!-- NUEVO: overlay de carga -->
      <div id="loadingMask" class="loading-mask">
        <div class="loading-msg">Cargando…</div>
      </div>
      <div class="toast" id="toast" style="display:none"></div>
    </div>
  </div>

  <!-- Modal: datos del cliente -->
  <div id="clientModal" class="modal" aria-hidden="true">
    <div class="modal-card">
      <h4 id="cm-title">Datos del cliente</h4>
      <div class="modal-row" id="cm-sub">—</div>
      <div class="modal-row" id="cm-problema"></div>
      <div class="modal-row" id="cm-creacion"></div>
      <div class="modal-row" id="cm-ejecucion"></div>
      <div class="modal-row" id="cm-solucion"></div>
      <div class="modal-actions">
        <button id="cm-close">Cerrar</button>
      </div>
    </div>
  </div>

  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
  <script src="app.js"></script>
  <script type="importmap">
  {
    "imports": {
      "three": "https://unpkg.com/three@0.159.0/build/three.module.js"
    }
  }
  </script>
  <script type="module" src="car-overlay.js"></script>
</body>
</html>
