import { DockerRunner } from "./apps/worker/src/sandbox/docker.js";

const CASES = [
  { id: "a", name: "types into the box and shows it", code: `const { find, type } = render(NameBox);\nawait type(find("input"), "Ada");\nexpect(find("p")).toHaveTextContent("Hello, Ada");`, visible: true },
];

const react = {
  runtime: "react",
  files: [{ path: "NameBox.jsx", content: `import { useState } from "react";

export default function NameBox() {
  const [name, setName] = useState("");
  return (
    <div>
      <input value={name} onChange={(e) => setName(e.target.value)} />
      <p>Hello, {name}</p>
    </div>
  );
}
` }],
  cases: CASES,
};

const vue = {
  runtime: "vue",
  files: [{ path: "NameBox.vue", content: `<script setup>
import { ref } from "vue";
const name = ref("");
</script>

<template>
  <div>
    <input v-model="name" />
    <p>Hello, {{ name }}</p>
  </div>
</template>
` }],
  cases: CASES,
};

const runner = new DockerRunner({ timeoutSeconds: 20 });
for (const [label, req] of [["react", react], ["vue", vue]] as const) {
  const r = await runner.run(req as never);
  const o = r.outcomes[0];
  console.log(`${label}: ${o.passed ? "PASS" : "fail"}`,
    o.expected !== undefined ? `(expected ${o.expected}, got ${o.actual})` : "",
    (o as { error?: string }).error ?? "", r.error ?? "");
}
