# ViewModel pattern

Frontend views use a ViewModel pattern (MVVM) to separate workflow logic from UI rendering. Each page's logic lives in a ViewModel class in a `.ts` file; the `.vue` file is a thin shell that renders the template and delegates actions to the ViewModel.

## Why this pattern

The ViewModel pattern descends from Martin Fowler's Presentation Model (2004) and Microsoft's MVVM refinement of it. The core idea is: **pull state and behavior out of the view into a plain object that knows nothing about the UI framework**. The view becomes a thin, almost mechanical translation layer — read state, render it, forward user gestures.

This separation buys two things:

1. **Testability without rendering.** Because the ViewModel is a plain TypeScript class, tests can call its methods and assert on its getters without mounting a component, touching the DOM, or waiting for animation frames. In this project `FindMeaningViewModel.test.ts` and `FindMeaningPrioritizeViewModel.test.ts` exercise persistence, analytics, undo, edge cases, and state transitions entirely outside Vue.

2. **A clear seam between "what happens" and "how it looks."** Deciding that a swipe records analytics, advances the card index, and persists progress is a workflow concern. Deciding that the card should fly off-screen before the index advances is a presentation concern. When these two concerns live in different files, each file stays small and single-purpose.

In practice the boundary shows up as a rule: **the ViewModel never imports from `vue-router` or references the DOM**. When the ViewModel needs to influence navigation — for example, when initialization discovers there is no saved data — it returns a status value (`"ready" | "no-data" | "skip"`) and lets the View decide which route to push. This keeps the ViewModel portable and the View in control of anything framework-specific.

## Structure

A page consists of two files:

- **`FooViewModel.ts`** — a class that owns reactive state, derived properties, and business logic (persistence, analytics, validation).
- **`FooView.vue`** — the template, DOM refs, animations, route navigation, and presentation-only computeds.

## ViewModel class conventions

The constructor takes the dependencies the ViewModel needs (typically just `sessionId`). Initialization logic that reads from localStorage or sets up state goes in an `initialize()` method called from `onMounted`, not in the constructor.

State is stored in private `ref()` fields and exposed via getters, so consumers see normal properties without `.value`:

```ts
import { ref } from "vue";

export class FooViewModel {
	private readonly _count = ref(0);

	get count(): number {
		return this._count.value;
	}

	increment(): void {
		this._count.value++;
	}
}
```

Vue's reactivity tracking works because the getter reads `ref.value` during render — the template re-renders when the underlying ref changes.

## What belongs in the ViewModel

- Reactive state (refs) and derived properties (getters)
- Business logic: persistence (localStorage via `store.ts`), analytics (`capture()`), data transformations
- Methods that the View calls in response to user actions (e.g. `swipe()`, `undo()`, `finalize()`)

## What belongs in the View

- Template and styles
- DOM refs (e.g. a ref to a child component for triggering animations)
- Animation coordination (e.g. calling `flyAway()` on a component before delegating to the ViewModel)
- Route navigation — the ViewModel does not import `vue-router`. If navigation depends on ViewModel state, the View reads that state and decides the route.
- Presentation-only computeds that map ViewModel state to display text (e.g. button labels)

## Instantiation

The View creates the ViewModel in `<script setup>` and references it as `vm` in the template:

```vue
<script setup lang="ts">
const vm = new FooViewModel(sessionId);

onMounted(() => {
	vm.initialize();
});
</script>

<template>
	<p>{{ vm.count }}</p>
	<button @click="vm.increment()">+1</button>
</template>
```

## Example

`FindMeaningView.vue` and `FindMeaningViewModel.ts` follow this pattern. The ViewModel owns card shuffling, swipe history, progress persistence, and analytics. The View owns the SwipeCard DOM ref (for animations), the pending-swipe-method flag (drag vs button — a UI coordination concern), route navigation, and the next-phase button label.
