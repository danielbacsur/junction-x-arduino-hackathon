export type Question = { label: string; instructions: string };

// Every board is asked these unless its hash carries a `questions` override.
export const questions: Record<string, Question> = {
  door: {
    label: "Is the door open?",
    instructions: "Is a door in the image visibly open?",
  },

  person: {
    label: "Is there a person in view?",
    instructions: "Is a real person visible in the image? Pictures and screens do not count.",
  },

  hands: {
    label: "Is the person showing two hands?",
    instructions: "Is a person visibly showing both of their hands? Answer no when nobody is in view.",
  },
};
