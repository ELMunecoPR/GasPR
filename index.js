const path = require("path");
const express = require("express");
const cheerio = require("cheerio");

const app = express();
app.use(express.static(__dirname))
const PORT = 3001;

async function obtenerPrecios() {
  const url ="https://www.daco.pr.gov/?53e8dab1_page=3&a551dcf7_page=2";


  const respuesta = await fetch(url);
  const html = await respuesta.text();

  const $ = cheerio.load(html);

  const texto = $("body")
    .text()
    .replace(/\s+/g, " ")
    .trim();
console.log(texto.includes("Bomba"), texto.slice(0, 1000));

  const regular = texto.match(/Bomba\s*(\d{2,3}\.\d)\s*(\d{2,3}\.\d)\s*REGULAR/i);
  const premium = texto.match(/REGULAR\s*(\d{2,3}\.\d)\s*(\d{2,3}\.\d)\s*PREMIUM/i);
  const diesel = texto.match(/PREMIUM\s*(\d{2,3}\.\d)\s*(\d{2,3}\.\d)\s*DI[ÉE]SEL/i);
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
for (const marca of marcasConocidas) {
  console.log("Buscando marca:", marca);
}

  return {
    actualizado: new Date().toISOString(),
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
