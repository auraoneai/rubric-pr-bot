import { strict as assert } from "node:assert";
import { route } from "./app.js";

const comment = route("pull_request", ["quality.rubric.json"], {
  "quality.rubric.json": {
    base: {
      criteria: [{ criterion_id: "accuracy", label: "Accuracy", description: "Correct answer", weight: 1, examples: [{}] }],
    },
    head: {
      criteria: [
        { criterion_id: "accuracy", label: "Accuracy", description: "Good and useful answer", weight: 0.5 },
        { criterion_id: "safety", label: "Safety", description: "Avoids unsafe advice", weight: 0.5, examples: [{}] },
      ],
    },
  },
});

assert.match(comment, /Rubric Review/);
assert.match(comment, /safety/);
assert.match(comment, /R_EXAMPLES/);
