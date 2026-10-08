const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const express = require("express");
const cheerio = require("cheerio");
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

async function peticionSupabase(recurso, opciones = {}) {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    const error = new Error("Faltan SUPABASE_URL o SUPABASE_SECRET_KEY en la configuración del servidor.");
    error.status = 500;
    throw error;
  }

  let respuesta;
  try {
    const base = new URL(SUPABASE_URL);
    if (base.protocol !== "https:") {
      throw new Error("Configuración inválida");
    }
    const url = new URL(`${base.href.replace(/\/$/, "")}/rest/v1/${recurso}`);
    if (url.origin !== base.origin) {
      throw new Error("Recurso inválido");
    }
    const headers = new Headers(opciones.headers);
    headers.set("Authorization", `Bearer ${SUPABASE_SECRET_KEY}`);
    headers.set("apikey", SUPABASE_SECRET_KEY);
    respuesta = await fetch(url, {
      ...opciones,
      headers,
      redirect: "error",
      signal: opciones.signal || AbortSignal.timeout(10000)
    });
  } catch {
    const error = new Error("No se pudo conectar con Supabase. Revisa la URL y la conexión del servidor.");
    error.status = 502;
    throw error;
  }

  if (!respuesta.ok) {
    const error = new Error(`Supabase respondió con un error HTTP ${respuesta.status}. Revisa las credenciales y el acceso al recurso.`);
    error.status = 502;
    throw error;
  }

  return respuesta;
}

const app = express();
app.use(express.static(__dirname))
app.use("/api/station-prices", express.json({ limit: "16kb" }));
app.use("/api/station-prices", (error, req, res, next) => {
  if (!error) return next();
  res.status(error.status === 413 ? 413 : 400).json({
    ok: false,
    message: error.status === 413 ? "El reporte excede el tamaño permitido." : "El cuerpo debe contener JSON válido."
  });
});
const PORT = 3001;
const URL_GASOLINERAS = "https://sigejp.pr.gov/server/rest/services/Public_Assets/public_assets_5142019/FeatureServer/0/query";
const RADIO_BUSQUEDA_MARCA_METROS = 16000;
async function obtenerGasolinerasGoogle(latitud, longitud, radio = 5000) { 
  const respuesta = await fetch(
    "https://places.googleapis.com/v1/places:searchNearby",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress,places.location"
      },
      body: JSON.stringify({
        includedTypes: ["gas_station"],
        maxResultCount: 20,
        locationRestriction: {
          circle: {
            center: {
              latitude: latitud,
              longitude: longitud
            },
            radius: radio
          }
        }
      })
    }
  );

  const datos = await respuesta.json();

  return datos.places || [];
}
async function obtenerGasolineras(municipio) {
const parametros = new URLSearchParams();
const filtro = municipio
  ? `UPPER(City)='${municipio.toUpperCase()}'`
  : "1=1";

parametros.append("where", filtro);
parametros.append("outFields", "Name,City,GPS_Latitu,GPS_Longit");
parametros.append("f", "json");
const respuesta = await fetch(`${URL_GASOLINERAS}?${parametros.toString()}`);
const datos = await respuesta.json();

return datos.features || [];
}

const MUNICIPIOS_PR = ["Adjuntas","Aguada","Aguadilla","Aguas Buenas","Aibonito","Añasco","Arecibo","Arroyo","Barceloneta","Barranquitas","Bayamón","Cabo Rojo","Caguas","Camuy","Canóvanas","Carolina","Cataño","Cayey","Ceiba","Ciales","Cidra","Coamo","Comerío","Corozal","Culebra","Dorado","Fajardo","Florida","Guánica","Guayama","Guayanilla","Guaynabo","Gurabo","Hatillo","Hormigueros","Humacao","Isabela","Jayuya","Juana Díaz","Juncos","Lajas","Lares","Las Marías","Las Piedras","Loíza","Luquillo","Manatí","Maricao","Maunabo","Mayagüez","Moca","Morovis","Naguabo","Naranjito","Orocovis","Patillas","Peñuelas","Ponce","Quebradillas","Rincón","Río Grande","Sabana Grande","Salinas","San Germán","San Juan","San Lorenzo","San Sebastián","Santa Isabel","Toa Alta","Toa Baja","Trujillo Alto","Utuado","Vega Alta","Vega Baja","Vieques","Villalba","Yabucoa","Yauco"];

