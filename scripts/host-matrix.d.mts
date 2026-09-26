/**
 * Type declarations for the host verification dashboard generator.
 */

export type HostCheckStatus = "pass" | "partial" | "fail" | "pending" | "unknown";

export interface HostMatrixTable {
  header: string[];
  dataRows: string[][];
}

export interface HostCheck {
  column: string;
  raw: string;
  status: HostCheckStatus;
  observed: boolean;
}

export interface HostMatrixRow {
  host: string;
  version: string;
  engine: string;
  checks: HostCheck[];
  statuses: HostCheckStatus[];
  evidence: string;
  overall: HostCheckStatus;
}

export interface HostMatrixTotals {
  hosts: number;
  byOverall: Partial<Record<HostCheckStatus, number>>;
  passing: number;
}

export interface HostMatrixDashboard {
  generatedFrom: string;
  descriptors: string[];
  checks: string[];
  evidenceDate: string | null;
  evidenceAgeDays: number | null;
  staleEvidence: boolean;
  stalenessThresholdDays: number;
  rows: HostMatrixRow[];
  totals: HostMatrixTotals;
  releaseReady: false;
  releaseNote: string;
}

export declare const EVIDENCE_STALENESS_DAYS: number;
export declare const HOST_MATRIX_STATUSES: readonly HostCheckStatus[];
export declare const HOST_MATRIX_DESCRIPTORS: readonly string[];
export declare const HOST_MATRIX_CHECKS: readonly string[];
export declare const PASSING_STATUSES: readonly HostCheckStatus[];

export declare function hasObservation(raw: string | undefined | null): boolean;

export declare function extractHostMatrix(markdown: string): HostMatrixTable;

export declare function extractEvidenceDate(markdown: string): string | null;

export declare function buildHostMatrixDashboard(
  markdown: string,
  options?: { now?: Date },
): HostMatrixDashboard;

export declare function renderHostMatrixDashboard(dashboard: HostMatrixDashboard): string;
