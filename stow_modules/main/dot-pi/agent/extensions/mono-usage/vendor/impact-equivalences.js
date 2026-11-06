// src/engine/number.ts
function roundToSignificant(value, significantDigits = 2) {
  if (value === 0) return 0;
  const magnitude = Math.floor(Math.log10(Math.abs(value)));
  const factor = 10 ** (significantDigits - magnitude - 1);
  return Math.round(value * factor) / factor;
}
function formatNumber(value, locale = "en-US") {
  if (value === 0) return "0";
  if (Math.abs(value) < 0.01) return value > 0 ? "<0.01" : ">-0.01";
  const rounded = roundToSignificant(value, value >= 100 ? 2 : 2);
  if (rounded === 0) return value > 0 ? "<0.01" : ">-0.01";
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: Math.abs(rounded) < 10 ? 2 : 0
  }).format(rounded);
}
function formatRange(min, max, unit, locale = "en-US") {
  if (min === max) return `\u2248 ${formatNumber(min, locale)} ${unit}`;
  return `\u2248 ${formatNumber(min, locale)}\u2013${formatNumber(max, locale)} ${unit}`;
}
function pluralize(label, value) {
  return Math.abs(value - 1) < 0.05 ? label : `${label}s`;
}

// src/sources/index.ts
var sources = {
  epaGhg: {
    id: "epa-ghg-equivalencies",
    name: "EPA Greenhouse Gas Equivalencies Calculator",
    url: "https://www.epa.gov/energy/greenhouse-gas-equivalencies-calculator-calculations-and-references",
    accessedAt: "2026-05-10",
    geography: "United States",
    boundary: "Simplified public equivalency factors; boundaries vary by factor.",
    factorType: "illustrative"
  },
  eiaFuelCoefficients: {
    id: "eia-co2-emissions-coefficients-fuel",
    name: "U.S. Energy Information Administration Carbon Dioxide Emissions Coefficients by Fuel",
    url: "https://www.eia.gov/environment/emissions/co2_vol_mass.php",
    accessedAt: "2026-05-10",
    datasetYear: "2022",
    geography: "United States",
    boundary: "Direct fuel-combustion CO2 coefficients by fuel volume or mass.",
    factorType: "tailpipe"
  },
  epaEgrid: {
    id: "epa-egrid",
    name: "EPA eGRID",
    url: "https://www.epa.gov/egrid",
    accessedAt: "2026-05-08",
    geography: "United States",
    boundary: "Average operational grid electricity emissions factors.",
    factorType: "average"
  },
  eiaElectricityUse: {
    id: "eia-residential-electricity-use",
    name: "U.S. Energy Information Administration residential electricity use references",
    url: "https://www.eia.gov/energyexplained/use-of-energy/electricity-use-in-homes.php",
    accessedAt: "2026-05-08",
    geography: "United States",
    boundary: "Residential electricity consumption only.",
    factorType: "average"
  },
  ieaGrid: {
    id: "iea-global-electricity-emissions",
    name: "IEA global electricity emissions references",
    url: "https://www.iea.org/",
    accessedAt: "2026-05-08",
    geography: "World",
    boundary: "Illustrative average operational electricity emissions factor.",
    factorType: "average"
  },
  epochAi: {
    id: "epoch-ai-inference-energy",
    name: "Epoch AI: How much energy does ChatGPT use?",
    url: "https://epoch.ai/gradient-updates/how-much-energy-does-chatgpt-use",
    accessedAt: "2026-05-10",
    boundary: "Inference electricity estimates only; excludes training and lifecycle impacts.",
    factorType: "operational"
  },
  mlEnergyLeaderboard: {
    id: "ml-energy-leaderboard-v3",
    name: "ML.ENERGY Leaderboard v3.0 inference energy benchmark",
    url: "https://ml.energy/blog/measurement/energy/diagnosing-inference-energy-consumption-with-the-mlenergy-leaderboard-v30/",
    accessedAt: "2026-05-10",
    publishedAt: "2025-12",
    boundary: "Inference electricity measurements for benchmarked model-serving workloads.",
    factorType: "operational"
  },
  owidEmberElectricity: {
    id: "owid-ember-carbon-intensity-electricity",
    name: "Our World in Data / Ember Yearly Electricity Data",
    url: "https://ourworldindata.org/grapher/carbon-intensity-electricity",
    accessedAt: "2026-05-10",
    datasetYear: "2025",
    boundary: "Average annual lifecycle carbon intensity of electricity.",
    factorType: "lifecycle"
  },
  epaWaterSense: {
    id: "epa-watersense",
    name: "EPA WaterSense indoor water use and shower assumptions",
    url: "https://www.epa.gov/watersense",
    accessedAt: "2026-05-08",
    geography: "United States",
    boundary: "Indoor water-use assumptions; not scarcity weighted.",
    factorType: "average"
  },
  epaWaterSenseToilets: {
    id: "epa-watersense-residential-toilets",
    name: "EPA WaterSense Residential Toilets",
    url: "https://www.epa.gov/watersense/residential-toilets",
    accessedAt: "2026-05-10",
    publishedAt: "2024-05",
    geography: "United States",
    boundary: "Physical water volume per WaterSense-labeled toilet flush; not scarcity weighted.",
    factorType: "illustrative"
  },
  epaWaterSenseFaucets: {
    id: "epa-watersense-bathroom-faucets",
    name: "EPA WaterSense Bathroom Faucets",
    url: "https://www.epa.gov/watersense/bathroom-faucets",
    accessedAt: "2026-05-10",
    publishedAt: "2007-10-01",
    geography: "United States",
    boundary: "Physical water volume at the WaterSense bathroom faucet flow criterion; not scarcity weighted.",
    factorType: "illustrative"
  },
  energyStarDishwashers: {
    id: "energy-star-dishwasher-criteria",
    name: "ENERGY STAR Dishwashers Key Product Criteria",
    url: "https://www.energystar.gov/products/dishwashers/key_product_criteria",
    accessedAt: "2026-05-10",
    publishedAt: "2023-07-19",
    geography: "United States",
    boundary: "ENERGY STAR dishwasher qualification criteria under test assumptions.",
    factorType: "illustrative"
  },
  energyStarDryers: {
    id: "energy-star-clothes-dryers-criteria",
    name: "ENERGY STAR Clothes Dryers Key Product Criteria",
    url: "https://www.energystar.gov/products/clothes_dryers/key_product_criteria",
    accessedAt: "2026-05-10",
    publishedAt: "2014-05-19",
    geography: "United States",
    boundary: "ENERGY STAR electric dryer combined energy factor under standard test assumptions.",
    factorType: "illustrative"
  },
  nistWaterHeatCapacity: {
    id: "nist-water-heat-capacity",
    name: "NIST Chemistry WebBook water heat-capacity reference",
    url: "https://webbook.nist.gov/cgi/cbook.cgi?ID=C7732185&Type=JANAFL&Plot=on",
    accessedAt: "2026-05-10",
    boundary: "Arithmetic electricity estimate from water heat capacity and assumed kettle efficiency.",
    factorType: "arithmetic"
  },
  olympicPool: {
    id: "olympic-pool-volume",
    name: "Olympic pool dimensions approximation",
    url: "https://www.worldaquatics.com/",
    accessedAt: "2026-05-08",
    boundary: "Geometric volume approximation only.",
    factorType: "arithmetic"
  },
  energyStar: {
    id: "energy-star-device-energy",
    name: "ENERGY STAR device electricity use references",
    url: "https://www.energystar.gov/",
    accessedAt: "2026-05-08",
    boundary: "Device electricity-use assumptions; values vary by model and usage pattern.",
    factorType: "illustrative"
  },
  arithmeticVolume: {
    id: "arithmetic-volume-conversion",
    name: "Arithmetic volume conversion",
    url: "https://en.wikipedia.org/wiki/Litre",
    accessedAt: "2026-05-08",
    boundary: "Physical volume only; excludes packaging and lifecycle impacts.",
    factorType: "arithmetic"
  }
};