function normalizarMunicipio(valor) {
  return String(valor || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/\b(municipio de|municipality|municipio)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

function perteneceAlMunicipio(estacion, municipio) {
  const ubicacion = estacion.location;
  if (!estacion.id || !Number.isFinite(ubicacion?.latitude) || !Number.isFinite(ubicacion?.longitude)
      || ubicacion.latitude < 17.8 || ubicacion.latitude > 18.6
      || ubicacion.longitude < -67.4 || ubicacion.longitude > -65.2) return false;
  const objetivo = normalizarMunicipio(municipio);
  const componentes = estacion.addressComponents || [];
  const coincide = c => [c.longText, c.shortText].some(v => normalizarMunicipio(v) === objetivo);
  // Los resultados auditados usan country=PR, nivel 1=municipio y nivel 2=barrio.
  // Reconocer el nombre contra los 78 municipios evita asumir un nivel fijo:
  // si nivel 1 contiene Puerto Rico, se evalúan nivel 2, localidad y dirección.
  const paisPR = componentes.some(c => c.types?.includes("country") && c.shortText === "PR");
  const esMunicipio = c => MUNICIPIOS_PR.some(nombre =>
    [c.longText, c.shortText].some(v => normalizarMunicipio(v) === normalizarMunicipio(nombre)));
  const nivel1 = componentes.filter(c => c.types?.includes("administrative_area_level_1") && esMunicipio(c));
  if (paisPR && nivel1.length) return nivel1.some(coincide);
  const municipales = componentes.filter(c => c.types?.includes("administrative_area_level_2")
    && esMunicipio(c));
  // Un municipio administrativo reconocido tiene prioridad sobre una localidad postal vecina.
  if (municipales.length) return municipales.some(coincide);
  if (componentes.some(c => c.types?.includes("locality") && coincide(c))) return true;
  return String(estacion.formattedAddress || "").split(",").some(parte =>
    normalizarMunicipio(parte).replace(/\s+(?:pr\s+)?\d{5}(?:\s+\d{4})?$/, "") === objetivo
  );
}

async function obtenerGasolinerasMunicipio(municipio) {
  if (!GOOGLE_MAPS_API_KEY) throw new Error("Google Places no está configurado");
  const estaciones = new Map();
  const consulta = {
    textQuery: `gas stations in ${municipio}, Puerto Rico`,
    includedType: "gas_station", strictTypeFiltering: true,
    languageCode: "es", regionCode: "PR", pageSize: 20
  };
  let pageToken;
  for (let pagina = 0; pagina < 3; pagina++) {
    const respuesta = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json", "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.addressComponents,nextPageToken"
      },
      body: JSON.stringify({ ...consulta, ...(pageToken ? { pageToken } : {}) }),
      signal: AbortSignal.timeout(15000)
    });
    if (!respuesta.ok) throw new Error("Falló la búsqueda de Google Places");
    const datos = await respuesta.json();
    if (datos.error || (datos.places != null && !Array.isArray(datos.places))) {
      throw new Error("Respuesta inválida de Google Places");
    }
    for (const estacion of datos.places || []) {
      if (perteneceAlMunicipio(estacion, municipio)) {
        const { id, displayName, formattedAddress, location } = estacion;
        estaciones.set(id, { id, displayName, formattedAddress, location });
      }
    }
    pageToken = datos.nextPageToken;
    if (!pageToken) break;
  }
  return [...estaciones.values()];
}

