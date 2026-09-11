import "dotenv/config";
import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import {
  createChatReply,
  createEndInterviewReply,
  createFollowUps,
  createLiveInterviewTurnReply,
  createMicOnReply,
  createPreInterviewChecklistReply,
  createRefinedTranscript,
  createStarterQuestionFlowReply,
  createStarterQuestions,
  createSummary,
  hasPreInterviewChecklist,
  isConfirmationCommand,
  isEndInterviewCommand,
  isProceedCommand,
  isStartInterviewCommand,
} from "./ai";
import { createAuthSession, getAuth, requireRole } from "./auth";
import {
  addChatExchange,
  addDiagnostic,
  addFollowUps,
  addTranscriptSegment,
  authenticateAccount,
  approveQuestions,
  createManagedAccount,
  createSession,
  createSetting,
  deleteManagedAccount,
  deleteSetting,
  endSession,
  ensureBootstrapAccounts,
  getSession,
  listInterviewers,
  listManagedAccounts,
  listSessions,
  listSettings,
  markSuggestionUsed,
  setRefinedTranscript,
  setStarterQuestions,
  startSession,
  updateManagedAccount,
  updateQuestion,
  updateSetting,
  updateSettingAccess,
} from "./store";
import {
  chatInputSchema,
  interviewSettingInputSchema,
  managedAccountInputSchema,
  managedAccountUpdateSchema,
  settingAccessInputSchema,
  transcriptSegmentInputSchema,
} from "../shared/validation";

const app = express();
const server = createServer(app);
const port = Number(process.env.PORT ?? 8787);
const clientOrigin = process.env.CLIENT_ORIGIN ?? "http://127.0.0.1:5173";

app.use(cors({ origin: clientOrigin }));
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    ai: Boolean(process.env.OPENAI_API_KEY),
    stt: Boolean(process.env.STT_PROVIDER && process.env.STT_API_KEY),
  });
});

app.post("/api/auth/login", async (request, response, next) => {
  try {
  const username = String(request.body?.username ?? "");
  const password = String(request.body?.password ?? "");
    const account = await authenticateAccount(username, password);

    if (!account) {
      response.status(401).json({ error: "Invalid username or password" });
      return;
    }

    response.json(
      createAuthSession({
        accountId: account.id,
        username: account.username,
        displayName: account.displayName,
        role: account.role,
      }),
    );
  } catch (error) {
    next(error);
  }
});

app.get("/api/accounts", requireRole("it_admin"), async (_request, response, next) => {
  try {
    response.json(await listManagedAccounts());
  } catch (error) {
    next(error);
  }
});

app.post("/api/accounts", requireRole("it_admin"), async (request, response, next) => {
  try {
    const input = managedAccountInputSchema.parse(request.body);
    response.status(201).json(await createManagedAccount(input));
  } catch (error) {
    next(error);
  }
});

