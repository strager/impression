import type { KWeight, WinLoss } from "./ranking-math.ts";

export interface SelectPairRequest {
	type: "selectPair";
	id: number;
	mu: Float64Array;
	sigma: Float64Array;
	history: WinLoss[];
	kWeights: KWeight[];
	n: number;
	priorVariance: number;
	recencyDiscount: number;
	noCache?: boolean;
}

export interface BayesianRefitRequest {
	type: "bayesianRefit";
	id: number;
	history: WinLoss[];
	n: number;
	priorVariance: number;
	noCache?: boolean;
}

export type WorkerRequest = SelectPairRequest | BayesianRefitRequest;

export interface SelectPairResponse {
	type: "selectPair";
	id: number;
	pair: [number, number];
}

export interface BayesianRefitResponse {
	type: "bayesianRefit";
	id: number;
	mu: Float64Array;
	sigma: Float64Array;
}

export type WorkerResponse = SelectPairResponse | BayesianRefitResponse;
