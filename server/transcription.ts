import { NoTranscriptGeneratedError, transcribe } from "ai";
import { openai } from "@ai-sdk/openai";
import { requireOpenAiKey } from "./ai";
import type { InterviewSetting } from "../shared/types";

// Tried in order: a model the account cannot use, or that fails, falls through to the next.
const RECORDED_TRANSCRIPTION_MODELS = ["gpt-transcribe", "gpt-4o-transcribe", "gpt-4o-mini-transcribe", "whisper-1"];

// Returns "" when the recording holds no speech.
export async function transcribeRecording(audio: Uint8Array, setting: InterviewSetting): Promise<string> {
  requireOpenAiKey();

  let lastError: unknown;
  for (const modelId of RECORDED_TRANSCRIPTION_MODELS) {
    try {
      const result = await transcribe({
        model: openai.transcription(modelId),
        audio,
        providerOptions: {
          openai: {
            prompt: transcriptionContext(setting),
            // Without this the SDK asks newer models for verbose_json, which only whisper-1 supports.
            ...(modelId !== "whisper-1" && { responseFormat: "json" }),
          },
        },
      });
      return result.text.trim();
    } catch (error) {
      if (NoTranscriptGeneratedError.isInstance(error)) {
        return "";
      }
      lastError = error;
      console.warn(`Transcription with ${modelId} failed; trying the next model.`, error instanceof Error ? error.message : error);
    }
  }
  throw lastError;
}

// Names and domain vocabulary help the model spell them correctly; Whisper only reads the last 224 tokens.
function transcriptionContext(setting: InterviewSetting): string {
  return [
    `Interview between ${setting.interviewerName} and ${setting.smeName}, ${setting.jobRoleTitle} (${setting.domainIndustry}).`,
    `Topics: ${setting.keyFocusAreas.replace(/\s+/g, " ").trim()}`,
  ]
    .join(" ")
    .slice(0, 600);
}