app.put("/api/accounts/:id", requireRole("it_admin"), async (request, response, next) => {
  try {
    const input = managedAccountUpdateSchema.parse(request.body);
    const account = await updateManagedAccount(routeParam(request, "id"), {
      ...input,
      password: input.password || undefined,
    });
    if (!account) {
      response.status(404).json({ error: "Account not found" });
      return;
    }

    response.json(account);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/accounts/:id", requireRole("it_admin"), async (request, response, next) => {
  try {
    const deleted = await deleteManagedAccount(routeParam(request, "id"));
    if (!deleted) {
      response.status(404).json({ error: "Account not found" });
      return;
    }

    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get("/api/accounts/interviewers", requireRole("admin", "it_admin"), async (_request, response, next) => {
  try {
    response.json(await listInterviewers());
  } catch (error) {
    next(error);
  }
});

app.get("/api/settings", requireRole("admin", "interviewer"), async (_request, response, next) => {
  try {
    response.json(await listSettings(getAuth(response)));
  } catch (error) {
    next(error);
  }
});

app.post("/api/settings", requireRole("admin"), async (request, response, next) => {
  try {
    const input = interviewSettingInputSchema.parse(request.body);
    response.status(201).json(await createSetting(input));
  } catch (error) {
    next(error);
  }
});

app.patch("/api/settings/:id/access", requireRole("admin"), async (request, response, next) => {
  try {
    const input = settingAccessInputSchema.parse(request.body);
    const setting = await updateSettingAccess(routeParam(request, "id"), input.interviewerAccountId);
    if (!setting) {
      response.status(404).json({ error: "Interview setting not found" });
      return;
    }

    response.json(setting);
  } catch (error) {
    next(error);
  }
});

app.put("/api/settings/:id", requireRole("admin"), async (request, response, next) => {
  try {
    const input = interviewSettingInputSchema.parse(request.body);
    const setting = await updateSetting(routeParam(request, "id"), input);
    if (!setting) {
      response.status(404).json({ error: "Interview setting not found" });
      return;
    }

    response.json(setting);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/settings/:id", requireRole("admin"), async (request, response, next) => {
  try {
    const deleted = await deleteSetting(routeParam(request, "id"));
    if (!deleted) {
      response.status(404).json({ error: "Interview setting not found" });
      return;
    }

    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get("/api/sessions", requireRole("interviewer"), async (_request, response, next) => {
  try {
    response.json(await listSessions(getAuth(response).accountId));
  } catch (error) {
    next(error);
  }
});

app.post("/api/sessions", requireRole("interviewer"), async (request, response, next) => {
  try {
    const auth = getAuth(response);
    const settingId = String(request.body?.settingId ?? "");
    const session = await createSession(settingId, auth.accountId);
    if (!session) {
      response.status(403).json({ error: "You do not have access to this interview setting" });
      return;
    }

    response.status(201).json(session);
  } catch (error) {
    next(error);
  }
});

app.get("/api/sessions/:id", requireRole("interviewer"), async (request, response, next) => {
  try {
    const session = await getSession(routeParam(request, "id"), getAuth(response).accountId);
    if (!session) {
      response.status(404).json({ error: "Interview session not found" });
      return;
    }

    response.json(session);
  } catch (error) {
    next(error);
  }
});

app.post("/api/sessions/:id/generate-starter-questions", requireRole("interviewer"), async (request, response, next) => {
  try {
    const auth = getAuth(response);
    const session = await getSession(routeParam(request, "id"), auth.accountId);
    if (!session) {
      response.status(404).json({ error: "Interview session not found" });
      return;
    }

    const questions = await createStarterQuestions(session.settingSnapshot);
    response.json(await setStarterQuestions(session.id, questions, auth.accountId));
  } catch (error) {
    next(error);
  }
});

app.patch("/api/sessions/:id/questions/:questionId", requireRole("interviewer"), async (request, response, next) => {
  try {
    const auth = getAuth(response);
    const session = await updateQuestion(
      routeParam(request, "id"),
      routeParam(request, "questionId"),
      request.body ?? {},
      auth.accountId,
    );
    if (!session) {
      response.status(404).json({ error: "Interview session or question not found" });
      return;
    }

    response.json(session);
  } catch (error) {
    next(error);
  }
});

app.post("/api/sessions/:id/approve-questions", requireRole("interviewer"), async (request, response, next) => {
  try {
    const session = await approveQuestions(routeParam(request, "id"), getAuth(response).accountId);
    if (!session) {
      response.status(404).json({ error: "Interview session not found" });
      return;
    }

    response.json(session);
  } catch (error) {
    next(error);
  }
});

app.post("/api/sessions/:id/start", requireRole("interviewer"), async (request, response, next) => {
  try {
    const session = await startSession(routeParam(request, "id"), getAuth(response).accountId);
    if (!session) {
      response.status(404).json({ error: "Interview session not found" });
      return;
    }

    response.json(session);
  } catch (error) {
    next(error);
  }
});

app.post("/api/sessions/:id/transcript", requireRole("interviewer"), async (request, response, next) => {
  try {
    const auth = getAuth(response);
    const input = transcriptSegmentInputSchema.parse(request.body);
    const session = await addTranscriptSegment(routeParam(request, "id"), {
      ...input,
      submittedForAi: input.submittedForAi ?? false,
    }, auth.accountId);
    if (!session) {
      response.status(404).json({ error: "Interview session not found" });
      return;
    }

    response.status(201).json(session);
  } catch (error) {
    next(error);
  }
});

app.post("/api/sessions/:id/followups", requireRole("interviewer"), async (request, response, next) => {
  try {
    const auth = getAuth(response);
    const session = await getSession(routeParam(request, "id"), auth.accountId);
    if (!session) {
      response.status(404).json({ error: "Interview session not found" });
      return;
    }

    const suggestions = await createFollowUps(session);
    response.json(await addFollowUps(session.id, suggestions, auth.accountId));
  } catch (error) {
    next(error);
  }
});

app.post("/api/sessions/:id/suggestions/:suggestionId/use", requireRole("interviewer"), async (request, response, next) => {
  try {
    const auth = getAuth(response);
    const session = await markSuggestionUsed(
      routeParam(request, "id"),
      routeParam(request, "suggestionId"),
      auth.accountId,
    );
    if (!session) {
      response.status(404).json({ error: "Interview session or suggestion not found" });
      return;
    }

    response.json(session);
  } catch (error) {
    next(error);
  }
});

app.post("/api/sessions/:id/chat", requireRole("interviewer"), async (request, response, next) => {
  try {
    const auth = getAuth(response);
    const { message } = chatInputSchema.parse(request.body);
    const session = await getSession(routeParam(request, "id"), auth.accountId);
    if (!session) {
      response.status(404).json({ error: "Interview session not found" });
      return;
    }

    if (isEndInterviewCommand(message)) {
      const summary = await createSummary(session);
      const reply = createEndInterviewReply(session, summary);
      await endSession(session.id, summary, auth.accountId);
      response.json(await addChatExchange(session.id, message, reply, auth.accountId));
      return;
    }

    if (session.starterQuestions.length === 0) {
      const checklistAlreadyShown = hasPreInterviewChecklist(session);

      if (checklistAlreadyShown && isConfirmationCommand(message)) {
        const questions = await createStarterQuestions(session.settingSnapshot);
        await setStarterQuestions(session.id, questions, auth.accountId);
        await approveQuestions(session.id, auth.accountId);

        const readySession = await getSession(session.id, auth.accountId);
        if (!readySession) {
          response.status(404).json({ error: "Interview session not found" });
          return;
        }

        const reply = createStarterQuestionFlowReply(readySession);
        response.json(await addChatExchange(session.id, message, reply, auth.accountId));
        return;
      }

      if (isProceedCommand(message)) {
        const reply = await createPreInterviewChecklistReply(session.settingSnapshot);
        response.json(await addChatExchange(session.id, message, reply, auth.accountId));
        return;
      }

      const reply = await createChatReply(session, message);
      response.json(await addChatExchange(session.id, message, reply, auth.accountId));
      return;
    }

    if (isStartInterviewCommand(message)) {
      const startedSession = session.status === "in_progress"
        ? session
        : await startSession(session.id, auth.accountId);
      if (!startedSession) {
        response.status(404).json({ error: "Interview session not found" });
        return;
      }

      const reply = createMicOnReply(startedSession);
      response.json(await addChatExchange(session.id, message, reply, auth.accountId));
      return;
    }

    const activeSession = session.status === "in_progress"
      ? session
      : await startSession(session.id, auth.accountId);
    if (!activeSession) {
      response.status(404).json({ error: "Interview session not found" });
      return;
    }

    await addTranscriptSegment(session.id, {
      speaker: "unknown",
      text: message,
      submittedForAi: true,
    }, auth.accountId);

    const withTranscript = await getSession(session.id, auth.accountId);
    if (!withTranscript) {
      response.status(404).json({ error: "Interview session not found" });
      return;
    }

    const nextQuestion = withTranscript.starterQuestions.find((question) => question.status === "planned");
    if (nextQuestion) {
      await updateQuestion(session.id, nextQuestion.id, { status: "asked" }, auth.accountId);
    }

    const afterQuestionUpdate = await getSession(session.id, auth.accountId);
    if (!afterQuestionUpdate) {
      response.status(404).json({ error: "Interview session not found" });
      return;
    }

    const suggestions = await createFollowUps(afterQuestionUpdate);
    await addFollowUps(session.id, suggestions, auth.accountId);

    const coachedSession = await getSession(session.id, auth.accountId);
    if (!coachedSession) {
      response.status(404).json({ error: "Interview session not found" });
      return;
    }

    const reply = await createLiveInterviewTurnReply(coachedSession, message);
    response.json(await addChatExchange(session.id, message, reply, auth.accountId));
  } catch (error) {
    next(error);
  }
});

app.post("/api/sessions/:id/end", requireRole("interviewer"), async (request, response, next) => {
  try {
    const auth = getAuth(response);
    const session = await getSession(routeParam(request, "id"), auth.accountId);
    if (!session) {
      response.status(404).json({ error: "Interview session not found" });
      return;
    }

    const summary = await createSummary(session);
    response.json(await endSession(session.id, summary, auth.accountId));
  } catch (error) {
    next(error);
  }
});

app.post("/api/sessions/:id/refined-transcript", requireRole("interviewer"), async (request, response, next) => {
  try {
    const auth = getAuth(response);
    const session = await getSession(routeParam(request, "id"), auth.accountId);
    if (!session) {
      response.status(404).json({ error: "Interview session not found" });
      return;
    }

    const refinedTranscript = await createRefinedTranscript(session);
    response.json(await setRefinedTranscript(session.id, refinedTranscript, auth.accountId));
  } catch (error) {
    next(error);
  }
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(__dirname, "..", "dist");

if (existsSync(distPath)) {
  app.use(express.static(distPath));
  app.use((request, response, next) => {
    if (request.method !== "GET" || request.path.startsWith("/api") || request.path.startsWith("/audio")) {
      next();
      return;
    }

    response.sendFile(path.join(distPath, "index.html"));
  });
}

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const pathname = new URL(request.url ?? "", `http://${request.headers.host}`).pathname;
  if (!pathname.startsWith("/audio/")) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (websocket) => {
    wss.emit("connection", websocket, request);
  });
});

wss.on("connection", (websocket, request) => {
  const pathname = new URL(request.url ?? "", `http://${request.headers.host}`).pathname;
  const sessionId = decodeURIComponent(pathname.replace("/audio/", ""));
  let chunkCount = 0;

websocket.on("message", async (message) => {
    chunkCount += 1;
    if (chunkCount === 1) {
      await addDiagnostic(sessionId, "Audio ingress connected. Configure an STT provider to transcribe audio chunks.");
    }

    websocket.send(
      JSON.stringify({
        type: "audio_ack",
        bytes: getRawDataLength(message),
        chunkCount,
        transcribed: false,
      }),
    );
  });

  websocket.on("close", async () => {
    await addDiagnostic(sessionId, `Audio ingress closed after ${chunkCount} chunks.`);
  });
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  if (error && typeof error === "object" && "issues" in error) {
    response.status(400).json({ error: "Validation failed", details: error });
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Username already exists")) {
    response.status(400).json({ error: "Username already exists" });
    return;
  }

  if (message.includes("does not have access")) {
    response.status(403).json({ error: "You do not have access to this resource" });
    return;
  }

  if (message.includes("not found")) {
    response.status(404).json({ error: "Resource not found" });
    return;
  }

  console.error(error);
  response.status(500).json({ error: "Unexpected server error" });
});

ensureBootstrapAccounts()
  .then(() => {
    server.listen(port, () => {
      console.log(`TACITA API listening on http://127.0.0.1:${port}`);
    });
  })
  .catch((error) => {
    console.error("TACITA API failed to bootstrap Convex accounts.", error);
    process.exit(1);
  });

function routeParam(request: express.Request, name: string): string {
  const value = request.params[name];
  return Array.isArray(value) ? value[0] : value;
}

function getRawDataLength(message: Parameters<WebSocketServer["emit"]>[1]): number {
  if (typeof message === "string") {
    return Buffer.byteLength(message);
  }

  if (message instanceof ArrayBuffer) {
    return message.byteLength;
  }

  if (Array.isArray(message)) {
    return message.reduce((total, item) => total + item.byteLength, 0);
  }

  return message.byteLength;
}
