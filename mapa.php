<?php
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
  <link rel="stylesheet" href="style.css"/>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet"
      integrity="sha384-QWTKZyjpPEjISv5WaRU9OFeRpok6YctnYmDr5pNlyT2bRjXh0JMhjY6hW+ALEwIH" crossorigin="anonymous">
  <style></style>
</head>
<body>
  <div class="wrap">
    <div class="map">
      <button id="btnOffcanvas"
        class="btn btn-light border position-absolute"
        style="top:12px; right:12px; z-index:1200"
        data-bs-toggle="offcanvas" data-bs-target="#sidePanel" aria-controls="sidePanel">
          Técnico
      </button>

      <!-- Playback options removidas -->

      <!-- Basemap switcher (compact) -->
      <div class="ui-card bl" id="grpBaseMaps"
      style="left:14px; bottom:14px; right:auto; top:auto; position:absolute">
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
  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"
        integrity="sha384-YvpcrYf0tY3lHB60NNkmXc5s9fDVZLESaAA55NDzOxhy9GkcIdslK1eN7N6jIeHz"
        crossorigin="anonymous"></script>
  <!-- Offcanvas lateral derecho -->
  <div class="offcanvas offcanvas-end" tabindex="-1" id="sidePanel" aria-labelledby="sidePanelLabel"
      data-bs-scroll="true" data-bs-backdrop="true" style="--bs-offcanvas-width: 420px;">
    <div class="offcanvas-header">
      <h5 class="offcanvas-title" id="sidePanelLabel">Tu técnico</h5>
      <button type="button" class="btn-close text-reset" data-bs-dismiss="offcanvas" aria-label="Cerrar"></button>
    </div>

    <div class="offcanvas-body pt-0">
      <!-- Tabs -->
      <ul class="nav nav-tabs px-2 pt-2" id="panelTabs" role="tablist">
        <li class="nav-item" role="presentation">
          <button class="nav-link active" id="tab-pedido" data-bs-toggle="tab"
                  data-bs-target="#tabPanePedido" type="button" role="tab"
                  aria-controls="tabPanePedido" aria-selected="true">
            Servicio
          </button>
        </li>
        <li class="nav-item" role="presentation">
          <button class="nav-link" id="tab-satis" data-bs-toggle="tab"
                  data-bs-target="#tabPaneSatis" type="button" role="tab"
                  aria-controls="tabPaneSatis" aria-selected="false">
            Satisfacción
          </button>
        </li>
      </ul>

      <!-- Contenido de las pestañas -->
      <div class="tab-content p-3" id="panelTabsContent">
        <!-- Pestaña: Pedido -->
        <div class="tab-pane fade show active" id="tabPanePedido" role="tabpanel" aria-labelledby="tab-pedido">
          <div class="text-muted">Orden de servicio:</div>
          <div id="pedidoTitulo" class="fs-5 fw-semibold">
            Instalación de acometida
          </div>
          <!-- Si quieres más campos, añádelos aquí -->
        </div>

        <!-- Pestaña: Satisfacción -->
        <div class="tab-pane fade" id="tabPaneSatis" role="tabpanel" aria-labelledby="tab-satis">
          <div class="text-center my-4">
            <div id="satisPorcentaje" class="display-3 fw-bold">92%</div>
            <div id="satisComentario" class="text-muted">Detalles de Satisfacción</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>