// src/datasets/water.ts
var waterBoundary = {
  included: ["Physical water volume only."],
  excluded: ["Local water scarcity", "source water stress", "water quality", "seasonality", "packaging", "lifecycle impacts"]
};
var waterEquivalencies = [
  {
    id: "olympic_pool",
    domain: "water",
    label: "Olympic swimming pool volume",
    baseUnit: "m3",
    valueInBaseUnit: 2500,
    confidence: "medium",
    source: sources.olympicPool,
    assumptions: ["Uses a common 50 m \xD7 25 m \xD7 2 m approximation."],
    boundary: waterBoundary,
    methodology: "Divide water volume by 2,500 m\xB3 per pool.",
    formatter: ({ ratio, locale }) => `${formatNumber(ratio, locale)} ${pluralize("Olympic swimming pool", ratio)}`
  },
  {
    id: "household_daily_water",
    domain: "water",
    label: "household day of indoor water use",
    baseUnit: "m3",
    valueInBaseUnit: 0.3,
    confidence: "low",
    source: sources.epaWaterSense,
    assumptions: ["Approximate indoor household use of 300 liters per household-day; household size and regional use vary."],
    boundary: waterBoundary,
    methodology: "Divide water volume by assumed indoor household daily consumption.",
    formatter: ({ ratio, locale }) => `${formatNumber(ratio, locale)} household ${pluralize("day", ratio)} of indoor water use`
  },
  {
    id: "shower",
    domain: "water",
    label: "8-minute shower at about 8 L/min",
    baseUnit: "m3",
    valueInBaseUnit: 0.065,
    confidence: "medium",
    source: sources.epaWaterSense,
    assumptions: ["Assumes roughly 8 minutes at about 8 liters per minute, approximately 65 liters total."],
    boundary: waterBoundary,
    methodology: "Divide water volume by 65 liters per shower.",
    formatter: ({ ratio, locale }) => `${formatNumber(ratio, locale)} ${pluralize("8-minute shower", ratio)}`
  },
  {
    id: "watersense_toilet_flush",
    domain: "water",
    label: "WaterSense toilet flush",
    baseUnit: "m3",
    valueInBaseUnit: 0.00484532708352,
    confidence: "high",
    source: sources.epaWaterSenseToilets,
    assumptions: ["Represents WaterSense-labeled tank-type toilets using 1.28 US gallons per flush or less; actual flush volumes vary by model and mode."],
    boundary: waterBoundary,
    methodology: "Divide water volume by 1.28 US gallons per flush, converted using 0.003785411784 m\xB3 per US gallon.",
    formatter: ({ ratio, locale }) => `${formatNumber(ratio, locale)} WaterSense toilet ${Math.abs(ratio - 1) < 0.05 ? "flush" : "flushes"}`
  },
  {
    id: "watersense_faucet_minute",
    domain: "water",
    label: "one minute of WaterSense bathroom faucet flow",
    baseUnit: "m3",
    valueInBaseUnit: 0.005678117676,
    confidence: "high",
    source: sources.epaWaterSenseFaucets,
    assumptions: ["Represents the WaterSense bathroom sink faucet/aerator maximum flow criterion of 1.5 US gallons per minute at rated pressure; actual flow varies."],
    boundary: waterBoundary,
    methodology: "Divide water volume by 1.5 US gallons per minute, converted using 0.003785411784 m\xB3 per US gallon.",
    formatter: ({ ratio, locale }) => `${formatNumber(ratio, locale)} ${pluralize("minute", ratio)} of WaterSense bathroom faucet flow`
  },
  {
    id: "energystar_dishwasher_cycle",
    domain: "water",
    label: "ENERGY STAR standard dishwasher cycle water use",
    baseUnit: "m3",
    valueInBaseUnit: 0.0121133177088,
    confidence: "high",
    source: sources.energyStarDishwashers,
    assumptions: ["Uses the ENERGY STAR standard-size dishwasher water criterion of 3.2 US gallons per cycle; this is a qualification criterion, not a measured average."],
    boundary: waterBoundary,
    methodology: "Divide water volume by 3.2 US gallons per cycle, converted using 0.003785411784 m\xB3 per US gallon.",
    formatter: ({ ratio, locale }) => `${formatNumber(ratio, locale)} ENERGY STAR dishwasher ${pluralize("cycle", ratio)} of water use`
  },
  {
    id: "bottled_water_500ml",
    domain: "water",
    label: "500 ml bottle volume",
    baseUnit: "m3",
    valueInBaseUnit: 5e-4,
    confidence: "high",
    source: sources.arithmeticVolume,
    assumptions: ["Bottle volume only; excludes plastic packaging, transport, and lifecycle water impacts."],
    boundary: waterBoundary,
    methodology: "Divide water volume by 0.5 liters per bottle.",
    formatter: ({ ratio, locale }) => `${formatNumber(ratio, locale)} 500 ml water ${pluralize("bottle", ratio)}`
  }
];

