<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";

import AppButton from "./AppButton.vue";
import ExamineTextarea from "./ExamineTextarea.vue";
import { ExamineMeaningViewModel } from "./ExamineMeaningViewModel.ts";
import { useStringParam } from "./route-utils.ts";
import { hasVisitedExamineReflect } from "./store.ts";
import { useMatchMedia } from "./use-match-media.ts";
import { EXAMINE_QUESTIONS } from "../shared/examine-questions.ts";

const router = useRouter();

const questionsById = new Map(EXAMINE_QUESTIONS.map((q) => [q.id, q]));

const profileId = useStringParam("profileId");
const cardId = useStringParam("meaningId");

const vm = new ExamineMeaningViewModel(profileId, cardId);

const activeTextarea = ref<InstanceType<typeof ExamineTextarea> | null>(null);
const entryTextareas = ref<(InstanceType<typeof ExamineTextarea> | null)[]>([]);
const entryCards = ref<(HTMLElement | null)[]>([]);
const freeformCard = ref<HTMLElement | null>(null);
const freeformTextarea = ref<InstanceType<typeof ExamineTextarea> | null>(null);
const descriptionsHeading = ref<HTMLElement | null>(null);

let persistTimer: ReturnType<typeof setTimeout> | undefined;

function debouncedPersist(): void {
	if (persistTimer !== undefined) return;
	persistTimer = setTimeout(() => {
		persistTimer = undefined;
		vm.persistEntries();
	}, 300);
}

let freeformPersistTimer: ReturnType<typeof setTimeout> | undefined;

function debouncedFreeformPersist(): void {
	if (freeformPersistTimer !== undefined) return;
	freeformPersistTimer = setTimeout(() => {
		freeformPersistTimer = undefined;
		vm.persistFreeform();
	}, 300);
}

function onActiveEntryInput(entry: (typeof vm.entries)[number], index: number): void {
	vm.onActiveEntryInput(entry);
	debouncedPersist();
	mobileScrollToCardBottom(index);
}

function onAnsweredEntryInput(entry: (typeof vm.entries)[number], index: number): void {
	vm.onAnsweredEntryInput(entry);
	debouncedPersist();
	mobileScrollToCardBottom(index);
}

// https://github.com/w3c/csswg-drafts/issues/3871
const hasPhysicalKb = useMatchMedia("(hover: hover) and (pointer: fine)");

// --- Mobile editing mode ---
const focusedCard = ref<number | "freeform" | null>(null);
const keyboardVisible = ref(false);
const supportsMobileEditing: boolean = navigator.virtualKeyboard !== undefined;
const isMobileEditing = computed(() => !hasPhysicalKb.value && focusedCard.value !== null && keyboardVisible.value);

// Returns the visible viewport height above the virtual keyboard. Uses the
// VirtualKeyboard API (Chromium-only). Chrome Android reports boundingRect in
// a coordinate frame where `y` does NOT mean "distance from the top of the
// layout viewport" (observed: y=24 for a keyboard at the bottom of a 729px
// viewport), so we compute the visible area as layout height minus keyboard
// height, assuming the keyboard is at the bottom.
function getVisibleHeight(): number {
	const vk = navigator.virtualKeyboard;
	if (vk !== undefined && vk.boundingRect.height > 0) {
		return window.innerHeight - vk.boundingRect.height;
	}
	return window.innerHeight;
}

function updateVisibleHeightVar(): void {
	const vk = navigator.virtualKeyboard;
	const vkHeight = vk !== undefined && vk.boundingRect.height > 0 ? vk.boundingRect.height : 0;
	// --vv-height should be equivalent to env(keyboard-inset-top).
	document.documentElement.style.setProperty("--vv-height", String(window.innerHeight - vkHeight) + "px");
	if (vk === undefined) return;
	const wasEditing = isMobileEditing.value;
	keyboardVisible.value = vkHeight > 0;
	const nowEditing = isMobileEditing.value;
	if (wasEditing && !nowEditing) {
		// Keyboard hid — exit mobile editing, restore scroll.
		// Freeze the textarea height so it doesn't shrink when
		// .editing-active is removed.
		if (focusedCard.value !== null) {
			freezeTextareaHeight(focusedCard.value);
		}
	}
	if (!wasEditing && nowEditing) {
		// Keyboard appeared on an already-focused textarea (e.g. re-tap
		// after back-button dismiss). Unfreeze.
		if (focusedCard.value !== null) {
			unfreezeTextareaHeight(focusedCard.value);
		}
		void nextTick(() => {
			if (focusedCard.value !== null) {
				scrollCardIntoView(focusedCard.value);
			}
		});
	}
}

