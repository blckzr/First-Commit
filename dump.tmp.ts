import { buildHarness } from "./apps/worker/src/sandbox/harness.js";
const h = buildHarness({
  runtime: "vue",
  files: [{ path: "Counter.vue", content: `<script setup>
import { ref } from "vue";
const props = defineProps({ start: { type: Number, default: 0 } });
const count = ref(props.start);
</script>

<template>
  <div>
    <p data-count>{{ count }}</p>
    <button @click="count++">Add one</button>
  </div>
</template>
` }],
  cases: [{ id: "a", name: "renders", code: `const { find } = render(Counter, { start: 3 });\nexpect(find("[data-count]")).toHaveTextContent("3");`, visible: true }],
});
process.stdout.write(h.source);
