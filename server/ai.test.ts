import { describe, expect, it } from "vitest";
import { isRepeatQuestion, starterStatus } from "./ai";

const question =
  "When a bottleneck is emerging across fabrication processes, what subtle signs distinguish a temporary buildup from a line-wide constraint?";

describe("starter question status", () => {
  it("stays pending until the question is asked", () => {
    expect(starterStatus(question, ["Approve", "Mic On"])).toBe("Pending");
  });

  it("does not count a question sent without an answer", () => {
    expect(starterStatus(question, [`Amy: ${question}`])).toBe("Asked, awaiting answer");
    expect(starterStatus(question, [`Question: ${question} Answer:`])).toBe("Asked, awaiting answer");
    expect(starterStatus(question, [`Amy: ${question}\nMichael Tan: Yes.`])).toBe("Asked, awaiting answer");
  });

  it("does not count a second question as the answer", () => {
    expect(starterStatus(question, [`${question} And which tools do you check first?`])).toBe("Asked, awaiting answer");
  });

  it("counts an answer in the same message", () => {
    expect(
      starterStatus(question, [
        `Amy: ${question}\nMichael Tan: I watch whether the queue keeps growing after the next shift starts.`,
      ]),
    ).toBe("Answered");
  });

  it("counts an answer without punctuation from speech-to-text", () => {
    const spoken = question.replace(/[?,]/g, "").toLowerCase();
    expect(starterStatus(question, [`${spoken} mostly i look at whether the queue keeps growing`])).toBe("Answered");
  });

  it("counts an answer sent in the next message", () => {
    expect(
      starterStatus(question, [`Amy: ${question}`, "Michael Tan: I watch whether the queue keeps growing after the shift change."]),
    ).toBe("Answered");
  });

  it("does not take the next question's answer as this question's answer", () => {
    expect(
      starterStatus(question, [
        `Amy: ${question}`,
        "Amy: How do you decide which lots to protect?\nMichael Tan: I look at commit dates and customer priority first.",
      ]),
    ).toBe("Asked, awaiting answer");
  });
});

describe("repeated follow-ups", () => {
  it("flags a reworded repeat of an earlier question", () => {
    expect(
      isRepeatQuestion(
        "What subtle signs distinguish a temporary buildup from a line-wide bottleneck constraint?",
        question,
      ),
    ).toBe(true);
  });

  it("allows a new angle that reuses some of the same words", () => {
    expect(
      isRepeatQuestion("What would a newer planner misread when a bottleneck queue first starts to grow?", question),
    ).toBe(false);
  });
});