// src/datasets/electricity.ts
var electricityBoundary = {
  included: ["Consumed electricity only."],
  excluded: ["Grid emissions unless converted separately", "upstream fuel impacts", "device manufacturing", "lifecycle impacts"]
};
var electricityEquivalencies = [
  {
    id: "smartphone_charge",
    domain: "electricity",
    label: "smartphone charge",
    baseUnit: "Wh",
    valueInBaseUnit: 12,
    confidence: "low",
    source: sources.energyStar,
    assumptions: ["Illustrative full phone battery charge including charging losses; actual devices vary."],
    boundary: electricityBoundary,
    methodology: "Divide electricity by an assumed 12 Wh per charge.",
    formatter: ({ ratio, locale }) => `${formatNumber(ratio, locale)} ${pluralize("smartphone charge", ratio)}`
  },
  {
    id: "laptop_charge",
    domain: "electricity",
    label: "laptop charge",
    baseUnit: "Wh",
    valueInBaseUnit: 60,
    confidence: "low",
    source: sources.energyStar,
    assumptions: ["Illustrative mainstream laptop battery capacity; actual batteries and charging losses vary."],
    boundary: electricityBoundary,
    methodology: "Divide electricity by an assumed 60 Wh per laptop charge.",
    formatter: ({ ratio, locale }) => `${formatNumber(ratio, locale)} ${pluralize("laptop charge", ratio)}`
  },
  {
    id: "laptop_hour",
    domain: "electricity",
    label: "hour of laptop use",
    baseUnit: "Wh",
    valueInBaseUnit: 50,
    confidence: "low",
    source: sources.energyStar,
    assumptions: ["Assumes an average active laptop draw of about 50 W; use varies by device and workload."],
    boundary: electricityBoundary,
    methodology: "Divide electricity by 50 Wh per hour of laptop use.",
    formatter: ({ ratio, locale }) => `${formatNumber(ratio, locale)} ${pluralize("hour", ratio)} of laptop use`
  },
  {
    id: "led_bulb_hour",
    domain: "electricity",
    label: "hour of LED bulb use",
    baseUnit: "Wh",
    valueInBaseUnit: 10,
    confidence: "medium",
    source: sources.energyStar,
    assumptions: ["Assumes one 10 W LED bulb."],
    boundary: electricityBoundary,
    methodology: "Divide electricity by 10 Wh per bulb-hour.",
    formatter: ({ ratio, locale }) => `${formatNumber(ratio, locale)} LED bulb ${pluralize("hour", ratio)}`
  },
  {
    id: "boil_one_liter_water",
    domain: "electricity",
    label: "boiling one liter of water in an electric kettle",
    baseUnit: "Wh",
    valueInBaseUnit: 103,
    confidence: "medium",
    source: sources.nistWaterHeatCapacity,
    assumptions: ["Heats 1 liter of water from 20\xB0C to 100\xB0C and assumes 90% kettle efficiency; actual use varies with starting temperature, overfilling, kettle losses, and altitude."],
    boundary: electricityBoundary,
    methodology: "Estimate thermal energy as 1 kg \xD7 4.184 kJ/kg\xB0C \xD7 80\xB0C = about 93 Wh, then divide by 90% kettle efficiency.",
    formatter: ({ ratio, locale }) => `${formatNumber(ratio, locale)} ${pluralize("liter", ratio)} of water boiled in an electric kettle`
  },
  {
    id: "dishwasher_cycle",
    domain: "electricity",
    label: "ENERGY STAR standard dishwasher cycle electricity use",
    baseUnit: "Wh",
    valueInBaseUnit: 1116,
    confidence: "medium",
    source: sources.energyStarDishwashers,
    assumptions: ["Uses the ENERGY STAR standard-size dishwasher annual energy criterion of 240 kWh/year divided by 215 cycles/year; actual cycles and hot-water system assumptions vary."],
    boundary: electricityBoundary,
    methodology: "Divide 240 kWh/year by 215 cycles/year to estimate 1.116 kWh per standard dishwasher cycle.",
    formatter: ({ ratio, locale }) => `${formatNumber(ratio, locale)} ENERGY STAR dishwasher ${pluralize("cycle", ratio)} of electricity use`
  },
  {
    id: "electric_dryer_load",
    domain: "electricity",
    label: "ENERGY STAR electric clothes dryer load",
    baseUnit: "Wh",
    valueInBaseUnit: 2150,
    confidence: "medium",
    source: sources.energyStarDryers,
    assumptions: ["Uses the ENERGY STAR standard electric dryer combined energy factor of 3.93 lb/kWh and an 8.45 lb test load; excludes washer energy and gas dryers."],
    boundary: electricityBoundary,
    methodology: "Divide an 8.45 lb standard test load by 3.93 lb/kWh to estimate about 2.15 kWh per electric dryer load.",
    formatter: ({ ratio, locale }) => `${formatNumber(ratio, locale)} ENERGY STAR electric dryer ${pluralize("load", ratio)}`
  },
  {
    id: "ev_charge",
    domain: "electricity",
    label: "EV full charge for a 60 kWh battery",
    baseUnit: "Wh",
    valueInBaseUnit: 6e4,
    confidence: "low",
    source: sources.energyStar,
    assumptions: ["Assumes a representative 60 kWh battery electric vehicle pack; actual vehicles vary widely."],
    boundary: electricityBoundary,
    methodology: "Divide electricity by 60 kWh per EV charge.",
    formatter: ({ ratio, locale }) => `${formatNumber(ratio, locale)} ${pluralize("EV full charge", ratio)}`
  },
  {
    id: "home_daily_usage",
    domain: "electricity",
    label: "US average home day of electricity use",
    baseUnit: "Wh",
    valueInBaseUnit: 3e4,
    confidence: "medium",
    source: sources.eiaElectricityUse,
    assumptions: ["Approximate US household electricity use of 30 kWh per day; varies by home, region, season, and year."],
    boundary: electricityBoundary,
    methodology: "Divide electricity by 30 kWh per household-day.",
    formatter: ({ ratio, locale }) => `${formatNumber(ratio, locale)} US average home ${pluralize("day", ratio)} of electricity use`
  }
];

