<script setup lang="ts">
import { ref, useAttrs } from "vue";

defineOptions({ inheritAttrs: false });

defineProps<{
	id?: string;
	modelValue: string;
	rows?: number;
	placeholder?: string;
	variant?: "active" | "answered";
	// When true, modelValue should contain a trailing "\n" to reserve space
	// for the autofill chip in the bottom-right corner of the textarea.
	autofilled?: boolean;
}>();

const emit = defineEmits<{
	"update:modelValue": [value: string];
	blur: [];
}>();

const attrs = useAttrs();
const textareaRef = ref<HTMLTextAreaElement | null>(null);

function focus(): void {
	textareaRef.value?.focus();
}

function focusAtEnd(): void {
	const el = textareaRef.value;
	if (el === null) return;
	el.focus();
	const len = el.value.length;
	el.setSelectionRange(len, len);
}

function onInput(event: Event): void {
	if (!(event.target instanceof HTMLTextAreaElement)) {
		throw new Error("Expected target to be an HTMLTextAreaElement");
	}
	emit("update:modelValue", event.target.value);
}

defineExpose({ focus, focusAtEnd });
</script>

<template>
	<div class="textarea-wrapper">
		<textarea :id="id" ref="textareaRef" v-bind="attrs" :class="[variant ?? 'active', { autofilled, 'no-focus-ring': autofilled }]" :value="modelValue" :rows="rows ?? 5" :placeholder="placeholder ?? ''" :readonly="autofilled || undefined" @input="onInput" @blur="emit('blur')"></textarea>
		<span v-if="autofilled" class="chip chip-positioned chip-ai autofill-chip">AI-generated</span>
	</div>
</template>

<style scoped>
.textarea-wrapper {
	position: relative;
}

textarea.autofilled {
	color: var(--color-gray-400);
	cursor: default;
}

.autofill-chip {
	position: absolute;
	bottom: var(--space-2);
	right: 0;
}
</style>
