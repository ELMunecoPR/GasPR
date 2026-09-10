const path = require("path");
const express = require("express");
const cheerio = require("cheerio");

const app = express();
app.use(express.static(__dirname))
const PORT = 3001;
const URL_GASOLINERAS = "https://sigejp.pr.gov/server/rest/services/Public_Assets/public_assets_5142019/FeatureServer/0/query";
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
return datos.features;
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