// src/datasets/carbon.ts
var carbonBoundary = {
  included: ["Approximate published CO2 or CO2e comparison factors."],
  excluded: ["Formal carbon accounting", "offset claims", "certification", "full lifecycle impacts unless explicitly stated"]
};
var carbonEquivalencies = [
  {
    id: "tree_year",
    domain: "carbon",
    label: "estimated urban tree-year sequestration",
    baseUnit: "kgCO2e",
    valueInBaseUnit: 22,
    confidence: "low",
    source: sources.epaGhg,
    assumptions: [
      "Illustrative annualized tree sequestration estimate; varies by species, age, climate, survival, and permanence.",
      "Should not be interpreted as an offset or carbon-neutrality claim."
    ],
    boundary: carbonBoundary,
    methodology: "Divide kgCO2e by about 22 kg CO2e per estimated tree-year of sequestration.",
    formatter: ({ ratio, locale }) => `${formatNumber(ratio, locale)} estimated tree-${pluralize("year", ratio)} of sequestration`
  },
  {
    id: "gasoline_gallon",
    domain: "carbon",
    label: "US tailpipe CO2 from one gallon of gasoline burned",
    baseUnit: "kgCO2e",
    valueInBaseUnit: 8.89,
    confidence: "high",
    source: sources.epaGhg,
    assumptions: ["Direct tailpipe CO2 from combusting gasoline; excludes upstream lifecycle emissions and is not a full fuel-cycle CO2e factor."],
    boundary: {
      included: ["Direct tailpipe CO2 from gasoline combustion."],
      excluded: ["Extraction", "refining", "transport", "vehicle manufacturing", "other lifecycle emissions"]
    },
    methodology: "Divide kgCO2e by 8.89 kg direct CO2 per gallon gasoline.",
    formatter: ({ ratio, locale }) => `${formatNumber(ratio, locale)} ${pluralize("gallon", ratio)} of gasoline burned`
  },
  {
    id: "diesel_gallon",
    domain: "carbon",
    label: "US tailpipe CO2 from one gallon of diesel burned",
    baseUnit: "kgCO2e",
    valueInBaseUnit: 10.18,
    confidence: "high",
    source: sources.epaGhg,
    assumptions: ["Direct CO2 from combusting diesel fuel; excludes extraction, refining, transport, vehicle manufacturing, and other lifecycle emissions."],
    boundary: {
      included: ["Direct tailpipe CO2 from diesel combustion."],
      excluded: ["Extraction", "refining", "transport", "vehicle manufacturing", "CH4/N2O unless explicitly included", "other lifecycle emissions"]
    },
    methodology: "Divide kgCO2e by 10.18 kg direct CO2 per gallon diesel, based on EPA's 10,180 grams CO2/gallon factor.",
    formatter: ({ ratio, locale }) => `${formatNumber(ratio, locale)} ${pluralize("gallon", ratio)} of diesel burned`
  },
  {
    id: "natural_gas_therm",
    domain: "carbon",
    label: "CO2 from one therm of natural gas burned",
    baseUnit: "kgCO2e",
    valueInBaseUnit: 5.3,
    confidence: "high",
    source: sources.epaGhg,
    assumptions: ["Direct CO2 from natural gas combustion; excludes upstream gas production, transmission leakage, appliance lifecycle, and unburned methane leakage."],
    boundary: {
      included: ["Direct combustion CO2 from natural gas burned as fuel."],
      excluded: ["Upstream production", "transmission leakage", "appliance lifecycle", "unburned methane leakage", "other lifecycle emissions"]
    },
    methodology: "Divide kgCO2e by 5.3 kg direct CO2 per therm of natural gas, based on EPA's 0.0053 metric tons CO2/therm factor.",
    formatter: ({ ratio, locale }) => `${formatNumber(ratio, locale)} ${pluralize("therm", ratio)} of natural gas burned`
  },
  {
    id: "propane_gallon",
    domain: "carbon",
    label: "CO2 from one gallon of propane burned",
    baseUnit: "kgCO2e",
    valueInBaseUnit: 5.75,
    confidence: "high",
    source: sources.eiaFuelCoefficients,
    assumptions: ["Direct CO2 from propane combustion; excludes upstream propane production, transport, storage losses, appliance lifecycle, and other lifecycle emissions."],
    boundary: {
      included: ["Direct combustion CO2 from propane burned as fuel."],
      excluded: ["Production", "transport", "storage losses", "appliance lifecycle", "other lifecycle emissions"]
    },
    methodology: "Divide kgCO2e by EIA's 5.75 kg CO2 per gallon propane combustion coefficient.",
    formatter: ({ ratio, locale }) => `${formatNumber(ratio, locale)} ${pluralize("gallon", ratio)} of propane burned`
  },
  {
    id: "jet_fuel_gallon",
    domain: "carbon",
    label: "CO2 from one gallon of jet fuel burned",
    baseUnit: "kgCO2e",
    valueInBaseUnit: 9.75,
    confidence: "high",
    source: sources.eiaFuelCoefficients,
    assumptions: ["Direct CO2 from jet fuel combustion; excludes aircraft efficiency, passenger allocation, seating class, load factor, airport operations, fuel production, and non-CO2 aviation effects."],
    boundary: {
      included: ["Direct fuel-combustion CO2 from jet fuel."],
      excluded: ["Fuel production", "aircraft operations allocation", "airport operations", "non-CO2 aviation effects", "other lifecycle emissions"]
    },
    methodology: "Divide kgCO2e by EIA's 9.75 kg CO2 per gallon jet fuel combustion coefficient.",
    formatter: ({ ratio, locale }) => `${formatNumber(ratio, locale)} ${pluralize("gallon", ratio)} of jet fuel burned`
  },
  {
    id: "vehicle_km",
    domain: "carbon",
    label: "US passenger vehicle kilometer",
    baseUnit: "kgCO2e",
    valueInBaseUnit: 0.25,
    confidence: "medium",
    source: sources.epaGhg,
    assumptions: ["Representative US passenger vehicle operational emissions; real-world fleet values vary by vehicle, fuel economy, and driving conditions."],
    boundary: carbonBoundary,
    methodology: "Divide kgCO2e by 0.25 kg CO2e per vehicle-km.",
    formatter: ({ ratio, locale }) => `${formatNumber(ratio, locale)} US passenger vehicle ${pluralize("km", ratio)}`
  },
  {
    id: "home_powered_day",
    domain: "carbon",
    label: "US home powered for one day",
    baseUnit: "kgCO2e",
    valueInBaseUnit: 12,
    confidence: "low",
    source: sources.epaGhg,
    assumptions: ["Approximate emissions for one US household electricity day; electricity use and grid intensity vary strongly by region and year."],
    boundary: {
      included: ["Illustrative operational electricity emissions for a household-day."],
      excluded: ["Household fuel use", "upstream lifecycle emissions", "regional hourly or marginal grid variation"]
    },
    methodology: "Divide kgCO2e by an illustrative 12 kg CO2e per US home-day powered.",
    formatter: ({ ratio, locale }) => `${formatNumber(ratio, locale)} US home ${pluralize("day", ratio)} powered`
  },
  {
    id: "short_flight_passenger",
    domain: "carbon",
    label: "illustrative short-haul passenger flight",
    baseUnit: "kgCO2e",
    valueInBaseUnit: 150,
    confidence: "low",
    source: sources.epaGhg,
    assumptions: ["Illustrative passenger allocation for a short-haul flight; route, aircraft, class, load factor, and non-CO2 effects vary."],
    boundary: carbonBoundary,
    methodology: "Divide kgCO2e by an illustrative 150 kg CO2e per passenger short-haul flight.",
    formatter: ({ ratio, locale }) => `${formatNumber(ratio, locale)} illustrative ${pluralize("short-haul passenger flight", ratio)}`
  }
];

