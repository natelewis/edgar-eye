export interface AccessionCandidate {
  accessionNumber: string;
  accessionNoDashes: string;
  cik: string;
}

export class AccessionPredictor {
  private readonly sequenceByCik = new Map<string, number>();
  private readonly prefixByCik = new Map<string, string>();

  registerKnown(cik: string, accessionNumber: string): void {
    const normalizedCik = normalizeCik(cik);
    const parsed = parseAccession(accessionNumber);
    if (!parsed) {
      return;
    }

    this.prefixByCik.set(normalizedCik, parsed.prefix);
    const current = this.sequenceByCik.get(normalizedCik) ?? 0;
    if (parsed.sequence >= current) {
      this.sequenceByCik.set(normalizedCik, parsed.sequence);
    }
  }

  predictNext(cik: string, count = 3): AccessionCandidate[] {
    const normalizedCik = normalizeCik(cik);
    const prefix =
      this.prefixByCik.get(normalizedCik) ??
      `${normalizedCik.padStart(10, "0")}-${new Date().getFullYear().toString().slice(-2)}`;
    const baseSequence = this.sequenceByCik.get(normalizedCik) ?? 0;

    const candidates: AccessionCandidate[] = [];
    for (let i = 1; i <= count; i++) {
      const sequence = baseSequence + i;
      const accessionNumber = `${prefix}-${sequence.toString().padStart(6, "0")}`;
      candidates.push({
        accessionNumber,
        accessionNoDashes: accessionNumber.replace(/-/g, ""),
        cik: normalizedCik.replace(/^0+/, ""),
      });
    }

    return candidates;
  }

  confirm(cik: string, accessionNumber: string): void {
    this.registerKnown(cik, accessionNumber);
  }
}

function normalizeCik(cik: string): string {
  return cik.replace(/\D/g, "").padStart(10, "0");
}

function parseAccession(
  accessionNumber: string,
): { prefix: string; sequence: number } | null {
  const match = accessionNumber.match(/^(\d{10}-\d{2})-(\d{6})$/);
  if (!match) {
    return null;
  }

  return {
    prefix: match[1]!,
    sequence: parseInt(match[2]!, 10),
  };
}

export function buildFilingUrl(
  cik: string,
  accessionNumber: string,
): string {
  const normalizedCik = cik.replace(/^0+/, "");
  const accessionNoDashes = accessionNumber.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${normalizedCik}/${accessionNoDashes}/${accessionNumber}.txt`;
}

export function buildIndexUrl(
  cik: string,
  accessionNumber: string,
): string {
  const normalizedCik = cik.replace(/^0+/, "");
  const accessionNoDashes = accessionNumber.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${normalizedCik}/${accessionNoDashes}/${accessionNumber}-index.htm`;
}
