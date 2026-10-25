// apps/web/types/strategy_v3.ts
/**
 * Institutional Quant Strategy Types (QuantOS v3.0)
 * Supports Dynamic Universe Screening, Portfolio Risk Parity, AST Recursive Condition Trees,
 * Realistic Microstructure Friction Models, and Prop-Firm Circuit Breakers.
 */

export type AssetClass = "CRYPTO" | "FOREX" | "FUTURES" | "EQUITY";

export interface AssetContractSpec {
  symbol: string;
  assetClass: AssetClass;
  tickSize: number;
  tickValue: number;          // e.g., $12.50 for ES, $5.00 for NQ, $10.00 for standard FX lot
  contractMultiplier: number;  // 50 for ES, 20 for NQ, 100,000 for standard FX lot
  lotSize: number;
  baseCurrency: string;
  quoteCurrency: string;
  makerFeeRate: number;        // e.g., 0.0002 (0.02%)
  takerFeeRate: number;        // e.g., 0.0005 (0.05%)
  marginRequirementPct: number;// e.g., 0.05 (20x leverage)
  fundingIntervalHours?: number; // 8 for Crypto Perpetual swaps
}

// ==========================================
// MODULE 1: DYNAMIC UNIVERSE SPECIFICATIONS
// ==========================================
export type UniverseMode = "DYNAMIC_FILTER" | "MANUAL_BASKET";

export interface DynamicUniverseFilter {
  assetClass: AssetClass;
  minAdvUsd: number;             // Minimum 30-day Average Daily Volume in USD
  minRealizedVol20d?: number;    // e.g., 0.15 (15% annualized min volatility)
  maxRealizedVol20d?: number;
  topNByAdv?: number;            // e.g., Top 30 by 30-day ADV
  sectors?: string[];            // e.g., ["DeFi", "Layer1", "AI"] or ["FX_Majors", "FX_Crosses"]
}

export type WeightingMethod = "EQUAL_WEIGHT" | "INVERSE_VOLATILITY" | "FIXED_UNIT_RISK";
export type RebalanceSchedule = "DAILY_CLOSE" | "WEEKLY" | "DRIFT_THRESHOLD";

export interface PortfolioAllocationConfig {
  weighting: WeightingMethod;
  rebalanceSchedule: RebalanceSchedule;
  driftThresholdPct: number;     // e.g., 0.05 for 5% drift rebalancing
  volatilityLookbackBars: number;// e.g., 20
  volatilityMetric: "ATR" | "STD_DEV";
  maxLeverageGross: number;      // e.g., 2.0 (200% gross exposure)
  maxAssetWeightPct: number;     // e.g., 0.25 (Max 25% allocation to single asset)
}

// ==========================================
// MODULE 2: AST RECURSIVE CONDITION TREE
// ==========================================
export type LogicalOperator = "AND" | "OR" | "NOT";
export type ComparisonOperator = ">" | ">=" | "<" | "<=" | "==" | "!=" | "CROSSES_ABOVE" | "CROSSES_BELOW";

export interface IndicatorOperand {
  type: "INDICATOR";
  symbol?: string;               // Optional: cross-asset reference (defaults to primary)
  timeframe: string;             // e.g., "5m", "15m", "1h", "4h", "1d"
  indicator: "EMA" | "SMA" | "RSI" | "ATR" | "MACD" | "BOLLINGER" | "RETURN" | "PRICE";
  params: Record<string, number | string>;
  field?: "close" | "high" | "low" | "open" | "volume" | "upper" | "lower" | "hist";
}

export interface RelativeValueOperand {
  type: "RELATIVE_VALUE_SPREAD";
  assetA: string;
  assetB: string;
  timeframe: string;
  hedgeRatio: number;            // Beta from OLS: Price_A - beta * Price_B
  metric: "SPREAD_VALUE" | "Z_SCORE";
  zScoreLookback?: number;       // e.g., 30 bars
}

export interface ConstantOperand {
  type: "CONSTANT";
  value: number;
}

export type ConditionOperand = IndicatorOperand | RelativeValueOperand | ConstantOperand;

export interface SingleRule {
  id: string;
  type: "RULE";
  leftOperand: ConditionOperand;
  operator: ComparisonOperator;
  rightOperand: ConditionOperand;
}

export interface RuleGroup {
  id: string;
  type: "GROUP";
  logicalOperator: LogicalOperator;
  conditions: (SingleRule | RuleGroup)[];
}

// ==========================================
// MODULE 3 & 4: EXECUTION & PROP-FIRM RISK
// ==========================================
export interface MicrostructureFrictionConfig {
  pessimisticIntraBarSequence: boolean;
  baseSpreadPipsOrTicks: number;
  sessionSpreadMultiplier: {
    londonOpen: number;          // e.g., 1.0
    nyOpen: number;              // e.g., 1.0
    asianSession: number;        // e.g., 1.5
    weekendOrRollover: number;   // e.g., 3.0
  };
  slippageModel: "STATIC_PCT" | "VOLATILITY_ADAPTIVE";
  slippageStdDevMultiplier: number;
}

export interface PropFirmRiskConfig {
  drawdownMode: "INTRADAY_EQUITY_PEAK_HWM" | "CLOSED_BALANCE_EOD";
  maxTrailingDrawdownPct: number; // e.g., 8.0%
  maxDailyLossPct: number;         // e.g., 4.0%
  dailyResetUtcHour: number;       // 00:00 UTC
  hardBreakerAction: "FLATTEN_AND_HALT" | "NOTIFY_ONLY";
  newsRiskEmbargoMinutes: number;  // Flatten 5m before red-folder CPI/FOMC/NFP
  maxSimultaneousTrades: number;
}

export interface MonteCarloConfig {
  iterations: number;
  expectedBlockSize: number;
  propDdThresholdPct: number;
}

export interface CompleteStrategySpec {
  meta: {
    id: string;
    name: string;
    author: string;
    version: string;
  };
  universe: {
    mode: UniverseMode;
    dynamicFilter?: DynamicUniverseFilter;
    staticSymbols?: string[];
  };
  allocation: PortfolioAllocationConfig;
  entryRules: RuleGroup;
  exitRules: RuleGroup;
  friction: MicrostructureFrictionConfig;
  propFirmGuard: PropFirmRiskConfig;
  monteCarlo?: MonteCarloConfig;
}
