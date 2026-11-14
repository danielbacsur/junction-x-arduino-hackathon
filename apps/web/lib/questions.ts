import type { Rule } from "./device";

// Every board is asked these until someone changes its questions.
export const questions: Rule[] = [
  {
    key: "door",
    label: "Door open",
    text: "Is the door open?",
    instructions: "Is a door in the image visibly open?",
    when: true,
    alert: false,
    hold: 0,
  },

  {
    key: "person",
    label: "Person in view",
    text: "Is there a person in view?",
    instructions: "Is a real person visible in the image? Pictures and screens do not count.",
    when: true,
    alert: false,
    hold: 0,
  },

  {
    key: "hands",
    label: "Two hands shown",
    text: "Is the person showing two hands?",
    instructions: "Is a person visibly showing both of their hands? Answer no when nobody is in view.",
    when: true,
    alert: false,
    hold: 0,
  },
];