// src/datasets/ai.ts
var aiBoundary = {
  included: ["Approximate inference electricity consumption."],
  excluded: ["Training", "embodied hardware emissions", "user devices", "networking", "storage", "cooling water", "full lifecycle impacts"]
};
var gridBoundary = {
  included: ["Average operational grid electricity emissions."],
  excluded: ["Marginal hourly emissions", "datacenter-specific power purchase agreements", "upstream fuel lifecycle emissions unless included by source"]
};
var aiEnergyProfiles = [
  {
    id: "efficient_small_model",
    label: "Efficient small model",
    assumptions: {
      modelClass: "Small or optimized inference model",
      infrastructure: "Efficient batching and modern accelerators"
    },
    whPer1KTokens: {
      min: 0.01,
      typical: 0.03,
      max: 0.08
    },
    confidence: "low",
    source: sources.epochAi,
    boundary: aiBoundary
  },
  {
    id: "balanced_model",
    label: "Balanced general-purpose model",
    assumptions: {
      modelClass: "Mid-sized general-purpose inference model",
      infrastructure: "Typical production datacenter efficiency"
    },
    whPer1KTokens: {
      min: 0.05,
      typical: 0.15,
      max: 0.5
    },
    confidence: "low",
    source: sources.epochAi,
    boundary: aiBoundary
  },
  {
    id: "frontier_model",
    label: "Frontier model",
    assumptions: {
      modelClass: "Large frontier inference model",
      reasoningLevel: "May include longer context, longer outputs, or higher reasoning depth",
      infrastructure: "Average datacenter efficiency"
    },
    whPer1KTokens: {
      min: 0.2,
      typical: 0.6,
      max: 1.5
    },
    confidence: "low",
    source: sources.epochAi,
    boundary: aiBoundary
  },
  {
    id: "reasoning_problem_solving",
    label: "Reasoning / problem-solving model",
    assumptions: {
      modelClass: "Long-output reasoning or problem-solving inference workload",
      reasoningLevel: "Represents tasks with longer generated outputs and higher energy per token than ordinary text conversation.",
      infrastructure: "Optimized benchmark-serving environment on modern accelerators"
    },
    whPer1KTokens: {
      min: 0.09,
      typical: 0.18,
      max: 0.25
    },
    confidence: "medium",
    source: sources.mlEnergyLeaderboard,
    boundary: aiBoundary
  },
  {
    id: "long_context_frontier",
    label: "Long-context frontier model",
    assumptions: {
      modelClass: "Frontier text model with substantial long-context input/prefill cost",
      reasoningLevel: "Schema-compatible total-token approximation; input and output tokens can have different energy costs.",
      infrastructure: "Production frontier-model serving; actual cost depends strongly on context length, batching, hardware, and datacenter efficiency"
    },
    whPer1KTokens: {
      min: 0.24,
      typical: 0.3,
      max: 0.4
    },
    confidence: "low",
    source: sources.epochAi,
    boundary: aiBoundary
  }
];
var regionalEmissionFactors = [
  {
    id: "WORLD",
    label: "World average grid electricity",
    kgCO2ePerKWh: 0.475,
    source: sources.ieaGrid,
    assumptions: ["Illustrative global average grid factor; replace with authoritative local data when available."],
    boundary: gridBoundary,
    confidence: "low"
  },
  {
    id: "US",
    label: "United States average grid electricity",
    kgCO2ePerKWh: 0.386,
    source: sources.epaEgrid,
    assumptions: ["Representative US average operational electricity emissions factor; use year-specific eGRID factors for reporting."],
    boundary: gridBoundary,
    confidence: "medium"
  },
  {
    id: "US-CA",
    label: "California average grid electricity",
    kgCO2ePerKWh: 0.196,
    source: sources.epaEgrid,
    assumptions: ["Illustrative California average grid factor; varies by year, grid subregion, marginal/average method, and time of use."],
    boundary: gridBoundary,
    confidence: "low"
  },
  {
    id: "EU",
    label: "European Union average electricity",
    kgCO2ePerKWh: 0.21,
    source: sources.owidEmberElectricity,
    assumptions: ["Average annual EU electricity carbon intensity from OWID/Ember; does not reflect hourly marginal emissions or datacenter-specific procurement."],
    boundary: {
      included: ["Average annual lifecycle electricity carbon intensity."],
      excluded: ["Hourly marginal emissions", "datacenter-specific power purchase agreements", "workload shifting", "facility-specific electricity supply"]
    },
    confidence: "medium"
  },
  {
    id: "FR",
    label: "France average electricity",
    kgCO2ePerKWh: 0.041,
    source: sources.owidEmberElectricity,
    assumptions: ["Average annual France electricity carbon intensity from OWID/Ember; does not reflect hourly marginal emissions or datacenter-specific procurement."],
    boundary: {
      included: ["Average annual lifecycle electricity carbon intensity."],
      excluded: ["Hourly marginal emissions", "datacenter-specific power purchase agreements", "workload shifting", "facility-specific electricity supply"]
    },
    confidence: "medium"
  },
  {
    id: "IN",
    label: "India average electricity",
    kgCO2ePerKWh: 0.67,
    source: sources.owidEmberElectricity,
    assumptions: ["Average annual India electricity carbon intensity from OWID/Ember; does not reflect hourly marginal emissions or datacenter-specific procurement."],
    boundary: {
      included: ["Average annual lifecycle electricity carbon intensity."],
      excluded: ["Hourly marginal emissions", "datacenter-specific power purchase agreements", "workload shifting", "facility-specific electricity supply"]
    },
    confidence: "medium"
  }
];

