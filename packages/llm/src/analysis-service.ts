import type { LlmAnalysisResult } from "@edgar-eye/shared";

export interface AnalysisInput {
  ticker: string;
  title: string;
  cleanedText: string;
}

export interface IAnalysisService {
  analyzeFiling(input: AnalysisInput): Promise<LlmAnalysisResult>;
}
