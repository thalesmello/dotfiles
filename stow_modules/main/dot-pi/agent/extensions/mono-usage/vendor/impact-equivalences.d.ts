type Domain = "water" | "electricity" | "carbon" | "ai";
type Confidence = "low" | "medium" | "high";
type FactorType = "average" | "marginal" | "lifecycle" | "tailpipe" | "operational" | "arithmetic" | "illustrative";
type Boundary = {
    included: string[];
    excluded?: string[];
};
type Source = {
    id: string;
    name: string;
    url: string;
    accessedAt: string;
    publishedAt?: string;
    datasetYear?: string;
    geography?: string;
    boundary?: string;
    factorType?: FactorType;
};
type Measurement = {
    domain: Domain;
    value: number;
    unit: string;
};
type FormatContext = {
    ratio: number;
    valueInBaseUnit: number;
    equivalency: Equivalency;
    locale?: string;
};
type Equivalency = {
    id: string;
    domain: Exclude<Domain, "ai">;
    label: string;
    baseUnit: string;
    valueInBaseUnit: number;
    confidence: Confidence;
    source: Source;
    assumptions?: string[];
    boundary?: Boundary;
    methodology?: string;
    formatter?: (context: FormatContext) => string;
};
type EquivalencyResult = {
    id: string;
    domain: Exclude<Domain, "ai">;
    label: string;
    ratio: number;
    score: number;
    formatted: string;
    valueInBaseUnit: number;
    baseUnit: string;
    confidence: Confidence;
    source: Source;
    assumptions: string[];
    boundary?: Boundary;
    methodology?: string;
};
type CompareOptions = {
    maxResults?: number;
    datasets?: Equivalency[];
    minRatio?: number;
    maxRatio?: number;
    locale?: string;
};
type CompareResult = {
    input: Measurement;
    normalized: {
        value: number;
        unit: string;
    };
    equivalents: EquivalencyResult[];
    assumptions: string[];
    sources: Source[];
};
type AiEnergyProfile = {
    id: string;
    label: string;
    assumptions: {
        modelClass: string;
        reasoningLevel?: string;
        infrastructure?: string;
    };
    whPer1KTokens: {
        min: number;
        typical: number;
        max: number;
    };
    confidence: Confidence;
    source: Source;
    boundary?: Boundary;
};
type RegionalEmissionFactor = {
    id: string;
    label: string;
    kgCO2ePerKWh: number;
    source: Source;
    assumptions?: string[];
    boundary?: Boundary;
    confidence: Confidence;
};
type AiEstimateInput = {
    tokens?: number;
    sessions?: number;
    inferenceRequests?: number;
    averageTokensPerSession?: number;
    averageTokensPerRequest?: number;
    profile?: string | AiEnergyProfile;
    region?: string | RegionalEmissionFactor;
    profiles?: AiEnergyProfile[];
    emissionFactors?: RegionalEmissionFactor[];
    maxEquivalents?: number;
};
type Range = {
    min: number;
    typical?: number;
    max: number;
};
type AiEstimateResult = {
    tokens: number;
    profile: AiEnergyProfile;
    region: RegionalEmissionFactor;
    electricity: {
        wh: Required<Range>;
        kwh: Required<Range>;
    };
    carbon: {
        kgCO2e: Required<Range>;
    };
    equivalents: string[];
    electricityEquivalents: EquivalencyResult[];
    carbonEquivalents: EquivalencyResult[];
    assumptions: string[];
    sources: Source[];
    disclaimer: string;
};

declare function compare(measurement: Measurement, options?: CompareOptions): CompareResult;

declare function normalizeMeasurement(measurement: Measurement): {
    value: number;
    unit: string;
};

declare function scoreRatio(ratio: number): number;
declare function rankEquivalencies(valueInBaseUnit: number, candidates: Equivalency[], options?: {
    maxResults?: number;
    minRatio?: number;
    maxRatio?: number;
    locale?: string;
}): EquivalencyResult[];

declare function roundToSignificant(value: number, significantDigits?: number): number;
declare function formatNumber(value: number, locale?: string): string;
declare function formatRange(min: number, max: number, unit: string, locale?: string): string;

declare function validateSource(source: Source, path?: string): void;
declare function validateEquivalency(equivalency: Equivalency, path?: string): void;
declare function validateEquivalencies(equivalencies: Equivalency[], path?: string): void;
declare function validateCompareOptions(options: CompareOptions): Required<Pick<CompareOptions, "maxResults" | "minRatio" | "maxRatio">>;
declare function validateAiEnergyProfile(profile: AiEnergyProfile, path?: string): void;
declare function validateRegionalEmissionFactor(factor: RegionalEmissionFactor, path?: string): void;