async function obtenerPrecios() {

  const urlGeneral = "https://www.daco.pr.gov/?53e8dab1_page=3&a551dcf7_page=2";
  const urlMarcas = "https://www.daco.pr.gov/recursos?342e6971_page=2&a4165446_page=2";


  const respuestaGeneral = await fetch(urlGeneral);
  const respuestaMarcas = await fetch(urlMarcas);
  const htmlGeneral = await respuestaGeneral.text();
  const htmlMarcas = await respuestaMarcas.text();

  const $general = cheerio.load(htmlGeneral);
  const $marcas = cheerio.load(htmlMarcas);

  const textoGeneral = $general("body").text().replace(/\s+/g, " ").trim();
  const textoMarcas = $marcas("body").text().replace(/\s+/g, " ").trim();

  const regular = textoGeneral.match(/Bomba\s*(\d{2,3}\.\d)\s*(\d{2,3}\.\d)\s*REGULAR/i);
  const premium = textoGeneral.match(/REGULAR\s*(\d{2,3}\.\d)\s*(\d{2,3}\.\d)\s*PREMIUM/i);
  const diesel = textoGeneral.match(/PREMIUM\s*(\d{2,3}\.\d)\s*(\d{2,3}\.\d)\s*DI[ÉE]SEL/i);
  const marcas = [];
  const pueblos = [];
  const estaciones = [];
  const preciosPorPueblo = {};
  const marcasConocidas = [
  "76",
  "American",
  "Bita's",
  "EcoMaxx",
  "Gulf",
  "Mobil",
  "Phillips 66",
  "Puma",
  "Shell",
  "Sunoco",
  "Texaco",
  "T-Express",
  "Total",
  "Ultra Top Fuel"
];
console.log("Marcas cargadas:", marcasConocidas.length);
for (const marca of marcasConocidas) {
  const nombreSeguro = marca.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const patron = new RegExp(
    `${nombreSeguro}(\\d{2,3}\\.\\d)Regular(\\d{2,3}\\.\\d)Premium(\\d{2,3}\\.\\d)Di[ée]sel`,
    "i"
  );

  const resultado = textoMarcas.match(patron);

  if (resultado) {
    marcas.push({
      marca: marca,
      regular: Number(resultado[1]),
      premium: Number(resultado[2]),
      diesel: Number(resultado[3])
    });
  }
}
  return {
    actualizado: new Date().toISOString(),
    marcas: marcas,
    regular: {
      minimo: regular ? Number(regular[1]) : null,
      maximo: regular ? Number(regular[2]) : null
    },
    premium: {
      minimo: premium ? Number(premium[1]) : null,
      maximo: premium ? Number(premium[2]) : null
    },
    diesel: {
      minimo: diesel ? Number(diesel[1]) : null,
      maximo: diesel ? Number(diesel[2]) : null
    }
  };
} 
const COLUMNAS_REPORTE = "id,created_at,place_id,station_name,brand,address,regular,premium,diesel,reported_at,source";

function consultaReporte(placeId) {
  // Las comillas y escapes mantienen el identificador como un valor literal de PostgREST.
  const literal = placeId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return new URLSearchParams({
    select: COLUMNAS_REPORTE,
    place_id: `eq."${literal}"`,
    limit: "1"
  });
}

app.get("/api/station-prices", async (req, res) => {
  try {
    const reports = [];
    const tamanoPagina = 1000;
    let offset = 0;
    while (true) {
      const parametros = new URLSearchParams({
        select: COLUMNAS_REPORTE, order: "id.asc", limit: String(tamanoPagina), offset: String(offset)
      });
      const respuesta = await peticionSupabase(`station_prices?${parametros}`);
      const pagina = await respuesta.json();
      if (!Array.isArray(pagina)) throw new Error("Respuesta inválida");
      reports.push(...pagina);
      if (pagina.length === 0) break;
      offset += pagina.length;
    }
    res.json({ ok: true, reports });
  } catch {
    res.status(502).json({ ok: false, message: "No se pudieron obtener los reportes de precios." });
  }
});

app.get("/api/station-prices/:placeId", async (req, res) => {
  try {
    const respuesta = await peticionSupabase(`station_prices?${consultaReporte(req.params.placeId)}`);
    const reports = await respuesta.json();
    if (!Array.isArray(reports)) throw new Error("Respuesta inválida");
    res.json({ ok: true, report: reports[0] || null });
  } catch {
    res.status(502).json({ ok: false, message: "No se pudo obtener el reporte de la estación." });
  }
});

