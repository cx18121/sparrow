// SIC and NAICS code → internal industry vocabulary mapping.
//
// The mapped value is a friendly industry label that matches one of the
// alias entries in tags.ts (so tagFromTopic resolves it to the right
// namespaced tag). Codes that don't imply a clear industry (e.g. SIC 7372
// "Prepackaged Software" applies to any vertical that ships software) are
// intentionally absent — we only set Company.industry when the code is
// specific enough to mean something to a student picking an audience.
//
// Coverage focus: codes Apollo most often returns for early-stage tech
// startups. Add more as we see them in the wild.

const SIC_TO_INDUSTRY: Record<string, string> = {
  // --- Finance / banking / fintech ---
  "6020": "fintech", "6021": "fintech", "6022": "fintech", "6029": "fintech",
  "6035": "fintech", "6036": "fintech", "6099": "fintech",
  "6111": "fintech", "6141": "fintech", "6153": "fintech", "6159": "fintech",
  "6199": "fintech", "6200": "fintech", "6211": "fintech", "6282": "fintech",
  "6311": "fintech", "6321": "fintech", "6331": "fintech", "6411": "fintech",

  // --- Real estate ---
  "6512": "real estate", "6513": "real estate", "6531": "real estate",
  "6541": "real estate", "6552": "real estate",

  // --- Healthcare / hospitals / providers ---
  "8011": "health", "8021": "health", "8031": "health", "8041": "health",
  "8042": "health", "8049": "health", "8050": "health", "8051": "health",
  "8052": "health", "8059": "health", "8060": "health", "8062": "health",
  "8063": "health", "8069": "health", "8071": "health", "8082": "health",
  "8090": "health", "8093": "health", "8099": "health",

  // --- Biotech / pharma / research ---
  "2833": "biotech", "2834": "biotech", "2835": "biotech", "2836": "biotech",
  "8731": "biotech", "8732": "biotech", "8733": "biotech", "8734": "biotech",

  // --- Retail / ecommerce ---
  "5961": "ecommerce", "5712": "ecommerce", "5731": "ecommerce",
  "5942": "ecommerce", "5943": "ecommerce", "5944": "ecommerce",
  "5961": "ecommerce", "5990": "ecommerce", "5999": "ecommerce",

  // --- Education ---
  "8200": "education", "8211": "education", "8221": "education",
  "8222": "education", "8231": "education", "8243": "education",
  "8244": "education", "8249": "education", "8299": "education",

  // --- Media / publishing / entertainment ---
  "2711": "content", "2721": "content", "2731": "content", "2741": "content",
  "7812": "video", "7819": "video", "7822": "video", "7829": "video",
  "7832": "video", "7833": "video",

  // --- Software / computer services / hardware ---
  // 7372 = packaged software, 7375 = information retrieval (most common
  // SIC code Apollo assigns to SaaS startups), 7371 = custom programming.
  "7370": "saas", "7371": "saas", "7372": "saas", "7373": "saas",
  "7374": "saas", "7375": "saas", "7376": "saas", "7377": "saas",
  "7378": "saas", "7379": "saas",
  "3571": "hardware", "3572": "hardware", "3577": "hardware", "3578": "hardware",

  // --- HR / recruiting / employment services ---
  "7361": "recruiting", "7363": "recruiting",

  // --- Financial services / investing / accounting ---
  "6282": "fintech", "6712": "fintech", "6770": "fintech", "6799": "fintech",
  "8721": "fintech",

  // --- Travel / hospitality ---
  "7011": "travel", "7041": "travel", "4724": "travel",

  // --- Security / guard services ---
  "7381": "security",

  // --- Gaming ---
  "7993": "gaming",

  // --- Logistics / transportation ---
  "4011": "logistics", "4013": "logistics", "4111": "logistics",
  "4119": "logistics", "4131": "logistics", "4151": "logistics",
  "4212": "logistics", "4213": "logistics", "4214": "logistics",
  "4215": "logistics", "4225": "logistics", "4226": "logistics",
  "4231": "logistics", "4311": "logistics", "4412": "logistics",
  "4499": "logistics", "4513": "logistics", "4581": "logistics",
  "4731": "logistics",

  // --- Automotive / transportation manufacturing ---
  "3711": "automotive", "3713": "automotive", "3714": "automotive",
  "3715": "automotive", "3721": "automotive", "3724": "automotive",
  "3728": "automotive", "3751": "automotive", "3761": "automotive",
  "3812": "automotive",

  // --- Manufacturing / industrial ---
  "3559": "industrial", "3561": "industrial", "3585": "industrial",
  "3674": "hardware", "3661": "hardware", "3669": "hardware",
  "3812": "automotive", "3829": "industrial", "3825": "industrial",

  // --- Climate / energy ---
  "1311": "energy", "2911": "energy", "4911": "energy", "4931": "energy",
  "4939": "energy", "4961": "energy",

  // --- Agriculture / food ---
  "0100": "agriculture", "0200": "agriculture", "0700": "agriculture",
  "5810": "food", "5812": "food", "5813": "food",
};

