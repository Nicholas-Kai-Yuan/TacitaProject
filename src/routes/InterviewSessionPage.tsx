import { FormEvent, Fragment, type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Loader2, MessageSquareText, Mic, Send, Square } from "lucide-react";
import { api } from "../api/client";
import { chatThreadTitle } from "../tacitaTool";
import type { InterviewSession } from "../../shared/types";

export default function InterviewSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [session, setSession] = useState<InterviewSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chatMessage, setChatMessage] = useState("");
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [recording, setRecording] = useState<"idle" | "recording" | "transcribing">("idle");
  const recorderRef = useRef<MediaRecorder | null>(null);

  useEffect(() => {
    if (sessionId) {
      void loadSession(sessionId);
    }
  }, [sessionId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [session?.chatMessages.length]);

  // Release the microphone if the page closes mid-recording.
  useEffect(
    () => () => {
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.stop();
      }
      recorder?.stream.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  // The input grows with its text; CSS sets the starting height and the cap.
  useEffect(() => {
    const input = chatInputRef.current;
    if (input) {
      input.style.height = "auto";
      input.style.height = `${input.scrollHeight}px`;
    }
  }, [chatMessage]);

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

  async function sendChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitChatMessage(chatMessage);
  }

  // Enter sends; Shift+Enter adds a new line.
  function handleChatKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  function toggleRecording() {
    if (recording === "recording") {
      recorderRef.current?.stop();
    } else if (recording === "idle") {
      void startRecording();
    }
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("This browser cannot record audio.");
      return;
    }

    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: pickAudioMimeType() });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        void transcribeRecording(new Blob(chunks, { type: recorder.mimeType }));
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording("recording");
    } catch (micError) {
      setError(micError instanceof Error ? `Microphone unavailable: ${micError.message}` : "Microphone unavailable");
    }
  }

  // The transcript is added to the reply box for review rather than sent straight away.
  async function transcribeRecording(audio: Blob) {
    if (!session) {
      return;
    }

    setRecording("transcribing");
    try {
      const { text } = await api.transcribe(session.id, audio);
      if (text) {
        setChatMessage((current) => (current.trim() ? `${current.trimEnd()}
${text}` : text));
        chatInputRef.current?.focus();
      } else {
        setError("No speech was detected in the recording.");
      }
    } catch (transcribeError) {
      setError(transcribeError instanceof Error ? transcribeError.message : "Transcription failed");
    } finally {
      setRecording("idle");
    }
  }

  async function submitChatMessage(message: string) {
    if (!session || !message.trim()) {
      return;
    }

    const text = message.trim();
    setChatMessage("");
    await runAction("chat", () => api.chat(session.id, text));
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
          <h1>{chatThreadTitle(session.settingSnapshot)}</h1>
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
          <textarea
            ref={chatInputRef}
            value={chatMessage}
            onChange={(event) => setChatMessage(event.target.value)}
            onKeyDown={handleChatKeyDown}
            rows={4}
            placeholder={chatPlaceholder(session.status === "ended", recording)}
            disabled={session.status === "ended" || busy === "chat"}
          />
          <button
            className={`icon-button mic-button${recording === "recording" ? " recording" : ""}`}
            type="button"
            onClick={toggleRecording}
            disabled={recording === "transcribing" || session.status === "ended"}
            title={MIC_BUTTON_LABELS[recording]}
            aria-label={MIC_BUTTON_LABELS[recording]}
          >
            {recording === "recording" && <Square size={16} />}
            {recording === "transcribing" && <Loader2 className="spin" size={18} />}
            {recording === "idle" && <Mic size={18} />}
          </button>
          <button
            className="icon-button solid"
            type="submit"
            disabled={!chatMessage.trim() || session.status === "ended" || busy === "chat"}
            title="Send"
          >
            <Send size={18} />
          </button>
        </form>

        {session.starterQuestions.length > 0 && session.status !== "ended" && (
          <div className="button-row chat-shortcuts">
            <button
              className="secondary-action"
              type="button"
              onClick={() => void runAction("start", () => api.startSession(session.id))}
              disabled={busy === "start" || session.status === "in_progress"}
            >
              <Mic size={16} />
              Mic On
            </button>
          </div>
        )}
      </section>
    </section>
  );
}

const MIC_BUTTON_LABELS = {
  idle: "Record",
  recording: "Stop recording and transcribe",
  transcribing: "Transcribing...",
};

function chatPlaceholder(ended: boolean, recording: keyof typeof MIC_BUTTON_LABELS): string {
  if (ended) {
    return "Interview ended";
  }
  if (recording === "recording") {
    return "Recording... click stop to transcribe";
  }
  return recording === "transcribing" ? "Transcribing recording..." : "Proceed, Mic On, transcript, or End";
}

function pickAudioMimeType(): string | undefined {
  const preferred = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return preferred.find((type) => MediaRecorder.isTypeSupported(type));
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
