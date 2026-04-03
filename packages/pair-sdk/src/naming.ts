function normalizeName(value: unknown) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ');
}

export function pairV2ConnectionSuffix(seed: unknown) {
  const normalized = String(seed || '')
    .trim()
    .replace(/_/g, '')
    .replace(/[^a-zA-Z0-9]/g, '');

  if (normalized) {
    return normalized.slice(-6);
  }

  return Date.now().toString().slice(-6);
}

export function formatPairV2ConnectionName(seed: unknown, mobileName?: unknown) {
  const suffix = pairV2ConnectionSuffix(seed);
  const normalizedMobileName = normalizeName(mobileName);
  return normalizedMobileName ? `${normalizedMobileName}-连接-${suffix}` : `连接-${suffix}`;
}

export function isGeneratedPairV2ConnectionName(
  value: unknown,
  candidates: Array<{ seed: unknown; mobileName?: unknown }>
) {
  const normalizedValue = normalizeName(value);
  if (!normalizedValue) {
    return false;
  }

  for (const candidate of candidates) {
    const withName = formatPairV2ConnectionName(candidate.seed, candidate.mobileName);
    if (normalizedValue === withName) {
      return true;
    }
    const legacy = formatPairV2ConnectionName(candidate.seed, '');
    if (normalizedValue === legacy) {
      return true;
    }
  }

  return false;
}

export function normalizePairV2MobileName(value: unknown) {
  return normalizeName(value);
}
