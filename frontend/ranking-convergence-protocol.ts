// Shared types for ranking convergence Web Worker communication.

export type OracleSpec = { type: "perfect" } | { type: "noisy"; confidentItems: number[]; noiseRange: number; noiseSeed: number } | { type: "random-bottom"; confidentItems: number[]; randomMax: number; noiseSeed: number } | { type: "mushy"; confidentItems: number[]; n: number } | { type: "reversal"; reversalRound: number; strengthsBefore: number[]; strengthsAfter: number[] };

export interface RunResult {
	round: number;
	stop: string;
	eK: number;
	correctness: "perfect" | "good-enough" | "incorrect";
	maxTasks: number;
	estimatedMidPerRound: (number | null)[];
}

export interface WorkerRequest {
	jobId: number;
	n: number;
	trueStrength: number[];
	oracleSpec: OracleSpec;
	expectedTopK: number[];
	config: { k: number };
	epsilon?: number;
	maxTasks?: number;
	minTasks?: number;
	seed: number;
}

export interface WorkerResponse {
	jobId: number;
	result: RunResult;
}

export function range(n: number): number[] {
	return Array.from({ length: n }, (_, i) => i);
}