const NAICS_TO_INDUSTRY: Record<string, string> = {
  // --- Software / data services ---
  "511210": "saas",  // Software Publishers
  "518210": "infrastructure", // Data Processing, Hosting
  "519130": "content", // Internet Publishing & Web Search
  "541511": "saas", "541512": "saas", "541513": "saas",
  "541519": "saas",
  // 5-digit fallbacks. Apollo often returns the 5-digit parent grouping
  // instead of the 6-digit specific code (e.g. "54151" rather than
  // "541510"). Same for the 511 / 519 information-publishing parents.
  "54151": "saas", "51121": "saas", "51913": "content", "51821": "infrastructure",

  // --- Finance / fintech ---
  "522110": "fintech", "522120": "fintech", "522130": "fintech",
  "522190": "fintech", "522210": "fintech", "522220": "fintech",
  "522291": "fintech", "522292": "fintech", "522293": "fintech",
  "522294": "fintech", "522298": "fintech", "522310": "fintech",
  "522320": "fintech", "522390": "fintech",
  "523110": "fintech", "523120": "fintech", "523130": "fintech",
  "523140": "fintech", "523210": "fintech", "523910": "fintech",
  "523920": "fintech", "523930": "fintech", "523991": "fintech",
  "523999": "fintech",
  "524113": "fintech", "524114": "fintech", "524126": "fintech",
  "524127": "fintech", "524128": "fintech", "524130": "fintech",
  "524210": "fintech", "524291": "fintech", "524292": "fintech",
  "524298": "fintech",

  // --- Real estate ---
  "531110": "real estate", "531120": "real estate", "531130": "real estate",
  "531190": "real estate", "531210": "real estate", "531311": "real estate",
  "531312": "real estate", "531320": "real estate", "531390": "real estate",

  // --- Professional services / consulting / agencies ---
  // 541810s are advertising/PR; 541611-541618 are management consulting
  // sub-buckets. 541330 = engineering services. 541211 = accounting/tax.
  "541211": "fintech", // accounting & tax prep counts toward fintech here
  "54121": "fintech",
  "541810": "marketing", "541820": "marketing", "541830": "marketing",
  "541840": "marketing", "541850": "marketing", "541860": "marketing",
  "541870": "marketing", "541890": "marketing", "541910": "marketing",
  "54181": "marketing", "54191": "marketing",
  // Employment services / temp staffing → recruiting tag
  "561311": "recruiting", "561312": "recruiting", "561320": "recruiting",
  "561330": "recruiting", "56131": "recruiting", "56132": "recruiting",
  "56133": "recruiting",
  // Investigation, security, guard services
  "561612": "security", "561621": "security", "561622": "security",
  "56161": "security", "56162": "security",

  // --- Hospitality / travel / hotels ---
  "721110": "travel", "721120": "travel", "721191": "travel",
  "721199": "travel", "721211": "travel", "721214": "travel",
  "72111": "travel", "72121": "travel",

  // --- Securities / investment / brokers ---
  "523110": "fintech", "523120": "fintech", "523130": "fintech",
  "523140": "fintech", "523210": "fintech", "523910": "fintech",
  "5231": "fintech", "52311": "fintech", "52312": "fintech",
  "52313": "fintech", "52321": "fintech",
  // 5-digit prefixes for 522/524 (banking + insurance) seen in Apollo data
  "52211": "fintech", "52221": "fintech", "52229": "fintech",
  "52231": "fintech", "52232": "fintech",
  "52411": "fintech", "52412": "fintech", "52413": "fintech",
  "52421": "fintech", "52429": "fintech",

  // --- Health & hospitals ---
  "621111": "health", "621112": "health", "621210": "health",
  "621310": "health", "621320": "health", "621330": "health",
  "621340": "health", "621391": "health", "621399": "health",
  "621410": "health", "621420": "health", "621491": "health",
  "621492": "health", "621493": "health", "621498": "health",
  "621511": "health", "621512": "health", "621610": "health",
  "621910": "health", "621991": "health", "621999": "health",
  "622110": "health", "622210": "health", "622310": "health",
  "623110": "health", "623210": "health", "623220": "health",
  "623311": "health", "623312": "health", "623990": "health",
  "62111": "health", "62121": "health", "62131": "health",
  "62132": "health", "62133": "health", "62139": "health",
  "62141": "health", "62142": "health", "62149": "health",
  "62151": "health", "62161": "health", "62199": "health",
  "62211": "health", "62221": "health", "62231": "health",
  "62311": "health", "62321": "health", "62322": "health",
  "62331": "health", "62399": "health",

  // --- Biotech / pharma ---
  "325411": "biotech", "325412": "biotech", "325413": "biotech",
  "325414": "biotech",
  "541713": "biotech", "541714": "biotech", "541715": "biotech",

  // --- Education ---
  "611110": "education", "611210": "education", "611310": "education",
  "611410": "education", "611420": "education", "611430": "education",
  "611511": "education", "611512": "education", "611513": "education",
  "611519": "education", "611610": "education", "611620": "education",
  "611630": "education", "611691": "education", "611692": "education",
  "611699": "education", "611710": "education",
  "61111": "education", "61121": "education", "61131": "education",
  "61141": "education", "61142": "education", "61143": "education",
  "61151": "education", "61161": "education", "61162": "education",
  "61163": "education", "61169": "education", "61171": "education",

  // --- Media / publishing / video ---
  "511110": "content", "511120": "content", "511130": "content",
  "511140": "content", "511191": "content", "511199": "content",
  "512110": "video", "512120": "video", "512131": "video",
  "512132": "video", "512191": "video", "512199": "video",
  "512230": "music", "512240": "music", "512290": "audio",
  "515111": "audio", "515112": "audio", "515120": "video",
  "516210": "podcast",

  // --- Gaming ---
  "713120": "gaming", "713210": "gaming", "713290": "gaming",

  // --- Ecommerce / retail ---
  "454110": "ecommerce", "455110": "ecommerce", "455211": "ecommerce",
  "455219": "ecommerce", "456110": "ecommerce", "456120": "ecommerce",
  "456130": "ecommerce",

  // --- Logistics / transportation ---
  "481111": "logistics", "481112": "logistics", "481211": "logistics",
  "481212": "logistics", "481219": "logistics",
  "482111": "logistics", "482112": "logistics",
  "483111": "logistics", "483112": "logistics", "483113": "logistics",
  "483114": "logistics", "483211": "logistics", "483212": "logistics",
  "484110": "logistics", "484121": "logistics", "484122": "logistics",
  "484210": "logistics", "484220": "logistics", "484230": "logistics",
  "485111": "logistics", "485112": "logistics", "485113": "logistics",
  "485119": "logistics", "485210": "logistics", "485310": "logistics",
  "485320": "logistics", "485410": "logistics", "485510": "logistics",
  "485991": "logistics", "485999": "logistics",
  "488510": "logistics", "492110": "logistics", "492210": "logistics",

  // --- Automotive / aerospace ---
  "336111": "automotive", "336112": "automotive", "336120": "automotive",
  "336211": "automotive", "336212": "automotive", "336213": "automotive",
  "336214": "automotive", "336310": "automotive", "336320": "automotive",
  "336330": "automotive", "336340": "automotive", "336350": "automotive",
  "336360": "automotive", "336370": "automotive", "336390": "automotive",
  "336411": "automotive", "336412": "automotive", "336413": "automotive",
  "336414": "automotive", "336415": "automotive", "336419": "automotive",

  // --- Industrial / hardware / robotics ---
  "333242": "hardware", "333243": "hardware", "333244": "hardware",
  "333249": "hardware", "333295": "hardware", "333318": "hardware",
  "333319": "hardware", "333413": "hardware", "333414": "hardware",
  "334111": "hardware", "334112": "hardware", "334118": "hardware",
  "334210": "hardware", "334220": "hardware", "334290": "hardware",
  "334310": "hardware", "334412": "hardware", "334413": "hardware",
  "334416": "hardware", "334417": "hardware", "334418": "hardware",
  "334419": "hardware",

  // --- Climate / energy ---
  "211120": "energy", "211130": "energy", "221111": "energy",
  "221112": "energy", "221113": "energy", "221114": "energy",
  "221115": "energy", "221116": "energy", "221117": "energy",
  "221118": "energy", "221121": "energy", "221122": "energy",
  "221330": "energy",

  // --- Agriculture ---
  "111110": "agriculture", "111120": "agriculture", "111130": "agriculture",
  "111140": "agriculture", "111150": "agriculture", "111160": "agriculture",
  "111191": "agriculture", "111199": "agriculture", "111211": "agriculture",
  "111219": "agriculture", "111310": "agriculture", "111320": "agriculture",
  "111331": "agriculture", "111332": "agriculture", "111333": "agriculture",
  "111334": "agriculture", "111335": "agriculture", "111336": "agriculture",
  "111339": "agriculture",

  // --- Food / restaurants ---
  "311111": "food", "311119": "food", "311211": "food", "311212": "food",
  "722511": "food", "722513": "food", "722514": "food", "722515": "food",
};

// Look up an industry label from the first matching code in either list.
// Returns null if no code is recognized.
export function industryFromCodes(opts: {
  sic?: string[] | null;
  naics?: string[] | null;
}): string | null {
  for (const code of opts.naics ?? []) {
    const hit = NAICS_TO_INDUSTRY[code];
    if (hit) return hit;
  }
  for (const code of opts.sic ?? []) {
    const hit = SIC_TO_INDUSTRY[code];
    if (hit) return hit;
  }
  return null;
}
