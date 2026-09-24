import type { ActaLevel, ActaRatio } from "./types";

const ACTA_LEVELS: ActaLevel[] = ["L1", "L2", "L3"];

export function parseActaRatio(value: string): ActaRatio | null {
  const matches = [...value.matchAll(/L\s*([123])\s*[:=-]?\s*(\d+(?:\.\d+)?)\s*%?/gi)];

  if (matches.length >= 3) {
    const ratio = { L1: 0, L2: 0, L3: 0 };
    for (const match of matches) {
      ratio[`L${match[1]}` as ActaLevel] = Number(match[2]);
    }
    return isValidRatio(ratio) ? ratio : null;
  }

  const numbers = value.match(/\d+(?:\.\d+)?/g)?.map(Number);
  if (numbers?.length === 3) {
    const ratio = { L1: numbers[0], L2: numbers[1], L3: numbers[2] };
    return isValidRatio(ratio) ? ratio : null;
  }

  return null;
}

export function isValidRatio(ratio: ActaRatio): boolean {
  const total = ratio.L1 + ratio.L2 + ratio.L3;
  return ACTA_LEVELS.every((level) => ratio[level] >= 0) && Math.abs(total - 100) <= 0.5;
}

export function getQuestionDistribution(ratioText: string): Record<ActaLevel, number> {
  const ratio = parseActaRatio(ratioText) ?? { L1: 20, L2: 60, L3: 20 };
  const l1 = Math.round((15 * ratio.L1) / 100);
  const l2 = Math.round((15 * ratio.L2) / 100);
  const l3 = Math.max(0, 15 - l1 - l2);

  return normalizeDistribution({ L1: l1, L2: l2, L3: l3 });
}

function normalizeDistribution(counts: Record<ActaLevel, number>): Record<ActaLevel, number> {
  let total = counts.L1 + counts.L2 + counts.L3;
  const normalized = { ...counts };

  while (total > 15) {
    const level = ACTA_LEVELS.reduce((max, current) =>
      normalized[current] > normalized[max] ? current : max,
    );
    normalized[level] -= 1;
    total -= 1;
  }

  while (total < 15) {
    normalized.L3 += 1;
    total += 1;
  }

  return normalized;
}