declare const waterEquivalencies: Equivalency[];

declare const electricityEquivalencies: Equivalency[];

declare const carbonEquivalencies: Equivalency[];

declare const aiEnergyProfiles: AiEnergyProfile[];
declare const regionalEmissionFactors: RegionalEmissionFactor[];

declare const defaultEquivalencies: Equivalency[];

declare const sources: {
    epaGhg: {
        id: string;
        name: string;
        url: string;
        accessedAt: string;
        geography: string;
        boundary: string;
        factorType: "illustrative";
    };
    eiaFuelCoefficients: {
        id: string;
        name: string;
        url: string;
        accessedAt: string;
        datasetYear: string;
        geography: string;
        boundary: string;
        factorType: "tailpipe";
    };
    epaEgrid: {
        id: string;
        name: string;
        url: string;
        accessedAt: string;
        geography: string;
        boundary: string;
        factorType: "average";
    };
    eiaElectricityUse: {
        id: string;
        name: string;
        url: string;
        accessedAt: string;
        geography: string;
        boundary: string;
        factorType: "average";
    };
    ieaGrid: {
        id: string;
        name: string;
        url: string;
        accessedAt: string;
        geography: string;
        boundary: string;
        factorType: "average";
    };
    epochAi: {
        id: string;
        name: string;
        url: string;
        accessedAt: string;
        boundary: string;
        factorType: "operational";
    };
    mlEnergyLeaderboard: {
        id: string;
        name: string;
        url: string;
        accessedAt: string;
        publishedAt: string;
        boundary: string;
        factorType: "operational";
    };
    owidEmberElectricity: {
        id: string;
        name: string;
        url: string;
        accessedAt: string;
        datasetYear: string;
        boundary: string;
        factorType: "lifecycle";
    };
    epaWaterSense: {
        id: string;
        name: string;
        url: string;
        accessedAt: string;
        geography: string;
        boundary: string;
        factorType: "average";
    };
    epaWaterSenseToilets: {
        id: string;
        name: string;
        url: string;
        accessedAt: string;
        publishedAt: string;
        geography: string;
        boundary: string;
        factorType: "illustrative";
    };
    epaWaterSenseFaucets: {
        id: string;
        name: string;
        url: string;
        accessedAt: string;
        publishedAt: string;
        geography: string;
        boundary: string;
        factorType: "illustrative";
    };
    energyStarDishwashers: {
        id: string;
        name: string;
        url: string;
        accessedAt: string;
        publishedAt: string;
        geography: string;
        boundary: string;
        factorType: "illustrative";
    };
    energyStarDryers: {
        id: string;
        name: string;
        url: string;
        accessedAt: string;
        publishedAt: string;
        geography: string;
        boundary: string;
        factorType: "illustrative";
    };
    nistWaterHeatCapacity: {
        id: string;
        name: string;
        url: string;
        accessedAt: string;
        boundary: string;
        factorType: "arithmetic";
    };
    olympicPool: {
        id: string;
        name: string;
        url: string;
        accessedAt: string;
        boundary: string;
        factorType: "arithmetic";
    };
    energyStar: {
        id: string;
        name: string;
        url: string;
        accessedAt: string;
        boundary: string;
        factorType: "illustrative";
    };
    arithmeticVolume: {
        id: string;
        name: string;
        url: string;
        accessedAt: string;
        boundary: string;
        factorType: "arithmetic";
    };
};

declare function estimate(input: AiEstimateInput): AiEstimateResult;
declare const ai: {
    estimate: typeof estimate;
    profiles: AiEnergyProfile[];
    emissionFactors: RegionalEmissionFactor[];
};

declare const impact: {
    compare: typeof compare;
    ai: {
        estimate: typeof estimate;
        profiles: AiEnergyProfile[];
        emissionFactors: RegionalEmissionFactor[];
    };
};

export { type AiEnergyProfile, type AiEstimateInput, type AiEstimateResult, type Boundary, type CompareOptions, type CompareResult, type Confidence, type Domain, type Equivalency, type EquivalencyResult, type FactorType, type Measurement, type RegionalEmissionFactor, type Source, ai, aiEnergyProfiles, carbonEquivalencies, compare, impact as default, defaultEquivalencies, electricityEquivalencies, estimate as estimateAiImpact, formatNumber, formatRange, impact, normalizeMeasurement, rankEquivalencies, regionalEmissionFactors, roundToSignificant, scoreRatio, sources, validateAiEnergyProfile, validateCompareOptions, validateEquivalencies, validateEquivalency, validateRegionalEmissionFactor, validateSource, waterEquivalencies };