function freezeTextareaHeight(index: number | "freeform"): void {
	if (index === "freeform") {
		freeformTextarea.value?.freezeHeight();
	} else {
		entryTextareas.value[index]?.freezeHeight();
	}
}

function unfreezeTextareaHeight(index: number | "freeform"): void {
	if (index === "freeform") {
		freeformTextarea.value?.unfreezeHeight();
	} else {
		entryTextareas.value[index]?.unfreezeHeight();
	}
}

// Chrome Android doesn't collapse the URL bar on short pages, so entering
// fullscreen when the user starts editing reclaims that vertical space. Must
// be called from a user gesture (e.g. the textarea focus event).
function requestFullscreenIfMobile(): void {
	if (hasPhysicalKb.value) return;
	if (document.fullscreenElement !== null) return;
	if (typeof document.documentElement.requestFullscreen !== "function") return;
	document.documentElement.requestFullscreen().catch(() => {
		// Request may be denied (iframe permissions, user settings);
		// silently ignore — URL bar just won't collapse.
	});
}

function exitFullscreenIfActive(): void {
	if (document.fullscreenElement === null) return;
	document.exitFullscreen().catch(() => {
		// Ignore — nothing useful to do if exiting fullscreen fails.
	});
}

// Increase the viewport size (via fullscreen mode) while editing on mobile.
// Fullscreen mode is kind of glitchy, so it's disabled for now.
const ENABLE_FULLSCREEN = Boolean(0);
if (ENABLE_FULLSCREEN) {
	// Invariant: inFullscreen === isMobileEditing.
	// flush: "sync" runs the callback synchronously with the reactive write,
	// keeping requestFullscreen in the same call stack as the user gesture (tap)
	// that caused the keyboard to show. Transient user activation would also hold
	// through a microtask, but sync removes any doubt.
	watch(
		isMobileEditing,
		(editing) => {
			if (editing) {
				requestFullscreenIfMobile();
			} else {
				exitFullscreenIfActive();
			}
		},
		{ flush: "sync" },
	);
}

let blurTimer: ReturnType<typeof setTimeout> | undefined;

function onTextareaFocus(card: number | "freeform"): void {
	unfreezeTextareaHeight(card);
	if (blurTimer !== undefined) {
		clearTimeout(blurTimer);
		blurTimer = undefined;
	}
	focusedCard.value = card;
	if (!isMobileEditing.value) return;

	void nextTick(() => {
		scrollCardIntoView(card);
	});
}

function onTextareaBlur(): void {
	blurTimer = setTimeout(() => {
		blurTimer = undefined;
		if (isMobileEditing.value && navigator.virtualKeyboard !== undefined) {
			// VirtualKeyboard API available — geometrychange will handle
			// exiting mobile editing mode when the keyboard hides.
			return;
		}
		focusedCard.value = null;
	}, 150);
}

function onEntryBlur(entry: (typeof vm.entries)[number], index: number): void {
	onTextareaBlur();
	if (index === vm.editingEntryIndex) {
		vm.persistEntries();
	} else {
		vm.onAnsweredEntryBlur(entry);
	}
}

function handleFreeformBlur(): void {
	onTextareaBlur();
	vm.onFreeformBlur();
}

function preventDefaultIfMobile(event: Event): void {
	if (!hasPhysicalKb.value) {
		event.preventDefault();
	}
}

