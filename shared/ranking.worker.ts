import { bayesianRefit, selectPair } from "./ranking-math.ts";
import type { WorkerRequest, WorkerResponse } from "./ranking-worker-protocol.ts";

const refitCache = new Map<string, { mu: Float64Array; sigma: Float64Array }>();
const selectPairCache = new Map<string, [number, number]>();

function makeHistoryKey(n: number, priorVariance: number, history: readonly (readonly [number, number])[]): string {
	return `${n.toString()}|${priorVariance.toString()}|${history.map(([w, l]) => `${w.toString()},${l.toString()}`).join("|")}`;
}

function makeSelectPairCacheKey(kWeights: readonly { readonly k: number; readonly weight: number }[], n: number, priorVariance: number, recencyDiscount: number, history: readonly (readonly [number, number])[]): string {
	const kw = kWeights.map((w) => `${w.k.toString()}:${w.weight.toString()}`).join(";");
	return `${kw}|${recencyDiscount.toString()}|${makeHistoryKey(n, priorVariance, history)}`;
}

function handleMessage(data: WorkerRequest): WorkerResponse {
	switch (data.type) {
		case "selectPair": {
			if (data.noCache) {
				const mu = data.mu instanceof Float64Array ? data.mu : new Float64Array(data.mu);
				const sigma = data.sigma instanceof Float64Array ? data.sigma : new Float64Array(data.sigma);
				const pair = selectPair(mu, sigma, data.history, data.kWeights, data.n, data.priorVariance, data.recencyDiscount);
				return { type: "selectPair", id: data.id, pair };
			}
			const key = makeSelectPairCacheKey(data.kWeights, data.n, data.priorVariance, data.recencyDiscount, data.history);
			const cached = selectPairCache.get(key);
			if (cached !== undefined) {
				return { type: "selectPair", id: data.id, pair: cached };
			}
			const mu = data.mu instanceof Float64Array ? data.mu : new Float64Array(data.mu);
			const sigma = data.sigma instanceof Float64Array ? data.sigma : new Float64Array(data.sigma);
			const pair = selectPair(mu, sigma, data.history, data.kWeights, data.n, data.priorVariance, data.recencyDiscount);
			selectPairCache.set(key, pair);
			return { type: "selectPair", id: data.id, pair };
		}
		case "bayesianRefit": {
			if (data.noCache) {
				const { mu, sigma } = bayesianRefit(data.history, data.n, data.priorVariance);
				return { type: "bayesianRefit", id: data.id, mu, sigma };
			}
			const key = makeHistoryKey(data.n, data.priorVariance, data.history);
			const cached = refitCache.get(key);
			if (cached !== undefined) {
				return { type: "bayesianRefit", id: data.id, mu: cached.mu, sigma: cached.sigma };
			}
			const { mu, sigma } = bayesianRefit(data.history, data.n, data.priorVariance);
			refitCache.set(key, { mu, sigma });
			return { type: "bayesianRefit", id: data.id, mu, sigma };
		}
	}
}

// Browser Web Workers expose a postMessage function on the global scope.
// Node worker_threads do not. We use this to detect the environment.
// The runtime check via "postMessage" in globalThis is needed because
// the Node tsconfig does not include DOM types.

if ("postMessage" in globalThis) {
	// Browser Web Worker
	// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- globalThis not typed without DOM lib
	const scope = globalThis as unknown as {
		onmessage: ((event: { data: WorkerRequest }) => void) | null;
		postMessage(msg: WorkerResponse): void;
	};
	scope.onmessage = (event) => {
		const response = handleMessage(event.data);
		scope.postMessage(response);
	};
} else {
	// Node worker_threads
	void import("node:worker_threads").then(({ parentPort }) => {
		if (parentPort === null) {
			throw new Error("ranking.worker.ts must be run as a worker thread");
		}
		parentPort.on("message", (data: WorkerRequest) => {
			const response = handleMessage(data);
			parentPort.postMessage(response);
		});
	});
}
