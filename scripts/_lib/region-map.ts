export const US_REGIONS = new Set([
  "Bay Area", "New York Metro", "Pacific Northwest", "Boston / Cambridge",
  "Austin", "Los Angeles", "Chicago", "Denver / Boulder",
  "DC Metro", "Miami", "Salt Lake City", "Raleigh / Durham",
  "Atlanta", "Houston", "Dallas", "San Diego", "Minneapolis",
  "Phoenix", "Nashville", "Pittsburgh", "Ann Arbor", "Detroit",
  "St. Louis", "Charlotte", "Columbus", "Cincinnati", "Louisville",
  "Memphis", "Richmond", "New Orleans", "Kansas City", "San Antonio", "Tucson",
]);

// Keywords that indicate a job title / role description — not a location.
// Strings matching these are treated as null in normalizeRegion.
const JOB_TITLE_SIGNALS = [
  "engineer", "developer", "designer", "manager", "founder", "scientist",
  "researcher", "analyst", "executive", "director", "president",
  // "intern" and "lead" omitted — false-positive on "international" / "Cleveland"
  "officer", "architect", "specialist", "consultant", "partner",
  "associate", "coordinator", "recruiter", "advisor", "strategist",
  // salary / compensation strings
  "salary", "equity", "benefits", "k+",
  // catch-all role noise (avoid "swe" — false-positive on "Sweden")
  "full stack", "fullstack", "backend", "frontend", "devops",
  "aes,", "csms,",
];