function handleDone(): void {
	if (blurTimer !== undefined) {
		clearTimeout(blurTimer);
		blurTimer = undefined;
	}
	if (focusedCard.value !== null) {
		freezeTextareaHeight(focusedCard.value);
	}
	focusedCard.value = null;
	if (document.activeElement instanceof HTMLElement) {
		document.activeElement.blur();
	}
}

// On desktop, skip if already fully visible. On mobile, we carefully manage
// the viewport thus we always want to scroll.
function scrollTargetIntoViewIfNeeded(target: Element): void {
	if (!isMobileEditing.value) {
		const rect = target.getBoundingClientRect();
		if (rect.top >= 0 && rect.bottom <= getVisibleHeight()) return;
	}
	target.scrollIntoView({ block: "start", behavior: "smooth" });
}

// Scroll a question card (or the freeform card) into view, targeting the most
// relevant sub-element. For question cards, if reflection/guardrail text is
// present, scroll to it; otherwise scroll to the source-of-meaning description.
// No-op if the target is already visible.
function scrollCardIntoView(index: number | "freeform"): void {
	const card = index === "freeform" ? freeformCard.value : entryCards.value.at(index);
	if (card === undefined) throw new Error(`No card for index ${String(index)}`);
	if (card === null) return;
	const reflection = card.querySelector(".reflection-guardrail, .reflection-thought-bubble, .manual-reflect-positive");
	const target = reflection ?? card.querySelector("p") ?? card;
	const cardRect = card.getBoundingClientRect();
	const targetRect = target.getBoundingClientRect();
	// Set --scroll-offset on every card we scroll to (not just the editing
	// one). It's only consumed by .editing-active's min-height calc, so it's
	// a harmless no-op on non-editing cards and avoids a branch here.
	card.style.setProperty("--scroll-offset", String(targetRect.top - cardRect.top) + "px");
	scrollTargetIntoViewIfNeeded(target);
}

function mobileScrollToCardBottom(index: number): void {
	if (!isMobileEditing.value) return;
	const card = entryCards.value.at(index);
	if (card === undefined) throw new Error(`No card for index ${String(index)}`);
	if (card === null) return;
	const rect = card.getBoundingClientRect();
	if (rect.bottom <= getVisibleHeight()) return;
	// Don't use scrollIntoView({ block: "end" }) — with overlaysContent, it
	// aligns with the full viewport bottom (behind the keyboard).
	window.scrollBy({ top: rect.bottom - getVisibleHeight(), behavior: "smooth" });
}

async function handleSubmitAnswer(): Promise<void> {
	const focusedAtStart = document.activeElement;
	const submittedIndex = vm.editingEntryIndex;
	if (!hasPhysicalKb.value && !isMobileEditing.value && document.activeElement instanceof HTMLElement) {
		document.activeElement.blur();
	}
	try {
		await vm.submitAnswer();
	} finally {
		// If the final question was just submitted (all answered, no more editing),
		// blur the input and scroll to the descriptions heading. Otherwise, focus
		// the next textarea.
		if (vm.allAnswered && vm.editingEntryIndex === -1 && !vm.awaitingReflection && !vm.inferring) {
			if (blurTimer !== undefined) {
				clearTimeout(blurTimer);
				blurTimer = undefined;
			}
			if (document.activeElement instanceof HTMLElement) {
				document.activeElement.blur();
			}
			focusedCard.value = null;
			void nextTick(() => {
				if (descriptionsHeading.value !== null) {
					scrollTargetIntoViewIfNeeded(descriptionsHeading.value);
				}
			});
		} else {
			if (isMobileEditing.value) {
				if (blurTimer !== undefined) {
					clearTimeout(blurTimer);
					blurTimer = undefined;
				}
				if (vm.freeformVisible) {
					focusedCard.value = "freeform";
				} else if (vm.editingEntryIndex >= 0) {
					focusedCard.value = vm.editingEntryIndex;
				} else {
					focusedCard.value = null;
				}
			}
			if (hasPhysicalKb.value || isMobileEditing.value) {
				void nextTick(() => {
					const cur = document.activeElement;
					if (cur !== focusedAtStart && cur !== document.body && cur !== null) return;
					if (vm.freeformVisible) {
						freeformTextarea.value?.focus();
					} else {
						activeTextarea.value?.focus();
					}
					if (focusedCard.value !== null) {
						// If a reflection/guardrail appeared on the card we're still
						// looking at (e.g. guardrail after submit), scroll to the
						// reflection text. Otherwise scroll to the description (new card).
						scrollCardIntoView(focusedCard.value);
					}
				});
			}
			if (submittedIndex >= 0 && vm.manualReflectResult.has(vm.entries[submittedIndex].questionId)) {
				void nextTick(() => {
					scrollCardIntoView(submittedIndex);
				});
			}
		}
	}
}

