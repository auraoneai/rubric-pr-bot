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

assert.ok(comment);
assert.equal(comment.conclusion, "success");
assert.match(comment.comment, /Rubric Review/);
assert.match(comment.comment, /safety/);
assert.match(comment.comment, /R_EXAMPLES/);
assert.match(comment.comment, /R_ANCHORS/);
assert.match(comment.comment, /rubric-spec#criteria/);

const blocking = route("pull_request.synchronize", ["quality.rubric.json"], {
  "quality.rubric.json": {
    head: {
      criteria: [{ label: "No stable id", description: "Specific behavior", examples: [{}], anchors: [{}] }],
    },
  },
});

assert.ok(blocking);
assert.equal(blocking.conclusion, "failure");
assert.match(blocking.comment, /R_ID/);
assert.equal(route("push", ["quality.rubric.json"]), null);
