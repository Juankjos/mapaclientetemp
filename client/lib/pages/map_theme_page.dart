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

  // Centro inicial (Guadalajara aprox.). Cámbialo por lo que necesites.
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
        // OpenStreetMap estándar (claro)
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
        title: const Text('Mapa con cambio de tema'),
        actions: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8),
            child: DropdownButtonHideUnderline(
              child: DropdownButton<MapTheme>(
                value: _theme,
                icon: const Icon(Icons.map_outlined),
                items: const [
                  DropdownMenuItem(
                    value: MapTheme.light,
                    child: Text('Claro'),
                  ),
                  DropdownMenuItem(
                    value: MapTheme.dark,
                    child: Text('Oscuro'),
                  ),
                  DropdownMenuItem(
                    value: MapTheme.satellite,
                    child: Text('Satelital'),
                  ),
                ],
                onChanged: (v) {
                  if (v != null) setState(() => _theme = v);
                },
              ),
            ),
          ),
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
                flags: ~InteractiveFlag.doubleTapZoom, // ejemplo de ajuste
              ),
            ),
            children: [
              TileLayer(
                urlTemplate: base.url,
                // Recomendado: define el package para el user-agent en peticiones de tiles
                userAgentPackageName: 'com.example.yourapp',
                // Muestra atribución legal en pantalla
                subdomains: const [], // opcional
                // Puedes mostrar attribution en un widget propio; abajo hay un Overlay
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

          // Atribución discreta (requerido por los proveedores de mapas)
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
