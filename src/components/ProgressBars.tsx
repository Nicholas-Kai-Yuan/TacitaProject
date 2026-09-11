import { getQuestionDistribution } from "../../shared/acta";
import type { ActaLevel, InterviewSession } from "../../shared/types";

const levels: ActaLevel[] = ["L1", "L2", "L3"];

export default function ProgressBars({ session }: { session: InterviewSession }) {
  const target = getQuestionDistribution(session.settingSnapshot.actaRatio);
  const asked = levels.reduce<Record<ActaLevel, number>>(
    (acc, level) => {
      acc[level] = session.starterQuestions.filter(
        (question) => question.actaLevel === level && question.status === "asked",
      ).length;
      return acc;
    },
    { L1: 0, L2: 0, L3: 0 },
  );
  const totalAsked = session.starterQuestions.filter((question) => question.status === "asked").length;

  return (
    <div className="progress-stack">
      <div className="progress-total">
        <strong>{totalAsked}</strong>
        <span>validated questions</span>
      </div>
      {levels.map((level) => {
        const denominator = Math.max(target[level], asked[level], 1);
        const percent = Math.min(100, Math.round((asked[level] / denominator) * 100));
        return (
          <div className="coverage-row" key={level}>
            <div>
              <strong>{level}</strong>
              <span>{`${asked[level]} / ${target[level]}`}</span>
            </div>
            <div className="coverage-track" aria-label={`${level} coverage`}>
              <span style={{ width: `${percent}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
