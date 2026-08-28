export type MeasurementUnit = "MM" | "IN";
export type NumberFormat = "DECIMAL" | "FRACTION";
export type MeasurementPreferences = { measurementUnit: MeasurementUnit; numberFormat: NumberFormat };

export function toMillimeters(value: number, unit: MeasurementUnit) {
  return unit === "IN" ? value * 25.4 : value;
}

export function fromMillimeters(value: number, unit: MeasurementUnit) {
  return unit === "IN" ? value / 25.4 : value;
}

function trimmed(value: number, digits = 4) {
  return Number(value.toFixed(digits)).toString();
}

const unicodeFractions: Record<string, string> = {
  "1/2": "½", "1/3": "⅓", "2/3": "⅔", "1/4": "¼", "3/4": "¾", "1/5": "⅕", "2/5": "⅖",
  "3/5": "⅗", "4/5": "⅘", "1/6": "⅙", "5/6": "⅚", "1/8": "⅛", "3/8": "⅜", "5/8": "⅝", "7/8": "⅞",
};

function greatestCommonDivisor(a: number, b: number): number {
  return b === 0 ? a : greatestCommonDivisor(b, a % b);
}

function fraction(value: number) {
  const whole = Math.floor(value);
  const numerator64 = Math.round((value - whole) * 64);
  if (numerator64 === 0) return String(whole);
  if (numerator64 === 64) return String(whole + 1);
  const divisor = greatestCommonDivisor(numerator64, 64);
  const numerator = numerator64 / divisor;
  const denominator = 64 / divisor;
  const fractionText = unicodeFractions[`${numerator}/${denominator}`] ?? `${numerator}/${denominator}`;
  return whole > 0 ? `${whole} ${fractionText}` : fractionText;
}

export function formatMeasurement(millimeters: string | number, preferences: MeasurementPreferences) {
  const parsed = Number(millimeters);
  if (!Number.isFinite(parsed)) return "—";
  if (preferences.measurementUnit === "MM") return `${trimmed(parsed, 3)} mm`;
  const inches = fromMillimeters(parsed, "IN");
  return `${preferences.numberFormat === "FRACTION" ? fraction(inches) : trimmed(inches)} in*`;
}

export function measurementInputValue(millimeters: string | number, unit: MeasurementUnit) {
  const parsed = Number(millimeters);
  return Number.isFinite(parsed) ? trimmed(fromMillimeters(parsed, unit), 6) : "";
}
