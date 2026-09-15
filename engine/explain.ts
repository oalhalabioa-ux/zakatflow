export type ExplanationLine = {
  lotId: string;
  transactionId?: string;
  assetName?: string;
  value: string;
  status: string;
  reason: string;
};

export function explainAssessment(lines: ExplanationLine[]) {
  return lines.map((line) => ({
    ...line,
    path: [
      'Zakat',
      'Assessment',
      line.assetName ?? 'Asset',
      `Lot ${line.lotId}`,
      ...(line.transactionId ? [`Transaction ${line.transactionId}`] : []),
    ],
  }));
}
