import { USER_INSTRUCTIONS } from "../tacitaTool";

export default function ToolInstructions() {
  return (
    <div className="tool-instructions">
      <h2>{USER_INSTRUCTIONS.title}</h2>
      <p>{USER_INSTRUCTIONS.intro}</p>
      <p>
        <strong>{USER_INSTRUCTIONS.levelsTitle}</strong>
      </p>
      <ul>
        {USER_INSTRUCTIONS.levels.map((level) => (
          <li key={level.label}>
            <strong>{level.label}</strong> {level.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