function handleConfirmDescriptions(): void {
	vm.confirmDescriptions();
	if (hasPhysicalKb.value) {
		void nextTick(() => {
			freeformTextarea.value?.focus();
		});
	}
	void nextTick(() => {
		scrollCardIntoView("freeform");
	});
}

async function handleReflectOnEntry(questionId: string, index: number): Promise<void> {
	const entry = vm.entries[index];
	if (entry.userAnswer.trim() === "") {
		await vm.reflectOnEntry(questionId);
		if (hasPhysicalKb.value) {
			entryTextareas.value[index]?.focus();
		}
		void nextTick(() => {
			scrollCardIntoView(index);
		});
		return;
	}
	await vm.reflectOnEntry(questionId);
	void nextTick(() => {
		scrollCardIntoView(index);
	});
}

function handleEditAutoFill(entry: (typeof vm.entries)[number], index: number): void {
	vm.acceptAutoFill(entry);
	void nextTick(() => {
		entryTextareas.value[index]?.focusAtEnd();
		scrollCardIntoView(index);
	});
}

function handleClearAutoFill(entry: (typeof vm.entries)[number], index: number): void {
	vm.clearAutoFill(entry);
	void nextTick(() => {
		entryTextareas.value[index]?.focus();
		scrollCardIntoView(index);
	});
}

function onKeydown(index: number | null, event: KeyboardEvent): void {
	if (!(event.key === "Enter" && event.shiftKey)) return;
	event.preventDefault();
	if (index !== null && index === vm.editingEntryIndex && vm.entries[index].autoFilledPending) return;
	if (index === vm.editingEntryIndex) {
		void handleSubmitAnswer();
	} else if (index !== null) {
		const next = entryTextareas.value[index + 1] ?? null;
		if (next !== null) {
			next.focus();
		} else if (vm.freeformVisible) {
			freeformTextarea.value?.focus();
		}
	} else {
		handleFinishExamining();
	}
}

const fadingOut = ref(false);
let fadeTimer: ReturnType<typeof setTimeout> | undefined;
const prefersReducedMotion = useMatchMedia("(prefers-reduced-motion: reduce)");

function handleFinishExamining(): void {
	vm.finishExamining();
	if (vm.readyForReflect) {
		if (prefersReducedMotion.value || hasVisitedExamineReflect(profileId, cardId)) {
			void router.push({ name: "examineReflect", params: { profileId, meaningId: cardId } });
		} else {
			fadingOut.value = true;
			document.documentElement.classList.add("page-fading-out");
			fadeTimer = setTimeout(() => {
				void router.push({ name: "examineReflect", params: { profileId, meaningId: cardId } });
			}, 2000);
		}
	} else if (!vm.allAnswered) {
		void router.push({ name: "examine", params: { profileId } });
	}
}

onBeforeUnmount(() => {
	if (fadeTimer !== undefined) clearTimeout(fadeTimer);
	if (blurTimer !== undefined) clearTimeout(blurTimer);
	document.documentElement.classList.remove("page-fading-out");
	navigator.virtualKeyboard?.removeEventListener("geometrychange", updateVisibleHeightVar);
	document.documentElement.style.removeProperty("--vv-height");
	if (navigator.virtualKeyboard !== undefined) {
		navigator.virtualKeyboard.overlaysContent = false;
	}
	exitFullscreenIfActive();
});