export const REGION_MAP: Record<string, string> = {
  // ── Bay Area ──────────────────────────────────────────────────────────────
  "san francisco": "Bay Area",
  sf: "Bay Area",
  "san jose": "Bay Area",
  "palo alto": "Bay Area",
  "mountain view": "Bay Area",
  "menlo park": "Bay Area",
  sunnyvale: "Bay Area",
  "santa clara": "Bay Area",
  "san mateo": "Bay Area",
  "foster city": "Bay Area",
  burlingame: "Bay Area",
  "redwood city": "Bay Area",
  millbrae: "Bay Area",
  "los altos": "Bay Area",
  "los gatos": "Bay Area",
  cupertino: "Bay Area",
  "walnut creek": "Bay Area",
  fremont: "Bay Area",
  emeryville: "Bay Area",
  oakland: "Bay Area",
  berkeley: "Bay Area",
  "south bay": "Bay Area",

  // ── New York Metro ────────────────────────────────────────────────────────
  "new york": "New York Metro",
  nyc: "New York Metro",
  brooklyn: "New York Metro",
  manhattan: "New York Metro",
  "jersey city": "New York Metro",
  hoboken: "New York Metro",
  newark: "New York Metro",
  "new providence": "New York Metro",

  // ── Pacific Northwest ─────────────────────────────────────────────────────
  seattle: "Pacific Northwest",
  bellevue: "Pacific Northwest",
  redmond: "Pacific Northwest",
  shoreline: "Pacific Northwest",
  portland: "Pacific Northwest",

  // ── Boston / Cambridge ────────────────────────────────────────────────────
  boston: "Boston / Cambridge",
  cambridge: "Boston / Cambridge",
  woburn: "Boston / Cambridge",
  burlington: "Boston / Cambridge",
  waltham: "Boston / Cambridge",

  // ── DC Metro ──────────────────────────────────────────────────────────────
  "washington, dc": "DC Metro",
  "washington dc": "DC Metro",
  "washington, d.c": "DC Metro",
  bethesda: "DC Metro",
  arlington: "DC Metro",
  alexandria: "DC Metro",
  mclean: "DC Metro",
  reston: "DC Metro",
  baltimore: "DC Metro",
  annapolis: "DC Metro",

  // ── Austin ────────────────────────────────────────────────────────────────
  austin: "Austin",
  "georgetown, tx": "Austin",

  // ── Los Angeles ───────────────────────────────────────────────────────────
  "los angeles": "Los Angeles",
  " la,": "Los Angeles",          // ", LA," avoids matching "Atlanta"
  "santa monica": "Los Angeles",
  "culver city": "Los Angeles",
  "el segundo": "Los Angeles",
  "manhattan beach": "Los Angeles",
  "hermosa beach": "Los Angeles",
  "long beach": "Los Angeles",
  "irvine": "Los Angeles",        // Orange County but close enough
  "newport beach": "Los Angeles",
  "huntington beach": "Los Angeles",
  "santa barbara": "Los Angeles",
  "ventura": "Los Angeles",
  carlsbad: "Los Angeles",
  pasadena: "Los Angeles",

  // ── Chicago ───────────────────────────────────────────────────────────────
  chicago: "Chicago",
  evanston: "Chicago",
  "downers grove": "Chicago",
  "lisle,": "Chicago",

  // ── Denver / Boulder ──────────────────────────────────────────────────────
  denver: "Denver / Boulder",
  boulder: "Denver / Boulder",

  // ── Miami ─────────────────────────────────────────────────────────────────
  miami: "Miami",
  "fort lauderdale": "Miami",
  "west palm": "Miami",
  tampa: "Miami",
  orlando: "Miami",
  "boca raton": "Miami",

  // ── Houston ───────────────────────────────────────────────────────────────
  houston: "Houston",

  // ── Dallas ────────────────────────────────────────────────────────────────
  dallas: "Dallas",
  "fort worth": "Dallas",
  plano: "Dallas",
  frisco: "Dallas",

  // ── Atlanta ───────────────────────────────────────────────────────────────
  atlanta: "Atlanta",
  kennesaw: "Atlanta",

  // ── Nashville ─────────────────────────────────────────────────────────────
  nashville: "Nashville",

  // ── Raleigh / Durham ──────────────────────────────────────────────────────
  raleigh: "Raleigh / Durham",
  durham: "Raleigh / Durham",
  "chapel hill": "Raleigh / Durham",

  // ── Pittsburgh ────────────────────────────────────────────────────────────
  pittsburgh: "Pittsburgh",

  // ── San Diego ─────────────────────────────────────────────────────────────
  "san diego": "San Diego",

  // ── Salt Lake City (Silicon Slopes) ──────────────────────────────────────
  "salt lake": "Salt Lake City",
  lehi: "Salt Lake City",
  provo: "Salt Lake City",
  orem: "Salt Lake City",
  ogden: "Salt Lake City",

  // ── Minneapolis ───────────────────────────────────────────────────────────
  minneapolis: "Minneapolis",
  "st. paul": "Minneapolis",

  // ── Phoenix ───────────────────────────────────────────────────────────────
  phoenix: "Phoenix",
  tempe: "Phoenix",
  scottsdale: "Phoenix",
  chandler: "Phoenix",

  // ── Other US metros ───────────────────────────────────────────────────────
  "ann arbor": "Ann Arbor",
  detroit: "Detroit",
  "st. louis": "St. Louis",
  "saint louis": "St. Louis",
  charlotte: "Charlotte",
  columbus: "Columbus",
  cincinnati: "Cincinnati",
  louisville: "Louisville",
  memphis: "Memphis",
  richmond: "Richmond",
  "new orleans": "New Orleans",
  "kansas city": "Kansas City",
  "san antonio": "San Antonio",
  tucson: "Tucson",

  // ── Remote ────────────────────────────────────────────────────────────────
  remote: "Remote",
  distributed: "Remote",

  // ── International: Canada ─────────────────────────────────────────────────
  toronto: "Toronto",
  vancouver: "Vancouver",
  montreal: "Montreal",
  montréal: "Montreal",
  waterloo: "Waterloo",
  calgary: "Calgary",
  edmonton: "Edmonton",
  ottawa: "Ottawa",
  winnipeg: "Winnipeg",
  "kitchener": "Waterloo",

  // ── International: UK ─────────────────────────────────────────────────────
  london: "London",
  "united kingdom": "London",
  " uk,": "London",
  " uk ": "London",
  "| uk": "London",
  manchester: "London",
  edinburgh: "London",
  bristol: "London",
  birmingham: "London",
  glasgow: "London",

  // ── International: Germany ────────────────────────────────────────────────
  berlin: "Berlin",
  munich: "Munich",
  münchen: "Munich",
  hamburg: "Hamburg",
  frankfurt: "Frankfurt",
  cologne: "Frankfurt",
  karlsruhe: "Berlin",
  germany: "Germany",

  // ── International: France ─────────────────────────────────────────────────
  paris: "Paris",
  france: "Paris",
  "île-de-france": "Paris",
  "ile-de-france": "Paris",
  levallois: "Paris",

  // ── International: Nordics ────────────────────────────────────────────────
  stockholm: "Stockholm",
  sweden: "Stockholm",
  sverige: "Stockholm",
  zweden: "Stockholm",
  denmark: "Copenhagen",
  danish: "Copenhagen",
  copenhagen: "Copenhagen",
  "københavn": "Copenhagen",
  danmark: "Copenhagen",
  oslo: "Oslo",
  norway: "Oslo",
  "bergen,": "Oslo",
  helsinki: "Helsinki",
  finland: "Helsinki",
  lysaker: "Oslo",

  // ── International: Israel ─────────────────────────────────────────────────
  "tel aviv": "Tel Aviv",
  "tel-aviv": "Tel Aviv",
  israel: "Tel Aviv",

  // ── International: India ──────────────────────────────────────────────────
  bangalore: "Bangalore",
  bengaluru: "Bangalore",
  bengalooru: "Bangalore",
  mumbai: "Mumbai",
  "new delhi": "Delhi",
  "delhi": "Delhi",
  hyderabad: "Hyderabad",
  pune: "Pune",
  chennai: "Chennai",
  noida: "Delhi",
  gurgaon: "Gurgaon",
  gurugram: "Gurgaon",
  kolkata: "Kolkata",
  jaipur: "India",
  indore: "India",
  surat: "India",
  chandigarh: "India",
  india: "India",

  // ── International: Southeast Asia ────────────────────────────────────────
  singapore: "Singapore",
  jakarta: "Jakarta",
  "ho chi minh": "Ho Chi Minh City",
  hanoi: "Hanoi",
  vietnam: "Vietnam",
  "kuala lumpur": "Kuala Lumpur",
  malaysia: "Kuala Lumpur",
  philippines: "Manila",
  manila: "Manila",
  "taguig": "Manila",
  indonesia: "Jakarta",
  bandung: "Jakarta",

  // ── International: East Asia ──────────────────────────────────────────────
  tokyo: "Tokyo",
  japan: "Tokyo",
  seoul: "Seoul",
  korea: "Seoul",
  beijing: "Beijing",
  shanghai: "Shanghai",
  shenzhen: "Shenzhen",
  china: "China",
  "hong kong": "Hong Kong",

  // ── International: Australia / NZ ─────────────────────────────────────────
  sydney: "Sydney",
  melbourne: "Melbourne",
  brisbane: "Brisbane",
  "gold coast": "Brisbane",
  "sunshine coast": "Brisbane",
  perth: "Perth",
  australia: "Australia",
  "new zealand": "Auckland",
  auckland: "Auckland",

  // ── International: LATAM ──────────────────────────────────────────────────
  "são paulo": "São Paulo",
  "sao paulo": "São Paulo",
  brazil: "Brazil",
  brasil: "Brazil",
  "rio de janeiro": "Rio de Janeiro",
  "belo horizonte": "Brazil",
  curitiba: "Brazil",
  "mexico city": "Mexico City",
  "ciudad de mexico": "Mexico City",
  "cdmx": "Mexico City",
  mexico: "Mexico",
  monterrey: "Mexico",
  guadalajara: "Mexico",
  bogotá: "Bogotá",
  bogota: "Bogotá",
  colombia: "Colombia",
  medellín: "Colombia",
  medellin: "Colombia",
  "buenos aires": "Buenos Aires",
  argentina: "Argentina",
  santiago: "Santiago",
  chile: "Santiago",
  lima: "Lima",
  peru: "Lima",

  // ── International: Middle East / Africa ───────────────────────────────────
  dubai: "Dubai",
  "united arab emirates": "Dubai",
  uae: "Dubai",
  riyadh: "Riyadh",
  "saudi arabia": "Riyadh",
  jeddah: "Riyadh",
  cairo: "Cairo",
  egypt: "Cairo",
  nairobi: "Nairobi",
  kenya: "Nairobi",
  lagos: "Lagos",
  nigeria: "Lagos",
  accra: "Accra",
  ghana: "Accra",

  // ── International: Eastern Europe ─────────────────────────────────────────
  amsterdam: "Amsterdam",
  netherlands: "Amsterdam",
  barcelona: "Barcelona",
  spain: "Barcelona",
  madrid: "Madrid",
  lisbon: "Lisbon",
  portugal: "Lisbon",
  zurich: "Zurich",
  zürich: "Zurich",
  switzerland: "Zurich",
  zug: "Zurich",
  dublin: "Dublin",
  ireland: "Dublin",
  brussels: "Brussels",
  belgium: "Brussels",
  warsaw: "Warsaw",
  poland: "Warsaw",
  poznan: "Warsaw",
  prague: "Prague",
  "czech": "Prague",
  vienna: "Vienna",
  austria: "Vienna",
  graz: "Vienna",
  budapest: "Budapest",
  hungary: "Budapest",
  tallinn: "Tallinn",
  estonia: "Tallinn",
  vilnius: "Vilnius",
  lithuania: "Vilnius",
  riga: "Riga",
  latvia: "Riga",
  belgrade: "Belgrade",
  serbia: "Belgrade",
  zagreb: "Zagreb",
  croatia: "Zagreb",
  luxembourg: "Luxembourg",
  tbilisi: "Tbilisi",
  georgia: "Tbilisi",
  istanbul: "Istanbul",
  turkey: "Istanbul",
  nicosia: "Nicosia",
  cyprus: "Nicosia",
  ljubljana: "Ljubljana",
  slovenia: "Ljubljana",
};

/**
 * Normalize a raw location string to a named region.
 * Returns null for job title strings, null/empty inputs, or garbage data.
 * Falls back to the raw string if no match is found.
 */
export function normalizeRegion(rawLocation: string | null): string | null {
  if (!rawLocation) return null;
  const lower = rawLocation.toLowerCase().trim();
  if (!lower) return null;

  // Reject strings that look like job titles or salary ranges, not locations.
  if (JOB_TITLE_SIGNALS.some(s => lower.includes(s))) return null;
  // Reject strings that are obviously not locations (URLs, pure numbers, etc.)
  if (lower.startsWith("http") || lower.startsWith("www.")) return null;

  for (const [key, region] of Object.entries(REGION_MAP)) {
    if (lower.includes(key)) {
      return region;
    }
  }

  // Pass through unknown locations unchanged
  return rawLocation;
}
