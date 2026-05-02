import "dotenv/config";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { tagsFromTopics, mergeTags } from "./_lib/tags.js";

// id → [primaryIndustry, ...additionalTopicsForTags]
const CLASSIFICATIONS: Record<string, string[]> = {
  // A
  "cmon8y5cx00017yfza6e3jhub": ["media"],                          // [untitled] - OS for musicians
  "cmon8y5cz00037yfz37o617qa": ["fintech", "real estate"],         // Adaptive - financial mgmt for construction
  "cmon8y5cz00057yfzru421sl0": ["ecommerce", "fintech"],           // Addi - digital commerce LATAM
  "cmon8y5cz00067yfz0zsam8yt": ["automotive"],                     // Aerodome - air support for public safety
  "cmon8y5if00087yfzstxvcsbz": ["automotive"],                     // Air Space Intelligence - aerospace & defense
  "cmon8y5nw00097yfzx5rjrz8j": ["infrastructure"],                 // Airbase - RF spectrum software
  "cmon9757j000afafzr2v6nan9": ["real estate"],                    // AirGarage - parking operator
  "cmon8y5tb000a7yfz6k9lrdzn": ["health", "ai"],                   // AKASA - AI for healthcare revenue
  "cmon8y5tf000b7yfz6gtqgix0": ["crypto", "developer tools"],      // Alchemy - web3 dev platform
  "cmon8y5tw000d7yfzfcbx3rhd": ["health"],                         // Alchemy Health - pharmacy platform
  "cmon8y5ty000e7yfzdfehgb3r": ["crypto"],                         // Aleo - privacy blockchain
  "cmon8y5tz000g7yfzwai166r7": ["health", "ai", "biotech"],        // Alleviate Health - clinical trial AI
  "cmon8y5ty000f7yfz3ziz42bh": ["data", "infrastructure"],         // Alluxio - data orchestration
  "cmon8y5yr000h7yfzeeq8xtxu": ["biotech"],                        // Alpha-9 Oncology - radiopharma
  "cmon8y5yw000i7yfzpe6i52ua": ["biotech", "agriculture"],         // Alpine Bio - plant biomanufacturing
  "cmon8y5z8000j7yfz0m0rqulm": ["gaming", "xr"],                   // Alta - VR games
  "cmon8y5zc000k7yfz14mk56uc": ["education"],                      // AltSchool - micro-schools
  "cmon8y5zc000l7yfzxhq8el1p": ["biotech"],                        // Amber - RNA therapy
  "cmon8y5ze000n7yfz7pzlwhjq": ["security", "ai"],                 // Ambient.ai - AI computer vision security
  "cmon8y646000o7yfzw49k5zd8": ["biotech", "marketplace"],         // AminoChain - biosample marketplace
  "cmon8y649000p7yfz19xw78bg": ["crypto", "fintech"],              // Anchorage - regulated crypto
  "cmon8y64r000r7yfzagksph7c": ["crypto", "fintech"],              // Angle - euro stablecoins
  "cmommhbhq01d7s7fz23ik8r69": ["infrastructure"],                 // anunta - end user computing
  "cmon8y64s000t7yfzh9kejwxn": ["marketing"],                      // AnyRoad - experiential marketing
  "cmon8y64s000s7yfz53a3pa6p": ["ai", "developer tools"],          // Anyscale - ML dev platform
  "cmon8y64t000u7yfz071iupf4": ["agriculture", "food"],            // Apeel Sciences - produce coatings
  "cmon8y69l000v7yfzq4vy3vkp": ["automotive"],                     // Apex Space - satellite buses
  "cmon8y69n000w7yfzw3114rcz": ["developer tools", "api"],         // Apollo (GraphQL) - GraphQL hub
  "cmommhbzp01das7fzz4v9e7u9": ["developer tools", "infrastructure"], // appwrite - BaaS platform
  "cmon8y6aa000y7yfzzgqvoszp": ["crypto"],                         // Aptos - layer 1 blockchain
  "cmon8y6aa00107yfzhql5prb5": ["health", "fintech"],              // Aradigm - pharmacy benefits manager
  "cmon8y6aa000z7yfz1pmmp8cu": ["automotive", "energy"],           // Arc - electric sport boats
  "cmon975od0014fafzivzjo87n": ["biotech"],                         // Arda Therapeutics - aging diseases
  "cmon8y6f100127yfzpfls62va": ["media", "crypto"],                 // Arpeggi Labs - web3 music creation
  "cmon8y6fc00147yfz0u5li0vf": ["crypto", "data"],                  // Arweave - blockchain data storage
  "cmon8y6fq00167yfzb0gugvvv": ["biotech"],                         // Asimov - genetic design
  "cmon8y6fr00177yfzr6h14kod": ["automotive"],                      // Astranis - advanced satellites
  "cmon8y6fq00157yfz1uy5ss58": ["travel"],                          // Atlys - visa app
  "cmon8y6kh001a7yfzzrfe98zq": ["crypto"],                          // Avalanche - decentralized contracts
  "cmomm9c5q008os7fzzkwgziwg": ["energy"],                          // Axle Energy - flexible energy
  "cmon8y6kr001b7yfzfff0qhqk": ["crypto", "fintech"],               // Axoni - blockchain capital markets
  "cmon8y6l7001c7yfzvtilt5b6": ["gaming", "crypto"],                // Azra Games - blockchain games
  "cmon8y6l7001d7yfzya8g5djb": ["crypto"],                          // Aztec - Ethereum privacy
  "cmon2zgzt01ac9sfz5ztilemo": ["crypto", "security"],              // Babylon - blockchain security

  // B
  "cmon8y6l7001e7yfzljfspo1q": ["health", "ai"],                   // Backbone Systems - healthcare revenue AI
  "cmon975z7001ifafzn6igube1": ["ai", "gaming"],                    // Backflip AI - 3D asset generation
  "cmon2w0c1011e9sfz2qbm5sn6": ["energy"],                          // Base Power
  "cmommhfhg01dss7fzmqxb6rqu": ["fintech", "security"],            // basis theory - tokenization API
  "cmon8y6q5001i7yfzt1lmyu36": ["crypto"],                          // Bastion - web3 platform
  "cmon8y6qk001j7yfzogclq23a": ["health", "ai"],                   // Bayesian Health - clinical AI
  "cmon8y6qq001l7yfz1fh3s6xz": ["developer tools", "devops"],      // Beeps - on-call for Next.js
  "cmon8y6qr001m7yfzeolcz9x6": ["gaming"],                          // Believer - game studio
  "cmon8y6va001n7yfzxcpvs6k3": ["real estate", "fintech"],         // Belong - residential real estate
  "cmon8y6ve001o7yfzk3sun970": ["biotech", "data"],                 // Benchling - life sciences OS
  "cmon8y6vk001p7yfzgfy0s6lk": ["ai"],                              // Ber Sarai Labs (Yupp) - AI comparison
  "cmommhfze01dvs7fzeltl944i": ["social"],                          // bettermode (Tribe) - community platform
  "cmon8y6w2001q7yfz3o4vvpdw": ["biotech", "ai"],                  // BigHat Biosciences - ML biologics
  "cmon8y6w4001r7yfz52ehn7xu": ["xr", "gaming"],                   // BigScreen - VR
  "cmon8y6w9001t7yfzzoemnffk": ["crypto"],                          // Bitski - blockchain wallet infra
  "cmon8y70w001w7yfz4xsabsy4": ["health", "ai"],                   // Bold - AI preventative health
  "cmommhi5001e8s7fzfs91hl86": ["sports", "ecommerce"],            // boldfit - fitness gear
  "cmon8y71h001x7yfzbkvee6ah": ["biotech", "ai"],                  // Boltz - biomolecular AI
  "cmon8y71h001y7yfzf6qty693": ["gaming"],                          // Bonfire Studios - game studio
  "cmon8y71n001z7yfz2y5zifb1": ["travel", "marketplace"],          // Bounce - luggage storage
  "cmon8y71p00207yfztr3m4xeq": ["social"],                          // Braid.ai - community platform
  "cmon8y76700227yfz6fu5bmx4": ["fintech"],                         // Branch.co - mobile financial services
  "cmon8y76900237yfzyvclq6ca": ["biotech"],                         // Braveheart - cardiomyopathy biotech
  "cmon8y76x00247yfzza3ngna1": ["fintech", "health"],              // Brightside - financial health
  "cmommhjqo01ehs7fznn8rb3qx": ["infrastructure"],                  // broadsoft - communications software
  "cmon8y77000257yfz9sa6oypi": ["fintech", "real estate"],         // Cadre - digital investment marketplace
  "cmon8y77600267yfzvg533eb0": ["real estate"],                     // California Forever - new city

  // C
  "cmon8y7bh00287yfzbaa2nleq": ["ecommerce", "marketplace"],       // Canal - distributed commerce
  "cmon8y7bk00297yfz35dfh1hx": ["mobile", "security"],             // Cape - privacy mobile network
  "cmon8y7bn002a7yfzy1bkd3zb": ["fintech"],                        // Capitolis - capital markets
  "cmon8y7cd002b7yfzkh8o4xvo": ["productivity", "no-code"],        // Capriza - app builder
  "cmon8y7ch002c7yfzgn0e5iss": ["gaming"],                          // Carbonated - mobile games
  "cmon8y7co002d7yfzu4593vjv": ["gaming"],                          // Carry1st - game publisher Africa
  "cmon8y7cr002e7yfzppcdr9wp": ["fintech"],                         // Carta - equity management
  "cmon8y7gy002f7yfzqmcb33pv": ["biotech"],                        // Cartography Biosciences - immunotherapies
  "cmomm9k2l009qs7fzunihe7sz": ["ai", "gaming"],                   // Cartwheel - text-to-3D animation
  "cmon8y7h0002g7yfzf6sx0eqw": ["automotive"],                     // Castelion - defense systems
  "cmon8y7h0002h7yfz0zjox993": ["ai"],                              // Catena Labs - AI products
  "cmon8y7ht002i7yfzkb3t6b0q": ["gaming"],                         // CCP Games - MMO
  "cmomm9le8009ws7fzolnid535": ["data", "infrastructure"],         // Cdata - data connectivity
  "cmon8y7i3002k7yfziai5hdmw": ["fintech", "crypto"],              // Celo - mobile financial
  "cmon8y7i8002l7yfzpzyrvrh6": ["ai"],                              // Character.AI - LLM consumer
  "cmon8y7m9002m7yfzipgjcd2e": ["hr"],                              // Charthop - people ops platform
  "cmon8y7me002n7yfzmmsmr34u": ["fintech"],                         // Chestnut - insurance distribution
  "cmon8y7nc002q7yfzuy9dpvhs": ["fashion", "ecommerce"],           // Cider - Gen-Z fashion
  "cmon8y7ni002r7yfz53l6v8zr": ["ai", "social"],                   // Civitai - AI image model platform
  "cmon8y7nn002s7yfz9hyxztoq": ["developer tools", "security"],   // Clerk - auth/sign-in
  "cmon8y7rq002t7yfzhzbdt5fk": ["productivity"],                   // ClickUp - productivity suite
  "cmommhobu01f5s7fzpogfuy4v": ["developer tools", "infrastructure"], // cloudinary - image/video management
  "cmon8y7ru002u7yfzheqokv6n": ["fintech"],                         // Clover Network - mobile payment
  "cmon8y7rv002v7yfzotzq5jpl": ["social", "media"],                // Clubhouse - audio social
  "cmon8y7sn002w7yfz0w1ug4vn": ["ai"],                              // Cluely - AI screen assistant
  "cmon8y7sx002y7yfz769x7oiy": ["social", "crypto"],               // Co:Create - community for brands
  "cmon9775i0037fafznb5jfcde": ["education", "gaming"],            // CodeCombat - coding game
  "cmon8y7x300307yfzhmpdp7yt": ["real estate", "productivity"],   // Codi - commercial real estate
  "cmon8y7x700317yfz242faqe6": ["automotive"],                      // Comma.ai - autonomous car kit
  "cmon36dol01rg9sfzjve02j30": ["security"],                        // Command Zero - cyber investigations
  "cmon8y7y400337yfzh9qk4m8d": ["crypto", "fintech"],              // Compound - Ethereum DeFi
  "cmon8y7yb00357yfzb13100pz": ["developer tools", "infrastructure"], // Convex - serverless state mgmt
  "cmon8y7ym00367yfzhh5ezt9s": ["gaming", "crypto"],               // Core Loop - blockchain MMO
  "cmommhqbl01fhs7fzko0fmhee": ["developer tools", "api"],         // courier - developer notifications
  "cmon8y82p00397yfztczk2x7k": ["gaming", "xr"],                   // Createra - UGC gaming metaverse
  "cmon8y83q003b7yfz9bhrcpho": ["fintech"],                         // Cross River Bank - fintech infra
  "cmon977g8003mfafzl8qxxh5b": ["gaming", "crypto"],               // Cryptoys - interactive digital ownership
  "cmon8y87v003e7yfzsrv4cejt": ["fintech"],                         // Cuenca - digital banking
  "cmon8y87y003f7yfzl5agvuwg": ["gaming"],                          // Cult of the North - multiplayer games
  "cmon8y88z003h7yfzoimymta0": ["fintech"],                         // Current - US fintech
  "cmon8y89h003k7yfzz6j9fifk": ["security"],                        // CYGNVS - cyber crisis response
  "cmomm8ee4005us7fzv0gll4r7": ["automotive", "robotics"],         // Cyngn - self-driving industrial vehicles
  "cmommhrzd01frs7fzsulh59pi": ["developer tools"],                 // cypress.io - front-end testing

  // D
  "cmon8y8da003m7yfzpq4m3e3g": ["infrastructure", "devops"],       // D2iQ - container/data services
  "cmommhshe01fus7fzpykveea6": ["data", "analytics"],              // databand - data observability
  "cmon8y8em003p7yfzbs66r2fe": ["fintech", "data"],                // Datanomik - financial data LATAM
  "cmon8y8eu003q7yfzms038ryx": ["energy", "crypto"],               // Daylight - energy protocol
  "cmomm9u5z00azs7fzxaga3k8j": ["ai"],                              // Decagon - enterprise AI customer service
  "cmon8y8io003t7yfzfd2ufj5s": ["hr"],                              // Deel - global HR platform
  "cmon8y8iv003u7yfzoznn3nsm": ["biotech", "ai"],                  // Deepcell - AI cell analysis
  "cmon8y8k4003w7yfzh60qs883": ["ai"],                              // Deeptune - AI agent training
  "cmon8y8kb003x7yfzxg42679a": ["crypto", "fintech"],              // DELV (Element Finance) - DeFi
  "cmon8y8kg003y7yfz3lbcr2om": ["media"],                           // Descript - audio/video editing
  "cmon8y8o3003z7yfzbuh7fbc6": ["gaming", "crypto"],               // Destruction Labz - gaming ecosystem
  "cmon8y8p900427yfz7t9s57u5": ["crypto", "infrastructure"],       // Dfinity - Internet Computer
  "cmon8y8pu00457yfzhshp0wif": ["logistics", "automotive"],        // Dispatch - autonomous delivery
  "cmon8y8tg00477yfznizvhpu7": ["real estate", "fintech"],         // Divvy Homes - rent-to-own
  "cmomm9wdp00b8s7fz13dwb3bx": ["hardware", "automotive"],         // DJI - UAV platform
  "cmon8y8tq00487yfzn2ajhpo9": ["legal"],                           // DoNotPay - robot lawyer
  "cmon8y8uy004a7yfz8ht0297y": ["real estate", "ai"],              // Doxel - construction AI
  "cmon8y8v6004b7yfzkt6mdb56": ["fintech"],                         // Dwolla - payment services
  "cmon8y8v8004c7yfzuql68744": ["crypto", "fintech"],              // dYdX - DEX
  "cmon8y8yw004d7yfzgjxqieie": ["crypto", "security"],             // Dynamic Labs - multi-chain wallet auth

  // E
  "cmon8y902004g7yfz0h8829ty": ["biotech"],                         // Earli - cancer genetic constructs
  "cmon8y90e004h7yfzncqb803i": ["fintech"],                         // Earnin - paycheck advance
  "cmon8y90n004i7yfz9k84sh27": ["health"],                          // Ease Health - behavioral health OS
  "cmon36pj901se9sfza2exbp61": ["security"],                        // Eclypsium - firmware security
  "cmon978al004vfafz67bhoajw": ["crypto", "fintech"],              // Eco - onchain payments
  "cmon8y94a004k7yfzly5ef8pw": ["biotech"],                         // Elegen - DNA synthesis
  "cmon8y95t004o7yfz9yvpj6w0": ["gaming"],                          // End Game - game development
  "cmon8y963004p7yfzw1odbm0r": ["developer tools", "devops"],      // EngFlow - build acceleration
  "cmon8y968004q7yfzgmwz3kfi": ["crypto", "security"],             // Entropy - crypto custody
  "cmon8y99n004r7yfzhfb0f0pq": ["productivity", "real estate"],   // Envoy - workplace management
  "cmon8y99n004s7yfzr879l46z": ["gaming", "social"],               // EPAL - gaming social network
  "cmon8y9az004u7yfzcjfldxvv": ["analytics", "productivity"],      // Equals - next-gen spreadsheet
  "cmon8y9bi004w7yfzwc9tp45z": ["legal", "ai"],                    // Eve - legal AI for law firms
  "cmon8y9bq004x7yfzccpwi3hd": ["legal"],                           // Everlaw - legal tech
  "cmon978l6005afafz5wj64aaq": ["gaming", "xr"],                   // EveryRealm - virtual worlds

  // F
  "cmon8y9gg00517yfzfx8g9v2u": ["gaming", "crypto"],               // Faraway - blockchain games
  "cmon8y9gr00527yfze2xedk4m": ["fashion"],                         // Fashivly - personal style
  "cmon8y9gx00537yfz4kp4b117": ["gaming", "social"],               // favorited - gamified streaming
  "cmon8y9h600547yfzcz7jbngx": ["food", "marketplace"],            // Feedplan - restaurant meal plans
  "cmon8y9kh00557yfzaa1xo5nn": ["crypto", "fintech"],              // Fei Protocol - stablecoin
  "cmommhygd01gus7fzl6icdzol": ["developer tools", "api"],         // fern - SDK generation
  "cmomma1bk00bvs7fzh7kx7cm3": ["ai"],                              // Fibr - agentic web platform
  "cmon8y9kv00577yfzw4s3sy6o": ["media", "marketplace"],           // Filmhub - B2B film marketplace
  "cmomma1wu00bys7fzjmpjjcjc": ["fintech", "ecommerce"],           // Finaloop - e-commerce bookkeeping
  "cmon8y9lw00587yfzmswrhs9x": ["crypto"],                          // FingerprintsDAO - NFT art
  "cmommhz2f01gxs7fz52t9ugjy": ["data", "analytics"],              // firebolt - cloud data warehouse
  "cmon8y9m600597yfzxbm26ki2": ["health"],                          // Firefly Health - alternative health plan
  "cmon8y9md005a7yfzmw6ff036": ["data", "infrastructure"],         // Fivetran - data integration
  "cmon8y9qd005e7yfz3bl79w38": ["real estate", "fintech"],         // Flock Homes - rental home ownership
  "cmon8y9rc005f7yfzhbxagv1u": ["real estate"],                     // Flow - residential real estate
  "cmon8y9rn005g7yfznak24b2a": ["climate", "crypto"],              // Flowcarbon - blockchain carbon
  "cmon8y9vb005k7yfz2gcbj4pp": ["food"],                            // Foodology - cloud kitchen
  "cmon8y9vb005j7yfzhm7gck61": ["education"],                       // Formation - engineering fellowship
  "cmon8y9x4005n7yfz2qj2fknh": ["gaming", "crypto"],               // Forte Labs - blockchain for games
  "cmon8y9xi005p7yfzdnq29sv6": ["infrastructure", "security"],     // Forward Networks - networking
  "cmon979620064fafz18rgqgn9": ["crypto", "media"],                 // Foundation - NFT art marketplace
  "cmon8ya0o005q7yfzgvfygj4w": ["data", "analytics"],              // Foursquare - location tech
  "cmon8ya29005t7yfzu440zn7v": ["food"],                            // Fudo - restaurant software
  "cmon8ya2n005u7yfzwhv5ng4l": ["health", "biotech"],              // Function Health - biomarker tracking

  // G
  "cmon8ya63005y7yfz5ohps8u5": ["gaming", "social"],               // GamerXSociety - gaming ecosystem
  "cmon8ya8200617yfzj9b8tvq0": ["biotech"],                         // GC Therapeutics - cell therapies
  "cmon8ya8800627yfz5s6lw8xk": ["biotech", "ai"],                  // Genesis Molecular AI - drug discovery
  "cmon8ya8e00637yfzt04k6s8g": ["ai", "infrastructure"],           // Gensyn - AI infrastructure
  "cmon979ds006ifafzfdi34tr6": ["developer tools"],                  // Gitbutler - Git client
  "cmon8yac300667yfz1oty2nks": ["social", "media"],                // Glorify - Christian worship app
  "cmon979j2006ofafzr6nvo4mx": ["health"],                           // Glow - fertility tracking
  "cmon979j4006pfafz8jbmbnze": ["analytics"],                        // GoodData - business intelligence
  "cmommi3ta01hms7fzcam6blms": ["health", "ai"],                   // graph ai - pharmacovigilance AI
  "cmon979j7006qfafzbpm5nyv4": ["fintech"],                          // Greenlight - banking app for families
  "cmon979jd006rfafzpnk2ytrl": ["travel"],                           // Greether - travel platform for women
  "cmon979ms006tfafz0gz3elut": ["sports", "xr", "gaming"],         // Gym Class VR - VR basketball

  // H
  "cmomma90s00cus7fzcou39ml6": ["ai"],                              // H Company - AI task automation
  "cmon979om006yfafzbybsqzew": ["fintech", "crypto"],               // Harbor - tokenized securities
  "cmommi4xh01hss7fzke68zst3": ["infrastructure", "devops"],       // hashicorp - infrastructure provisioning
  "cmon979tx0075fafz8u749n8m": ["analytics", "marketing"],         // Hilbert - B2C growth analytics
  "cmon979u50076fafzjazlrzxy": ["travel", "marketplace"],          // Hipcamp - outdoor recreation
  "cmon979x00078fafzzcoyxg5s": ["health"],                           // Honor - home care
  "cmon979xm0079fafz43nye1yx": ["productivity"],                    // Hopin - event platform

  // I
  "cmon30ib001cv9sfzmggt07f8": ["ai"],                              // Ideogram - AI image generation
  "cmon979z8007cfafzrm96aa9q": ["automation", "productivity"],     // IFTTT - automation platform
  "cmommi7aa01i3s7fzvadzkitq": ["data", "analytics"],              // imply - Apache Druid platform
  "cmon97a04007ffafz5o94iijm": ["gaming", "infrastructure"],       // Improbable - simulation platform
  "cmon984b2000mm5fz6ict90gs": ["automotive"],                      // Impulse Space - space transportation
  "cmon97a2c007gfafzsp4tf9kf": ["ai", "media"],                   // Incention - AI storytelling
  "cmon97a32007hfafzxsq7x9j1": ["biotech", "ai"],                  // Inceptive - molecule design models
  "cmon97a3b007ifafzknz85ddo": ["health", "hr"],                   // Incredible Health - nurse marketplace
  "cmon97a4d007jfafz0lhz9nk3": ["biotech", "ai"],                  // Inductive Bio - AI drug design
  "cmon97a4q007lfafzj8k39j5l": ["sports", "ai"],                   // Infinite Athlete - sports tech
  "cmon97a7q007ofafz69fk64ys": ["developer tools", "automation"],  // Inngest - developer workflows
  "cmommi8e401i9s7fz1xrbh315": ["fintech"],                         // inrisk - parametric insurance
  "cmon97a9u007rfafzhmbmbztl": ["infrastructure"],                   // Instart - internet delivery
  "cmon97a9y007sfafz5ukmufcq": ["marketplace"],                     // Intro - expert marketplace
  "cmon97ab6007vfafzir2lcn9c": ["gaming", "ai", "crypto"],         // Irreverent Labs - AI blockchain games
  "cmon97ad3007wfafz9sxi3k96": ["crypto", "marketing"],            // IYK - digi-physical experiences

  // J
  "cmon97ae6007yfafzftyr8eh5": ["crypto", "fintech"],              // Jito - liquid staking Solana
  "cmon97af9007zfafzl5axomi0": ["travel"],                           // Journera - travel software
  "cmon97afc0080fafzm2w5uz23": ["gaming"],                           // k-ID - age-appropriate gaming
  "cmon97akq0088fafz3rnwl5oc": ["fintech", "hr"],                  // Keep Financial - deferred compensation
  "cmon97akt0089fafzyh5y7iii": ["crypto"],                          // Keep Network - blockchain private data
  "cmon97alq008afafzrbt0q0ih": ["ai", "security"],                  // Keycard - agent policy
  "cmon97ama008bfafzfcaa57w4": ["beauty", "ecommerce"],            // KIKI - virtual beauty brand
  "cmon97apq008efafzo817vgva": ["crypto", "social"],               // Kiosk - on-chain social assets
  "cmon97apy008ffafzerooluw9": ["health"],                           // Knownwell - metabolic health
  "cmon97aq6008hfafzcer0m9ro": ["energy", "ai"],                   // KoBold Metals - battery metals exploration
  "cmon97ar9008ifafz715vzodr": ["health", "ai"],                   // Komodo Health - life sciences AI
  "cmon97arq008jfafz2wzql6we": ["infrastructure"],                   // Kong - cloud connectivity
  "cmomm7jt4003ns7fz7pel72tk": ["ai", "media"],                   // Krea - AI creative tools
  "cmommib6v01ios7fzh89i6d8h": ["fintech"],                         // kroll bond rating agency - credit ratings

  // L
  "cmon97avi008ofafzd6s4jev5": ["education"],                        // Labster - science simulations
  "cmommibkb01iqs7fzihkt99ki": ["developer tools"],                  // launchdarkly - feature management
  "cmon97axa008rfafzzl37v7ng": ["crypto", "fintech"],               // Legend Labs - DeFi platform
  "cmon97b03008tfafzs3spu54g": ["health"],                           // Levels Health - metabolic health
  "cmon97b0m008ufafzpl2f4nsv": ["crypto", "fintech"],               // Lido Finance - liquid staking
  "cmon97b0v008wfafz9z899cyi": ["crypto", "fintech"],               // Lightspark - Bitcoin payments
  "cmon97b12008xfafzs3ec72yd": ["data", "analytics"],               // Lightup - data observability
  "cmon37p0x01v19sfziqmgfrmq": ["ai", "hardware"],                  // Limitless - memory capture
  "cmon97b5i0091fafz5mcbi55o": ["automotive", "logistics"],        // Local Motion - car sharing/fleet
  "cmon97b620093fafz8452k7uv": ["real estate"],                      // Loft - real estate marketplace Brazil
  "cmon97b6j0095fafz1eg82w4u": ["crypto", "fintech"],               // Loop - crypto autopay
  "cmon97b8b0097fafz7cilsoy1": ["fintech"],                          // LTSE - Long-Term Stock Exchange
  "cmon97b9j0098fafzlm37sv1z": ["ai"],                               // Luma AI - multimodal AI
  "cmon97bay0099fafzp952j8ac": ["gaming", "health"],                // Lumi Interactive - wellbeing game
  "cmon2s0j400r79sfzigjnp65e": ["security", "hr"],                  // Lumos - app/access management

  // M
  "cmon97bbi009bfafzv02n76ff": ["ai", "productivity"],              // Macro - AI document workspace
  "cmon97bc1009dfafz1yaiaih3": ["gaming"],                           // Mainframe Industries - game studio
  "cmon97bdj009efafzoq7xdxmk": ["biotech", "ai"],                  // Mana Bio - AI lipid nanoparticles
  "cmon97bdu009ffafz1533t6te": ["crypto"],                           // Manifold - NFT creator tools
  "cmon97bgf009hfafzykkmhqb3": ["education", "health"],            // Marker Learning - learning diagnostics
  "cmon97bgw009ifafzmvo8g5dh": ["security"],                        // Material Security - email security
  "cmon97bgy009kfafzas5czysc": ["ai", "sales"],                    // Matik - AI customer presentations
  "cmon97bgx009jfafz2qlt6vk3": ["crypto", "infrastructure"],       // Matter Labs (zkSync) - zero-knowledge
  "cmon97bj4009mfafz3p05w3w1": ["beauty", "ecommerce"],            // Mayvenn - beauty professional e-comm
  "cmon97bjc009nfafzujhq858v": ["biotech"],                          // Maze Therapeutics - precision therapy
  "cmon97bkd009ofafze8lh724z": ["media", "crypto"],                 // Mediachain - image metadata
  "cmon97bm9009rfafz6h5hlpig": ["education", "social"],            // Medley - personal development
  "cmon97bn4009tfafzi8bcrdw5": ["productivity"],                    // Mem - self-organizing workspace
  "cmon97bop009ufafzzmbt2rac": ["crypto", "social"],               // Mem Protocol - web3 social
  "cmommalu700ejs7fz74x8agh8": ["marketplace"],                     // Meragi - wedding planning
  "cmon97brj009xfafztqo7u4ib": ["developer tools"],                 // Merit Systems - dev attribution
  "cmon97brm009yfafz6bkeyb8b": ["social", "crypto"],               // Merkle Manufactory (Farcaster) - decentralized social
  "cmon97bua00a2fafzjr6djf17": ["crypto", "fintech"],               // Metatheory - web3 games
  "cmon97bur00a3fafztzuwgjar": ["health", "ai", "fintech"],         // Midstream Health - AI health finance
  "cmon97bv200a4fafzrgoy2h2y": ["health"],                           // Milu Health - consumer health navigation
  "cmon97by400a9fafzgp2zhovo": ["ai"],                               // Mistral AI - frontier AI models
  "cmon97bzx00aafafzule8owha": ["analytics"],                        // Mixpanel - event analytics
  "cmon97c0b00abfafzx0nwdsr6": ["fintech"],                          // ModernFi - deposit network
  "cmon97c0g00acfafz74cms265": ["fintech"],                          // Moment - fixed income
  "cmon30b9101c99sfza2griaxo": ["fintech"],                          // Moov - payments infrastructure
  "cmon97c2i00aefafz61v0827v": ["crypto", "fintech"],               // Morpho - DeFi lending
  "cmon97c2l00affafz5sk6y9w1": ["real estate"],                      // Mosaic - construction technology
  "cmon97c3j00ahfafzjyoq3wai": ["data", "analytics"],               // Motherduck - serverless analytics
  "cmon97c5g00aifafzqsqknlws": ["gaming"],                           // Mountaintop Studios - game studio
  "cmon97c7u00alfafzfwmsad3z": ["logistics"],                        // Mvmnt - freight tech
  "cmon97c7v00amfafz1s1dj1r6": ["crypto", "infrastructure"],       // Mysten Labs (Sui) - web3 infra
  "cmon97c7x00anfafzij7nllc1": ["gaming", "crypto"],                // Mythical Games - player economies

  // N
  "cmon97c9000apfafz68zo3yon": ["logistics"],                        // Nash - delivery orchestration
  "cmon97caw00aqfafzl06pr44s": ["social", "govtech"],               // NationBuilder - organizing platform
  "cmon97cb600arfafzqwidh6wq": ["crypto", "infrastructure"],       // NEAR - blockchain protocol
  "cmon8ym6z00o2rpfzlgbcs00f": ["marketplace", "real estate"],    // Neighbor - P2P self-storage
  "cmommiilh01jts7fzty4qjlwz": ["devops", "infrastructure"],      // netdata - performance monitoring
  "cmommcf3k00nls7fzo1nwvcp9": ["developer tools", "infrastructure"], // netlify - web dev platform
  "cmon97cdd00avfafz46b2r4x7": ["ai", "infrastructure"],           // Neural Magic - AI inference software
  "cmon97ceu00axfafzks8h6rn3": ["fintech"],                          // NG.CASH - Gen Z fintech Brazil
  "cmommikyx01k5s7fzm4aonn2k": ["developer tools"],                  // npm - package manager
  "cmon97cis00b3fafzv2tuiqnn": ["developer tools"],                  // NX - monorepo build system
  "cmon97cj300b4fafzl93pyshs": ["security", "crypto"],              // Nym - privacy network
  "cmon97cka00b5fafzarvxnn8a": ["crypto", "security"],              // Oasis Labs - privacy cloud blockchain
  "cmon97clw00b6fafz2wquj8eb": ["biotech"],                          // Octant Bio - protein misfolding
  "cmon97cmi00b8fafz7jp8r537": ["education"],                        // Odyssey - education for families
  "cmon97cnz00b9fafz781f9hqm": ["gaming"],                           // Odyssey Interactive - game studio
  "cmon97co200bafafzwwffpddy": ["ecommerce", "marketplace"],        // OfferUp - C2C marketplace
  "cmommiliv01k8s7fz5sdtwn3t": ["data", "security"],               // okera - data access governance
  "cmommatvl00fos7fzy905whi5": ["automotive", "marketplace"],      // ola - taxi aggregation
  "cmon97co900bbfafziiq2a7a6": ["gaming"],                           // One More Game - online games
  "cmon97cpu00bdfafzt94olsld": ["ecommerce", "marketplace"],       // OpenBazaar - P2P marketplace
  "cmon97cr900befafzg8lmx5vd": ["ai", "api"],                       // OpenRouter - LLM router
  "cmon97crh00bffafz6u442zrg": ["crypto", "marketplace"],          // OpenSea - NFT marketplace
  "cmon97cry00bgfafzd7gusgzq": ["crypto", "infrastructure"],       // Optimism - Ethereum L2
  "cmon97ctb00bhfafzhogv0qko": ["biotech"],                          // Orchestra Bio - biotech R&D SaaS
  "cmon97cth00bifafzbh9utjkg": ["security"],                        // Orchid Labs - internet privacy
  "cmon97cto00bjfafz3ax2m3n9": ["logistics"],                        // Orderful - supply chain EDI
  "cmon97cwn00bmfafzjaytg2hg": ["sports", "media"],                 // Overtime - sports media
  "cmon97cx000bnfafzpy8d3h5o": ["gaming"],                           // Overwolf - in-game creators
  "cmomminiq01kks7fz6pfxac4s": ["devops"],                           // pagerduty - operations performance
  "cmon97cym00bpfafz2cce3nuc": ["gaming"],                           // Pahdo Labs - anime MMORPG
  "cmon97cyu00bqfafzeg58xa3q": ["ecommerce", "marketplace"],       // Palmstreet - live shopping
  "cmon97czc00bsfafzairx8doj": ["crypto"],                           // PartyDAO - multiplayer crypto
  "cmon97d0q00btfafz78fz45f3": ["climate", "crypto"],               // Patch - carbon market
  "cmon97d2h00bvfafzy915k311": ["fintech"],                          // Payall - payment systems
  "cmon97d2y00bwfafztcfzqfvq": ["fintech"],                          // Payrails - payment OS
  "cmon97d3z00bxfafzngmdo2k2": ["health", "ai"],                   // Pearl Health - Medicare VBC AI
  "cmon97d4500byfafz5iyfp680": ["crypto", "fintech"],               // Peepal.co (CoinSwitch) - crypto app
  "cmon97d4i00bzfafz3jr7uqw3": ["ai", "industrial"],               // Periodic Labs - AI materials science
  "cmon97d4r00c0fafzjjl1bi6a": ["ai", "analytics"],                // Petual - AI audit testing
  "cmon97d7v00c1fafz5rlk26qr": ["crypto"],                          // Phantom - crypto wallet
  "cmon97d7w00c2fafzqo4b98px": ["ai", "media"],                   // Phota Labs - personalized visual AI
  "cmon97d8d00c3fafzrgv1uyhs": ["biotech", "ai"],                  // Phylo - biomedical AI
  "cmon97d8i00c4fafznncioouj": ["ecommerce"],                        // Pietra - commerce OS
  "cmon97dan00c6fafz1cip8b3g": ["crypto", "infrastructure"],       // Pimlico - Ethereum smart accounts
  "cmon97dan00c7fafzi0h2qb2n": ["ai", "infrastructure"],           // Pinecone - vector database
  "cmon97de000ccfafz6siekqhz": ["real estate", "fintech"],         // Point - home equity
  "cmon97dfx00cdfafzwq72gm6o": ["crypto", "fintech"],              // Polychain - blockchain hedge fund
  "cmommiqu801l4s7fzyhoayc1y": ["developer tools", "devops"],      // port - internal developer portal
  "cmommir0601l5s7fzlboavxe5": ["devops", "infrastructure"],       // portainer - container management
  "cmon97dg200cgfafzethvnrup": ["ai", "data"],                     // Poseidon - decentralized data for AI
  "cmon984x1001em5fzkihaachx": ["logistics", "food"],               // Postmates - on-demand delivery
  "cmon97dg200cffafz55offaqh": ["health"],                           // Practice - coaching tools
  "cmommir6901l6s7fzofdr6f51": ["data", "devops"],                  // prefect - data workflow mgmt
  "cmommirc701l7s7fzf00ee3rx": ["analytics", "no-code"],           // preql - no-code metrics
  "cmon97dir00chfafzft6lroiu": ["analytics"],                        // Preset - Apache Superset analytics
  "cmon97diy00cifafzvpf3su1e": ["education", "xr"],                 // Prisms - spatial learning
  "cmon97dje00cjfafz0r01otqg": ["media", "ai"],                   // Promise - generative AI films
  "cmon97djh00ckfafz861ybj04": ["crypto"],                           // Proof Holdings - NFT experiences
  "cmon97do500cpfafzix0dieqs": ["crypto", "infrastructure"],       // Protocol Labs (IPFS/Filecoin) - internet infra
  "cmon97dod00cqfafz31qvo308": ["hr"],                               // Proven - hiring tool for SMBs
  "cmon97dqv00cvfafzx7lsy7fp": ["health", "biotech"],              // Q Bio - high-res imaging

  // Q-R
  "cmon2lg9300bi9sfzckyvmxwj": ["ai"],                              // QuiverAI - vector design AI
  "cmon97dtl00cxfafzffjh8mkn": ["social"],                          // Quora - Q&A platform
  "cmon97duf00d0fafz011vd173": ["energy"],                           // Radiant - portable nuclear power
  "cmon97dvv00d1fafz70ia8yao": ["gaming"],                           // Raid Base - game development
  "cmommitbv01ljs7fzhq7g21c7": ["developer tools"],                 // rainforest qa - testing
  "cmon97dvz00d2fafznfdrwcyr": ["developer tools", "api"],         // Rapid (RapidAPI) - API marketplace
  "cmommb3lu00h7s7fz2psc0t72": ["ai", "no-code"],                  // RapidCanvas - no-code AutoAI
  "cmon97dz000d5fafz629ojee6": ["fashion", "ai"],                   // Raspberry AI - retail design AI
  "cmon97dzy00d7fafzh349qbkf": ["ai", "media"],                   // Reface - face swap AI app
  "cmon97dzy00d8fafzdjotjrwi": ["education"],                        // Reforge - product growth programs
  "cmon97e1c00dafafzi94oycfl": ["automation", "productivity"],     // Relay - workflow automation
  "cmon97e1p00dbfafz08n9vqyn": ["developer tools"],                 // Replay - browser bug recording
  "cmon97e5f00dffafz7yxx1el6": ["ai", "productivity"],             // Rewatch - AI meeting recording
  "cmon97e6k00dhfafzcffvgv5f": ["biotech"],                          // Rezo Therapeutics - therapeutics
  "cmon97e6o00difafzi7t9vkme": ["energy", "hr"],                   // Rigup - energy workforce marketplace
  "cmon97e7c00dkfafzff2z74u8": ["developer tools"],                 // Rive - interactive design tool
  "cmon97e9p00dlfafzvrfjopfi": ["gaming"],                           // Roboto Games - multiplayer games
  "cmon97eax00dnfafzer9p48uw": ["developer tools", "industrial"],  // Rollup AI - hardware engineering
  "cmon97ebw00dpfafzxk0o1vrp": ["media", "crypto"],                 // Royal - NFT music ownership
  "cmon97ec100dqfafzlsv8vuo1": ["productivity", "education"],      // Run the World - digital collaboration
  "cmon97ef400dtfafz7ug34a9c": ["fintech", "analytics"],           // Runway (financial) - strategic planning
  "cmon97egg00dvfafzn7ynavri": ["developer tools", "ecommerce"],   // Rye - eCommerce dev tools
  "cmommb62z00hls7fz3vst0zw5": ["food", "industrial"],             // S4S Technologies - food processing
  "cmon97ehe00dyfafz03um70ch": ["ai", "biotech"],                  // Salt AI - AI for life sciences

  // S
  "cmon97ehx00dzfafzn8wyjj7x": ["gaming", "xr"],                   // Sandbox VR - immersive VR
  "cmommh2ca01bus7fz75qwh5q5": ["fintech", "security"],            // Sardine - fraud/compliance
  "cmon97elz00e3fafzmo1ng8xe": ["social"],                           // Scene Infrastructure - social software
  "cmon97em300e4fafzutuwptmu": ["biotech"],                          // Scribe Therapeutics - gene editing
  "cmon97emj00e5fafzzd2a69qg": ["health", "ai"],                   // Scribenote - AI vet scribe
  "cmon97emq00e6fafzry6cnnci": ["health", "food"],                  // Season Health - food-as-medicine
  "cmommixzh01mbs7fzozpsx7db": ["education"],                        // seekho - edu-tainment India
  "cmon97enn00e8fafzer1ko9l2": ["fintech", "crypto"],               // Seismic Systems - financial instruments
  "cmon2vqa6010m9sfz508ydeds": ["security", "fintech"],             // SentiLink - identity fraud
  "cmon97eri00ebfafzhcvx6em5": ["fintech"],                          // Sequence - billing/pricing
  "cmon97erm00ecfafzw44ws7ql": ["gaming", "ai"],                   // Series Entertainment - AI games
  "cmon97es200eefafzhlb288li": ["real estate", "fintech"],         // Setpoint.io - real estate transactions
  "cmon97evb00ehfafzud0zcmm2": ["media", "crypto"],                 // Shibuya - web3 content studio
  "cmon97ew700eifafzkmgkpzux": ["ai", "automotive"],               // Shield AI - AI defense
  "cmon97ex800elfafz3q5thwlw": ["gaming"],                           // Singularity 6 - online game
  "cmon97exf00emfafzhtwfya2l": ["crypto"],                           // Sky - Ethereum DAO
  "cmon97f0o00epfafzqe2zhbdh": ["health"],                           // Skylight Health - value-based care
  "cmon2lptd00c79sfz81n1pgza": ["security", "automotive"],         // SkySafe - drone detection
  "cmon97f2k00erfafzvqfxlhj4": ["sports", "social"],               // Sleeper - social sports platform
  "cmon97f2q00etfafzksppu4fc": ["health", "ai"],                   // Slingshot AI - AI therapy
  "cmon97f3x00ewfafzux415wy3": ["data", "infrastructure"],         // SnapLogic - enterprise integration
  "cmon97f5z00exfafzl1n5j0bu": ["gaming", "developer tools"],     // Snapser - game backend
  "cmon97f7300eyfafzbui3vtsv": ["security", "developer tools"],   // Socket - supply chain security
  "cmon97f8100f0fafz2sf16kjc": ["crypto", "infrastructure"],       // Solana - layer 1 blockchain
  "cmon97f8700f2fafzqwl4yw3s": ["media", "crypto"],                 // Sound.xyz - music NFT
  "cmon97f8z00f3fafz77ac1m5g": ["gaming", "ai"],                   // Sovrun - 3D asset production
  "cmon97fda00f7fafz62lzgcct": ["fintech", "ecommerce"],           // SpotOn - cloud tech for small biz
  "cmon2nmse00gz9sfzxqiw46vd": ["developer tools", "api"],         // Stainless - SDK generation
  "cmon97fi000fefafzl387jg2v": ["data", "analytics"],               // Starburst - data lake analytics
  "cmon97fix00fgfafzxwudwqpn": ["biotech"],                          // Stipple Bio - cancer biology
  "cmon97fj400fhfafz14aqjdai": ["security", "fintech"],            // Stoik - cyber + insurance
  "cmommj46001n6s7fz6mfdyqxq": ["infrastructure"],                   // storwize - storage compression
  "cmon97fjw00fjfafzn51ddokz": ["crypto", "media"],                 // Story Protocol - IP tokenization
  "cmon97fny00fnfafzvxhqlnhw": ["gaming"],                           // Super Evil MegaCorp - mobile games
  "cmon97fon00fpfafz8bqoxmci": ["logistics"],                        // Supermove - moving company software
  "cmon97fot00fqfafzvz6y645q": ["ai"],                               // Supersonik - AI demos
  "cmon8ybia008zrpfzvzpvwaja": ["marketing"],                        // SwayBrand - influencer content mgmt
  "cmommbipk00jgs7fzbp8ucc57": ["fintech"],                          // Swypex - B2B spend management
  "cmon97fsw00fufafz5rghpulp": ["fintech"],                          // Synapse - banking platform
  "cmon97ft900fvfafzmm9vqcfo": ["crypto", "fintech"],               // Syndicate - decentralized investment
  "cmon97ftl00fwfafzafs23asd": ["hr", "fintech"],                   // Tako - workforce management
  "cmon97fu700fxfafz9e1zol7c": ["health"],                           // Talkiatry - virtual psychiatry
  "cmon97fua00fyfafzc5r43xdw": ["media", "crypto"],                 // Tally Labs - web3 media
  "cmon97fut00fzfafznqsndttc": ["crypto", "fintech"],               // Talos - institutional crypto infra
  "cmon97fv200g0fafzeakq8yvx": ["security"],                         // Tanium - systems management
  "cmon97fwu00g1fafznkxfcuw6": ["fintech"],                          // Tapi - LATAM paytech
  "cmon97fyp00g3fafzgepuf51w": ["ecommerce"],                        // Teespring - merchandise
  "cmommca3q00mys7fz4zdokh67": ["infrastructure", "security"],     // teleport - infrastructure access
  "cmommj7h201nms7fz4za5i2gh": ["health"],                           // teleradiology solutions - telemedicine
  "cmon97fyw00g4fafzb345xw4g": ["fintech", "real estate"],         // Tellus - passive income/real estate
  "cmon97g0800g7fafzn23l1hh5": ["media"],                            // ternwheel - tour profitability
  "cmon97g0f00g8fafzl8sfi8qj": ["media", "social"],                 // Testcode - social audio
  "cmon97g3v00gafafzcg4bi78d": ["fintech"],                          // The Coterie - financial products
  "cmon97g5500gdfafzknw1va57": ["biotech"],                          // Third Arc Bio - antibody engineering
  "cmon97g5f00gefafzg1gjzzhv": ["health"],                           // Thyme Care - cancer care navigation
  "cmon97g5u00ggfafzm11pd2ij": ["marketplace", "crypto"],          // Timbucktoo - art marketplace
  "cmon97g9b00gifafzza1aydur": ["crypto", "infrastructure"],       // Tlon (Urbit) - decentralized OS
  "cmon97g9d00gjfafz5ms2ia9u": ["security"],                         // Toka - cyber capacity building
  "cmon97gan00glfafzk8b9d7xd": ["health", "marketplace"],          // Tomorrow Health - home health services
  "cmon97gb200gnfafza53tcvpd": ["health", "biotech"],              // Topography Health - clinical trials
  "cmon97gba00gofafzfduam7an": ["crypto", "fintech"],               // Tradeblock - bitcoin data
  "cmommj9s001nxs7fzwqh246jj": ["fintech"],                         // transbnk - corporate banking OS
  "cmon97gd400gpfafz7vypuy2d": ["security", "ai"],                  // Treeline AI - IT/security AI
  "cmon97ger00grfafzq4bs83e3": ["crypto", "fintech"],               // TrueFi - DeFi credit
  "cmon97gf600gsfafzupeghbug": ["health", "fintech"],              // Truemed - HSA payment rails
  "cmon97gg400gtfafzxp77tts1": ["security"],                         // Truffle Security - credential security
  "cmon2krzf009p9sfzj1vcc8o8": ["developer tools"],                  // Trunk - dev tools

  // U-Z
  "cmon97gih00gxfafzv50dr956": ["biotech"],                          // Ultima Genomics - DNA sequencing
  "cmon97gjy00gyfafzbcqgzxa3": ["automotive", "industrial"],       // Ulysses - autonomous subsea platforms
  "cmon97gki00h0fafzs7zd523f": ["security"],                        // UnifyID - passwordless auth
  "cmommbpkc00kes7fzqjhjny7r": ["marketing"],                        // Uniqode - mobile marketing QR
  "cmon97glm00h1fafzkyxovd0a": ["media"],                            // Unisound - music licensing
  "cmon97glu00h2fafzxon683me": ["crypto", "fintech"],               // Uniswap - DEX AMM
  "cmon97gm100h3fafzdovqw4h4": ["media"],                            // UnitedMasters - music distribution
  "cmon97gm400h4fafzwjiw3y68": ["crypto"],                           // Universal - wrapped asset protocol
  "cmon97gp900h6fafzm691z4pf": ["hr"],                               // UpSmith - skilled worker tech
  "cmon97gpv00h8fafzgcf8gwde": ["fintech"],                          // Vaas - LATAM credit
  "cmon8f0sm009v7wfz2ghhkuvh": ["developer tools"],                  // Valaa Technologies - dev stack
  "cmon97gt400h9fafzsoz4px2y": ["biotech", "ai"],                  // Valar Labs - AI oncology diagnostics
  "cmon97gt400hafafzlk5w4xav": ["fintech", "real estate"],         // Valon - mortgage servicer
  "cmon97gt500hcfafzxmuhza7e": ["crypto", "fintech"],               // Valora - mobile crypto wallet
  "cmon97gvw00hffafz5bbzhoie": ["developer tools"],                  // Ventrilo - software releases
  "cmon97gvv00hefafzrgozwiyp": ["security", "fintech"],             // Very Good Security - secure payments
  "cmon97gyo00hhfafzy5c3zupw": ["fintech", "real estate"],         // Vesta - LOS for lenders
  "cmommjf9f01oss7fzz3436hp9": ["health", "pets"],                  // vetic - pet healthcare
  "cmon97gyo00hifafzqjub32yc": ["ai", "media"],                   // Viggle - controllable video AI
  "cmon97gyp00hjfafzo0z26o6s": ["ecommerce"],                        // Virch Merch - merchandise platform
  "cmon97gyr00hkfafzeyeys1cp": ["saas", "sales"],                   // Vitally - customer success B2B
  "cmommbt8t00l0s7fzap2u7y65": ["developer tools"],                  // vlt - open source package manager
  "cmon97h1a00hlfafzcpjm52oo": ["gaming"],                           // Voldex - UGC game studio
  "cmon97h1d00hnfafzsnk8s1nh": ["crypto", "fintech"],               // Warbler Labs (Goldfinch) - DeFi credit
  "cmon97h4400hpfafz2i20qdhy": ["health"],                           // Waymark - Medicaid value-based care
  "cmon97h4700hrfafzgfwwkddq": ["fintech"],                          // Wealthmore - personal finance
  "cmon97h6p00htfafzabhf3sst": ["hr", "fintech"],                   // Wingspan - freelancer platform
  "cmon97h6s00hvfafzstky46r1": ["productivity", "analytics"],      // WorkBoard - digital operating rhythm
  "cmon97h9l00hxfafzyqqgw3eu": ["crypto", "fintech"],               // Worldcoin - digital currency
  "cmon97h9q00hzfafz19fcfzl0": ["real estate", "ai"],              // XBuild - AI construction platform
  "cmon97h9w00i0fafz61hjimox": ["crypto"],                           // XMTP Labs - crypto communication
  "cmon97hc200i1fafzwoh287v8": ["gaming", "ai"],                   // Yellow - AI 3D game assets
  "cmon97hc400i2fafzckincq5i": ["gaming", "crypto"],               // Yield Guild Games - NFT gaming DAO
  "cmon97hc700i3fafz23njev07": ["security", "hardware"],           // Yubico - hardware security keys
  "cmon97hez00i5fafzrpj3rhaz": ["fintech"],                          // Yuno - payment orchestration
  "cmon97hf400i6fafze1w1sq2f": ["gaming", "crypto"],               // Zed.run - decentralized entertainment
  "cmon97hfb00i7fafzbwm5r7l7": ["crypto", "infrastructure"],       // Zefchain (Linera) - multi-chain infra
  "cmon97hff00i8fafzg57fme75": ["hr"],                               // Zenefits - HR/benefits/payroll
  "cmon97hhe00i9fafzm1p8ub4k": ["ai", "automotive"],               // ZeroMark - AI defense
  "cmon97hhj00ibfafzzf11hst9": ["logistics", "automotive"],        // Zipline - drone delivery
  "cmon97hhj00iafafzmtlcvg9i": ["ecommerce"],                        // Zulily - flash sales
  "cmon97hkd00idfafzs6mqwhjx": ["health"],                          // Zus Health - shared medical records
};

async function main() {
  const entries = Object.entries(CLASSIFICATIONS);
  console.log(`Classifying ${entries.length} companies...`);

  let updated = 0;
  for (const [id, topics] of entries) {
    const [primaryIndustry, ...rest] = topics;
    const newTags = tagsFromTopics(topics);

    const existing = await prisma.company.findUnique({
      where: { id },
      select: { tags: true },
    });
    if (!existing) continue;

    const mergedTags = mergeTags(existing.tags, newTags);
    await prisma.company.update({
      where: { id },
      data: { industry: primaryIndustry, tags: mergedTags },
    });
    updated++;
    if (updated % 50 === 0) process.stdout.write(`  ${updated}/${entries.length}\r`);
  }

  console.log(`\nDone. Updated ${updated} companies.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().finally(() => prisma.$disconnect()).catch(console.error);