onMounted(() => {
	// Opt into the VirtualKeyboard API so the on-screen keyboard overlays
	// content rather than resizing the layout viewport, and so boundingRect
	// reports meaningful values. Reset on unmount so other views see the
	// browser's default keyboard behavior.
	if (navigator.virtualKeyboard !== undefined) {
		navigator.virtualKeyboard.overlaysContent = true;
	}
	updateVisibleHeightVar();
	navigator.virtualKeyboard?.addEventListener("geometrychange", updateVisibleHeightVar);
	const status = vm.initialize();
	if (status === "no-data") {
		void router.replace({ name: "examine", params: { profileId } });
	}
});
</script>

<template>
	<main v-if="vm.card" :class="{ 'fading-out': fadingOut, 'supports-mobile-editing': supportsMobileEditing }">
		<header>
			<h1>Examine meaning</h1>

			<h2 class="description">
				&ldquo;{{ vm.card.description }}&rdquo; <span class="source">({{ vm.card.source }})</span>
			</h2>

			<div class="instruction-stack">
				<p :class="['instruction', { active: !vm.allAnswered && vm.submittedCount === 0 }]">Reflect on what this source of meaning means to you. Answer each question thoughtfully.</p>
				<p :class="['instruction', { active: !vm.allAnswered && vm.submittedCount > 0 }]">Question {{ vm.submittedCount + 1 }} of {{ EXAMINE_QUESTIONS.length }} — keep reflecting on this source of meaning.</p>
				<p :class="['instruction', { active: vm.allAnswered }]">You've answered all questions. Add any additional notes, or finish examining this source of meaning.</p>
			</div>
		</header>

		<div
			v-for="(entry, index) in vm.entries"
			:key="entry.questionId"
			:ref="
				(el: any) => {
					entryCards[index] = el;
				}
			"
			:class="['card-hrule', 'textarea-card', { 'editing-active': isMobileEditing && focusedCard === index }]"
		>
			<p>
				<label :for="`q-${entry.questionId}`"
					><q>{{ vm.card.description }}</q></label
				>
			</p>
			<p>
				<label :for="`q-${entry.questionId}`">{{ questionsById.get(entry.questionId)?.text }}</label>
			</p>
			<template v-if="entry.submitted">
				<template v-if="vm.manualReflectResult.has(entry.questionId)">
					<p v-if="vm.manualReflectResult.get(entry.questionId)!.type === 'guardrail'" class="reflection-guardrail" style="--chip-parent-cap: 1cap">
						<em>{{ vm.manualReflectResult.get(entry.questionId)!.message }}</em> <span class="chip chip-ai">AI-generated</span>
					</p>
					<p v-else-if="vm.manualReflectResult.get(entry.questionId)!.type === 'thought_bubble'" class="reflection-thought-bubble" style="--chip-parent-cap: 1cap">
						<span class="thought-bubble-icon" aria-hidden="true">💭</span> <em>{{ vm.manualReflectResult.get(entry.questionId)!.message }}</em> <span class="chip chip-ai">AI-generated</span>
					</p>
					<p v-else class="manual-reflect-positive"><em>Your answer looks good!</em></p>
				</template>
			</template>
			<ExamineTextarea
				:id="`q-${entry.questionId}`"
				:ref="
					(el: any) => {
						entryTextareas[index] = el;
						if (index === vm.editingEntryIndex) activeTextarea = el;
					}
				"
				v-model="entry.userAnswer"
				:autofilled="index === vm.editingEntryIndex && entry.autoFilledPending"
				:variant="index === vm.editingEntryIndex ? undefined : 'answered'"
				:rows="index === vm.editingEntryIndex ? 5 : 3"
				:placeholder="index === vm.editingEntryIndex ? 'Type your reflection here...' : ''"
				@update:model-value="index === vm.editingEntryIndex ? onActiveEntryInput(entry, index) : onAnsweredEntryInput(entry, index)"
				@focus="onTextareaFocus(index)"
				@blur="onEntryBlur(entry, index)"
				@keydown="onKeydown(index, $event)"
			/>
			<p v-if="entry.submitted && (vm.manualReflectLoading.has(entry.questionId) || (vm.inferring && index === vm.entries.length - 1))" class="hint">Thinking about your answer...</p>
			<!-- eslint-disable-next-line vue/no-restricted-html-elements -->
			<button v-else-if="entry.submitted && index !== vm.editingEntryIndex" class="reflect-link-btn" @pointerdown="preventDefaultIfMobile" @click="handleReflectOnEntry(entry.questionId, index)">Help me reflect</button>
			<AppButton v-if="isMobileEditing && focusedCard === index && index !== vm.editingEntryIndex" variant="secondary" class="submit-btn" @pointerdown.prevent @click="handleDone">Done</AppButton>
			<template v-if="index === vm.editingEntryIndex">
				<div v-if="entry.autoFilledPending" class="autofill-actions">
					<AppButton variant="primary" @click="handleEditAutoFill(entry, index)">
						<span class="btn-icon-label"> ✏︎ Edit answer </span>
					</AppButton>
					<AppButton variant="secondary" @click="handleClearAutoFill(entry, index)">
						<span class="btn-icon-label"> ⌫ Write my own </span>
					</AppButton>
				</div>
				<template v-else>
					<div class="submit-actions">
						<AppButton variant="primary" class="submit-btn" :disabled="vm.awaitingReflection || entry.userAnswer.trim() === ''" @pointerdown="preventDefaultIfMobile" @click="handleSubmitAnswer">Next</AppButton>
						<AppButton v-if="isMobileEditing" variant="secondary" @pointerdown.prevent @click="handleDone">Done</AppButton>
					</div>
					<p v-if="vm.manualReflectResult.has(entry.questionId)" class="hint">Press Next to continue as-is, or edit your answer above</p>
					<p v-else-if="hasPhysicalKb" class="hint">Shift + Enter to submit</p>
				</template>
			</template>
		</div>

		<div v-if="vm.allAnswered && !vm.inferring && vm.editingEntryIndex === -1 && !vm.awaitingReflection" class="card-hrule">
			<h3 ref="descriptionsHeading" class="descriptions-heading">Which of these feel right to you?</h3>
			<div class="description-list">
				<label v-for="d in vm.cardDescriptions" :key="d.id" class="description-row">
					<input type="checkbox" :checked="vm.selectedDescriptionIds.has(d.id)" class="description-checkbox" @change="vm.toggleDescription(d.id)" />
					<span class="description-text">{{ d.text }}</span>
				</label>
			</div>
			<AppButton v-if="!vm.descriptionsConfirmed" variant="primary" class="submit-btn" @click="handleConfirmDescriptions">Next</AppButton>
		</div>

		<div v-if="vm.freeformVisible" ref="freeformCard" :class="['card-hrule', 'textarea-card', { 'editing-active': isMobileEditing && focusedCard === 'freeform' }]">
			<label for="freeform-notes">Additional notes about this source of meaning</label>
			<ExamineTextarea id="freeform-notes" ref="freeformTextarea" v-model="vm.freeformNote" :rows="5" placeholder="Any other thoughts you'd like to capture (optional)" @update:model-value="debouncedFreeformPersist" @focus="onTextareaFocus('freeform')" @blur="handleFreeformBlur()" @keydown="onKeydown(null, $event)" />
			<AppButton v-if="isMobileEditing && focusedCard === 'freeform'" variant="secondary" class="submit-btn" @pointerdown.prevent @click="handleDone">Done</AppButton>
		</div>

		<AppButton :variant="vm.readyForReflect ? 'primary' : 'secondary'" class="finish-btn" @click="handleFinishExamining">Finish examining {{ vm.card.source }}</AppButton>
	</main>
