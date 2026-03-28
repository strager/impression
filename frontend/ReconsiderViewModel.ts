import { ref } from "vue";

import type { MeaningCard, SwipeDirection } from "../shared/meaning-cards.ts";
import { MEANING_CARDS } from "../shared/meaning-cards.ts";
import { capture } from "./analytics.ts";
import { loadChosenCardIds, loadExamineData, loadSwipeProgress, saveChosenCardIds } from "./store.ts";

export class ReconsiderViewModel {
	private readonly profileId: string;
	private readonly _chosenIds = ref<Set<string>>(new Set());
	private readonly _examinedIds = ref<Set<string>>(new Set());
	private readonly _swipeDirections = ref<Map<string, SwipeDirection>>(new Map());
	private readonly _confirmingRemove = ref<string | null>(null);

	constructor(profileId: string) {
		this.profileId = profileId;
	}

	get chosenIds(): Set<string> {
		return this._chosenIds.value;
	}

	get examinedIds(): Set<string> {
		return this._examinedIds.value;
	}

	get confirmingRemove(): string | null {
		return this._confirmingRemove.value;
	}

	get selectedCount(): number {
		return this._chosenIds.value.size;
	}

	get hasSwipeData(): boolean {
		return this._swipeDirections.value.size > 0;
	}

	get agreedCards(): MeaningCard[] {
		return MEANING_CARDS.filter((c) => this._swipeDirections.value.get(c.id) === "agree");
	}

	get unsureCards(): MeaningCard[] {
		return MEANING_CARDS.filter((c) => this._swipeDirections.value.get(c.id) === "unsure");
	}

	get disagreedCards(): MeaningCard[] {
		return MEANING_CARDS.filter((c) => this._swipeDirections.value.get(c.id) === "disagree");
	}

	initialize(): "ready" | "no-data" {
		try {
			const cardIds = loadChosenCardIds(this.profileId);
			if (cardIds === null) {
				return "no-data";
			}
			this._chosenIds.value = new Set(cardIds);

			const examineData = loadExamineData(this.profileId);
			if (examineData !== null) {
				for (const [cardId, cardData] of Object.entries(examineData)) {
					if (cardData.entries.some((e) => e.userAnswer !== "")) {
						this._examinedIds.value.add(cardId);
					}
				}
			}
			const swipeProgress = loadSwipeProgress(this.profileId);
			if (swipeProgress !== null) {
				for (const record of swipeProgress.swipeHistory) {
					this._swipeDirections.value.set(record.cardId, record.direction);
				}
			}

			capture("reconsider_visited", { session_id: this.profileId });
			return "ready";
		} catch {
			return "no-data";
		}
	}

	isExamined(cardId: string): boolean {
		return this._examinedIds.value.has(cardId);
	}

	toggleCard(cardId: string): void {
		if (this._chosenIds.value.has(cardId)) {
			if (this.isExamined(cardId)) {
				// Remove optimistically so the checkbox stays in sync with the
				// browser's toggle.  cancelRemove() re-adds if the user cancels.
				this._chosenIds.value.delete(cardId);
				this._chosenIds.value = new Set(this._chosenIds.value);
				this._confirmingRemove.value = cardId;
				return;
			}
			this.removeCard(cardId, false);
		} else {
			this.addCard(cardId);
		}
	}

	addCard(cardId: string): void {
		this._chosenIds.value.add(cardId);
		this._chosenIds.value = new Set(this._chosenIds.value);
		this.saveChosenIds();
		capture("card_toggled", { session_id: this.profileId });
	}

	removeCard(cardId: string, hadData: boolean): void {
		this._chosenIds.value.delete(cardId);
		this._chosenIds.value = new Set(this._chosenIds.value);
		this._confirmingRemove.value = null;
		this.saveChosenIds();
		capture("card_toggled", { session_id: this.profileId });
		if (hadData) {
			capture("card_with_data_removed", { session_id: this.profileId });
		}
	}

	cancelRemove(): void {
		if (this._confirmingRemove.value !== null) {
			this._chosenIds.value.add(this._confirmingRemove.value);
			this._chosenIds.value = new Set(this._chosenIds.value);
			capture("reconsider_remove_cancelled", {
				session_id: this.profileId,
			});
		}
		this._confirmingRemove.value = null;
	}

	onDone(): void {
		capture("reconsider_completed", {
			session_id: this.profileId,
			card_count: this.selectedCount,
		});
	}

	private saveChosenIds(): void {
		const ordered = MEANING_CARDS.filter((c) => this._chosenIds.value.has(c.id)).map((c) => c.id);
		saveChosenCardIds(this.profileId, ordered);
	}
}
