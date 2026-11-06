// dotfiles/stow_modules/main/dot-pi/agent/extensions/mono-usage/index.ts
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import {
  CancellableLoader,
  Container,
  Spacer,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi
} from "@earendil-works/pi-tui";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// dotfiles/stow_modules/main/dot-pi/agent/extensions/mono-usage/vendor/impact-equivalences.js
function roundToSignificant(value, significantDigits = 2) {
  if (value === 0)
    return 0;
  const magnitude = Math.floor(Math.log10(Math.abs(value)));
  const factor = 10 ** (significantDigits - magnitude - 1);
  return Math.round(value * factor) / factor;
}
function formatNumber(value, locale = "en-US") {
  if (value === 0)
    return "0";
  if (Math.abs(value) < 0.01)
    return value > 0 ? "<0.01" : ">-0.01";
  const rounded = roundToSignificant(value, value >= 100 ? 2 : 2);
  if (rounded === 0)
    return value > 0 ? "<0.01" : ">-0.01";
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: Math.abs(rounded) < 10 ? 2 : 0
  }).format(rounded);
}
function pluralize(label, value) {
  return Math.abs(value - 1) < 0.05 ? label : `${label}s`;
}
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
    assumptions: ["Uses a common 50 m × 25 m × 2 m approximation."],
    boundary: waterBoundary,
    methodology: "Divide water volume by 2,500 m³ per pool.",
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
    methodology: "Divide water volume by 1.28 US gallons per flush, converted using 0.003785411784 m³ per US gallon.",
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
    methodology: "Divide water volume by 1.5 US gallons per minute, converted using 0.003785411784 m³ per US gallon.",
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
    methodology: "Divide water volume by 3.2 US gallons per cycle, converted using 0.003785411784 m³ per US gallon.",
    formatter: ({ ratio, locale }) => `${formatNumber(ratio, locale)} ENERGY STAR dishwasher ${pluralize("cycle", ratio)} of water use`
  },
  {
    id: "bottled_water_500ml",
    domain: "water",
    label: "500 ml bottle volume",
    baseUnit: "m3",
    valueInBaseUnit: 0.0005,
    confidence: "high",
    source: sources.arithmeticVolume,
    assumptions: ["Bottle volume only; excludes plastic packaging, transport, and lifecycle water impacts."],
    boundary: waterBoundary,
    methodology: "Divide water volume by 0.5 liters per bottle.",
    formatter: ({ ratio, locale }) => `${formatNumber(ratio, locale)} 500 ml water ${pluralize("bottle", ratio)}`
  }
];
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
    assumptions: ["Heats 1 liter of water from 20°C to 100°C and assumes 90% kettle efficiency; actual use varies with starting temperature, overfilling, kettle losses, and altitude."],
    boundary: electricityBoundary,
    methodology: "Estimate thermal energy as 1 kg × 4.184 kJ/kg°C × 80°C = about 93 Wh, then divide by 90% kettle efficiency.",
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
    valueInBaseUnit: 60000,
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
    valueInBaseUnit: 30000,
    confidence: "medium",
    source: sources.eiaElectricityUse,
    assumptions: ["Approximate US household electricity use of 30 kWh per day; varies by home, region, season, and year."],
    boundary: electricityBoundary,
    methodology: "Divide electricity by 30 kWh per household-day.",
    formatter: ({ ratio, locale }) => `${formatNumber(ratio, locale)} US average home ${pluralize("day", ratio)} of electricity use`
  }
];
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
var defaultEquivalencies = [
  ...waterEquivalencies,
  ...electricityEquivalencies,
  ...carbonEquivalencies
];
var baseUnits = {
  water: "m3",
  electricity: "Wh",
  carbon: "kgCO2e"
};
var units = {
  water: [
    { unit: "m3", aliases: ["m3", "m³", "cubic-meter", "cubic-meters"], toBaseUnit: (v) => v },
    { unit: "liter", aliases: ["l", "L", "liter", "liters", "litre", "litres"], toBaseUnit: (v) => v / 1000 },
    { unit: "gallon", aliases: ["gal", "gallon", "gallons", "us-gallon", "us-gallons"], toBaseUnit: (v) => v * 0.003785411784 }
  ],
  electricity: [
    { unit: "Wh", aliases: ["wh", "Wh", "watt-hour", "watt-hours"], toBaseUnit: (v) => v },
    { unit: "kWh", aliases: ["kwh", "kWh", "kilowatt-hour", "kilowatt-hours"], toBaseUnit: (v) => v * 1000 },
    { unit: "MWh", aliases: ["mwh", "MWh", "megawatt-hour", "megawatt-hours"], toBaseUnit: (v) => v * 1e6 }
  ],
  carbon: [
    { unit: "kgCO2e", aliases: ["kgco2e", "kgCO2e", "kg-co2e", "kg co2e", "kilogram-co2e"], toBaseUnit: (v) => v },
    { unit: "tCO2e", aliases: ["tco2e", "tCO2e", "tonne-co2e", "tonnes-co2e", "metric-ton-co2e", "metric-tons-co2e"], toBaseUnit: (v) => v * 1000 }
  ]
};
function findUnit(domain, inputUnit) {
  const normalized = inputUnit.trim().toLowerCase();
  return units[domain].find((definition) => definition.aliases.some((alias) => alias.toLowerCase() === normalized));
}
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
function defaultEquivalencyFormatter(ratio, equivalency, locale = "en-US") {
  return `${formatNumber(ratio, locale)} × ${equivalency.label}`;
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
var confidences = /* @__PURE__ */ new Set(["low", "medium", "high"]);
var domains = /* @__PURE__ */ new Set(["water", "electricity", "carbon"]);
function assertFiniteNumber(value, label) {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
}
function assertNonNegativeFiniteNumber(value, label) {
  assertFiniteNumber(value, label);
  if (value < 0)
    throw new Error(`${label} must be non-negative.`);
}
function assertPositiveFiniteNumber(value, label) {
  assertFiniteNumber(value, label);
  if (value <= 0)
    throw new Error(`${label} must be greater than zero.`);
}
function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
}
function validateSource(source, path = "source") {
  if (!source || typeof source !== "object")
    throw new Error(`${path} must be an object.`);
  assertNonEmptyString(source.id, `${path}.id`);
  assertNonEmptyString(source.name, `${path}.name`);
  assertNonEmptyString(source.url, `${path}.url`);
  assertNonEmptyString(source.accessedAt, `${path}.accessedAt`);
}
function validateEquivalency(equivalency, path = "equivalency") {
  if (!equivalency || typeof equivalency !== "object")
    throw new Error(`${path} must be an object.`);
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
  if (!Array.isArray(equivalencies))
    throw new Error(`${path} must be an array.`);
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
  if (!profile || typeof profile !== "object")
    throw new Error(`${path} must be an object.`);
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
  if (!factor || typeof factor !== "object")
    throw new Error(`${path} must be an object.`);
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
function scoreRatio(ratio) {
  if (!Number.isFinite(ratio) || ratio <= 0)
    return Number.POSITIVE_INFINITY;
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
  const candidates = dataset.filter((equivalency) => equivalency.domain === measurement.domain && equivalency.baseUnit === normalized.unit);
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
  if (!profile)
    throw new Error(`Unknown AI energy profile '${id}'.`);
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
  if (!factor)
    throw new Error(`Unknown regional emission factor '${id}'.`);
  return factor;
}
function resolveTokens(input) {
  const directTokens = input.tokens ?? 0;
  const sessions = input.sessions ?? 0;
  const inferenceRequests = input.inferenceRequests ?? 0;
  const averageTokensPerSession = input.averageTokensPerSession ?? 2000;
  const averageTokensPerRequest = input.averageTokensPerRequest ?? 1000;
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
  const tokenUnits = tokens / 1000;
  const wh = {
    min: tokenUnits * profile.whPer1KTokens.min,
    typical: tokenUnits * profile.whPer1KTokens.typical,
    max: tokenUnits * profile.whPer1KTokens.max
  };
  const kwh = {
    min: wh.min / 1000,
    typical: wh.typical / 1000,
    max: wh.max / 1000
  };
  const kgCO2e = {
    min: kwh.min * region.kgCO2ePerKWh,
    typical: kwh.typical * region.kgCO2ePerKWh,
    max: kwh.max * region.kgCO2ePerKWh
  };
  const maxEquivalents = input.maxEquivalents ?? 2;
  const electricityEquivalents = compare({ domain: "electricity", value: wh.typical, unit: "Wh" }, { maxResults: maxEquivalents }).equivalents;
  const carbonEquivalents = compare({ domain: "carbon", value: kgCO2e.typical, unit: "kgCO2e" }, { maxResults: maxEquivalents }).equivalents;
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

// dotfiles/stow_modules/main/dot-pi/agent/extensions/mono-usage/index.ts
var PERIOD_ORDER = ["day", "week", "month", "all"];
var VIEW_ORDER = [
  "summary",
  "providers",
  "patterns",
  "tools",
  "activity"
];
var PERIOD_LABELS = {
  day: "Today",
  week: "This Week",
  month: "This Month",
  all: "All Time"
};
var VIEW_LABELS = {
  summary: "Summary",
  providers: "Providers",
  patterns: "Patterns",
  tools: "Tools",
  activity: "Activity"
};
var NAME_COL_MAX = 28;
var NAME_COL_MIN_FULL = NAME_COL_MAX;
var PARALLEL_RADIUS_MS = 2 * 60000;
var PARALLEL_THRESHOLD = 4;
var HEAVY_CONTEXT = 150000;
var HEAVY_UNCACHED = 1e5;
var LONG_SESSION_MS = 8 * 60 * 60 * 1000;
var TOP_SESSIONS_PROBE = 5;
var MIN_TURNS_FOR_PARALLEL = 10;
var MIN_INSIGHT_PERCENT = 1;
var SUMMARY_TOP_PROVIDERS = 3;
var BAR_WIDTH = 24;
var BAR_FILLED = "█";
var BAR_EMPTY = "░";
var BUILT_IN_TOOLS = new Set([
  "bash",
  "edit",
  "read",
  "write"
]);
var HEAT_CELL = "■";
var HEAT_CELL_GAP = " ";
var HEAT_CELL_WIDTH = 2;
var HEAT_ROWS = 7;
var HEAT_MAX_WEEKS = 53;
var HEAT_MIN_WEEKS = 8;
var HEAT_ROW_LABEL_WIDTH = 4;
var HEAT_TIERS = 4;
var HEAT_LEVELS = HEAT_TIERS + 1;
var HEAT_DENSITY_GLYPHS = ["·", "░", "▒", "▓", "█"];
var HEAT_ROW_LABELS = ["Mon", "", "Wed", "", "Fri", "", "Sun"];
var MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec"
];
var DAY_MS = 24 * 60 * 60 * 1000;
var agentRoot = () => {
  const root = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
  return root;
};
var sessionRoots = () => {
  const root = agentRoot();
  return [
    join(root, "sessions"),
    join(root, "extensions", "team-mode", "teammates")
  ];
};
async function listSessionFiles(root, signal) {
  const queue = [root];
  const out = [];
  while (queue.length > 0) {
    if (signal?.aborted)
      return [];
    const dir = queue.shift();
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const name = entry.name;
      const full = join(dir, name);
      if (entry.isDirectory())
        queue.push(full);
      else if (entry.isFile() && name.endsWith(".jsonl"))
        out.push(full);
    }
  }
  return out.sort();
}
async function listFiles(root, predicate, signal) {
  const queue = [root];
  const out = [];
  while (queue.length > 0) {
    if (signal?.aborted)
      return [];
    const dir = queue.shift();
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const name = entry.name;
      if (name === "node_modules" || name === "dist" || name === "__tests__")
        continue;
      const full = join(dir, name);
      if (entry.isDirectory())
        queue.push(full);
      else if (entry.isFile() && predicate(name))
        out.push(full);
    }
  }
  return out.sort();
}
async function buildToolRegistry(signal) {
  const registry = new Map;
  const extensionsDir = join(process.cwd(), "extensions");
  let entries;
  try {
    entries = await readdir(extensionsDir, { withFileTypes: true });
  } catch {
    return registry;
  }
  for (const entry of entries) {
    if (signal?.aborted)
      return registry;
    if (!entry.isDirectory())
      continue;
    const extensionDir = join(extensionsDir, entry.name);
    const group = await extensionGroupName(extensionDir, entry.name);
    const files = await listFiles(extensionDir, (name) => name.endsWith(".ts"), signal);
    for (const file of files) {
      if (signal?.aborted)
        return registry;
      let source = "";
      try {
        source = await readFile(file, "utf8");
      } catch {
        continue;
      }
      for (const toolName of extractRegisteredToolNames(source))
        registry.set(toolName, group);
    }
  }
  return registry;
}
async function extensionGroupName(extensionDir, fallback) {
  try {
    const pkg = JSON.parse(await readFile(join(extensionDir, "package.json"), "utf8"));
    const name = typeof pkg.name === "string" ? pkg.name : fallback;
    return titleCaseWords(name.replace(/^pi-mono-/, ""));
  } catch {
    return titleCaseWords(fallback);
  }
}
function extractRegisteredToolNames(source) {
  const names = new Set;
  const patterns = [
    /registerTool\s*\(\s*{[\s\S]*?name:\s*["']([^"']+)["']/g
  ];
  for (const pattern of patterns) {
    let match;
    while (match = pattern.exec(source))
      names.add(match[1]);
  }
  return [...names];
}
function turnFingerprint(turn) {
  return `${turn.ts}|${turn.input}|${turn.output}|${turn.cacheRead}|${turn.cacheWrite}`;
}
async function parseSessionFile(path, seen, signal) {
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return null;
  }
  if (signal?.aborted)
    return null;
  const turns = [];
  const tools = [];
  let sessionId = "";
  const lines = raw.trim().split(`
`);
  for (let i = 0;i < lines.length; i++) {
    if (signal?.aborted)
      return null;
    if (i % 400 === 0)
      await new Promise((resolve) => setImmediate(resolve));
    const line = lines[i];
    if (!line.trim())
      continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type === "session" && typeof entry.id === "string") {
      sessionId = entry.id;
      continue;
    }
    if (entry.type !== "message")
      continue;
    const msg = entry.message;
    if (msg?.role === "toolResult" && typeof msg.toolName === "string") {
      const ts2 = timestampForMessage(entry, msg);
      tools.push({
        sessionId: "",
        name: msg.toolName,
        resultTokens: estimateTextTokens(toolResultText(msg.content)),
        ts: ts2
      });
      continue;
    }
    if (!msg || msg.role !== "assistant" || !msg.usage || !msg.provider || !msg.model)
      continue;
    const input = numeric(msg.usage.input);
    const output = numeric(msg.usage.output);
    const cacheRead = numeric(msg.usage.cacheRead);
    const cacheWrite = numeric(msg.usage.cacheWrite);
    const cost = numeric(msg.usage.cost?.total);
    const ts = timestampForMessage(entry, msg);
    const fp = turnFingerprint({ input, output, cacheRead, cacheWrite, ts });
    if (seen.has(fp))
      continue;
    seen.add(fp);
    turns.push({
      sessionId: "",
      provider: String(msg.provider),
      model: String(msg.model),
      cost,
      input,
      output,
      cacheRead,
      cacheWrite,
      ts
    });
  }
  if (!sessionId)
    return null;
  for (const turn of turns)
    turn.sessionId = sessionId;
  for (const tool of tools)
    tool.sessionId = sessionId;
  return { sessionId, turns, tools };
}
function numeric(value) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}
function timestampForMessage(entry, msg) {
  const tsCandidate = typeof msg?.timestamp === "number" ? msg.timestamp : entry.timestamp ? Date.parse(entry.timestamp) : 0;
  return Number.isFinite(tsCandidate) ? Number(tsCandidate) : 0;
}
function toolResultText(content) {
  if (typeof content === "string")
    return content;
  if (!Array.isArray(content))
    return "";
  return content.map((part) => {
    if (typeof part === "string")
      return part;
    if (part && typeof part === "object" && "text" in part)
      return String(part.text ?? "");
    return "";
  }).join(`
`);
}
function estimateTextTokens(text) {
  if (!text)
    return 0;
  return Math.ceil(text.length / 4);
}
function groupForTool(name, registry) {
  if (BUILT_IN_TOOLS.has(name))
    return "Built-in";
  const registeredGroup = registry.get(name);
  if (registeredGroup)
    return registeredGroup;
  return "Other";
}
function titleCaseWords(value) {
  return value.split(/[\s_-]+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}
function emptyTokens() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}
function emptyAggregate() {
  return { cost: 0, calls: 0, tokens: emptyTokens(), sessions: new Set };
}
function emptyProvider() {
  return { ...emptyAggregate(), models: new Map };
}
function emptyToolBucket() {
  return { calls: 0, resultTokens: 0, sessions: new Set };
}
function emptyToolGroup() {
  return { ...emptyToolBucket(), tools: new Map };
}
function emptyPeriod() {
  return {
    providers: new Map,
    toolGroups: new Map,
    totals: emptyAggregate(),
    turns: [],
    insights: []
  };
}
function applyTurn(target, sessionId, turn) {
  target.calls += 1;
  target.cost += turn.cost;
  target.tokens.input += turn.input;
  target.tokens.output += turn.output;
  target.tokens.cacheRead += turn.cacheRead;
  target.tokens.cacheWrite += turn.cacheWrite;
  target.sessions.add(sessionId);
}
function applyTool(target, sessionId, tool) {
  target.calls += 1;
  target.resultTokens += tool.resultTokens;
  target.sessions.add(sessionId);
}
function periodsFor(ts, b) {
  const periods = ["all"];
  if (ts >= b.dayStart)
    periods.push("day");
  if (ts >= b.weekStart)
    periods.push("week");
  if (ts >= b.monthStart)
    periods.push("month");
  return periods;
}
function computeBoundaries(now = new Date) {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  const week = new Date(now);
  const dow = week.getDay();
  const offsetToMonday = dow === 0 ? 6 : dow - 1;
  week.setDate(week.getDate() - offsetToMonday);
  week.setHours(0, 0, 0, 0);
  const month = new Date(now);
  month.setDate(1);
  month.setHours(0, 0, 0, 0);
  return {
    dayStart: day.getTime(),
    weekStart: week.getTime(),
    monthStart: month.getTime()
  };
}
function dayKey(ts) {
  const d = new Date(ts);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}
