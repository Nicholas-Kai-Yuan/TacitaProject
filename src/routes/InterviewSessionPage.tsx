import { ChangeEvent, FormEvent, Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileText,
  ListChecks,
  MessageSquareText,
  Mic,
  Power,
  RefreshCw,
  Save,
  Send,
  Sparkles,
  Square,
  Wand2,
  Wrench,
} from "lucide-react";
import { api } from "../api/client";
import ActaBadge from "../components/ActaBadge";
import ProgressBars from "../components/ProgressBars";
import type { InterviewSession, QuestionStatus, Speaker } from "../../shared/types";

export default function InterviewSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [session, setSession] = useState<InterviewSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [speaker, setSpeaker] = useState<Speaker>("sme");
  const [transcriptText, setTranscriptText] = useState("");
  const [chatMessage, setChatMessage] = useState("");
  const [recordingState, setRecordingState] = useState<"idle" | "recording">("idle");
  const [audioStatus, setAudioStatus] = useState("Mic idle");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const canApprove = useMemo(
    () => Boolean(session?.starterQuestions.length === 15 && session.status === "questions_generated"),
    [session],
  );
  const checklistShown = useMemo(
    () =>
      Boolean(
        session?.chatMessages.some(
          (message) => message.role === "assistant" && message.content.includes("Pre-Interview Checklist"),
        ),
      ),
    [session],
  );

  useEffect(() => {
    if (sessionId) {
      void loadSession(sessionId);
    }

    return () => stopRecording();
  }, [sessionId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [session?.chatMessages.length]);

  async function loadSession(id = sessionId) {
    if (!id) {
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const loaded = await api.getSession(id);
      setSession(loaded);
      if (loaded.chatMessages.length === 0) {
        await runAction("welcome", () => api.requestWelcome(id));
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load session");
    } finally {
      setIsLoading(false);
    }
  }

  async function runAction(label: string, action: () => Promise<InterviewSession>) {
    setBusy(label);
    setError(null);
    try {
      setSession(await action());
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  async function saveTranscript(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !transcriptText.trim()) {
      return;
    }

    const text = transcriptText;
    setTranscriptText("");
    await runAction("transcript", () =>
      api.addTranscript(session.id, {
        speaker,
        text,
        submittedForAi: true,
      }),
    );
  }

  async function sendChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitChatMessage(chatMessage);
  }

  async function submitChatMessage(message: string) {
    if (!session || !message.trim()) {
      return;
    }

    const text = message.trim();
    setChatMessage("");
    await runAction("chat", () => api.chat(session.id, text));
  }

  async function sendQuickChat(message: string) {
    if (!session) {
      return;
    }

    setChatMessage("");
    await runAction("chat", () => api.chat(session.id, message));
  }

  async function updateQuestionText(questionId: string, text: string) {
    if (!session) {
      return;
    }

    setSession({
      ...session,
      starterQuestions: session.starterQuestions.map((question) =>
        question.id === questionId ? { ...question, text } : question,
      ),
    });
  }

  async function persistQuestion(questionId: string, patch: { text?: string; status?: QuestionStatus }) {
    if (!session) {
      return;
    }

    await runAction(`question-${questionId}`, () => api.updateQuestion(session.id, questionId, patch));
  }

  async function startRecording() {
    if (!session || recordingState === "recording") {
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      const host = window.location.host;
      const socket = new WebSocket(`${protocol}://${host}/audio/${session.id}`);
      socketRef.current = socket;

      socket.onmessage = (event) => {
        const payload = JSON.parse(event.data) as { chunkCount: number; transcribed: boolean };
        setAudioStatus(payload.transcribed ? "Transcript received" : `Audio chunks sent: ${payload.chunkCount}`);
      };

      const recorder = new MediaRecorder(stream, { mimeType: pickMimeType() });
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0 && socket.readyState === WebSocket.OPEN) {
          socket.send(event.data);
        }
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
      };
      socket.onopen = () => recorder.start(1200);
      setRecordingState("recording");
      setAudioStatus("Mic starting");
      await runAction("start", () => api.startSession(session.id));
    } catch (recordingError) {
      setError(recordingError instanceof Error ? recordingError.message : "Unable to start microphone");
      stopRecording();
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    socketRef.current?.close();
    socketRef.current = null;
    setRecordingState("idle");
    setAudioStatus("Mic idle");
  }

  if (isLoading) {
    return <div className="panel loading-line">Loading interview session...</div>;
  }

  if (!session) {
    return (
      <div className="panel">
        <div className="alert">{error ?? "Session not found"}</div>
        <Link className="secondary-action inline-action" to="/interviewer">
          Back to settings
        </Link>
      </div>
    );
  }

  return (
    <section className="page-stack">
      <div className="session-header">
        <div>
          <Link className="back-link" to="/interviewer">
            Back to interviewer
          </Link>
          <p className="eyebrow">Interview Session</p>
          <h1>{session.settingSnapshot.smeName}</h1>
          <p>{`${session.settingSnapshot.jobRoleTitle} · ${session.settingSnapshot.domainIndustry}`}</p>
        </div>
        <span className="status-pill large">{session.status.replaceAll("_", " ")}</span>
      </div>

      {error && <div className="alert">{error}</div>}

      <section className="panel guided-chat-panel">
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">AI Guided Interview</p>
            <h1>Silent Whisperer Chat</h1>
          </div>
          <MessageSquareText size={22} />
        </div>

        <div className="chat-list guided-chat-list">
          {session.chatMessages.map((message) => (
            <article className={`chat-message ${message.role}`} key={message.id}>
              <div className="chat-avatar">{message.role === "user" ? "IN" : "AI"}</div>
              <div className="chat-bubble">
                <strong>{message.role === "user" ? "Interviewer" : "TACITA"}</strong>
                <RichChatContent content={message.content} />
              </div>
            </article>
          ))}
          <div ref={chatEndRef} />
        </div>

        <form className="chat-form guided-chat-form" onSubmit={sendChat}>
          <input
            value={chatMessage}
            onChange={(event) => setChatMessage(event.target.value)}
            placeholder={session.status === "ended" ? "Interview ended" : "Proceed, Mic On, transcript, or End"}
            disabled={session.status === "ended" || busy === "chat"}
          />
          <button
            className="icon-button solid"
            type="submit"
            disabled={!chatMessage.trim() || session.status === "ended" || busy === "chat"}
            title="Send"
          >
            <Send size={18} />
          </button>
        </form>

        <div className="button-row chat-shortcuts">
          {session.starterQuestions.length === 0 && (
            <button
              className="secondary-action"
              type="button"
              onClick={() => void sendQuickChat(checklistShown ? "Yes proceed" : "Proceed")}
              disabled={busy === "chat"}
            >
              <CheckCircle2 size={16} />
              {checklistShown ? "Confirm Checklist" : "Proceed"}
            </button>
          )}
          {session.starterQuestions.length > 0 && session.status !== "ended" && (
            <button
              className="secondary-action"
              type="button"
              onClick={() => void runAction("start", () => api.startSession(session.id))}
              disabled={busy === "start" || session.status === "in_progress"}
            >
              <Mic size={16} />
              Mic On
            </button>
          )}
          {session.status !== "ended" && (
            <button
              className="danger-action"
              type="button"
              onClick={() => void sendQuickChat("End")}
              disabled={busy === "chat"}
            >
              <Power size={16} />
              End
            </button>
          )}
        </div>
      </section>

      <button
        className="secondary-action inline-action tools-toggle"
        type="button"
        onClick={() => setToolsOpen((open) => !open)}
      >
        <Wrench size={16} />
        {toolsOpen ? "Hide Interview Tools" : "Show Interview Tools"}
        {toolsOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      {toolsOpen && (
        <>
      <section className="workspace-grid">
        <div className="panel question-panel">
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">ACTA Queue</p>
              <h1>Starter Questions</h1>
            </div>
            {session.starterQuestions.length === 0 ? (
              <button
                className="primary-action"
                type="button"
                onClick={() => void runAction("generate", () => api.generateStarterQuestions(session.id))}
                disabled={busy === "generate"}
              >
                <Wand2 size={18} />
                {busy === "generate" ? "Working..." : "Generate Starter Questions"}
              </button>
            ) : (
              <button
                className="secondary-action"
                type="button"
                onClick={() => void runAction("generate", () => api.generateStarterQuestions(session.id))}
                disabled={busy === "generate"}
              >
                <RefreshCw size={17} />
                Regenerate
              </button>
            )}
          </div>

          {session.starterQuestions.length === 0 ? (
            <div className="empty-inline">
              <ListChecks size={22} />
              <span>No questions generated.</span>
            </div>
          ) : (
            <div className="question-list">
              {session.starterQuestions.map((question, index) => (
                <article className={`question-item ${question.status}`} key={question.id}>
                  <div className="question-number">{index + 1}</div>
                  <div className="question-body">
                    <div className="question-meta">
                      <ActaBadge level={question.actaLevel} />
                      <span>{question.focus}</span>
                    </div>
                    <textarea
                      value={question.text}
                      rows={3}
                      onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                        void updateQuestionText(question.id, event.target.value)
                      }
                      onBlur={(event) => void persistQuestion(question.id, { text: event.target.value })}
                    />
                    <div className="button-row">
                      <button
                        className="secondary-action"
                        type="button"
                        onClick={() => void persistQuestion(question.id, { status: "asked" })}
                      >
                        <CheckCircle2 size={16} />
                        Asked
                      </button>
                      <button
                        className="ghost-action"
                        type="button"
                        onClick={() => void persistQuestion(question.id, { status: "skipped" })}
                      >
                        <Square size={16} />
                        Skip
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}

          {canApprove && (
            <button
              className="primary-action full-width"
              type="button"
              onClick={() => void runAction("approve", () => api.approveQuestions(session.id))}
              disabled={busy === "approve"}
            >
              <CheckCircle2 size={18} />
              Approve Question Queue
            </button>
          )}
        </div>

        <aside className="panel progress-panel">
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">Coverage</p>
              <h1>Progress</h1>
            </div>
          </div>
          <ProgressBars session={session} />
        </aside>
      </section>

      <section className="workspace-grid live-grid">
        <div className="panel">
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">Live Interview</p>
              <h1>Capture</h1>
            </div>
            <div className="button-row">
              {recordingState === "idle" ? (
                <button
                  className="secondary-action"
                  type="button"
                  onClick={() => void startRecording()}
                  disabled={session.status === "draft" || session.status === "questions_generated"}
                  title="Start microphone"
                >
                  <Mic size={17} />
                  Start
                </button>
              ) : (
                <button className="danger-action" type="button" onClick={stopRecording} title="Stop microphone">
                  <Square size={17} />
                  Stop
                </button>
              )}
            </div>
          </div>
          <div className="audio-meter">
            <span className={recordingState === "recording" ? "pulse-dot live" : "pulse-dot"} />
            <span>{audioStatus}</span>
          </div>

          <form className="transcript-form" onSubmit={saveTranscript}>
            <div className="field-row">
              <label className="field compact-field">
                <span>Speaker</span>
                <select value={speaker} onChange={(event) => setSpeaker(event.target.value as Speaker)}>
                  <option value="sme">SME</option>
                  <option value="interviewer">Interviewer</option>
                  <option value="unknown">Unknown</option>
                </select>
              </label>
            </div>
            <label className="field">
              <span>Transcript Segment</span>
              <textarea
                value={transcriptText}
                onChange={(event) => setTranscriptText(event.target.value)}
                rows={5}
                placeholder="Paste or type captured dialogue"
              />
            </label>
            <div className="button-row">
              <button className="primary-action" type="submit" disabled={!transcriptText.trim() || busy === "transcript"}>
                <Save size={18} />
                Save Segment
              </button>
              <button
                className="secondary-action"
                type="button"
                onClick={() => void runAction("followups", () => api.generateFollowUps(session.id))}
                disabled={session.transcriptSegments.length === 0 || busy === "followups"}
              >
                <Sparkles size={17} />
                {busy === "followups" ? "Thinking..." : "AI Follow-Ups"}
              </button>
            </div>
          </form>
        </div>

        <div className="panel">
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">AI</p>
              <h1>Recommendations</h1>
            </div>
          </div>
          {session.followUpSuggestions.length === 0 ? (
            <div className="empty-inline">
              <Sparkles size={22} />
              <span>No follow-ups yet.</span>
            </div>
          ) : (
            <div className="suggestion-list">
              {session.followUpSuggestions.map((suggestion) => (
                <article className="suggestion-item" key={suggestion.id}>
                  <div className="question-meta">
                    <ActaBadge level={suggestion.actaLevel} />
                    <span>{suggestion.focus}</span>
                  </div>
                  <p>{suggestion.text}</p>
                  <small>{suggestion.rationale}</small>
                  <button
                    className="secondary-action"
                    type="button"
                    disabled={suggestion.used}
                    onClick={() => void runAction(`use-${suggestion.id}`, () => api.markSuggestionUsed(session.id, suggestion.id))}
                  >
                    <CheckCircle2 size={16} />
                    {suggestion.used ? "Used" : "Mark Used"}
                  </button>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="workspace-grid live-grid">
        <div className="panel">
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">Transcript</p>
              <h1>Session Log</h1>
            </div>
            <span className="count-pill">{session.transcriptSegments.length}</span>
          </div>
          <div className="transcript-list">
            {session.transcriptSegments.map((segment) => (
              <article className={`transcript-row ${segment.speaker}`} key={segment.id}>
                <strong>{segment.speaker}</strong>
                <p>{segment.text}</p>
              </article>
            ))}
          </div>
          {session.transcriptSegments.length === 0 && (
            <div className="empty-inline">
              <Bot size={22} />
              <span>Interview transcript will appear here after chat exchanges are submitted.</span>
            </div>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">Outputs</p>
            <h1>Post-Interview</h1>
          </div>
          <div className="button-row">
            <button
              className="primary-action"
              type="button"
              disabled={session.status === "ended" || busy === "end"}
              onClick={() => void runAction("end", () => api.endSession(session.id))}
            >
              <FileText size={18} />
              {busy === "end" ? "Generating..." : "End & Summarize"}
            </button>
            <button
              className="secondary-action"
              type="button"
              disabled={session.transcriptSegments.length === 0 || busy === "refined"}
              onClick={() => void runAction("refined", () => api.refinedTranscript(session.id))}
            >
              <ListChecks size={17} />
              Refined Transcript
            </button>
          </div>
        </div>

        {session.summary && (
          <div className="summary-grid">
            <SummarySection title="L1 Task Map and Cognitive Hotspots" items={session.summary.taskMap} />
            <SummarySection title="L2 Tacit Expert Knowledge" items={session.summary.tacitKnowledge} />
            <SummarySection title="L3 Scenario / Incident Analysis" items={session.summary.scenarioFindings} />
            <SummarySection title="Future Exploration" items={session.summary.futureExploration} />
          </div>
        )}

        {session.refinedTranscript && (
          <div className="refined-list">
            {session.refinedTranscript.map((block) => (
              <article className="refined-block" key={block.id}>
                <strong>Interviewer</strong>
                <p>{block.interviewerQuestion}</p>
                <strong>SME</strong>
                <p>{block.smeResponse}</p>
              </article>
            ))}
          </div>
        )}
      </section>
        </>
      )}
    </section>
  );
}

interface ListItem {
  text: string;
  children: ListBlock[];
}

interface ListBlock {
  type: "list";
  ordered: boolean;
  start: number;
  items: ListItem[];
}

type RichBlock =
  | { type: "heading"; text: string; depth: number }
  | { type: "paragraph"; text: string }
  | { type: "rule" }
  | ListBlock
  | { type: "table"; rows: string[][] };

const HEADING = /^(#{1,4})\s+(.+)$/;
const LIST_ITEM = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
const HORIZONTAL_RULE = /^(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/;

function RichChatContent({ content }: { content: string }) {
  const blocks = useMemo(() => parseRichBlocks(content), [content]);

  return (
    <div className="rich-chat-content">
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          const HeadingTag = block.depth <= 1 ? "h2" : block.depth === 2 ? "h3" : "h4";
          return <HeadingTag key={`${block.type}-${index}`}>{renderInline(block.text)}</HeadingTag>;
        }

        if (block.type === "rule") {
          return <hr key={`${block.type}-${index}`} />;
        }

        if (block.type === "list") {
          return <RichList key={`${block.type}-${index}`} list={block} />;
        }

        if (block.type === "table") {
          const [header, ...body] = block.rows;
          return (
            <div className="chat-table-wrap" key={`${block.type}-${index}`}>
              <table className="chat-table">
                {header && (
                  <thead>
                    <tr>
                      {header.map((cell) => (
                        <th key={cell}>{renderCell(cell)}</th>
                      ))}
                    </tr>
                  </thead>
                )}
                <tbody>
                  {body.map((row, rowIndex) => (
                    <tr key={`${row.join("-")}-${rowIndex}`}>
                      {row.map((cell, cellIndex) => (
                        <td key={`${cell}-${cellIndex}`}>{renderCell(cell)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        return <p key={`${block.type}-${index}`}>{renderInline(block.text)}</p>;
      })}
    </div>
  );
}

function RichList({ list }: { list: ListBlock }) {
  const items = list.items.map((item, index) => (
    <li key={index}>
      {renderInline(item.text)}
      {item.children.map((child, childIndex) => (
        <RichList key={childIndex} list={child} />
      ))}
    </li>
  ));

  return list.ordered ? <ol start={list.start}>{items}</ol> : <ul>{items}</ul>;
}

function parseRichBlocks(content: string): RichBlock[] {
  // HTML comments carry the model's hidden working notes (e.g. HIDDEN_ANALYSIS) and must never render.
  const lines = content.replace(/<!--[\s\S]*?-->/g, "").split(/\r?\n/);
  const blocks: RichBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) {
      index += 1;
      continue;
    }

    if (HORIZONTAL_RULE.test(line)) {
      blocks.push({ type: "rule" });
      index += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ type: "heading", depth: heading[1].length, text: heading[2] });
      index += 1;
      continue;
    }

    if (isTableLine(line)) {
      const tableLines: string[] = [];
      while (index < lines.length && isTableLine(lines[index].trim())) {
        tableLines.push(lines[index].trim());
        index += 1;
      }
      const rows = tableLines.map(splitTableRow).filter((row) => !row.every((cell) => /^:?-{2,}:?$/.test(cell)));
      blocks.push({ type: "table", rows });
      continue;
    }

    if (LIST_ITEM.test(lines[index])) {
      const list = parseList(lines, index);
      blocks.push(list.block);
      index = list.next;
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const current = lines[index].trim();
      if (!current || startsBlock(current) || LIST_ITEM.test(current)) {
        break;
      }
      paragraphLines.push(current);
      index += 1;
    }
    blocks.push({ type: "paragraph", text: paragraphLines.join("\n") });
  }

  return blocks;
}

interface OpenList {
  indent: number;
  list: ListBlock;
  parent: ListItem | null;
}

// Nesting follows indentation; blank lines only continue the list when the next item still belongs to it.
function parseList(lines: string[], start: number): { block: ListBlock; next: number } {
  const open: OpenList[] = [];
  let index = start;

  while (index < lines.length) {
    const match = LIST_ITEM.exec(lines[index]);

    if (!match) {
      const text = lines[index].trim();
      if (text) {
        const lastItem = open[open.length - 1].list.items.at(-1);
        if (!lastItem || !/^\s{2,}/.test(lines[index]) || startsBlock(text)) {
          break;
        }
        lastItem.text += ` ${text}`;
        index += 1;
        continue;
      }

      let next = index + 1;
      while (next < lines.length && !lines[next].trim()) {
        next += 1;
      }
      const upcoming = next < lines.length ? LIST_ITEM.exec(lines[next]) : null;
      const root = open[0];
      if (!upcoming || (listIndent(upcoming) <= root.indent && isOrderedMarker(upcoming[2]) !== root.list.ordered)) {
        break;
      }
      index = next;
      continue;
    }

    const indent = listIndent(match);
    const ordered = isOrderedMarker(match[2]);

    if (open.length === 0) {
      open.push({ indent, list: newList(ordered, match[2]), parent: null });
    } else {
      while (open.length > 1 && indent < open[open.length - 1].indent) {
        open.pop();
      }
      const top = open[open.length - 1];
      if (indent > top.indent) {
        const parent = top.list.items[top.list.items.length - 1];
        const child = newList(ordered, match[2]);
        parent.children.push(child);
        open.push({ indent, list: child, parent });
      } else if (top.list.ordered !== ordered) {
        if (!top.parent) {
          break;
        }
        const sibling = newList(ordered, match[2]);
        top.parent.children.push(sibling);
        open[open.length - 1] = { indent, list: sibling, parent: top.parent };
      }
    }

    open[open.length - 1].list.items.push({ text: match[3], children: [] });
    index += 1;
  }

  return { block: open[0].list, next: index };
}

function newList(ordered: boolean, marker: string): ListBlock {
  return { type: "list", ordered, start: ordered ? Number.parseInt(marker, 10) : 1, items: [] };
}

function listIndent(match: RegExpExecArray): number {
  return match[1].replaceAll("\t", "    ").length;
}

function isOrderedMarker(marker: string): boolean {
  return /^\d/.test(marker);
}

function startsBlock(line: string): boolean {
  return HORIZONTAL_RULE.test(line) || HEADING.test(line) || isTableLine(line);
}

function isTableLine(line: string): boolean {
  return line.startsWith("|") && line.endsWith("|");
}

function splitTableRow(line: string): string[] {
  return line
    .slice(1, -1)
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replaceAll("\\|", "|"));
}

function renderCell(text: string) {
  return text.split(/<br\s*\/?>/i).map((line, index) => (
    <Fragment key={index}>
      {index > 0 && <br />}
      {renderInline(line.trim().replace(/^[-*]\s+/, "• "))}
    </Fragment>
  ));
}

function renderInline(text: string): ReactNode[] {
  // Captured tokens land at odd indexes: `code`, **bold**, *italic*.
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s](?:[^*]*[^*\s])?\*)/g).map((part, index) => {
    if (index % 2 === 0) {
      return <span key={index}>{part}</span>;
    }

    if (part.startsWith("`")) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }

    if (part.startsWith("**")) {
      return <strong key={index}>{renderInline(part.slice(2, -2))}</strong>;
    }

    return <em key={index}>{renderInline(part.slice(1, -1))}</em>;
  });
}

function SummarySection({ title, items }: { title: string; items: string[] }) {
  return (
    <article className="summary-section">
      <h2>{title}</h2>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </article>
  );
}

function pickMimeType(): string | undefined {
  const preferred = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return preferred.find((type) => MediaRecorder.isTypeSupported(type));
}