</template>

<style scoped>
main {
	margin: var(--space-8) auto;
	max-width: 36rem;
	padding: 0 var(--space-6);
	color: var(--color-black);
	transition: opacity 2s ease;
}

main.fading-out {
	opacity: 0;
}

main.supports-mobile-editing {
	/* Ensure enough scrollable space so scrollIntoView({ block: "start" }) can
	   scroll elements within a card to the viewport top, even before the virtual
	   keyboard has fully appeared. */
	padding-bottom: 100vh;
}

@media (prefers-reduced-motion: reduce) {
	main {
		transition: none;
	}
}

header {
	margin-bottom: var(--space-8);
}

h1 {
	margin: 0 0 var(--space-1);
}

.description {
	font-weight: 400;
	border-left: 3px solid var(--color-green-600);
	padding: var(--space-4) 0 var(--space-4) var(--space-5);
	margin: var(--space-16) 0 var(--space-12) 0;
}

.source {
	color: var(--color-gray-600);
}

label {
	font-family: var(--font-heading);
	font-size: var(--text-lg);
	font-weight: 500;
	color: var(--color-gray-800);
	cursor: pointer;
}

.submit-btn {
	width: 100%;
}

/* --- Mobile editing mode --- */
/* In mobile editing mode, the focused card fills the visual viewport so the
   textarea is comfortable to type in and the buttons stay above the keyboard.
   All other UI elements stay in normal page flow, so pressing Next produces a
   real smooth page scroll to the next focused card. */
