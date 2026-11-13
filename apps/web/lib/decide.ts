import { experimental_decide } from "ai";

import type { Question } from "./questions";

// Resolves through Vercel AI Gateway, which authenticates with the project's
// OIDC token, so no Google key is stored anywhere.
export async function decide(frame: Buffer, questions: Record<string, Question>, deadline: number) {
  const entries = Object.entries(questions).map(([key, { instructions }]) => [
    key,
    { type: "boolean" as const, instructions },
  ]);

  const { answers } = await experimental_decide({
    model: "google/gemini-decision-1",
    state: [{ type: "file", mediaType: "image/jpeg", data: frame }],
    questions: Object.fromEntries(entries),
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(deadline),
  });

  const probabilities = Object.entries(answers).map(([key, answer]) => {
    if (answer.type !== "boolean") throw new Error(`Unexpected answer for ${key}`);

    return [key, answer.probability];
  });

  return Object.fromEntries(probabilities) as Record<string, number>;
}