// src/datasets/index.ts
var defaultEquivalencies = [
  ...waterEquivalencies,
  ...electricityEquivalencies,
  ...carbonEquivalencies
];

// src/engine/units.ts
var baseUnits = {
  water: "m3",
  electricity: "Wh",
  carbon: "kgCO2e"
};
var units = {
  water: [
    { unit: "m3", aliases: ["m3", "m\xB3", "cubic-meter", "cubic-meters"], toBaseUnit: (v) => v },
    { unit: "liter", aliases: ["l", "L", "liter", "liters", "litre", "litres"], toBaseUnit: (v) => v / 1e3 },
    { unit: "gallon", aliases: ["gal", "gallon", "gallons", "us-gallon", "us-gallons"], toBaseUnit: (v) => v * 0.003785411784 }
  ],
  electricity: [
    { unit: "Wh", aliases: ["wh", "Wh", "watt-hour", "watt-hours"], toBaseUnit: (v) => v },
    { unit: "kWh", aliases: ["kwh", "kWh", "kilowatt-hour", "kilowatt-hours"], toBaseUnit: (v) => v * 1e3 },
    { unit: "MWh", aliases: ["mwh", "MWh", "megawatt-hour", "megawatt-hours"], toBaseUnit: (v) => v * 1e6 }
  ],
  carbon: [
    { unit: "kgCO2e", aliases: ["kgco2e", "kgCO2e", "kg-co2e", "kg co2e", "kilogram-co2e"], toBaseUnit: (v) => v },
    { unit: "tCO2e", aliases: ["tco2e", "tCO2e", "tonne-co2e", "tonnes-co2e", "metric-ton-co2e", "metric-tons-co2e"], toBaseUnit: (v) => v * 1e3 }
  ]
};
function findUnit(domain, inputUnit) {
  const normalized = inputUnit.trim().toLowerCase();
  return units[domain].find(
    (definition) => definition.aliases.some((alias) => alias.toLowerCase() === normalized)
  );
}

// src/engine/normalize.ts
function normalizeMeasurement(measurement) {
  if (measurement.domain === "ai") {
    throw new Error("AI measurements use impact.ai.estimate() because token impacts are modeled as ranges.");
  }
  if (!Number.isFinite(measurement.value) || measurement.value < 0) {
    throw new Error("Measurement value must be a finite non-negative number.");
  }
  if (!(measurement.domain in baseUnits)) {
    throw new Error(`Unsupported domain '${measurement.domain}'.`);
  }
  const unit = findUnit(measurement.domain, measurement.unit);
  if (!unit) {
    throw new Error(`Unsupported unit '${measurement.unit}' for domain '${measurement.domain}'.`);
  }
  return {
    value: unit.toBaseUnit(measurement.value),
    unit: baseUnits[measurement.domain]
  };
}

// src/engine/formatter.ts
function defaultEquivalencyFormatter(ratio, equivalency, locale = "en-US") {
  return `${formatNumber(ratio, locale)} \xD7 ${equivalency.label}`;
}
function toEquivalencyResult(equivalency, ratio, score, inputValueInBaseUnit, locale = "en-US") {
  const formatted = equivalency.formatter ? equivalency.formatter({ ratio, valueInBaseUnit: inputValueInBaseUnit, equivalency, locale }) : defaultEquivalencyFormatter(ratio, equivalency, locale);
  return {
    id: equivalency.id,
    domain: equivalency.domain,
    label: equivalency.label,
    ratio,
    score,
    formatted,
    valueInBaseUnit: equivalency.valueInBaseUnit,
    baseUnit: equivalency.baseUnit,
    confidence: equivalency.confidence,
    source: equivalency.source,
    assumptions: equivalency.assumptions ?? [],
    boundary: equivalency.boundary,
    methodology: equivalency.methodology
  };
}