.editing-active {
	/* --vv-height is set from JS in response to VirtualKeyboard API
	   geometrychange events. It's the visible area above the virtual keyboard. */
	min-height: calc(var(--vv-height, 100vh) + var(--scroll-offset, 0px));
	display: flex;
	flex-direction: column;
}

.textarea-card :deep(.textarea-wrapper) {
	flex-grow: 1;
}

.textarea-card :deep(textarea) {
	flex-grow: 1;
}

.submit-actions {
	display: flex;
	gap: var(--space-3);
}

.submit-actions > .submit-btn {
	flex: 1;
	width: auto;
}

.hint {
	font-size: var(--text-sm);
	color: var(--color-gray-400);
}

.textarea-card {
	display: flex;
	flex-direction: column;
	gap: var(--space-2);
}

.reflection-guardrail {
	font-size: var(--text-lg);
	font-weight: 600;
	color: var(--color-warning);
}

.reflection-thought-bubble {
	font-size: var(--text-lg);
	font-weight: 500;
	color: var(--color-green-600);
	background: var(--color-success-bg);
	border-left: 3px solid var(--color-green-600);
	padding: var(--space-3) var(--space-4);
	font-style: italic;
}

.reflect-link-btn {
	align-self: start;
	background: none;
	border: none;
	color: var(--color-gray-400);
	font-size: var(--text-sm);
	text-decoration: underline;
	cursor: pointer;
	padding: 0;
}

.has-hover .reflect-link-btn:hover,
.reflect-link-btn:active {
	color: var(--color-green-600);
}

.reflect-link-btn:disabled {
	background: none;
	border: none;
	text-decoration: none;
	cursor: default;
}

.manual-reflect-positive {
	font-size: var(--text-sm);
	color: var(--color-green-600);
	font-style: italic;
}

.autofill-actions {
	display: flex;
	gap: var(--space-3);
}

.autofill-actions button {
	flex: 1;
}

.btn-icon-label {
	font-family: "Lucide Icons", var(--font-body);
}

.descriptions-heading {
	font-family: var(--font-heading);
	font-size: var(--text-lg);
	font-weight: 500;
	color: var(--color-gray-800);
	margin: 0 0 var(--space-4);
}

.description-list {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
}

.description-row {
	display: flex;
	align-items: center;
	gap: 0.75rem;
	padding: 0.75rem 1rem;
	background: var(--color-white);
	cursor: pointer;
	user-select: none;
}

.description-checkbox {
	width: 1.15rem;
	height: 1.15rem;
	flex-shrink: 0;
	accent-color: var(--color-green-600);
	cursor: pointer;
}

.description-text {
	font-size: 0.95rem;
}

.finish-btn {
	width: 100%;
	margin-top: var(--space-6);
}
</style>
