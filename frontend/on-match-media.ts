export function onMatchMedia(query: string, callback: (matches: boolean) => void): () => void {
	const mediaQuery = window.matchMedia(query);
	callback(mediaQuery.matches);
	function onChange(): void {
		callback(mediaQuery.matches);
	}
	mediaQuery.addEventListener("change", onChange);
	return () => {
		mediaQuery.removeEventListener("change", onChange);
	};
}