// src/engine/validation.ts
var confidences = /* @__PURE__ */ new Set(["low", "medium", "high"]);
var domains = /* @__PURE__ */ new Set(["water", "electricity", "carbon"]);
function assertFiniteNumber(value, label) {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
}
function assertNonNegativeFiniteNumber(value, label) {
  assertFiniteNumber(value, label);
  if (value < 0) throw new Error(`${label} must be non-negative.`);
}
function assertPositiveFiniteNumber(value, label) {
  assertFiniteNumber(value, label);
  if (value <= 0) throw new Error(`${label} must be greater than zero.`);
}
function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
}
function validateSource(source, path = "source") {
  if (!source || typeof source !== "object") throw new Error(`${path} must be an object.`);
  assertNonEmptyString(source.id, `${path}.id`);
  assertNonEmptyString(source.name, `${path}.name`);
  assertNonEmptyString(source.url, `${path}.url`);
  assertNonEmptyString(source.accessedAt, `${path}.accessedAt`);
}
function validateEquivalency(equivalency, path = "equivalency") {
  if (!equivalency || typeof equivalency !== "object") throw new Error(`${path} must be an object.`);
  assertNonEmptyString(equivalency.id, `${path}.id`);
  if (!domains.has(equivalency.domain)) {
    throw new Error(`${path}.domain must be one of: water, electricity, carbon.`);
  }
  assertNonEmptyString(equivalency.label, `${path}.label`);
  assertNonEmptyString(equivalency.baseUnit, `${path}.baseUnit`);
  assertPositiveFiniteNumber(equivalency.valueInBaseUnit, `${path}.valueInBaseUnit`);
  if (!confidences.has(equivalency.confidence)) {
    throw new Error(`${path}.confidence must be one of: low, medium, high.`);
  }
  validateSource(equivalency.source, `${path}.source`);
}
function validateEquivalencies(equivalencies, path = "datasets") {
  if (!Array.isArray(equivalencies)) throw new Error(`${path} must be an array.`);
  equivalencies.forEach((equivalency, index) => validateEquivalency(equivalency, `${path}[${index}]`));
}
function validateCompareOptions(options) {
  const maxResults = options.maxResults ?? 3;
  const minRatio = options.minRatio ?? 0.05;
  const maxRatio = options.maxRatio ?? 20;
  if (!Number.isInteger(maxResults) || maxResults <= 0) {
    throw new Error("options.maxResults must be a positive integer.");
  }
  assertPositiveFiniteNumber(minRatio, "options.minRatio");
  assertPositiveFiniteNumber(maxRatio, "options.maxRatio");
  if (minRatio > maxRatio) {
    throw new Error("options.minRatio must be less than or equal to options.maxRatio.");
  }
  return { maxResults, minRatio, maxRatio };
}
function validateAiEnergyProfile(profile, path = "profile") {
  if (!profile || typeof profile !== "object") throw new Error(`${path} must be an object.`);
  assertNonEmptyString(profile.id, `${path}.id`);
  assertNonEmptyString(profile.label, `${path}.label`);
  if (!profile.assumptions || typeof profile.assumptions !== "object") {
    throw new Error(`${path}.assumptions must be an object.`);
  }
  assertNonEmptyString(profile.assumptions.modelClass, `${path}.assumptions.modelClass`);
  assertNonNegativeFiniteNumber(profile.whPer1KTokens.min, `${path}.whPer1KTokens.min`);
  assertNonNegativeFiniteNumber(profile.whPer1KTokens.typical, `${path}.whPer1KTokens.typical`);
  assertNonNegativeFiniteNumber(profile.whPer1KTokens.max, `${path}.whPer1KTokens.max`);
  if (profile.whPer1KTokens.min > profile.whPer1KTokens.typical || profile.whPer1KTokens.typical > profile.whPer1KTokens.max) {
    throw new Error(`${path}.whPer1KTokens must satisfy min <= typical <= max.`);
  }
  if (!confidences.has(profile.confidence)) {
    throw new Error(`${path}.confidence must be one of: low, medium, high.`);
  }
  validateSource(profile.source, `${path}.source`);
}
function validateRegionalEmissionFactor(factor, path = "region") {
  if (!factor || typeof factor !== "object") throw new Error(`${path} must be an object.`);
  assertNonEmptyString(factor.id, `${path}.id`);
  assertNonEmptyString(factor.label, `${path}.label`);
  assertNonNegativeFiniteNumber(factor.kgCO2ePerKWh, `${path}.kgCO2ePerKWh`);
  if (!confidences.has(factor.confidence)) {
    throw new Error(`${path}.confidence must be one of: low, medium, high.`);
  }
  validateSource(factor.source, `${path}.source`);
}
function assertDomainBaseUnit(domain, baseUnit, expectedBaseUnit) {
  if (baseUnit !== expectedBaseUnit) {
    throw new Error(`Equivalency for domain '${domain}' must use base unit '${expectedBaseUnit}', received '${baseUnit}'.`);
  }
}

// src/engine/ranking.ts
function scoreRatio(ratio) {
  if (!Number.isFinite(ratio) || ratio <= 0) return Number.POSITIVE_INFINITY;
  return Math.abs(Math.log10(ratio));
}
function rankEquivalencies(valueInBaseUnit, candidates, options = {}) {
  const { maxResults, minRatio, maxRatio } = validateCompareOptions(options);
  validateEquivalencies(candidates, "candidates");
  const ranked = candidates.map((candidate) => {
    const ratio = valueInBaseUnit / candidate.valueInBaseUnit;
    return toEquivalencyResult(candidate, ratio, scoreRatio(ratio), valueInBaseUnit, options.locale);
  }).sort((a, b) => a.score - b.score);
  const humanScale = ranked.filter((result) => result.ratio >= minRatio && result.ratio <= maxRatio);
  return (humanScale.length > 0 ? humanScale : ranked).slice(0, maxResults);
}

// src/engine/compare.ts
function uniqueSources(sources2) {
  return [...new Map(sources2.map((source) => [source.id, source])).values()];
}
function uniqueStrings(values) {
  return [...new Set(values)];
}
function compare(measurement, options = {}) {
  if (measurement.domain === "ai") {
    throw new Error("Use impact.ai.estimate() for AI usage estimates.");
  }
  validateCompareOptions(options);
  const normalized = normalizeMeasurement(measurement);
  const dataset = options.datasets ?? defaultEquivalencies;
  validateEquivalencies(dataset);
  dataset.forEach((equivalency) => assertDomainBaseUnit(equivalency.domain, equivalency.baseUnit, baseUnits[equivalency.domain]));
  const candidates = dataset.filter(
    (equivalency) => equivalency.domain === measurement.domain && equivalency.baseUnit === normalized.unit
  );
  const equivalents = rankEquivalencies(normalized.value, candidates, {
    maxResults: options.maxResults,
    minRatio: options.minRatio,
    maxRatio: options.maxRatio,
    locale: options.locale
  });
  return {
    input: measurement,
    normalized,
    equivalents,
    assumptions: uniqueStrings(equivalents.flatMap((equivalent) => equivalent.assumptions)),
    sources: uniqueSources(equivalents.map((equivalent) => equivalent.source))
  };
}