function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function placeDay(report, turn) {
  if (turn.ts <= 0)
    return;
  const key = dayKey(turn.ts);
  const bucket = report.days.get(key) ?? { tokens: 0, cost: 0, calls: 0 };
  bucket.tokens += turn.input + turn.output + turn.cacheWrite;
  bucket.cost += turn.cost;
  bucket.calls += 1;
  report.days.set(key, bucket);
}
function placeTurn(report, turn, boundaries) {
  placeDay(report, turn);
  const span = report.lifespans.get(turn.sessionId);
  if (turn.ts > 0) {
    if (!span) {
      report.lifespans.set(turn.sessionId, { first: turn.ts, last: turn.ts });
    } else {
      if (turn.ts < span.first)
        span.first = turn.ts;
      if (turn.ts > span.last)
        span.last = turn.ts;
    }
  }
  for (const period of periodsFor(turn.ts, boundaries)) {
    const slice = report[period];
    slice.turns.push(turn);
    const provider = slice.providers.get(turn.provider) ?? emptyProvider();
    applyTurn(provider, turn.sessionId, turn);
    const model = provider.models.get(turn.model) ?? emptyAggregate();
    applyTurn(model, turn.sessionId, turn);
    provider.models.set(turn.model, model);
    slice.providers.set(turn.provider, provider);
    applyTurn(slice.totals, turn.sessionId, turn);
  }
}
function placeTool(report, tool, boundaries, toolRegistry) {
  for (const period of periodsFor(tool.ts, boundaries)) {
    const slice = report[period];
    const groupName = groupForTool(tool.name, toolRegistry);
    const group = slice.toolGroups.get(groupName) ?? emptyToolGroup();
    applyTool(group, tool.sessionId, tool);
    const toolBucket = group.tools.get(tool.name) ?? emptyToolBucket();
    applyTool(toolBucket, tool.sessionId, tool);
    group.tools.set(tool.name, toolBucket);
    slice.toolGroups.set(groupName, group);
  }
}
async function buildReport(signal) {
  const boundaries = computeBoundaries();
  const toolRegistry = await buildToolRegistry(signal);
  if (signal?.aborted)
    return null;
  const report = {
    day: emptyPeriod(),
    week: emptyPeriod(),
    month: emptyPeriod(),
    all: emptyPeriod(),
    lifespans: new Map,
    days: new Map
  };
  const roots = sessionRoots();
  const files = (await Promise.all(roots.map((root) => listSessionFiles(root, signal)))).flat();
  if (signal?.aborted)
    return null;
  const seen = new Set;
  for (const file of files) {
    if (signal?.aborted)
      return null;
    const session = await parseSessionFile(file, seen, signal);
    if (!session)
      continue;
    for (const turn of session.turns)
      placeTurn(report, turn, boundaries);
    for (const tool of session.tools)
      placeTool(report, tool, boundaries, toolRegistry);
    await new Promise((resolve) => setImmediate(resolve));
  }
  const longSessions = new Set;
  for (const [sessionId, span] of report.lifespans) {
    if (span.last - span.first >= LONG_SESSION_MS)
      longSessions.add(sessionId);
  }
  for (const period of PERIOD_ORDER) {
    report[period].insights = computeInsights(report[period], longSessions);
  }
  return report;
}
function computeInsights(slice, longSessions) {
  if (slice.turns.length === 0)
    return [];
  const total = slice.turns.reduce((acc, t) => acc + t.cost, 0);
  if (total <= 0)
    return [];
  const insights = [];
  const parallelCost = parallelCostShare(slice.turns);
  if (parallelCost !== null) {
    insights.push({
      weight: percent(parallelCost, total),
      headline: `Cost spent while ${PARALLEL_THRESHOLD}+ sessions overlapped`,
      hint: "Concurrent sessions all share one rate-limit bucket. Queueing them sequentially evens out throughput."
    });
  }
  const heavyContextCost = sumWhere(slice.turns, (t) => t.input + t.cacheRead + t.cacheWrite > HEAVY_CONTEXT);
  if (heavyContextCost > 0) {
    insights.push({
      weight: percent(heavyContextCost, total),
      headline: `Cost driven by turns over ${humanThreshold(HEAVY_CONTEXT)} of context`,
      hint: "Long-lived contexts stay expensive even when cached. /compact mid-task and /clear between tasks."
    });
  }
  const uncachedCost = sumWhere(slice.turns, (t) => t.input + t.cacheWrite > HEAVY_UNCACHED);
  if (uncachedCost > 0) {
    insights.push({
      weight: percent(uncachedCost, total),
      headline: `Cost from large uncached prompts (>${humanThreshold(HEAVY_UNCACHED)} fresh tokens)`,
      hint: "Fresh prompt tokens skip the cache. Run /compact before stepping away to keep cold starts cheap."
    });
  }
  const longCost = sumWhere(slice.turns, (t) => longSessions.has(t.sessionId));
  if (longCost > 0) {
    insights.push({
      weight: percent(longCost, total),
      headline: `Cost from sessions running ${LONG_SESSION_MS / 3600000}h+`,
      hint: "Often loops or background agents. Confirm the long-running session is doing intentional work."
    });
  }
  const sessionCosts = bySession(slice.turns);
  if (sessionCosts.size > TOP_SESSIONS_PROBE) {
    const sorted = Array.from(sessionCosts.values()).sort((a, b) => b - a);
    const head = sorted.slice(0, TOP_SESSIONS_PROBE).reduce((acc, c) => acc + c, 0);
    insights.push({
      weight: percent(head, total),
      headline: `Cost concentrated in your top ${TOP_SESSIONS_PROBE} sessions`,
      hint: "A handful of sessions usually accounts for most spend. Use the Providers tab to drill in."
    });
  }
  return insights.filter((row) => row.weight >= MIN_INSIGHT_PERCENT).sort((a, b) => b.weight - a.weight);
}
function bySession(turns) {
  const out = new Map;
  for (const t of turns)
    out.set(t.sessionId, (out.get(t.sessionId) ?? 0) + t.cost);
  return out;
}
function sumWhere(turns, predicate) {
  let sum = 0;
  for (const t of turns)
    if (predicate(t))
      sum += t.cost;
  return sum;
}
function percent(part, whole) {
  return whole > 0 ? part / whole * 100 : 0;
}
function parallelCostShare(turns) {
  const timed = turns.filter((t) => t.ts > 0);
  if (timed.length < MIN_TURNS_FOR_PARALLEL)
    return null;
  const sessions = new Set(timed.map((t) => t.sessionId));
  if (sessions.size < PARALLEL_THRESHOLD)
    return null;
  const sorted = timed.slice().sort((a, b) => a.ts - b.ts);
  const counts = new Map;
  let unique = 0;
  let head = 0;
  let tail = 0;
  let cost = 0;
  for (let i = 0;i < sorted.length; i++) {
    const probe = sorted[i];
    const upper = probe.ts + PARALLEL_RADIUS_MS;
    const lower = probe.ts - PARALLEL_RADIUS_MS;
    while (head < sorted.length && sorted[head].ts <= upper) {
      const sid = sorted[head].sessionId;
      const next = (counts.get(sid) ?? 0) + 1;
      counts.set(sid, next);
      if (next === 1)
        unique++;
      head++;
    }
    while (tail < head && sorted[tail].ts < lower) {
      const sid = sorted[tail].sessionId;
      const remaining = (counts.get(sid) ?? 0) - 1;
      if (remaining === 0) {
        counts.delete(sid);
        unique--;
      } else {
        counts.set(sid, remaining);
      }
      tail++;
    }
    if (unique >= PARALLEL_THRESHOLD)
      cost += probe.cost;
  }
  return cost;
}
function chargedTokens(slice) {
  return slice.totals.tokens.input + slice.totals.tokens.output + slice.totals.tokens.cacheWrite;
}
function impactFor(slice) {
  const tokens = chargedTokens(slice);
  if (tokens <= 0)
    return null;
  try {
    return estimate({ tokens, maxEquivalents: 4 });
  } catch {
    return null;
  }
}
var CUBE_VALUES = [0, 95, 135, 175, 215, 255];
function parseAnsiRgb(ansi) {
  const truecolor = ansi.match(/\x1b\[[34]8;2;(\d+);(\d+);(\d+)m/);
  if (truecolor) {
    return { r: Number(truecolor[1]), g: Number(truecolor[2]), b: Number(truecolor[3]) };
  }
  const indexed = ansi.match(/\x1b\[[34]8;5;(\d+)m/);
  if (!indexed)
    return null;
  const index = Number(indexed[1]);
  if (index >= 232 && index <= 255) {
    const gray = 8 + (index - 232) * 10;
    return { r: gray, g: gray, b: gray };
  }
  if (index >= 16 && index <= 231) {
    const offset = index - 16;
    return {
      r: CUBE_VALUES[Math.floor(offset / 36)],
      g: CUBE_VALUES[Math.floor(offset % 36 / 6)],
      b: CUBE_VALUES[offset % 6]
    };
  }
  return null;
}
function relativeLuminance({ r, g, b }) {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}
function mix(from, to, t) {
  return {
    r: Math.round(from.r + (to.r - from.r) * t),
    g: Math.round(from.g + (to.g - from.g) * t),
    b: Math.round(from.b + (to.b - from.b) * t)
  };
}
function rgbToAnsi({ r, g, b }, mode) {
  if (mode === "truecolor")
    return `\x1B[38;2;${r};${g};${b}m`;
  const idx = (v) => {
    let best = 0;
    for (let i = 1;i < CUBE_VALUES.length; i++) {
      if (Math.abs(v - CUBE_VALUES[i]) < Math.abs(v - CUBE_VALUES[best]))
        best = i;
    }
    return best;
  };
  return `\x1B[38;5;${16 + 36 * idx(r) + 6 * idx(g) + idx(b)}m`;
}
var HEAT_MIN_LUMA_SPAN = 0.62;
var HEAT_COLD_MIX = 0.06;
var HEAT_RAMP_START = 0.16;
function buildHeatRamp(theme) {
  const densityFallback = {
    paint: (level, glyph) => theme.fg(level === 0 ? "border" : "accent", glyph),
    glyph: (level) => HEAT_DENSITY_GLYPHS[Math.min(level, HEAT_LEVELS - 1)]
  };
  const accent = parseAnsiRgb(theme.getFgAnsi("accent"));
  if (!accent)
    return densityFallback;
  const background = parseAnsiRgb(theme.getBgAnsi("selectedBg")) ?? parseAnsiRgb(theme.getFgAnsi("border")) ?? { r: 0, g: 0, b: 0 };
  const bgLuma = relativeLuminance(background);
  const away = bgLuma > 0.5 ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 };
  let hot = accent;
  if (Math.abs(relativeLuminance(accent) - bgLuma) < HEAT_MIN_LUMA_SPAN) {
    for (let push = 0.05;push <= 0.95; push += 0.05) {
      hot = mix(accent, away, push);
      if (Math.abs(relativeLuminance(hot) - bgLuma) >= HEAT_MIN_LUMA_SPAN)
        break;
    }
  }
  const cold = mix(background, hot, HEAT_COLD_MIX);
  const mode = theme.getColorMode();
  const ansi = [];
  for (let level = 0;level < HEAT_LEVELS; level++) {
    const t = level === 0 ? 0 : HEAT_RAMP_START + (1 - HEAT_RAMP_START) * ((level - 1) / (HEAT_TIERS - 1));
    ansi.push(rgbToAnsi(mix(cold, hot, t), mode));
  }
  if (new Set(ansi).size !== ansi.length)
    return densityFallback;
  return {
    paint: (level, glyph) => `${ansi[Math.min(level, HEAT_LEVELS - 1)]}${glyph}\x1B[39m`,
    glyph: () => HEAT_CELL
  };
}
function metricValue(bucket, metric) {
  return metric === "tokens" ? bucket.tokens : bucket.cost;
}
function buildHeatGrid(days, weeks, metric, now = new Date) {
  const today = startOfDay(now.getTime());
  const dow = new Date(today).getDay();
  const offsetToMonday = dow === 0 ? 6 : dow - 1;
  const lastMonday = today - offsetToMonday * DAY_MS;
  const firstMonday = lastMonday - (weeks - 1) * 7 * DAY_MS;
  const grid = [];
  const active = [];
  let max = 0;
  for (let w = 0;w < weeks; w++) {
    const column = [];
    for (let row = 0;row < HEAT_ROWS; row++) {
      const ts = firstMonday + (w * 7 + row) * DAY_MS;
      const key = dayKey(ts);
      const bucket = days.get(key);
      const value = bucket ? metricValue(bucket, metric) : 0;
      if (value > max)
        max = value;
      if (value > 0 && ts <= today)
        active.push(value);
      column.push({ ts, value, future: ts > today });
    }
    grid.push(column);
  }
  return { weeks: grid, max, thresholds: quantileThresholds(active) };
}
function quantileThresholds(values) {
  const tiers = HEAT_TIERS;
  if (values.length === 0)
    return [];
  const sorted = values.slice().sort((a, b) => a - b);
  const cuts = [];
  for (let i = 1;i < tiers; i++) {
    const index = Math.floor(sorted.length * i / tiers);
    cuts.push(sorted[Math.min(index, sorted.length - 1)]);
  }
  return cuts;
}
function heatLevel(value, thresholds) {
  if (value <= 0)
    return 0;
  let level = 1;
  for (const cut of thresholds) {
    if (value >= cut)
      level++;
  }
  return Math.min(HEAT_LEVELS - 1, level);
}
function computeActivityStats(days, metric, now = new Date) {
  let total = 0;
  let peak = null;
  for (const [key, bucket] of days) {
    const value = metricValue(bucket, metric);
    total += value;
    if (value > 0 && (!peak || value > peak.value))
      peak = { key, value };
  }
  const active = new Set([...days.entries()].filter(([, b]) => metricValue(b, metric) > 0).map(([key]) => key));
  const today = startOfDay(now.getTime());
  let currentStreak = 0;
  let cursor = active.has(dayKey(today)) ? today : today - DAY_MS;
  while (active.has(dayKey(cursor))) {
    currentStreak++;
    cursor -= DAY_MS;
  }
  let longestStreak = 0;
  let run = 0;
  const sorted = [...active].sort();
  let previous = 0;
  for (const key of sorted) {
    const ts = startOfDay(Date.parse(`${key}T00:00:00`));
    run = previous > 0 && ts - previous === DAY_MS ? run + 1 : 1;
    if (run > longestStreak)
      longestStreak = run;
    previous = ts;
  }
  return { total, peak, currentStreak, longestStreak };
}
function formatTokens(n) {
  if (n <= 0)
    return "—";
  if (n < 1000)
    return String(n);
  if (n < 1e4)
    return `${(n / 1000).toFixed(1)}k`;
  if (n < 1e6)
    return `${Math.round(n / 1000)}k`;
  if (n < 1e7)
    return `${(n / 1e6).toFixed(1)}M`;
  return `${Math.round(n / 1e6)}M`;
}
function formatCost(value) {
  if (value <= 0)
    return "—";
  if (value < 0.01)
    return `$${value.toFixed(4)}`;
  if (value < 1)
    return `$${value.toFixed(2)}`;
  if (value < 100)
    return `$${value.toFixed(2)}`;
  return `$${Math.round(value)}`;
}
function formatCount(n) {
  if (n <= 0)
    return "—";
  return n.toLocaleString();
}
function formatPercent(p) {
  if (p >= 10)
    return `${Math.round(p)}%`;
  return `${(Math.round(p * 10) / 10).toFixed(1)}%`;
}
function formatDate(date) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}
function dateRangeForPeriod(period, report, now = new Date) {
  const boundaries = computeBoundaries(now);
  switch (period) {
    case "day":
      return [new Date(boundaries.dayStart), now];
    case "week":
      return [new Date(boundaries.weekStart), now];
    case "month":
      return [new Date(boundaries.monthStart), now];
    case "all": {
      let first = Number.POSITIVE_INFINITY;
      let last = 0;
      for (const span of report.lifespans.values()) {
        if (span.first > 0 && span.first < first)
          first = span.first;
        if (span.last > last)
          last = span.last;
      }
      return Number.isFinite(first) ? [new Date(first), new Date(last)] : [now, now];
    }
  }
}
function humanThreshold(n) {
  if (n >= 1e6)
    return `${n / 1e6}M`;
  if (n >= 1000)
    return `${n / 1000}k`;
  return String(n);
}
function padTo(text, width, side = "right") {
  if (width <= 0)
    return "";
  const truncated = truncateToWidth(text, width);
  const visible = visibleWidth(truncated);
  if (visible >= width)
    return truncated;
  const pad = " ".repeat(width - visible);
  return side === "left" ? pad + truncated : truncated + pad;
}
function clipLines(lines, width) {
  return lines.map((line) => truncateToWidth(line, Math.max(width, 0)));
}
function pickFitting(width, options) {
  for (const option of options) {
    if (visibleWidth(option) <= width)
      return option;
  }
  return options[options.length - 1] ?? "";
}
function randomItem(items) {
  if (items.length === 0)
    return;
  return items[Math.floor(Math.random() * items.length)];
}
var COL_SESSIONS = {
  label: "Sess",
  width: 7,
  value: (r) => formatCount(r.sessions.size)
};
var COL_CALLS = { label: "Calls", width: 8, value: (r) => formatCount(r.calls) };
var COL_COST = { label: "Cost", width: 9, value: (r) => formatCost(r.cost) };
var COL_TOKENS = {
  label: "Tokens",
  width: 9,
  value: (r) => formatTokens(r.tokens.input + r.tokens.output + r.tokens.cacheWrite)
};
var COL_INPUT = {
  label: "↑ In",
  width: 8,
  dim: true,
  value: (r) => formatTokens(r.tokens.input + r.tokens.cacheWrite)
};
var COL_OUTPUT = {
  label: "↓ Out",
  width: 8,
  dim: true,
  value: (r) => formatTokens(r.tokens.output)
};
var COL_CACHE = {
  label: "Cache",
  width: 8,
  dim: true,
  value: (r) => formatTokens(r.tokens.cacheRead + r.tokens.cacheWrite)
};
var LAYOUTS = [
  {
    columns: [COL_SESSIONS, COL_CALLS, COL_COST, COL_TOKENS, COL_INPUT, COL_OUTPUT, COL_CACHE],
    minName: NAME_COL_MIN_FULL
  },
  { columns: [COL_SESSIONS, COL_CALLS, COL_COST, COL_TOKENS], minName: 14, compact: true },
  { columns: [COL_SESSIONS, COL_COST, COL_TOKENS], minName: 12, compact: true },
  { columns: [COL_COST, COL_TOKENS], minName: 10, compact: true },
  { columns: [COL_COST], minName: 8, compact: true }
];
function toolColumns() {
  return [
    { label: "Calls", width: 8, value: (r) => formatCount(r.calls) },
    { label: "Result", width: 9, value: (r) => formatTokens(r.resultTokens) },
    { label: "Sess", width: 7, value: (r) => formatCount(r.sessions.size) }
  ];
}
function pickLayout(width) {
  const safe = Math.max(width, 0);
  const choose = (candidate) => {
    const colSum = candidate.columns.reduce((acc, c) => acc + c.width, 0);
    const nameWidth = Math.min(NAME_COL_MAX, Math.max(safe - colSum, 0));
    return {
      columns: candidate.columns,
      nameWidth,
      totalWidth: nameWidth + colSum,
      compact: candidate.compact ?? false
    };
  };
  for (const candidate of LAYOUTS) {
    const layout = choose(candidate);
    if (layout.nameWidth >= candidate.minName)
      return layout;
  }
  return choose(LAYOUTS[LAYOUTS.length - 1]);
}

