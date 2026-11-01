import { buildHarness } from "./apps/worker/src/sandbox/harness.js";
import { DockerRunner } from "./apps/worker/src/sandbox/docker.js";

const react = {
  runtime: "vue",
  files: [
    {
      path: "Counter.vue",
      content: `<script setup>
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
`,
    },
  ],
  cases: [
    { id: "a", name: "renders the start value", code: `const { find } = render(Counter, { start: 3 });\nexpect(find("[data-count]")).toHaveTextContent("3");`, visible: true },
    { id: "b", name: "counts up on click", code: `const { find, click } = render(Counter);\nawait click(find("button"));\nexpect(find("[data-count]")).toHaveTextContent("1");`, visible: true },
    { id: "c", name: "fails visibly when wrong", code: `const { find } = render(Counter);\nexpect(find("[data-count]")).toHaveTextContent("99");`, visible: true },
  ],
};

const runner = new DockerRunner({ timeoutSeconds: 20 });
const result = await runner.run(react as never);
console.log("error:", result.error ?? "(none)");
for (const o of result.outcomes) {
  console.log(` ${o.passed ? "PASS" : "fail"}  ${o.name}`,
    o.expected !== undefined ? `(expected ${o.expected}, got ${o.actual})` : "",
    (o as { error?: string }).error ? `ERROR: ${(o as { error?: string }).error}` : "");
}
