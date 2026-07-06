const NON_COUNTRY_REGION_CODES = new Set([
  'AC',
  'CP',
  'CQ',
  'DG',
  'EA',
  'EZ',
  'EU',
  'IC',
  'SU',
  'TA',
  'UN',
]);

const REGION_DISPLAY_NAMES = new Intl.DisplayNames(['en'], { type: 'region' });
const COUNTRY_NAME_BY_CODE = buildCountryNameByCode();
const COUNTRY_NAME_BY_LOWER = buildCountryNameByLower();
const COUNTRY_CODES_BY_NAME = buildCountryCodesByName();

export function getCountryNameFromCode(countryCode: string): string | undefined {
  return COUNTRY_NAME_BY_CODE.get(countryCode.trim().toUpperCase());
}

export function normalizeCountryName(country: string | null | undefined): string | undefined {
  const trimmed = country?.trim();

  if (!trimmed || trimmed.toLowerCase() === 'unknown') {
    return undefined;
  }

  return getCountryNameFromCode(trimmed) ?? COUNTRY_NAME_BY_LOWER.get(trimmed.toLowerCase());
}

export function getCountryFilterVariants(country: string): string[] {
  const normalized = normalizeCountryName(country);

  if (!normalized) {
    return [];
  }

  return Array.from(new Set([
    normalized.toLowerCase(),
    ...(COUNTRY_CODES_BY_NAME.get(normalized) ?? []),
  ]));
}

function buildCountryNameByCode(): Map<string, string> {
  const entries = new Map<string, string>();

  for (let first = 65; first <= 90; first += 1) {
    for (let second = 65; second <= 90; second += 1) {
      const code = String.fromCharCode(first, second);

      if (NON_COUNTRY_REGION_CODES.has(code)) {
        continue;
      }

      const displayName = REGION_DISPLAY_NAMES.of(code);

      if (!displayName || displayName === code) {
        continue;
      }

      entries.set(code, displayName);
    }
  }

  return entries;
}

function buildCountryNameByLower(): Map<string, string> {
  const entries = new Map<string, string>();

  for (const countryName of COUNTRY_NAME_BY_CODE.values()) {
    entries.set(countryName.toLowerCase(), countryName);
  }

  return entries;
}

function buildCountryCodesByName(): Map<string, string[]> {
  const entries = new Map<string, string[]>();

  for (const [code, countryName] of COUNTRY_NAME_BY_CODE.entries()) {
    const codes = entries.get(countryName) ?? [];
    codes.push(code.toLowerCase());
    entries.set(countryName, codes);
  }

  return entries;
}