class UsagePanel {
  theme;
  report;
  requestRender;
  close;
  period = "all";
  view = "summary";
  metric = "tokens";
  cursor = 0;
  expanded = new Set;
  providerOrder = [];
  toolGroupOrder = [];
  impactCache = new Map;
  ramp = null;
  constructor(theme, report, requestRender, close) {
    this.theme = theme;
    this.report = report;
    this.requestRender = requestRender;
    this.close = close;
    this.refreshProviderOrder();
    this.refreshToolGroupOrder();
  }
  handleInput(input) {
    if (matchesKey(input, "escape") || matchesKey(input, "q")) {
      this.close();
      return;
    }
    if (matchesKey(input, "tab") || matchesKey(input, "right")) {
      this.shiftPeriod(1);
      return;
    }
    if (matchesKey(input, "shift+tab") || matchesKey(input, "left")) {
      this.shiftPeriod(-1);
      return;
    }
    if (matchesKey(input, "v")) {
      this.shiftView(1);
      return;
    }
    if (input === "1")
      return this.gotoView("summary");
    if (input === "2")
      return this.gotoView("providers");
    if (input === "3")
      return this.gotoView("patterns");
    if (input === "4")
      return this.gotoView("tools");
    if (input === "5")
      return this.gotoView("activity");
    if (this.view === "activity" && matchesKey(input, "m")) {
      this.metric = this.metric === "tokens" ? "cost" : "tokens";
      this.requestRender();
      return;
    }
    if (this.view !== "providers" && this.view !== "tools")
      return;
    const order = this.view === "providers" ? this.providerOrder : this.toolGroupOrder;
    if (matchesKey(input, "up") && this.cursor > 0) {
      this.cursor--;
      this.requestRender();
    } else if (matchesKey(input, "down") && this.cursor < order.length - 1) {
      this.cursor++;
      this.requestRender();
    } else if (matchesKey(input, "enter") || matchesKey(input, "space")) {
      const expandable = order[this.cursor];
      if (expandable) {
        if (this.expanded.has(expandable))
          this.expanded.delete(expandable);
        else
          this.expanded.add(expandable);
        this.requestRender();
      }
    }
  }
  render(width) {
    const head = this.renderHeader(width);
    switch (this.view) {
      case "summary":
        return clipLines([...head, ...this.renderSummary(width)], width);
      case "providers": {
        const layout = pickLayout(width);
        return clipLines([...head, ...this.renderProviders(layout)], width);
      }
      case "patterns":
        return clipLines([...head, ...this.renderPatterns(width)], width);
      case "tools": {
        const layout = pickLayout(width);
        return clipLines([...head, ...this.renderTools(layout)], width);
      }
      case "activity":
        return clipLines([...head, ...this.renderActivity(width)], width);
    }
  }
  invalidate() {}
  dispose() {}
  refreshProviderOrder() {
    const slice = this.report[this.period];
    this.providerOrder = Array.from(slice.providers.entries()).sort((a, b) => b[1].cost - a[1].cost).map(([name]) => name);
    this.cursor = Math.min(this.cursor, Math.max(0, this.providerOrder.length - 1));
  }
  refreshToolGroupOrder() {
    const slice = this.report[this.period];
    this.toolGroupOrder = Array.from(slice.toolGroups.entries()).sort((a, b) => b[1].calls - a[1].calls || b[1].resultTokens - a[1].resultTokens).map(([name]) => name);
    this.cursor = Math.min(this.cursor, Math.max(0, this.toolGroupOrder.length - 1));
  }
  shiftPeriod(direction) {
    const idx = PERIOD_ORDER.indexOf(this.period);
    const next = (idx + direction + PERIOD_ORDER.length) % PERIOD_ORDER.length;
    this.period = PERIOD_ORDER[next];
    this.refreshProviderOrder();
    this.refreshToolGroupOrder();
    this.requestRender();
  }
  shiftView(direction) {
    const idx = VIEW_ORDER.indexOf(this.view);
    const next = (idx + direction + VIEW_ORDER.length) % VIEW_ORDER.length;
    this.view = VIEW_ORDER[next];
    this.cursor = 0;
    this.requestRender();
  }
  gotoView(view) {
    if (this.view === view)
      return;
    this.view = view;
    this.cursor = 0;
    this.requestRender();
  }
  getRamp() {
    if (!this.ramp)
      this.ramp = buildHeatRamp(this.theme);
    return this.ramp;
  }
  getImpact() {
    if (!this.impactCache.has(this.period)) {
      this.impactCache.set(this.period, impactFor(this.report[this.period]));
    }
    return this.impactCache.get(this.period) ?? null;
  }
  renderHeader(width) {
    const th = this.theme;
    const title = th.fg("accent", th.bold("Pi Usage"));
    const tabs = this.renderViewTabs();
    if (this.view === "activity")
      return [title, "", tabs, ""];
    const periods = this.renderPeriodTabs(width);
    const dateRange = th.fg("dim", this.renderPeriodDateRange());
    return [title, "", periods, tabs, dateRange, ""];
  }
  renderViewTabs() {
    const th = this.theme;
    return VIEW_ORDER.map((view) => {
      const label = `${VIEW_ORDER.indexOf(view) + 1}. ${VIEW_LABELS[view]}`;
      return view === this.view ? th.fg("accent", `[${label}]`) : th.fg("dim", ` ${label} `);
    }).join("  ");
  }
  renderPeriodTabs(width) {
    const th = this.theme;
    const full = PERIOD_ORDER.map((period) => {
      const label = PERIOD_LABELS[period];
      return period === this.period ? th.fg("accent", `‹${label}›`) : th.fg("dim", ` ${label} `);
    }).join("  ");
    const fallback = th.fg("accent", `‹${PERIOD_LABELS[this.period]}›`);
    return pickFitting(width, [full, `${fallback}  ${th.fg("dim", "[Tab/←→]")}`, fallback]);
  }
  renderPeriodDateRange() {
    const [from, to] = dateRangeForPeriod(this.period, this.report);
    return `From ${formatDate(from)} to ${formatDate(to)}`;
  }
  renderSummary(width) {
    const th = this.theme;
    const slice = this.report[this.period];
    const lines = [];
    if (slice.totals.calls === 0) {
      lines.push(th.fg("dim", "  No assistant turns recorded for this period."));
      lines.push("");
      lines.push(...this.renderHelp(width));
      return lines;
    }
    lines.push(th.bold("Totals"));
    lines.push("");
    lines.push(...this.renderTotalsBlock(slice));
    lines.push("");
    if (this.providerOrder.length > 0) {
      lines.push(th.bold("Top providers"));
      lines.push("");
      lines.push(...this.renderTopProviders(slice, width));
      lines.push("");
    }
    lines.push(th.bold("Sustainability"));
    lines.push(th.fg("dim", "AI estimates are approximate inference ranges using impact-equivalences."));
    lines.push("");
    lines.push(...this.renderImpactBlock(width));
    lines.push("");
    lines.push(...this.renderHelp(width));
    return lines;
  }
  renderTotalsBlock(slice) {
    const th = this.theme;
    const tokens = chargedTokens(slice);
    const fields = [
      ["Sessions", formatCount(slice.totals.sessions.size)],
      ["Calls", formatCount(slice.totals.calls)],
      ["Spend", formatCost(slice.totals.cost)],
      ["Tokens", formatTokens(tokens)],
      ["Cache hit", formatTokens(slice.totals.tokens.cacheRead)]
    ];
    return fields.map(([label, value]) => `  ${th.fg("dim", padTo(label, 10, "right"))}  ${th.bold(value)}`);
  }
  renderTopProviders(slice, width) {
    const th = this.theme;
    const top = this.providerOrder.slice(0, SUMMARY_TOP_PROVIDERS);
    const total = slice.totals.cost > 0 ? slice.totals.cost : 1;
    const labelWidth = Math.min(18, Math.max(...top.map((name) => Math.min(visibleWidth(name), 18))));
    const lines = [];
    for (const name of top) {
      const provider = slice.providers.get(name);
      if (!provider)
        continue;
      const ratio = Math.min(1, Math.max(0, provider.cost / total));
      const filled = Math.round(BAR_WIDTH * ratio);
      const bar = `${BAR_FILLED.repeat(filled)}${BAR_EMPTY.repeat(BAR_WIDTH - filled)}`;
      const cost = formatCost(provider.cost);
      const tokens = formatTokens(provider.tokens.input + provider.tokens.output + provider.tokens.cacheWrite);
      const lhs = `  ${padTo(name, labelWidth)}`;
      const rhs = `${th.fg("accent", bar)}  ${formatPercent(ratio * 100)} · ${cost} · ${tokens} tokens`;
      lines.push(truncateToWidth(`${lhs}  ${rhs}`, Math.max(width, 0)));
    }
    return lines;
  }
  renderImpactBlock(width) {
    const th = this.theme;
    const impact = this.getImpact();
    if (!impact) {
      return [th.fg("dim", "  Not enough token data to estimate environmental impact.")];
    }
    const indent = "  ";
    const electricity = impact.electricity.kwh;
    const carbon = impact.carbon.kgCO2e;
    const lines = [];
    const profileNote = `${impact.profile.label} · ${impact.region.label}`;
    lines.push(`${indent}${th.fg("dim", profileNote)}`);
    lines.push(`${indent}${th.fg("dim", padTo("Electricity", 12, "right"))}  ${th.bold(formatRange(electricity.min, electricity.typical, electricity.max, "kWh"))}`);
    lines.push(`${indent}${th.fg("dim", padTo("Carbon", 12, "right"))}  ${th.bold(formatRange(carbon.min, carbon.typical, carbon.max, "kg CO₂e"))}`);
    const equivalent = randomItem(impact.equivalents);
    if (equivalent) {
      lines.push("");
      const wrapped = wrapTextWithAnsi(th.fg("dim", `Roughly equivalent to ${equivalent}`), Math.max(20, width - indent.length));
      for (const part of wrapped)
        lines.push(`${indent}${part}`);
    }
    return lines;
  }
  renderProviders(layout) {
    const lines = [];
    lines.push(...this.renderTableHeader(layout));
    const slice = this.report[this.period];
    if (this.providerOrder.length === 0) {
      lines.push(this.theme.fg("dim", "  No usage data for this period"));
    } else {
      for (let i = 0;i < this.providerOrder.length; i++) {
        const name = this.providerOrder[i];
        const provider = slice.providers.get(name);
        const isSelected = i === this.cursor;
        const isExpanded = this.expanded.has(name);
        lines.push(this.renderProviderRow(name, provider, layout, isSelected, isExpanded));
        if (isExpanded) {
          const models = Array.from(provider.models.entries()).sort((a, b) => b[1].cost - a[1].cost);
          for (const [modelName, modelStats] of models) {
            lines.push(this.renderModelRow(modelName, modelStats, layout));
          }
        }
      }
    }
    lines.push(...this.renderTableFooter(slice, layout));
    lines.push(...this.renderHelp(layout.totalWidth));
    return lines;
  }
  renderTableHeader(layout) {
    const th = this.theme;
    let header = padTo("Provider / Model", layout.nameWidth);
    for (const col of layout.columns) {
      const cell = padTo(col.label, col.width, "left");
      header += col.dim ? th.fg("dim", cell) : cell;
    }
    return [
      th.fg("muted", header),
      th.fg("border", "─".repeat(layout.totalWidth))
    ];
  }
  renderProviderRow(name, stats, layout, selected, expanded) {
    const th = this.theme;
    const arrow = expanded ? "▾" : "▸";
    const prefix = selected ? th.fg("accent", `${arrow} `) : th.fg("dim", `${arrow} `);
    const innerWidth = Math.max(layout.nameWidth - 2, 0);
    const display = innerWidth > 0 ? truncateToWidth(name, innerWidth) : "";
    const styled = selected ? th.fg("accent", display) : display;
    let row = prefix + padTo(styled, innerWidth);
    for (const col of layout.columns) {
      const cell = padTo(col.value(stats), col.width, "left");
      row += col.dim ? th.fg("dim", cell) : cell;
    }
    return row;
  }
  renderModelRow(name, stats, layout) {
    const th = this.theme;
    const indent = "    ";
    const innerWidth = Math.max(layout.nameWidth - indent.length, 0);
    const display = innerWidth > 0 ? truncateToWidth(name, innerWidth) : "";
    let row = indent + padTo(th.fg("dim", display), innerWidth);
    for (const col of layout.columns) {
      row += th.fg("dim", padTo(col.value(stats), col.width, "left"));
    }
    return row;
  }
  renderTableFooter(slice, layout) {
    const th = this.theme;
    let row = padTo(th.bold("Total"), layout.nameWidth);
    for (const col of layout.columns) {
      const cell = padTo(col.value(slice.totals), col.width, "left");
      row += col.dim ? th.fg("dim", cell) : cell;
    }
    return [th.fg("border", "─".repeat(layout.totalWidth)), row, ""];
  }
  renderTools(layout) {
    const th = this.theme;
    const slice = this.report[this.period];
    const lines = [];
    const columns = toolColumns();
    const totalWidth = layout.nameWidth + columns.reduce((acc, col) => acc + col.width, 0);
    lines.push(th.bold("Extensions / tools"));
    lines.push(th.fg("dim", "Sorted by call count. Result tokens are estimated from tool output size."));
    lines.push("");
    lines.push(this.renderToolHeader(layout.nameWidth, columns));
    lines.push(th.fg("border", "─".repeat(totalWidth)));
    if (this.toolGroupOrder.length === 0) {
      lines.push(th.fg("dim", "  No tool usage recorded for this period."));
    } else {
      for (let i = 0;i < this.toolGroupOrder.length; i++) {
        const name = this.toolGroupOrder[i];
        const group = slice.toolGroups.get(name);
        const isSelected = i === this.cursor;
        const isExpanded = this.expanded.has(name);
        lines.push(this.renderToolGroupRow(name, group, layout.nameWidth, columns, isSelected, isExpanded));
        if (isExpanded) {
          const tools = Array.from(group.tools.entries()).sort((a, b) => b[1].calls - a[1].calls || b[1].resultTokens - a[1].resultTokens);
          for (const [toolName, stats] of tools) {
            lines.push(this.renderToolRow(toolName, stats, layout.nameWidth, columns));
          }
        }
      }
    }
    lines.push(th.fg("border", "─".repeat(totalWidth)));
    lines.push(this.renderToolTotalRow(slice, layout.nameWidth, columns));
    lines.push("");
    lines.push(...this.renderHelp(totalWidth));
    return lines;
  }
  renderToolHeader(nameWidth, columns) {
    const th = this.theme;
    let header = padTo("Extension / Tool", nameWidth);
    for (const col of columns)
      header += th.fg("dim", padTo(col.label, col.width, "left"));
    return th.fg("muted", header);
  }
  renderToolGroupRow(name, stats, nameWidth, columns, selected, expanded) {
    const th = this.theme;
    const arrow = expanded ? "▾" : "▸";
    const prefix = selected ? th.fg("accent", `${arrow} `) : th.fg("dim", `${arrow} `);
    const innerWidth = Math.max(nameWidth - 2, 0);
    const display = innerWidth > 0 ? truncateToWidth(name, innerWidth) : "";
    const styled = selected ? th.fg("accent", display) : display;
    return prefix + padTo(styled, innerWidth) + columns.map((col) => padTo(col.value(stats), col.width, "left")).join("");
  }
  renderToolRow(name, stats, nameWidth, columns) {
    const th = this.theme;
    const indent = "    ";
    const innerWidth = Math.max(nameWidth - indent.length, 0);
    const display = innerWidth > 0 ? truncateToWidth(name, innerWidth) : "";
    return indent + padTo(th.fg("dim", display), innerWidth) + columns.map((col) => th.fg("dim", padTo(col.value(stats), col.width, "left"))).join("");
  }
  renderToolTotalRow(slice, nameWidth, columns) {
    const total = emptyToolBucket();
    for (const group of slice.toolGroups.values()) {
      total.calls += group.calls;
      total.resultTokens += group.resultTokens;
      for (const sessionId of group.sessions)
        total.sessions.add(sessionId);
    }
    return padTo(this.theme.bold("Total"), nameWidth) + columns.map((col) => padTo(col.value(total), col.width, "left")).join("");
  }
  renderActivity(width) {
    const th = this.theme;
    const lines = [];
    const indent = "  ";
    const weeks = this.heatWeeksFor(width);
    if (weeks < HEAT_MIN_WEEKS) {
      lines.push(th.fg("dim", `${indent}Terminal too narrow for the activity heatmap.`));
      lines.push("");
      lines.push(...this.renderHelp(width));
      return lines;
    }
    const grid = buildHeatGrid(this.report.days, weeks, this.metric);
    const stats = computeActivityStats(this.report.days, this.metric);
    const metricLabel = this.metric === "tokens" ? "tokens" : "cost";
    lines.push(th.bold("Activity"));
    lines.push(th.fg("dim", `Daily ${metricLabel} over the last ${weeks} weeks. Press [m] to switch metric.`));
    lines.push("");
    lines.push(...this.renderHeatGrid(grid, indent));
    lines.push("");
    lines.push(...this.renderHeatLegend(indent));
    lines.push("");
    lines.push(...this.renderActivityStats(stats, width, indent));
    lines.push("");
    lines.push(...this.renderHelp(width));
    return lines;
  }
  heatWeeksFor(width) {
    const available = width - HEAT_ROW_LABEL_WIDTH - 2;
    const fits = Math.floor(available / HEAT_CELL_WIDTH);
    return Math.max(0, Math.min(HEAT_MAX_WEEKS, fits));
  }
  heatCell(cell, thresholds) {
    if (cell.future)
      return " ".repeat(HEAT_CELL_WIDTH);
    const level = heatLevel(cell.value, thresholds);
    const ramp = this.getRamp();
    return ramp.paint(level, ramp.glyph(level)) + HEAT_CELL_GAP;
  }
  renderHeatGrid(grid, indent) {
    const th = this.theme;
    const lines = [th.fg("dim", indent + this.renderMonthAxis(grid).trimEnd())];
    for (let row = 0;row < HEAT_ROWS; row++) {
      const label = th.fg("dim", padTo(HEAT_ROW_LABELS[row] ?? "", HEAT_ROW_LABEL_WIDTH));
      let line = indent + label;
      for (const column of grid.weeks)
        line += this.heatCell(column[row], grid.thresholds);
      lines.push(line);
    }
    return lines;
  }
  renderMonthAxis(grid) {
    const slots = new Array(HEAT_ROW_LABEL_WIDTH + grid.weeks.length * HEAT_CELL_WIDTH).fill(" ");
    let lastMonth = -1;
    let nextFree = HEAT_ROW_LABEL_WIDTH;
    grid.weeks.forEach((column, index) => {
      const month = new Date(column[0].ts).getMonth();
      if (month === lastMonth)
        return;
      lastMonth = month;
      const label = MONTH_LABELS[month];
      const start = HEAT_ROW_LABEL_WIDTH + index * HEAT_CELL_WIDTH;
      if (start < nextFree || start + label.length > slots.length)
        return;
      for (let i = 0;i < label.length; i++)
        slots[start + i] = label[i];
      nextFree = start + label.length + 1;
    });
    return slots.join("");
  }
  renderHeatLegend(indent) {
    const th = this.theme;
    const ramp = this.getRamp();
    let swatches = "";
    for (let level = 0;level < HEAT_LEVELS; level++) {
      swatches += ramp.paint(level, ramp.glyph(level)) + HEAT_CELL_GAP;
    }
    return [
      `${indent}${" ".repeat(HEAT_ROW_LABEL_WIDTH)}${th.fg("dim", "Less ")}${swatches}${th.fg("dim", "More")}`
    ];
  }
  renderActivityStats(stats, width, indent) {
    const th = this.theme;
    const format = this.metric === "tokens" ? formatTokens : formatCost;
    const metricWord = this.metric === "tokens" ? "tokens" : "spend";
    const cells = [
      [format(stats.total), `lifetime ${metricWord}`],
      [stats.peak ? format(stats.peak.value) : "—", "peak day"],
      [`${stats.currentStreak} ${stats.currentStreak === 1 ? "day" : "days"}`, "current streak"],
      [`${stats.longestStreak} ${stats.longestStreak === 1 ? "day" : "days"}`, "longest streak"]
    ];
    const cellWidth = Math.max(...cells.map(([v, l]) => Math.max(visibleWidth(v), visibleWidth(l)))) + 3;
    const inline = indent.length + cells.length * cellWidth <= width;
    if (!inline) {
      return cells.map(([value, label]) => `${indent}${th.bold(padTo(value, 12))}${th.fg("dim", label)}`);
    }
    const values = cells.map(([value]) => padTo(th.bold(value), cellWidth)).join("");
    const labels = cells.map(([, label]) => padTo(th.fg("dim", label), cellWidth)).join("");
    return [indent + values, indent + labels];
  }
  renderPatterns(width) {
    const th = this.theme;
    const slice = this.report[this.period];
    const lines = [];
    lines.push(th.bold("Where the spend goes"));
    lines.push(th.fg("dim", "Weighted by USD cost. Categories overlap and can total over 100%."));
    lines.push("");
    if (slice.totals.calls === 0) {
      lines.push(th.fg("dim", "  No usage recorded for this period."));
    } else if (slice.totals.cost <= 0) {
      lines.push(th.fg("dim", "  No cost figures recorded for this period."));
    } else if (slice.insights.length === 0) {
      lines.push(th.fg("dim", "  No notable patterns above 1%."));
    } else {
      const indent = "    ";
      const bodyWidth = Math.max(width - indent.length, 30);
      for (const row of slice.insights) {
        const pct = th.fg("accent", th.bold(formatPercent(row.weight)));
        lines.push(`  ${pct}  ${row.headline}`);
        for (const wrapped of wrapTextWithAnsi(row.hint, bodyWidth)) {
          lines.push(`${indent}${th.fg("dim", wrapped)}`);
        }
        lines.push("");
      }
    }
    lines.push(...this.renderHelp(width));
    return lines;
  }
  renderHelp(width) {
    const th = this.theme;
    const variants = this.view === "activity" ? [
      "[m] tokens/cost · [v/1-5] view · [q] close",
      "[m] metric · [v] view · [q]",
      "[m] · [v] · [q]"
    ] : this.view === "providers" || this.view === "tools" ? [
      "[Tab/←→] period · [↑↓] select · [Enter] expand · [v/1-5] view · [q] close",
      "[Tab] period · [↑↓] · [Enter] · [v] view · [q]",
      "[↑↓] · [Enter] · [q]"
    ] : [
      "[Tab/←→] period · [v/1-5] view · [q] close",
      "[Tab] period · [v] view · [q]",
      "[v] view · [q]"
    ];
    return [th.fg("dim", pickFitting(width, variants))];
  }
}
function formatRange(min, typical, max, unit) {
  const round = (n) => {
    if (n === 0)
      return "0";
    if (n < 0.001)
      return n.toExponential(1);
    if (n < 1)
      return n.toFixed(3);
    if (n < 100)
      return n.toFixed(2);
    return Math.round(n).toLocaleString();
  };
  if (min === max)
    return `${round(typical)} ${unit}`;
  return `${round(min)}–${round(max)} ${unit} (≈ ${round(typical)})`;
}
function mono_usage_default(pi) {
  pi.registerCommand("usage", {
    description: "Show token usage, spend and sustainability impact",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI)
        return;
      const report = await ctx.ui.custom((tui, theme, _kb, done) => {
        const loader = new CancellableLoader(tui, (s) => theme.fg("accent", s), (s) => theme.fg("muted", s), "Crunching session history…");
        let settled = false;
        const finish = (value) => {
          if (settled)
            return;
          settled = true;
          loader.dispose();
          done(value);
        };
        loader.onAbort = () => finish(null);
        buildReport(loader.signal).then(finish).catch(() => finish(null));
        return loader;
      });
      if (!report)
        return;
      await ctx.ui.custom((tui, theme, _kb, done) => {
        const container = new Container;
        container.addChild(new Spacer(1));
        container.addChild(new DynamicBorder((s) => theme.fg("border", s)));
        container.addChild(new Spacer(1));
        const panel = new UsagePanel(theme, report, () => tui.requestRender(), () => done());
        return {
          render: (w) => {
            const top = clipLines(container.render(w), w);
            const body = panel.render(w);
            const bottom = theme.fg("border", "─".repeat(w));
            return clipLines([...top, ...body, "", bottom], w);
          },
          invalidate: () => container.invalidate(),
          handleInput: (input) => panel.handleInput(input),
          dispose: () => {}
        };
      });
    }
  });
}
export {
  mono_usage_default as default
};
