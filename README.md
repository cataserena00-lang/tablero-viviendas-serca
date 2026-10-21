# Tablero de gestión de plan de viviendas · DEMO

**SERCA Consultora · Tablero de ejemplo.** Sitio estático (HTML + CSS + JS, sin build) que muestra cómo se puede hacer el seguimiento integral de un plan de viviendas cooperativo: avance de obra, stock, costos, cuotas de beneficiarios, índice de actualización y suficiencia financiera.

> **Todos los datos son ficticios** y tienen fines ilustrativos. «Cooperativa Ejemplo Ltda.» no existe.

## Caso ficticio

- 48 viviendas en 3 etapas de 16, presupuesto de $ 2.400 millones (a valores del mes base, sep-25).
- Plazo de obra de 24 meses; el tablero está "parado" en el mes 14 (oct-26).
- Cuotas de los beneficiarios actualizadas por un índice tipo ICC.

## Estructura

| Archivo | Para qué sirve |
|---|---|
| `index.html` | Estructura de las 7 secciones |
| `styles.css` | Identidad visual (azul `#1380E4`, azul oscuro `#0B2A4A`, Montserrat) y estilos de impresión |
| `data.js` | **Todos los datos y supuestos** (comentados). Es el único archivo que hace falta tocar para cambiar el caso |
| `app.js` | Cálculos, filtros, gráficos (Chart.js) y simulador |
| `assets/logo.png` | Placeholder del logo: reemplazalo por el logo real (mismo nombre; se ve bien con ~360×120 px) |

Dependencias externas (por CDN): Chart.js 4.4.1 y la tipografía Montserrat de Google Fonts. Hace falta conexión a internet para verlas.

## Correrlo localmente

Opción simple: abrir `index.html` con doble clic en el navegador.

Opción con servidor local (recomendada si el navegador bloquea algo):

```bash
python -m http.server 8000
```

y abrir <http://localhost:8000>.

## Cambiar los datos

En `data.js`:

- **Sección 1**: cantidad de viviendas, presupuesto total, plazo, mes actual (`mesActual`).
- **Sección 2**: etapas (inicio, atraso, cuota, morosidad), rubros de obra y materiales (precio, stock, plazo de reposición).
- **Sección 3**: variación mensual del costo real de la construcción (`CCI_VAR`) y del índice de actualización de cuotas (`IAC_VAR`).
- **Sección 4**: aportes no reembolsables, supuestos de inflación y escenarios de morosidad.

El resto del archivo genera las series mensuales (con "ruido" determinístico: siempre se obtienen los mismos números). Los umbrales de los semáforos están al principio de `app.js` (`UMB`).

## Descargar el resumen en PDF

El botón **Descargar resumen (PDF)** abre el diálogo de impresión del navegador con todas las secciones en formato A4. Elegir «Guardar como PDF» como destino.

## Publicar en Vercel desde GitHub

1. Crear un repositorio en GitHub (por ejemplo `tablero-viviendas-serca`) y subir este proyecto:

   ```bash
   git remote add origin https://github.com/<usuario>/tablero-viviendas-serca.git
   git branch -M main
   git push -u origin main
   ```

2. Entrar a <https://vercel.com/new> e importar el repositorio de GitHub.
3. En la configuración del proyecto: **Framework Preset = Other**, dejar vacíos *Build Command* y *Output Directory* (la raíz del repo ya es el sitio). Pulsar **Deploy**.
4. Vercel entrega una URL del tipo `https://tablero-viviendas-serca.vercel.app`, lista para compartir por WhatsApp. Cada `git push` a `main` vuelve a publicar solo.

Opcional: en *Settings → Domains* se puede asociar un dominio propio.

---

SERCA Consultora · info@sercaconsultora.com · 358 4 905227
