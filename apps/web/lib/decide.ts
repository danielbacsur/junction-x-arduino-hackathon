import { experimental_decide } from "ai";

import type { Rule } from "./device";

// Resolves through Vercel AI Gateway, which authenticates with the project's
// OIDC token, so no Google key is stored anywhere.
export async function decide(frame: Buffer, rules: Rule[], deadline: number) {
  const questions = rules.map(({ key, instructions }) => [key, { type: "boolean" as const, instructions }]);

  const { answers } = await experimental_decide({
    model: "google/gemini-decision-1",
    state: [{ type: "file", mediaType: "image/jpeg", data: frame }],
    questions: Object.fromEntries(questions),
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(deadline),
  });

  // Turned into the asker's terms, where yes means what they typed holds.
  const probabilities = rules.map(({ key, when }) => {
    const answer = answers[key];

    if (answer?.type !== "boolean") throw new Error(`Unexpected answer for ${key}`);

    return [key, when ? answer.probability : 1 - answer.probability];
  });

  return Object.fromEntries(probabilities) as Record<string, number>;
}
