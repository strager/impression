// Shared types for ranking convergence Web Worker communication.

import type { StopMode } from "../shared/ranking.ts";

export type OracleSpec = { type: "perfect" } | { type: "noisy"; confidentItems: number[]; noiseRange: number; noiseSeed: number } | { type: "random-bottom"; confidentItems: number[]; randomMax: number; noiseSeed: number } | { type: "mushy"; confidentItems: number[]; n: number } | { type: "reversal"; reversalRound: number; strengthsBefore: number[]; strengthsAfter: number[] };

export interface RunResult {
	round: number;
	stop: string;
	eK: number;
	correctness: "perfect" | "good-enough" | "incorrect";
	delta: number;
	maxTasks: number;
	estimatedMidPerRound: (number | null)[];
}

export interface WorkerRequest {
	jobId: number;
	n: number;
	trueStrength: number[];
	oracleSpec: OracleSpec;
	expectedTopK: number[];
	config: { k: number; minK: number; m: number };
	delta?: number;
	stopMode?: StopMode;
	maxTasks?: number;
	seed: number;
}

export interface WorkerResponse {
	jobId: number;
	result: RunResult;
}
