The system shall allow the interviewer to configure an interview using contextual information including, where applicable:
- Interviewer
- SME / interviewee
- SME job role/title
- SME job description
- Domain/industry
- Interview objective
- Key focus areas
- ACTA target ratio
The system shall generate a pre-interview review containing the interpreted interview context and expected themes.
Following confirmation, the system shall generate exactly 15 personalised starter questions.
The questions shall:
- Be customised for the particular SME and interview objective.
- Not be a universal fixed set for all interviewees.
- Follow ACTA L1, L2, and L3 principles.
- Respect the configured ACTA target ratio.
- Be arranged from L1 to L2 to L3.
- Avoid unnecessary duplication.
- Be sufficiently specific to the SME's context.
The system shall display the generated 15-question queue before the live interview begins.
The interviewer shall be able to:
- Review generated questions.
- Modify a generated question.
- Omit or skip a question.
- Request regeneration or alternatives.
- Review the ACTA classification of each question.
- Approve the final question queue.
The live interview workflow shall not automatically proceed until the interviewer approves the question queue.
The interviewer shall remain free to ask questions outside the generated queue during the actual interview.
The system shall provide controls for conducting the live interview.
The interviewer shall be able to:
- Begin the interview session.
- Activate audio capture.
- Pause or resume the session where supported.
- Save a captured recording/transcription segment.
- Discard an unwanted segment.
- End the interview session.
Session state shall be retained throughout the interview.
The recording workflow shall support capturing conversation between both the interviewer and SME.
The system shall convert recorded or live interview speech into text using the configured speech-to-text service.
The transcript shall capture dialogue from both:
- Interviewer
- SME / Interviewee
Where technically supported, transcript segments shall contain speaker identification.
The interviewer shall be able to save valid transcript segments and submit them for AI analysis.
A submitted transcript shall be treated as conversational context representing the interview dialogue.
SME responses contained in the transcript shall therefore function as input/replies to the AI system when determining the next appropriate interview recommendations.
The transcript shall accumulate throughout the session to maintain interview context.
After transcript content is submitted, the system shall analyse the current transcript together with relevant preceding interview context.
The system shall recommend contextual follow-up questions intended for the interviewer.
Follow-up questions shall:
- Build upon the SME's previous responses.
- Probe for deeper tacit knowledge.
- Follow relevant ACTA principles.
- Avoid repeating information already sufficiently covered.
- Avoid unnecessary yes/no questions.
- Encourage explanation and storytelling.
- Be concise enough for the interviewer to scan during a live interview.
- Include the relevant ACTA level or cognitive focus where applicable.
The system should normally provide a small set of recommended follow-up questions rather than interrupting the interviewer with excessive suggestions.
The interviewer remains responsible for selecting whether any recommendation is actually asked.
The system shall maintain the state of the interview throughout the session.
The system shall track information including:
- Questions asked
- Total validated questions
- L1 questions
- L2 questions
- L3 questions
- Current session progress
- Relevant transcript history
- Generated follow-up suggestions
The system shall use the accumulated context to reduce duplicate questioning.
The system may detect potential interview completion based on:
- Explicit closing remarks
- Sufficient question coverage
- Completion of the intended question threshold
- Diminishing new information
When the session appears to be concluding, TACITA may recommend a final reflection question before the interviewer ends the session.
When the interviewer ends the interview, the system shall process the complete accumulated transcript and interview context.
The system shall generate a summary of the whole interview.
The summary shall include, where supported by the interview content:
L1 – Task Map and Cognitive Hotspots
- Major activities or task areas
- Areas requiring significant judgement or expertise
L2 – Tacit Expert Knowledge
- Critical cues
- Strategies
- Job smarts
- Mental models
- Anomalies
- Workarounds
- Expert decision considerations
L3 – Scenario / Incident Analysis
- Scenario context
- Major events
- Decision points
- Situation assessment
- Critical cues
- Actions taken
- Trade-offs
- Potential novice errors
Future Exploration
- Unresolved areas
- Missing reasoning
- Knowledge requiring additional interviews or observation
The system shall also provide an overall representation of the interview rather than summarising only the most recent transcript segment.
Where requested, TACITA may additionally produce a refined, speaker-identified transcript organised into interviewer-question and SME-response interaction blocks.



1. Live transcription should normally be displayed within 2 seconds under supported network and audio conditions.
2. AI follow-up recommendations should normally be returned within 3 seconds after the relevant transcript is submitted.
3. Realtime UI updates should not require full-page refreshes.
4. The system should support at least 10 concurrent interview sessions as an initial baseline.
1. English ASR should target a Word Error Rate of 12% or lower under normal acoustic conditions.
2. Where diarization is available, speaker attribution should target at least 85% accuracy.
3. Transcript segments shall preserve chronological order.
4. Failed or incomplete transcription requests shall not silently replace previously valid transcript data.
1. AI outputs shall conform to defined structured schemas.
2. Invalid structured responses shall be rejected, retried, or handled safely.
3. Starter questions shall total exactly 15.
4. Follow-up questions shall take previous transcript context into account.
5. The AI shall minimise repetitive questioning.
6. Generated questions shall maintain a neutral, respectful, and interview-appropriate tone.
7. Real-time recommendations should be readable by an interviewer within approximately 10 seconds.
1. Interview state shall be stored durably.
2. Previously persisted transcript segments shall not be lost when subsequent AI requests fail.
3. Session state should survive ordinary UI refreshes or temporary connection interruptions where technically feasible.
4. Questions, transcripts, suggestions, summaries, and session metadata shall remain associated with the correct interview session.
5. Duplicate transcript submissions should be detected or prevented where practicable.
1. The application shall be usable through modern desktop browsers.
2. The primary interview workflow shall present recording, transcript, questions, and AI recommendations clearly.
3. Controls used during a live interview shall minimise interviewer distraction.
4. Important actions such as record, save, discard, send, pause, and end shall be clearly distinguishable.
5. AI recommendations shall be formatted for rapid scanning.
6. The interviewer shall always remain in control of which question is actually asked
1. The system shall maintain TypeScript-based frontend and backend code 
2. LLM configuration shall be externalised using environment variables.
3. STT providers shall be sufficiently modular to permit provider replacement.
4. Structured data shall be validated using Zod and/or Convex validators.
5. Schema changes shall be manageable through Convex migrations.
6. Core workflows shall be covered using the available Vitest, Playwright, Node, or convex-test test infrastructure.

  

Additional FR1. IT Admin Account Management

The system shall allow the IT Admin to manage Admin and Interviewer accounts.
The IT Admin shall be able to:

- View, create, edit, and delete accounts.
- Set each account's display name, username, password, and role.

The system shall restrict account management to the IT Admin.

Additional FR2. Admin Interview Management

The system shall allow the Admin to manage interview settings.
The Admin shall be able to:

- View, create, edit, and delete interview settings.
- Configure the interview context and ACTA target ratio.
- Assign or unassign each setting to one Interviewer.

The system shall allow Interviewers to access only settings assigned to them.
