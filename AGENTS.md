# Repository Guidelines

## Enfoque del Agente: Mapas Web Responsivos
- Especialización: mapas tipo Uber, minimalistas, elegantes y rápidos (60fps).
- Entorno: solo PHP en servidor Apache. Sin Node/npm.
- Frontend: librerías JS/CSS vía CDN (sin build step).
- Diseño: mapa oscuro por defecto, alto contraste; UI sutil y táctil.
- Accesibilidad: colores AA, foco visible, teclas de zoom/recorrido.

## Estructura del Proyecto
- `public/` — DocumentRoot de Apache (p. ej., `public/index.php`).
- `src/map/` — bootstrap del mapa, estilos y capas.
- `src/ui/` — controles (search, layers, bottom-sheet) y estado.
- `styles/` — tokens (`tokens.css`) y utilidades.
- `tests/` — unit/integración; refleja `src/`.
- `config/` — vars de entorno y ajustes (p. ej., `.env.example`).

## Desarrollo y Servidor (PHP + Apache)
- Apache ya instalado: establecer `DocumentRoot` en `public/`.
- Desarrollo local con MAMP/XAMPP/Apache nativo. Ejemplo vhost:
  - `<VirtualHost *:80>` `DocumentRoot "/ruta/al/proyecto/public"` `ServerName mapa.local` `</VirtualHost>`
- Sin build step. Refrescar el navegador es suficiente.
- Ejemplo de inclusión CDN en `public/index.php`:
  - `<link href="https://unpkg.com/maplibre-gl@latest/dist/maplibre-gl.css" rel="stylesheet">`
  - `<script src="https://unpkg.com/maplibre-gl@latest/dist/maplibre-gl.js"></script>`
  - Inicializa el mapa en un bloque `<script>`.

## Estilo y Convenciones
- PSR-12 (PHP): indentación 4 espacios, llaves en nueva línea para clases/métodos.
- Nombres: camelCase funciones/variables; PascalCase clases; UPPER_SNAKE_CASE constantes.
- Archivos/dirs en kebab-case (`route-planner/`). Prefijo `Map*` para componentes UI.
- CSS variables en `styles/tokens.css` (ej.: `--bg:#0b0b0b; --accent:#4cc9f0`).
- Formato: usar PHP-CS-Fixer o PHPCS si está configurado.

## Pruebas
- Unit/integración con PHPUnit o Pest (si el proyecto usa Composer).
- Nombres: `*Test.php` y estructura espejada de `src/`.
- Cobertura objetivo ≥80% en cambios. Probar gestos (zoom/drag) con tests funcionales (Codeception) o manuales documentados.
- Comandos (si aplica): `composer install`, `./vendor/bin/pest` o `./vendor/bin/phpunit`.

## Commits y Pull Requests
- Convenciones: Conventional Commits (`feat:`, `fix:`, `refactor:`...).
- PR debe incluir: descripción, issue vinculado, capturas antes/después en 320/768/1280, notas de rendimiento (fps, peso bundle) y accesibilidad.

## Seguridad y Configuración
- No subir secretos. Configurar `.env` (ej.: `MAP_TOKEN=...`) y restringir dominios.
- Servir librerías desde CDN con SRI cuando sea posible.
- Validar/sanitizar entradas usadas en estilos/capas. Documentar claves en `.env.example`.
