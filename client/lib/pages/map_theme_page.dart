import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:geolocator/geolocator.dart';

// import 'package:geolocator/geolocator.dart'; // Úsalo si activas "ir a mi ubicación"

enum MapTheme { light, dark, satellite }

class MapThemePage extends StatefulWidget {
  const MapThemePage({super.key});

  @override
  State<MapThemePage> createState() => _MapThemePageState();
}

class _MapThemePageState extends State<MapThemePage> {
  final MapController _mapController = MapController();
  MapTheme _theme = MapTheme.light;

  // Centro inicial (Guadalajara aprox.)
  static const LatLng _initialCenter = LatLng(20.6736, -103.344);
  static const double _initialZoom = 13;

  // Devuelve el urlTemplate y la atribución según el tema.
  ({String url, String attribution}) _baseLayerFor(MapTheme theme) {
    switch (theme) {
      case MapTheme.dark:
        // Esri Dark Gray Canvas (no requiere key)
        return (
          url:
              'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
          attribution:
              '© Esri, HERE, Garmin, FAO, NOAA, USGS — Esri Dark Gray Canvas'
        );
      case MapTheme.satellite:
        // Esri World Imagery (satelital, no requiere key)
        return (
          url:
              'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          attribution: '© Esri, Maxar, Earthstar Geographics — World Imagery'
        );
      case MapTheme.light:
        return (
          url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
          attribution: '© OpenStreetMap contributors'
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    final base = _baseLayerFor(_theme);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Rastreo de Técnico'),
        backgroundColor: const Color.fromARGB(255, 8, 64, 110),
        foregroundColor: Colors.white,
        actions: [
          Text(
                'Estilo del mapa',
                style: TextStyle(fontSize: 14, fontWeight: FontWeight.w400),
              ),
          IconButton(
            icon: const Icon(Icons.map_outlined, color: Colors.white),
            onPressed: () => _showMapThemePicker(context),
            tooltip: 'Cambiar estilo de mapa',
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: Stack(
        children: [
          FlutterMap(
            mapController: _mapController,
            options: MapOptions(
              initialCenter: _initialCenter,
              initialZoom: _initialZoom,
              interactionOptions: const InteractionOptions(
                flags: ~InteractiveFlag.doubleTapZoom,
              ),
            ),
            children: [
              TileLayer(
                urlTemplate: base.url,
                userAgentPackageName: 'com.example.yourapp',
              ),
              MarkerLayer(
                markers: [
                  Marker(
                    point: _initialCenter,
                    width: 40,
                    height: 40,
                    child: const Icon(Icons.location_pin, size: 40),
                  ),
                ],
              ),
            ],
          ),

          // Atribución discreta
          Positioned(
            left: 8,
            bottom: 8,
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: Colors.black.withOpacity(0.5),
                borderRadius: BorderRadius.circular(6),
              ),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                child: Text(
                  base.attribution,
                  style: const TextStyle(color: Colors.white, fontSize: 11),
                ),
              ),
            ),
          ),

          // Botón opcional: centrar (si activas geolocator)
          Positioned(
            right: 16,
            bottom: 16,
            child: FloatingActionButton(
              onPressed: _goToMyLocation,
              child: const Icon(Icons.my_location),
            ),
          ),
        ],
      ),
    );
  }

  // --- Selector de tema: Bottom Sheet con tarjetas ---
  void _showMapThemePicker(BuildContext context) {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (ctx) => _ThemePickerGrid(
        current: _theme,
        onSelect: (m) {
          setState(() => _theme = m);
          Navigator.pop(ctx);
        },
      ),
    );
  }

  // --- Opcional: centrar en mi ubicación (requiere permisos) ---
  Future<void> _goToMyLocation() async {
    bool serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) {
      await Geolocator.openLocationSettings();
      return;
    }
    LocationPermission permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
      if (permission == LocationPermission.denied) return;
    }
    if (permission == LocationPermission.deniedForever) return;

    final pos = await Geolocator.getCurrentPosition(
      desiredAccuracy: LocationAccuracy.best,
    );
    final here = LatLng(pos.latitude, pos.longitude);
    _mapController.move(here, 16);
  }
}

// ================== Widgets del selector ==================

class _ThemePickerGrid extends StatelessWidget {
  const _ThemePickerGrid({
    required this.current,
    required this.onSelect,
  });

  final MapTheme current;
  final ValueChanged<MapTheme> onSelect;

  @override
  Widget build(BuildContext context) {
    final sheet = Material(
      borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
      color: Theme.of(context).colorScheme.surface,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: Colors.black26,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            const SizedBox(height: 16),
            const Align(
              alignment: Alignment.centerLeft,
              child: Text(
                'Estilo del mapa',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
              ),
            ),
            const SizedBox(height: 12),
            GridView.count(
              crossAxisCount: 3,
              shrinkWrap: true,
              mainAxisSpacing: 12,
              crossAxisSpacing: 12,
              childAspectRatio: 0.85,
              physics: const NeverScrollableScrollPhysics(),
              children: [
                _ThemeCard(
                  label: 'Claro',
                  selected: current == MapTheme.light,
                  preview: _LightPreview(),
                  onTap: () => onSelect(MapTheme.light),
                ),
                _ThemeCard(
                  label: 'Oscuro',
                  selected: current == MapTheme.dark,
                  preview: _DarkPreview(),
                  onTap: () => onSelect(MapTheme.dark),
                ),
                _ThemeCard(
                  label: 'Satelital',
                  selected: current == MapTheme.satellite,
                  preview: _SatellitePreview(),
                  onTap: () => onSelect(MapTheme.satellite),
                ),
              ],
            ),
          ],
        ),
      ),
    );

    return SafeArea(top: false, child: sheet);
  }
}