app.post("/api/station-prices", async (req, res) => {
  const datos = req.body;
  if (!datos || typeof datos !== "object" || Array.isArray(datos)) {
    return res.status(400).json({ ok: false, message: "El cuerpo debe ser un objeto JSON." });
  }
  for (const campo of ["placeId", "stationName"]) {
    if (typeof datos[campo] !== "string" || !datos[campo].trim()) {
      return res.status(400).json({ ok: false, message: `${campo} es obligatorio y debe ser texto.` });
    }
  }
  for (const campo of ["brand", "address"]) {
    if (datos[campo] != null && typeof datos[campo] !== "string") {
      return res.status(400).json({ ok: false, message: `${campo} debe ser texto o null.` });
    }
  }
  const precios = {};
  for (const combustible of ["regular", "premium", "diesel"]) {
    const precio = datos[combustible];
    if (precio == null) continue;
    if (typeof precio !== "number" || !Number.isFinite(precio) || precio < 50 || precio > 300) {
      return res.status(400).json({ ok: false, message: `${combustible} debe ser un número entre 50 y 300 centavos por litro.` });
    }
    precios[combustible] = precio;
  }
  if (Object.keys(precios).length === 0) {
    return res.status(400).json({ ok: false, message: "Debes reportar al menos un precio." });
  }

  try {
    const placeId = datos.placeId.trim();
    const consulta = consultaReporte(placeId);
    const respuesta = await peticionSupabase(`station_prices?${consulta}`);
    const existentes = await respuesta.json();
    if (!Array.isArray(existentes)) throw new Error("Respuesta inválida");
    const existe = existentes.length > 0;
    const reporte = {
      station_name: datos.stationName.trim(),
      ...precios,
      reported_at: new Date().toISOString(),
      source: "usuario"
    };
    for (const campo of ["brand", "address"]) {
      if (datos[campo] !== undefined) reporte[campo] = datos[campo];
    }
    let recurso;
    if (existe) {
      const parametros = new URLSearchParams({ select: COLUMNAS_REPORTE, id: `eq.${existentes[0].id}` });
      recurso = `station_prices?${parametros}`;
    } else {
      reporte.place_id = placeId;
      reporte.brand = reporte.brand ?? null;
      reporte.address = reporte.address ?? null;
      for (const combustible of ["regular", "premium", "diesel"]) {
        reporte[combustible] = reporte[combustible] ?? null;
      }
      recurso = `station_prices?${new URLSearchParams({ select: COLUMNAS_REPORTE })}`;
    }
    // PATCH incluye únicamente los combustibles reportados para conservar los demás.
    const guardado = await peticionSupabase(recurso, {
      method: existe ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify(reporte)
    });
    const reports = await guardado.json();
    if (!Array.isArray(reports) || !reports[0]) throw new Error("Respuesta inválida");
    res.status(existe ? 200 : 201).json({ ok: true, report: reports[0] });
  } catch {
    res.status(502).json({ ok: false, message: "No se pudo guardar el reporte de precios." });
  }
});

app.get("/api/supabase-test", async (req, res) => {
  try {
    const respuesta = await peticionSupabase("station_prices?select=id&limit=1");
    await respuesta.arrayBuffer();
    res.json({ ok: true, message: "Supabase conectado correctamente" });
  } catch (error) {
    res.status(error.status || 502).json({
      ok: false,
      message: error.status
        ? error.message
        : "No se pudo completar la respuesta de Supabase."
    });
  }
});

app.get("/api/gasolineras-google", async (req, res) => {
  try {
    const latitud = Number(req.query.lat);
    const longitud = Number(req.query.lng);

    const gasolineras = await obtenerGasolinerasGoogle(
      latitud,
      longitud
    );

    res.json(gasolineras);
  } catch (error) {
    res.status(500).json({
      error: "No se pudieron obtener las gasolineras de Google"
    });
  }
});
app.get("/api/gasolineras-municipio", async (req, res) => {
  const municipio = MUNICIPIOS_PR.find(nombre => normalizarMunicipio(nombre) === normalizarMunicipio(req.query.municipio));
  if (!municipio) return res.status(400).json({ error: "Selecciona un municipio válido de Puerto Rico." });
  try {
    res.json(await obtenerGasolinerasMunicipio(municipio));
  } catch {
    res.status(502).json({ error: "No se pudieron buscar las gasolineras. Intenta nuevamente." });
  }
});

// Ruta antigua de ArcGIS, conservada por compatibilidad; el selector ya no la utiliza.
app.get("/api/gasolineras", async (req, res) => {
  try {
    const todas = req.query.todas === "1";
    const municipio = todas ? null : (req.query.municipio || "AGUADILLA");
    const gasolineras = await obtenerGasolineras(municipio);
    res.json(gasolineras);
  } catch (error) {
    res.status(500).json({
      error: "No se pudieron obtener las gasolineras"
    });
  }
});
app.get("/api/gasolineras-marca", async (req, res) => {
  try {
    const latitud = Number(req.query.lat);
    const longitud = Number(req.query.lng);

    const gasolineras = await obtenerGasolinerasGoogle(
      latitud,
      longitud,
      RADIO_BUSQUEDA_MARCA_METROS
    );

    res.json(gasolineras);
  } catch (error) {
    res.status(500).json({
      error: "No se pudieron obtener las gasolineras de esa marca"
    });
  }
});
app.get("/api/precios", async (req, res) => {
  try {
    const precios = await obtenerPrecios();
    res.json(precios);
  } catch (error) {
    res.status(500).json({
      error: "No se pudieron obtener los precios de DACO"
    });
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});
app.listen(PORT, () => {
  console.log(`GasPR API funcionando en http://localhost:${PORT}`);
});