// src/domains/ai/index.ts
var DISCLAIMER = "AI estimates are approximate ranges for inference electricity and associated operational emissions only. Results depend on model architecture, hardware, batching, context length, output length, reasoning mode, datacenter efficiency, and electricity supply. Estimates exclude training, embodied hardware emissions, user devices, networking, storage, cooling water, and lifecycle impacts unless otherwise stated.";
function uniqueSources2(sources2) {
  return [...new Map(sources2.map((source) => [source.id, source])).values()];
}
function resolveProfile(input, profiles = aiEnergyProfiles) {
  if (typeof input === "object" && input) {
    validateAiEnergyProfile(input);
    return input;
  }
  profiles.forEach((profile2, index) => validateAiEnergyProfile(profile2, `profiles[${index}]`));
  const id = input ?? "frontier_model";
  const profile = profiles.find((candidate) => candidate.id === id);
  if (!profile) throw new Error(`Unknown AI energy profile '${id}'.`);
  return profile;
}
function resolveRegion(input, factors = regionalEmissionFactors) {
  if (typeof input === "object" && input) {
    validateRegionalEmissionFactor(input);
    return input;
  }
  factors.forEach((factor2, index) => validateRegionalEmissionFactor(factor2, `emissionFactors[${index}]`));
  const id = input ?? "US";
  const factor = factors.find((candidate) => candidate.id.toLowerCase() === id.toLowerCase());
  if (!factor) throw new Error(`Unknown regional emission factor '${id}'.`);
  return factor;
}
function resolveTokens(input) {
  const directTokens = input.tokens ?? 0;
  const sessions = input.sessions ?? 0;
  const inferenceRequests = input.inferenceRequests ?? 0;
  const averageTokensPerSession = input.averageTokensPerSession ?? 2e3;
  const averageTokensPerRequest = input.averageTokensPerRequest ?? 1e3;
  assertNonNegativeFiniteNumber(directTokens, "tokens");
  assertNonNegativeFiniteNumber(sessions, "sessions");
  assertNonNegativeFiniteNumber(inferenceRequests, "inferenceRequests");
  assertNonNegativeFiniteNumber(averageTokensPerSession, "averageTokensPerSession");
  assertNonNegativeFiniteNumber(averageTokensPerRequest, "averageTokensPerRequest");
  const sessionTokens = sessions * averageTokensPerSession;
  const requestTokens = inferenceRequests * averageTokensPerRequest;
  const tokens = directTokens + sessionTokens + requestTokens;
  assertNonNegativeFiniteNumber(tokens, "AI token estimate");
  return tokens;
}
function estimate(input) {
  validateCompareOptions({ maxResults: input.maxEquivalents ?? 2 });
  const tokens = resolveTokens(input);
  const profile = resolveProfile(input.profile, input.profiles ?? aiEnergyProfiles);
  const region = resolveRegion(input.region, input.emissionFactors ?? regionalEmissionFactors);
  const tokenUnits = tokens / 1e3;
  const wh = {
    min: tokenUnits * profile.whPer1KTokens.min,
    typical: tokenUnits * profile.whPer1KTokens.typical,
    max: tokenUnits * profile.whPer1KTokens.max
  };
  const kwh = {
    min: wh.min / 1e3,
    typical: wh.typical / 1e3,
    max: wh.max / 1e3
  };
  const kgCO2e = {
    min: kwh.min * region.kgCO2ePerKWh,
    typical: kwh.typical * region.kgCO2ePerKWh,
    max: kwh.max * region.kgCO2ePerKWh
  };
  const maxEquivalents = input.maxEquivalents ?? 2;
  const electricityEquivalents = compare(
    { domain: "electricity", value: wh.typical, unit: "Wh" },
    { maxResults: maxEquivalents }
  ).equivalents;
  const carbonEquivalents = compare(
    { domain: "carbon", value: kgCO2e.typical, unit: "kgCO2e" },
    { maxResults: maxEquivalents }
  ).equivalents;
  const assumptions = [
    `${profile.label}: ${profile.assumptions.modelClass}`,
    ...profile.assumptions.reasoningLevel ? [`Reasoning/context assumption: ${profile.assumptions.reasoningLevel}`] : [],
    ...profile.assumptions.infrastructure ? [`Infrastructure assumption: ${profile.assumptions.infrastructure}`] : [],
    `${region.label}: ${region.kgCO2ePerKWh} kgCO2e/kWh`,
    ...region.assumptions ?? []
  ];
  return {
    tokens,
    profile,
    region,
    electricity: { wh, kwh },
    carbon: { kgCO2e },
    equivalents: [...electricityEquivalents, ...carbonEquivalents].map((equivalent) => equivalent.formatted),
    electricityEquivalents,
    carbonEquivalents,
    assumptions,
    sources: uniqueSources2([
      profile.source,
      region.source,
      ...electricityEquivalents.map((equivalent) => equivalent.source),
      ...carbonEquivalents.map((equivalent) => equivalent.source)
    ]),
    disclaimer: DISCLAIMER
  };
}
var ai = {
  estimate,
  profiles: aiEnergyProfiles,
  emissionFactors: regionalEmissionFactors
};

// src/index.ts
var impact = {
  compare,
  ai
};
var index_default = impact;
export {
  ai,
  aiEnergyProfiles,
  carbonEquivalencies,
  compare,
  index_default as default,
  defaultEquivalencies,
  electricityEquivalencies,
  estimate as estimateAiImpact,
  formatNumber,
  formatRange,
  impact,
  normalizeMeasurement,
  rankEquivalencies,
  regionalEmissionFactors,
  roundToSignificant,
  scoreRatio,
  sources,
  validateAiEnergyProfile,
  validateCompareOptions,
  validateEquivalencies,
  validateEquivalency,
  validateRegionalEmissionFactor,
  validateSource,
  waterEquivalencies
};