class _ThemeCard extends StatelessWidget {
  const _ThemeCard({
    required this.label,
    required this.preview,
    required this.onTap,
    this.selected = false,
  });

  final String label;
  final Widget preview;
  final VoidCallback onTap;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(14),
      onTap: onTap,
      child: Card(
        elevation: selected ? 6 : 2,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
          side: BorderSide(
            color:
                selected ? Theme.of(context).colorScheme.primary : Colors.transparent,
            width: 2,
          ),
        ),
        clipBehavior: Clip.antiAlias,
        child: Column(
          children: [
            Expanded(
              child: SizedBox.expand(child: preview),
            ),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
              color: Colors.black54,
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(label,
                      style: const TextStyle(
                          color: Colors.white, fontWeight: FontWeight.w600)),
                  if (selected)
                    const Icon(Icons.check_circle, color: Colors.white, size: 18),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ================== Previews “representativos” ==================

class _LightPreview extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return _MapSketch(
      base: const Color(0xFFEFEFEF),
      roads: Colors.white,
      rivers: const Color(0xFFB8D9F4),
      parks: const Color(0xFFCDE8C9),
      labels: Colors.black54,
    );
  }
}

class _DarkPreview extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return _MapSketch(
      base: const Color(0xFF23262A),
      roads: const Color(0xFF666B73),
      rivers: const Color(0xFF3A5569),
      parks: const Color(0xFF2F5136),
      labels: Colors.white70,
    );
  }
}

class _SatellitePreview extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return _MapSketch(
      base: const Color(0xFF4A6A47), // vegetación
      roads: const Color(0xFFEDEDED), // caminos claros
      rivers: const Color(0xFF2F7FB3), // agua
      parks: const Color(0xFF6E8B5B),
      labels: Colors.white70,
      textured: true,
    );
  }
}

// “Dibujo” genérico para simular un mapa
class _MapSketch extends StatelessWidget {
  const _MapSketch({
    required this.base,
    required this.roads,
    required this.rivers,
    required this.parks,
    required this.labels,
    this.textured = false,
  });

  final Color base, roads, rivers, parks, labels;
  final bool textured;

  @override
  Widget build(BuildContext context) {
    return Container(
      color: base,
      child: Stack(
        children: [
          if (textured)
            Positioned.fill(
              child: Opacity(
                opacity: 0.25,
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      stops: const [0.0, 0.5, 1.0],
                      colors: [base, parks, base],
                    ),
                  ),
                ),
              ),
            ),
          // “ríos”
          _river(20, 10, rivers),
          _river(60, 18, rivers),
          // “parques”
          _block(const Rect.fromLTWH(8, 8, 30, 20), parks),
          _block(const Rect.fromLTWH(55, 55, 28, 18), parks),
          // “calles”
          _road(0, 30, 100, 30, roads),
          _road(10, 0, 10, 100, roads),
          _road(60, 0, 60, 100, roads),
          _road(0, 70, 100, 70, roads),
          // texto simulado
          const Positioned(
            left: 12,
            top: 40,
            child: Text(
              '',
            ),
          ),
        ],
      ),
    );
  }

  Widget _block(Rect r, Color c) => Positioned(
        left: r.left,
        top: r.top,
        width: r.width,
        height: r.height,
        child: Container(color: c),
      );

  Widget _road(double x1, double y1, double x2, double y2, Color c) {
    return Positioned.fill(
      child: CustomPaint(
        painter: _LinePainter(Offset(x1, y1), Offset(x2, y2), c, 6),
      ),
    );
  }

  Widget _river(double y, double w, Color c) {
    return Positioned.fill(
      child: CustomPaint(
        painter: _LinePainter(Offset(0, y), Offset(100, y + 10), c, w),
      ),
    );
  }
}

class _LinePainter extends CustomPainter {
  _LinePainter(this.a, this.b, this.color, this.width);
  final Offset a, b;
  final Color color;
  final double width;

  @override
  void paint(Canvas canvas, Size size) {
    final p = Paint()
      ..color = color
      ..strokeWidth = width
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round;

    // Escala del espacio 0–100 al tamaño real del widget
    final sx = size.width / 100.0;
    final sy = size.height / 100.0;
    canvas.drawLine(
      Offset(a.dx * sx, a.dy * sy),
      Offset(b.dx * sx, b.dy * sy),
      p,
    );
  }

  @override
  bool shouldRepaint(covariant _LinePainter oldDelegate) =>
      oldDelegate.color != color ||
      oldDelegate.width != width ||
      oldDelegate.a != a ||
      oldDelegate.b != b;
}
